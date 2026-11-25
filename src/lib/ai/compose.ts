// Orchestrates AI-generated answers with local-memory context, falling back
// to the canned `answerFor()` payload on any failure (no key, network down,
// safety block, empty response).
//
// For text payloads, Gemini's output replaces the canned text. For
// recipe/memory-recipes payloads, the structured data (recipe ids) is
// preserved and Gemini's output becomes the surrounding `intro` text — the
// system prompt asks for a short intro that complements the recipe card.

import type { AnswerPayload, Pack } from "@/lib/dots-data";
import type { LookupResult } from "@/lib/memory";
// Direct path avoids a cycle: memory/index.ts ↔ dots-data via topics.ts.
import { extractTopics } from "@/lib/memory/topics";
// V5.0 Phase M-1: 임계점 도달 시 별도 Gemini 호출로 summary 생성. dispatch
// 호출 전에 박혀 — summary가 만들어졌으면 history는 recent N 만 보냄.
import { maybeGenerateSummary, RECENT_AFTER_SUMMARY } from "@/lib/memory/summary";
import type { Intent } from "@/lib/packs/intent";
import { matchPitch } from "@/lib/pitch";
import { getPreferences } from "@/lib/preferences";
import { dispatchLLMCall, type DispatchTurn } from "./dispatch";
import type { LLMUsage, ProviderId } from "./providers/types";
// V5.0 Phase P-2: 통일된 prompt 빌더가 dispatch 안에서 호출되며, compose는
// memory + payload kind 만 dispatch에 전달. compose의 BASE_PERSONA / pack /
// memory section 빌더 모두 system-prompt.ts 로 이전.

export type ComposeArgs = {
  query: string;
  pack?: Pack;
  lookup?: LookupResult;
  fallback: AnswerPayload;
  // Prior turns from the active thread, oldest → newest. dispatch trims
  // to the last N internally so callers can pass the whole conversation.
  history?: DispatchTurn[];
  // Per-token callback for streaming UIs. Fires once per delta with the
  // partial text so far. Gemini answers in one go (single onToken call
  // with the full text); WebLLM streams incrementally. Default no-op.
  onToken?: (delta: string, sofar: string) => void;
  // V3 라우터에서 분류된 의도. dispatch까지 그대로 전달 — casual일 땐
  // CASUAL_DISCIPLINE이 끼어 1 문장 인사로 응답 강제.
  intent?: Intent;
  // V5.0 Phase M-1: 활성 thread id. 박혀 있으면 임계점 도달 시 summary 생성
  // + 저장 + dispatch에 박음. omit하면 summary 비활성 (suggestion onClick의
  // ad-hoc compose 등 thread context 없는 호출 — caller가 명시 박지 않으면
  // summary 동작 X).
  threadId?: string;
  // V5.0 Phase I-5: cloud-direct 모드. routes/index.tsx Stage 3 (matchPackContent
  // miss → cloud) 가 박음. 박혀 있으면 pack identity 흉내 X, 일반 cloud 톤.
  // suggestion onClick 분기 (사용자 명시 pack 클릭) 는 미박힘 — pack identity
  // 유지.
  cloudMode?: boolean;
  // Phase EN-1: 입력 언어. dispatch까지 thread → buildSystemPrompt가 영어 미러
  // 사용. overload fallback 메시지도 영어 분기.
  lang?: "ko" | "en";
};

export type ComposeResult = {
  payload: AnswerPayload;
  // Which provider answered, if an LLM call ran. Absent on the fallback
  // path (network failure → canned reply has no LLM origin).
  provider?: "webllm" | ProviderId;
  // Cloud answers only — passed through from dispatch for token accounting.
  model?: string;
  usage?: LLMUsage;
  systemPromptChars?: number;
  // Tokens spent on a summary generated during THIS call (0 if reused/none).
  overheadInputTokens?: number;
  overheadOutputTokens?: number;
  // V5.0 Phase M-1: summary 활용 여부. trace 라벨 + UI 마커 박을 때 사용.
  //   summaryUsed     — 이번 호출 시점에 thread에 summary가 존재해 활용됨.
  //   summaryGenerated — 이번 호출에서 임계점 도달 → 새로 생성됨 (또는 supersede).
  // generated이면 used도 true. used만 true는 기존 summary 재활용.
  summaryUsed?: boolean;
  summaryGenerated?: boolean;
};

// V5.0 Phase P-2: BASE_PERSONA / 팩·메모리 섹션 빌더 / payload-specific 디시플린
// 모두 src/lib/ai/system-prompt.ts 로 이전. composeAnswer는 더 이상 prompt
// string을 만들지 않고, memory + payloadKind 컨텍스트를 dispatchLLMCall에
// 직접 전달한다 (DispatchInput의 새 필드).
//
// V5.0 Phase M-1: thread 컨텍스트 박혔으면 임계점 검사 + summary 자동 박음.

// summaryGenerated 판정용 — 임계 hit 직전 시점에 store에 summary가 있었는지
// 기록 + 호출 후 다시 비교. 이 import는 동적 — store 의존성 import 사이클
// 회피용이지만 maybeGenerateSummary가 이미 store를 활용하므로 여기서는
// pre-call 시점 체크만 위해 별도 import.
import { getSummaryForThread } from "@/lib/memory/store";

function attachPitch(payload: AnswerPayload, query: string): AnswerPayload {
  // Pitch matching is purely local — nothing about the query, topics, or
  // the chosen pitch leaves the device. The LLM never sees it either; we
  // attach it next to the answer the model already produced.
  const prefs = getPreferences();
  if (!prefs.pitch.enabled || prefs.pitch.categories.length === 0) return payload;
  // pack-suggestion is the on-device choice surface — no pitch overlay.
  if (payload.kind === "pack-suggestion") return payload;
  const pitch = matchPitch({
    query,
    topics: extractTopics(query),
    enabledCategories: prefs.pitch.categories,
  });
  return pitch ? { ...payload, pitch } : payload;
}

export async function composeAnswer(args: ComposeArgs): Promise<ComposeResult> {
  try {
    // V5.0 Phase M-1: thread 컨텍스트 박혔으면 임계점 검사 → 필요시 별도
    // Gemini 호출로 summary 생성 + 저장. summary 활성 시 dispatch에 보내는
    // history는 recent N (10) 으로 제한 — summary가 그 이전을 대체하므로
    // 중복 회피. omit (threadId 미박힘 — suggestion onClick ad-hoc 등) 시는
    // summary 비활성 + history 그대로.
    const fullHistory = args.history ?? [];
    // 임계 hit 직전 store snapshot — generated 판정용 (post-call 시점에 새
    // summary id/createdAt이 다르면 generated, 동일하면 reused).
    const preExisting = args.threadId ? getSummaryForThread(args.threadId) : undefined;
    const summary = args.threadId
      ? await maybeGenerateSummary({ threadId: args.threadId, history: fullHistory })
      : null;
    const summaryGenerated = !!summary && summary.createdAt !== preExisting?.createdAt;
    const dispatchHistory = summary
      ? fullHistory.slice(summary.sourceMessagesCount).slice(-RECENT_AFTER_SUMMARY)
      : fullHistory;

    // V5.0 Phase P-2: memory + payloadKind를 직접 dispatch에 전달 — 통일된
    // buildSystemPrompt가 두 컨텍스트 모두 한 번에 처리. 이전엔 compose가 prompt
    // string을 만들어 dispatch가 다시 prepend하던 2-layer 구조였음.
    const { text, provider, model, usage, systemPromptChars } = await dispatchLLMCall(
      {
        userMessage: args.query,
        history: dispatchHistory,
        pack: args.pack,
        intent: args.intent,
        memory: args.lookup,
        payloadKind: args.fallback.kind,
        summary: summary ?? undefined,
        cloudMode: args.cloudMode,
        lang: args.lang,
      },
      args.onToken,
    );

    // Wrap text into the same payload shape as the fallback so
    // structured fields (recipeId/recipeIds) survive.
    let payload: AnswerPayload;
    if (args.fallback.kind === "text") {
      payload = { kind: "text", text };
    } else if (args.fallback.kind === "recipe") {
      payload = { ...args.fallback, intro: text };
    } else if (args.fallback.kind === "memory-recipes") {
      payload = { ...args.fallback, intro: text };
    } else {
      payload = args.fallback;
    }
    return {
      payload: attachPitch(payload, args.query),
      provider,
      model,
      usage,
      systemPromptChars,
      overheadInputTokens: summaryGenerated ? (summary?.usageInputTokens ?? 0) : 0,
      overheadOutputTokens: summaryGenerated ? (summary?.usageOutputTokens ?? 0) : 0,
      summaryUsed: !!summary,
      summaryGenerated,
    };
  } catch (err) {
    console.error("[compose] LLM call failed:", err);
    const message = err instanceof Error ? err.message : String(err);
    // 안정성 정정 (2026-04-30): Gemini 503/UNAVAILABLE 같은 외부 일시
    // 장애일 땐 "안에서는 바로 안 잡혀…" 같은 모호한 캔드 fallback 대신
    // 명확한 "지금 클라우드 혼잡" 메시지를 노출. 사용자에게 원인이 보이게.
    const isOverloaded = /\b503\b|overload|UNAVAILABLE|혼잡/i.test(message);
    if (isOverloaded) {
      const overloadText =
        args.lang === "en"
          ? "The cloud is overloaded right now. Try again in a moment."
          : "지금 클라우드 서버가 혼잡해. 잠시 후 다시 시도해줘.";
      return {
        payload: {
          kind: "text",
          text: overloadText,
        },
      };
    }
    return { payload: attachPitch(args.fallback, args.query) };
  }
}
