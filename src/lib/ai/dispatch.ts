// Single entry point for every LLM call DOTS makes after Stage 3 routing.
// Picks WebLLM or Gemini based on the user's preference and the current
// engine readiness, optionally streams tokens, and returns the final
// text + which provider answered.
//
// CONSTITUTION: 매칭 hit (Stage 1, 2)에서는 이 함수를 부르지 않는다 —
// LLM 호출 자체가 사용자가 명시적으로 선택한 결과여야 한다는 헌법.
// dispatch는 Stage 3 + onSuggestionAction llm-call에서만.
//
// Provider semantics (사용자 시점 정정 후):
//   gemini-only (default) — 외부 API. 정확하고 자연스러운 응답. 일반
//                           사용자가 첫 설치 후 그대로 작동.
//   webllm-only           — 외부 호출 X. WebLLM 미로드 시 throw — 호출
//                           쪽이 "다운로드 필요" UI를 띄우게 한다.
// 폐기된 "webllm-first": WebLLM↔Gemini 자동 fallback이 응답 품질을
// 예측 불가능하게 만들고 ("양자역학" 2줄 환각 vs 풍부한 답이 무작위로
// 섞임), 사용자에게 부정확한 응답을 강제하던 어중간한 모드.

import type { AnswerPayload, Pack } from "@/lib/dots-data";
import type { LookupResult } from "@/lib/memory/lookup";
import type { ConversationSummary } from "@/lib/memory/types";
import type { Intent } from "@/lib/packs/intent";
// WebLLM 분기는 일시 비활성화 (2026-04-30). 모듈은 살려두고 imports만
// 정리. callWebLLM / isWebLLMReady 같은 dead helper도 미래 재활성화를
// 위해 그대로 둔다 (ESLint unused-vars off — CLAUDE.md 룰).
import { generateWithWebLLM, getWebLLMStatus, type WebLLMStatus } from "@/lib/webllm";
// Phase M0-5: Memory Activation — cloud 호출 시 사용자 선호 컨텍스트 inject.
import { getLastSudokuPlay, listPreferences } from "@/lib/learning";
import { askLLM } from "./llm";
import { getCallOverride } from "./override";
import type { LLMHistoryTurn, LLMUsage, ProviderId } from "./providers/types";
// V5.0 Phase P-2: 통일 system prompt 빌더. compose + dispatch 2-layer 통합.
import { buildSystemPrompt } from "./system-prompt";

export type DispatchTurn = { role: "user" | "assistant"; content: string };

// Last N turns kept as multi-turn context. 6 = 3 user/assistant pairs —
// enough for "수학말고 다른거" style follow-ups, light enough to stay
// well under any model's context window even with long replies.
const HISTORY_LIMIT = 6;

export type DispatchInput = {
  userMessage: string;
  // Caller-supplied persona override. Appended after DOTS_CHARTER + pack
  // persona — used by study LLM (TUTOR_PERSONA), suggestion onClick
  // (action_options[].systemPrompt 등). DOTS 헌법은 유지되며 caller persona는
  // 가장 마지막 섹션 (LLM 응답 결정 직전).
  systemPrompt?: string;
  history?: DispatchTurn[];
  // When provided, voice/tone get prepended to the system prompt so the
  // model takes on the pack's persona. The prompt itself stays as-is for
  // call sites (SAT 출제 등) that already crafted a complete prompt.
  pack?: Pack;
  // V3 라우터에서 분류된 사용자 의도. casual일 때만 시스템 프롬프트에
  // 짧은 인사 디시플린을 더한다 — definition/search/recommend는
  // 기존 프롬프트로 충분.
  intent?: Intent;
  // V5.0 Phase P-2: composeAnswer가 dispatch에 직접 메모리·payload 컨텍스트를
  // 전달. 이전 2-layer 구조에서는 compose가 buildSystemPrompt 결과 string을
  // input.systemPrompt 로 넘겨 dispatch가 다시 추가 디시플린 prepend 했다.
  // 이제는 unified builder가 둘을 한 곳에서 처리.
  memory?: LookupResult;
  payloadKind?: AnswerPayload["kind"];
  // V5.0 Phase M-1: thread-level 요약. compose가 maybeGenerateSummary 호출
  // 후 결과를 박으면 buildSystemPrompt에 CONVERSATION_SUMMARY 섹션이 추가됨.
  // history도 caller가 recent N (예: 10) 만 보내야 — summary와 history가
  // overlap되지 않도록.
  summary?: ConversationSummary;
  // V5.0 Phase I-5: cloud-direct 모드. 박혀 있으면 pack 컨텍스트는 단순 참고로
  // 변환 + CLOUD_DISCIPLINE 박힘 (Pack 이름 언급 X). 미박힘 = pack identity.
  cloudMode?: boolean;
  // Phase EN-1: 입력 언어. "en" → buildSystemPrompt가 모든 섹션을 영어 미러로
  // 교체. 미박힘 또는 "ko" → 기존 한국어 그대로.
  lang?: "ko" | "en";
  // Measurement / side-by-side: pin this call to one provider and temperature.
  // Omitted → server default (LLM_PROVIDER), same as before.
  provider?: ProviderId;
  temperature?: number;
};

export type DispatchResult = {
  text: string;
  // "webllm" kept for the dormant on-device branch; cloud answers carry the
  // actual ProviderId chosen by LLM_PROVIDER (gemini | openai | claude | grok).
  provider: "webllm" | ProviderId;
  // Cloud answers only: concrete model, provider-reported token counts, and
  // the size of the system prompt Stipple added (charter + pack + memory +
  // USER_CONTEXT) so its overhead can be accounted for honestly.
  model?: string;
  usage?: LLMUsage;
  truncated?: boolean;
  systemPromptChars?: number;
};

// V5.0 Phase P-2: 헌법·디시플린 / RECOMMENDATION_HINTS / hasRecommendationIntent
// / 2-layer buildSystemPrompt — 모두 system-prompt.ts 로 이전. 이 모듈은
// provider 호출 + history trim 만 담당.

function trimHistory(history: DispatchTurn[] | undefined): DispatchTurn[] {
  if (!history || history.length === 0) return [];
  return history.slice(-HISTORY_LIMIT);
}

function isWebLLMReady(status: WebLLMStatus): boolean {
  return status.state === "ready" || status.state === "generating";
}

async function callLLM(
  input: DispatchInput,
  systemPrompt: string | undefined,
  history: DispatchTurn[],
): Promise<DispatchResult> {
  // A measurement run pins provider + temperature for every Stipple call.
  const override = getCallOverride();
  const { text, provider, model, usage, truncated } = await askLLM({
    data: {
      userMessage: input.userMessage,
      systemPrompt,
      history: history as LLMHistoryTurn[],
      provider: input.provider ?? override.provider,
      temperature: input.temperature ?? override.temperature,
      maxOutputTokens: override.maxOutputTokens,
    },
  });
  return {
    text,
    provider,
    model,
    usage,
    truncated,
    systemPromptChars: systemPrompt?.length ?? 0,
  };
}

async function callWebLLM(
  input: DispatchInput,
  systemPrompt: string | undefined,
  history: DispatchTurn[],
  onToken: (delta: string, sofar: string) => void,
): Promise<DispatchResult> {
  // WebLLM speaks the OpenAI message shape — system is its own role
  // (Gemini puts it in systemInstruction, hence the divergence).
  const messages = [
    ...(systemPrompt ? [{ role: "system" as const, content: systemPrompt }] : []),
    ...history.map((t) => ({ role: t.role, content: t.content })),
    { role: "user" as const, content: input.userMessage },
  ];
  const text = await generateWithWebLLM(messages, onToken);
  return { text, provider: "webllm" };
}

export async function dispatchLLMCall(
  input: DispatchInput,
  // onToken은 WebLLM 스트리밍용. WebLLM 일시 비활성화 상태에서는 호출
  // 안 되지만 시그니처 그대로 유지해 추후 재활성화 시 호출 측 변경 X.
  // (CLAUDE.md: @typescript-eslint/no-unused-vars off — 별도 disable 불필요.)
  onToken: (delta: string, sofar: string) => void = () => {},
): Promise<DispatchResult> {
  // Phase M0-5: Memory Activation — 사용자 선호 (like/dislike) 측면 system
  // prompt 측면 USER_CONTEXT 박혀 cloud 응답 측면 자동 반영. Local Pack 필터
  // (preference-filter.ts) 측면 별도 — 본 분기 측면 cloud 만 적용.
  const prefs = listPreferences();
  // Sudoku Pack 직전 결과 — 같은 USER_CONTEXT 슬롯에 한 줄로 inject. 채팅에서
  // "스도쿠 어때?" 류 입력 시 LLM 이 이 줄을 보고 자연스럽게 회상.
  const lastSudoku = getLastSudokuPlay();
  const userPreferences = {
    likes: prefs.filter((p) => p.type === "like").map((p) => p.subject),
    dislikes: prefs.filter((p) => p.type === "dislike").map((p) => p.subject),
    sudokuLastPlay: lastSudoku
      ? {
          difficulty: lastSudoku.difficulty,
          mistakes: lastSudoku.mistakes,
          timeSeconds: lastSudoku.timeSeconds,
        }
      : undefined,
  };

  // V5.0 Phase P-2: 단일 출구. compose의 buildSystemPrompt 결과를 받아 다시
  // prepend하던 2-layer 구조 제거. caller가 input.systemPrompt를 박으면
  // callerSystemPrompt 섹션으로 통합 (study LLM TUTOR_PERSONA, suggestion
  // onClick option.systemPrompt 등).
  const systemPrompt = buildSystemPrompt({
    query: input.userMessage,
    pack: input.pack,
    intent: input.intent,
    memory: input.memory,
    payloadKind: input.payloadKind,
    callerSystemPrompt: input.systemPrompt,
    summary: input.summary,
    cloudMode: input.cloudMode,
    userPreferences,
    lang: input.lang,
  });
  const history = trimHistory(input.history);

  // 안정성 정정 (2026-04-30): WebLLM 분기 제거. @mlc-ai/web-llm ES module
  // 호환 문제로 런타임 깨짐 → 모든 응답을 cloud LLM 으로. WebLLM 인프라
  // 안정화 후 분기 복구. 실제 provider 는 서버의 LLM_PROVIDER 가 결정 —
  // dispatch 는 askLLM 서버펀 경계만 넘고 어느 provider 인지는 result 로 받음.
  if (import.meta.env.DEV) {
    const tStart = performance.now();
    try {
      const result = await callLLM(input, systemPrompt, history);
      console.log("[llm-call]", {
        provider: result.provider,
        success: true,
        ms: (performance.now() - tStart).toFixed(0),
        textLen: result.text.length,
      });
      return result;
    } catch (err) {
      console.warn("[llm-call]", {
        provider: "cloud",
        success: false,
        ms: (performance.now() - tStart).toFixed(0),
        error: err instanceof Error ? err.message : String(err),
      });
      throw err;
    }
  }
  return callLLM(input, systemPrompt, history);
}
