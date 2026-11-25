// Provider-neutral LLM interface. DOTS's routing / memory / pack layers never
// see a concrete provider — they call dispatch, dispatch calls `askLLM`, and
// `askLLM` picks one of these adapters by the LLM_PROVIDER env var. Swapping
// ChatGPT ↔ Gemini ↔ Claude ↔ Grok is a one-line config change, never a code
// change. This file is the whole contract every adapter implements.

export type ProviderId = "gemini" | "openai" | "claude" | "grok";

// Multi-turn context. DOTS speaks in "user" | "assistant"; each adapter maps to
// its own role convention internally (Gemini: assistant → model; Anthropic:
// system is a top-level field, not a role; OpenAI / Grok: system is a message
// role). Same shape as DispatchTurn in src/lib/ai/dispatch.ts.
export type LLMHistoryTurn = {
  role: "user" | "assistant";
  content: string;
};

export type LLMInput = {
  userMessage: string;
  systemPrompt?: string;
  history?: LLMHistoryTurn[];
  // Per-request provider override, used by measurement / side-by-side runs.
  // Omitted → LLM_PROVIDER env (default path, unchanged). The MODEL is never
  // chosen by the client: it is resolved server-side from env (see config.ts),
  // so a public caller cannot point a request at an expensive model.
  provider?: ProviderId;
  // Sampling temperature, clamped to 0..1 server-side. Omitted → each
  // adapter's previous behavior. Measurement runs pass 0 on both arms.
  temperature?: number;
  // Output cap, clamped server-side (see config.ts). Omitted → 800, the app
  // default. Measurement runs raise it on BOTH arms so answers are not cut off.
  maxOutputTokens?: number;
};

// Token counts as reported by the provider's own API response. Present
// whenever the provider returns them; never estimated locally.
export type LLMUsage = {
  inputTokens: number;
  outputTokens: number;
  // Part of outputTokens spent on hidden reasoning, when the provider reports
  // it. Billed as output, but not visible text.
  thinkingTokens?: number;
};

export type LLMOutput = {
  text: string;
  // The concrete model id that answered (after env resolution).
  model: string;
  usage?: LLMUsage;
  // True when the provider stopped because the output cap was hit — the text
  // is incomplete and must not be compared as a finished answer.
  truncated?: boolean;
};

// A provider adapter is a plain server-side async function: neutral input in,
// text out. It reads its own API key from `process.env`, absorbs every
// wire-format difference internally, and throws on misconfiguration or a bad
// response. Adapters run only inside the `askLLM` server function, so neither
// the keys nor this code reach the client bundle.
export type LLMAdapter = (input: LLMInput) => Promise<LLMOutput>;
