// V5.0 Phase M-1 — Auto-summary.
//
// 배경: 긴 대화 컨텍스트를 LLM 호출에 전부 보내면 토큰 부담 ↑ + 컨텍스트
// 손실 (trimHistory가 6 turn으로 자름). 임계점 (msgs >= 20 || chars >= 4000)
// 도달 시 별도 Gemini 호출로 thread 핵심을 요약 → memory layer에 영속 →
// 이후 dispatch는 summary + recent N (10) 만 보냄.
//
// 토큰 측정: Korean Gemini 토큰 ≈ 0.3-0.5 char/token. char count는 토큰의
// 보수적 상한 (실제 토큰은 더 적음). 4000 chars 임계점은 ~6000-12000 token
// 등가라 cloud LLM context window (Gemini 2.5 Flash 1M) 대비 작지만 비용
// 인지 + 응답 속도 우선이라 보수적 박음.
//
// 생성 시점: sync (사용자 다음 입력 차단). 첫 임계 도달 시 ~1-2s 추가 latency
// 발생 → trace에 "이전 대화 요약 중…" 라벨로 비용 인지. 이후 메시지는 기존
// summary 활용 (생성 X) 이라 latency 영향 0.
//
// 재요약 정책: thread당 1 summary 유지. 새 임계점 도달 시 supersede.
// MVP — accumulating summary chain (summary-of-summary) 는 미구현.

import type { DispatchTurn } from "@/lib/ai/dispatch";
import { askLLM } from "@/lib/ai/llm";
import { getCallOverride } from "@/lib/ai/override";
import { getSummaryForThread, putSummary } from "./store";
import type { ConversationSummary } from "./types";

// V5.0 Phase M-1: 임계점 — Tei 박은 값. 둘 중 하나라도 hit이면 generation.
//   - 20 messages: 짧은 turn 누적 케이스
//   - 4000 chars: 긴 응답 (cloud LLM이 답변 길게) 누적 케이스
export const SUMMARY_TRIGGER = {
  messages: 20,
  chars: 4000,
} as const;

// 새 summary 생성 후 dispatch가 보내는 recent message 개수. 임계점이 20
// msg이라 10이면 절반은 summary로, 절반은 raw multi-turn으로.
export const RECENT_AFTER_SUMMARY = 10;

// V5.0 Phase M-1: 요약 전용 system prompt. DOTS 정직성 헌법은 유지하되
// 요약 task에 특화. cloud Gemini 호출.
//
// 보존 측면 (Tei 박음):
//   1. 사용자가 박은 주요 정보 / 선호
//   2. 대화 영역 (cooking / study / 등)
//   3. 미해결 / 진행 중 항목
//   4. 사용자 톤 / 패턴
const SUMMARY_SYSTEM_PROMPT = [
  "당신은 DOTS의 대화 요약 모듈입니다. 사용자의 한국어 대화를 핵심만 보존해 짧게 요약합니다.",
  "",
  "원칙:",
  "- 한국어로만 답변. 다른 언어 X.",
  "- 추측·환각 X. 메시지에 없는 정보 박지 마.",
  "- 5-8 문장 이내. bullet 또는 짧은 문단.",
  "",
  "보존 측면:",
  "1. 사용자가 박은 주요 정보 / 선호 (좋아하는 음식·과목·습관 등 명시된 것).",
  "2. 대화 영역 (cooking / study / routine / 자유 — 어느 도메인인지).",
  "3. 미해결 / 진행 중 항목 (사용자가 답을 기다리거나 후속 액션 필요한 것).",
  "4. 사용자 톤 / 패턴 (격식·존대 정도, 짧게 묻는 편 / 길게 풀어쓰는 편 등).",
  "",
  "결과 형식:",
  "[요약]",
  "(5-8 문장으로 위 4 측면 보존)",
].join("\n");

// History → 단일 평문. user/assistant 라벨 보존해 LLM이 누가 뭘 말했는지 인지.
function historyToPlain(history: DispatchTurn[]): string {
  return history.map((t) => `${t.role === "user" ? "사용자" : "DOTS"}: ${t.content}`).join("\n\n");
}

// char count proxy로 토큰 추정. 한국어 Gemini 토큰은 1 token ≈ 2-3 chars
// 라 char count는 token 상한 추정. 4000 chars 임계점도 같은 가정.
export function estimateTokens(history: DispatchTurn[]): number {
  return history.reduce((sum, t) => sum + t.content.length, 0);
}

// 임계점 검사. msg 길이 또는 char 합 둘 중 하나라도 hit이면 true.
export function shouldSummarize(history: DispatchTurn[]): boolean {
  if (history.length >= SUMMARY_TRIGGER.messages) return true;
  if (estimateTokens(history) >= SUMMARY_TRIGGER.chars) return true;
  return false;
}

// 기존 summary가 있으면 그 시점 이후 message만 카운트. 첫 임계 hit 후 두번째
// 임계 hit 까지의 거리 측정용 (재요약 트리거).
export function shouldResummarize(history: DispatchTurn[], existing: ConversationSummary): boolean {
  // 기존 summary가 cover한 만큼 빼고 남은 history만 본다.
  const remaining = history.slice(existing.sourceMessagesCount);
  return shouldSummarize(remaining);
}

// 메인 엔트리. compose.ts가 dispatch 호출 전에 부른다. 임계 미도달이면
// null. 임계 도달이지만 LLM 실패 시도 null (caller는 전체 history 그대로).
export async function maybeGenerateSummary(args: {
  threadId: string;
  history: DispatchTurn[];
}): Promise<ConversationSummary | null> {
  const { threadId, history } = args;
  if (history.length === 0) return null;

  const existing = getSummaryForThread(threadId);

  // 기존 summary 있으면 추가 임계점 도달 여부만 체크.
  if (existing) {
    if (!shouldResummarize(history, existing)) return existing;
  } else {
    if (!shouldSummarize(history)) return null;
  }

  try {
    // V5.0 Phase M-1: 요약은 별도 cloud LLM 호출 (active provider = LLM_PROVIDER).
    // 비용 인지 — 정상 turn이 끝난 직후 한 번 추가 호출. 응답 latency ~1-2s 더 발생.
    const plain = historyToPlain(history);
    const tokensUsed = plain.length;
    const { text, usage } = await askLLM({
      data: {
        userMessage: plain,
        systemPrompt: SUMMARY_SYSTEM_PROMPT,
        // Follow a measurement run's pinned provider/temperature, if any.
        ...getCallOverride(),
      },
    });

    const summary: ConversationSummary = {
      id: `summary-${threadId}`,
      threadId,
      content: text.trim(),
      createdAt: Date.now(),
      sourceMessagesCount: history.length,
      tokensUsed,
      usageInputTokens: usage?.inputTokens,
      usageOutputTokens: usage?.outputTokens,
    };
    putSummary(summary);

    if (import.meta.env.DEV) {
      console.log("[summary]", {
        threadId,
        sourceMessagesCount: history.length,
        tokensUsed,
        contentLen: summary.content.length,
        supersede: !!existing,
      });
    }

    return summary;
  } catch (err) {
    console.error("[summary] generation failed", err);
    return existing ?? null;
  }
}
