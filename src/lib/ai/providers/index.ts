// Provider registry + selection. The active provider is chosen by the
// LLM_PROVIDER env var at call time, defaulting to "gemini" so DOTS works
// out of the box exactly as before. An unknown value falls back to gemini
// (with a dev warning) rather than throwing — a config typo should never take
// the whole app down.

import { claudeAdapter } from "./claude";
import { geminiAdapter } from "./gemini";
import { grokAdapter } from "./grok";
import { openaiAdapter } from "./openai";
import type { LLMAdapter, ProviderId } from "./types";

const ADAPTERS: Record<ProviderId, LLMAdapter> = {
  gemini: geminiAdapter,
  openai: openaiAdapter,
  claude: claudeAdapter,
  grok: grokAdapter,
};

// `requested` is the optional per-request override (LLMInput.provider). It is
// client-supplied, so it is checked with hasOwn — `in` would also accept
// inherited keys like "constructor".
export function selectProvider(requested?: string): { id: ProviderId; adapter: LLMAdapter } {
  const raw = String(requested ?? process.env.LLM_PROVIDER ?? "gemini").toLowerCase();
  const id: ProviderId = Object.hasOwn(ADAPTERS, raw) ? (raw as ProviderId) : "gemini";
  if (id !== raw && import.meta.env.DEV) {
    console.warn(`[llm] unknown LLM_PROVIDER "${raw}" — falling back to gemini`);
  }
  return { id, adapter: ADAPTERS[id] };
}
