// 데모 측정 인프라 — 라우팅 결정 추적 + 메트릭 집계.
//
// 본질 (시니어 엔지니어 피드백 2026-04-30):
//   "지금 필요한 건 더 똑똑한 라우터가 아님. 현재 라우터가 어떤 결정을
//    했는지 증명하는 장치."
// V1~V4.5 진화는 측정 X 면 무의미. 빅테크 대비 차별점인 "외부 호출 회피율"
// 을 증명하려면 send()의 각 라우팅 분기에 trace를 박고 집계해야 한다.
// 이 모듈은 trace 저장(localStorage 마지막 1000개) + useSyncExternalStore
// 구독 + 메트릭 계산을 담당.

import { useSyncExternalStore } from "react";
import type { ProviderId } from "@/lib/ai/providers/types";

export type DemoRoute = "pack" | "store" | "learned" | "cloud" | "local";
// ProviderId covers the cloud providers (gemini | openai | claude | grok);
// pack/learned/webllm/none are the non-cloud trace origins.
export type DemoProvider = "pack" | "learned" | "webllm" | "none" | ProviderId;

export type DemoTrace = {
  id: string;
  input: string;
  intent: string;
  route: DemoRoute;
  externalCall: boolean;
  provider: DemoProvider;
  packId?: string;
  packName?: string;
  latencyMs: number;
  reason: string;
  createdAt: number;
  // V4 임베딩 시맨틱 매칭 hit이면 코사인 유사도. 정확 일치(키워드/exact)
  // 또는 클라우드 호출처럼 의미가 없는 경로에선 undefined.
  embeddingSimilarity?: number;
  // 회피된 외부 호출의 추정 비용. provider별 단가 × 평균 토큰으로 가시화
  // 가능 — 첫 버전에서는 source 데이터로만 두고 UI 노출은 다음 단계.
  costAvoided?: number;
  // Cloud calls only: concrete model and provider-reported token counts.
  model?: string;
  inputTokens?: number;
  outputTokens?: number;
  thinkingTokens?: number;
  // Size (chars) of the system prompt Stipple added to this call.
  systemPromptChars?: number;
  // Extra cloud tokens Stipple spent around this call (summary generation).
  overheadInputTokens?: number;
  overheadOutputTokens?: number;
};

export type DemoMetrics = {
  total: number;
  packCount: number;
  learnedCount: number;
  storeCount: number;
  cloudCount: number;
  localCount: number;
  externalCallCount: number;
  // total - externalCallCount. "빅테크 대비 차별점"의 핵심 숫자 —
  // DOTS가 사용자의 외부 호출을 몇 번이나 막았는지.
  avoidedCalls: number;
  avoidanceRate: number;
  avgLatencyMs: number;
  // packId → trace count. UI는 PACKS와 join해서 0인 팩도 함께 노출 가능.
  packBreakdown: Record<string, number>;
  // Sums over traces that carry provider-reported usage.
  totalInputTokens: number;
  totalOutputTokens: number;
};

const STORAGE_KEY = "dots:demo-traces";
const MAX_TRACES = 1000;

let traces: DemoTrace[] = [];
let hydrated = false;
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((l) => l());
}

function persist() {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(traces));
  } catch (err) {
    console.error("[demo-trace] persist failed", err);
  }
}

export function hydrateDemoTraces(): void {
  if (hydrated) return;
  hydrated = true;
  if (typeof localStorage === "undefined") return;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw) as DemoTrace[];
    if (Array.isArray(parsed)) {
      traces = parsed.slice(-MAX_TRACES);
      emit();
    }
  } catch (err) {
    console.error("[demo-trace] hydrate failed", err);
  }
}

export function addDemoTrace(partial: Omit<DemoTrace, "id" | "createdAt">): DemoTrace {
  const trace: DemoTrace = {
    ...partial,
    id: crypto.randomUUID(),
    createdAt: Date.now(),
  };
  traces = [...traces, trace].slice(-MAX_TRACES);
  emit();
  persist();
  return trace;
}

export function getDemoTraces(): DemoTrace[] {
  return traces;
}

export function clearDemoTraces(): void {
  traces = [];
  emit();
  persist();
}

export function useDemoTraceStore(): DemoTrace[] {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => traces,
    () => traces,
  );
}

export function getDemoMetrics(): DemoMetrics {
  const total = traces.length;
  if (total === 0) {
    return {
      total: 0,
      packCount: 0,
      learnedCount: 0,
      storeCount: 0,
      cloudCount: 0,
      localCount: 0,
      externalCallCount: 0,
      avoidedCalls: 0,
      avoidanceRate: 0,
      avgLatencyMs: 0,
      packBreakdown: {},
      totalInputTokens: 0,
      totalOutputTokens: 0,
    };
  }
  let packCount = 0;
  let learnedCount = 0;
  let storeCount = 0;
  let cloudCount = 0;
  let localCount = 0;
  let externalCallCount = 0;
  let totalLatency = 0;
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  const packBreakdown: Record<string, number> = {};
  for (const t of traces) {
    if (t.route === "pack") packCount++;
    else if (t.route === "learned") learnedCount++;
    else if (t.route === "store") storeCount++;
    else if (t.route === "cloud") cloudCount++;
    else if (t.route === "local") localCount++;
    if (t.externalCall) externalCallCount++;
    totalLatency += t.latencyMs;
    totalInputTokens += (t.inputTokens ?? 0) + (t.overheadInputTokens ?? 0);
    totalOutputTokens += (t.outputTokens ?? 0) + (t.overheadOutputTokens ?? 0);
    if (t.packId) {
      packBreakdown[t.packId] = (packBreakdown[t.packId] ?? 0) + 1;
    }
  }
  const avoidedCalls = total - externalCallCount;
  return {
    total,
    packCount,
    learnedCount,
    storeCount,
    cloudCount,
    localCount,
    externalCallCount,
    avoidedCalls,
    avoidanceRate: avoidedCalls / total,
    avgLatencyMs: totalLatency / total,
    packBreakdown,
    totalInputTokens,
    totalOutputTokens,
  };
}
