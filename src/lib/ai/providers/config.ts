// Server-side model + temperature resolution shared by every adapter.
//
// Model: each provider has its own env var so several providers can be
// configured at once (side-by-side measurement). LLM_MODEL keeps its old
// meaning — it applies only to the provider named by LLM_PROVIDER — so an
// existing single-provider setup behaves exactly as before.

import type { LLMInput, ProviderId } from "./types";

const MODEL_ENV: Record<ProviderId, string> = {
  gemini: "GEMINI_MODEL",
  openai: "OPENAI_MODEL",
  claude: "ANTHROPIC_MODEL",
  grok: "XAI_MODEL",
};

export function resolveModel(id: ProviderId, fallback: string): string {
  const specific = process.env[MODEL_ENV[id]];
  if (specific) return specific;
  const defaultProvider = (process.env.LLM_PROVIDER ?? "gemini").toLowerCase();
  if (defaultProvider === id && process.env.LLM_MODEL) return process.env.LLM_MODEL;
  return fallback;
}

// undefined → caller did not ask for a specific temperature.
export function requestedTemperature(input: LLMInput): number | undefined {
  const t = input.temperature;
  if (typeof t !== "number" || Number.isNaN(t)) return undefined;
  return Math.min(1, Math.max(0, t));
}

// Output cap: app default 800; a caller may ask for more, never above 4096.
export function resolveMaxOutputTokens(input: LLMInput): number {
  const n = input.maxOutputTokens;
  if (typeof n !== "number" || Number.isNaN(n)) return 800;
  return Math.min(4096, Math.max(64, Math.floor(n)));
}
