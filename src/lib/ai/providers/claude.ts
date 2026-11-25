// Claude (Anthropic) adapter — Messages API.
//
// Two shape differences from the OpenAI family, both absorbed here: Anthropic
// has no "system" message role (the system prompt is a top-level `system`
// field, like Gemini's systemInstruction), and `max_tokens` is required. The
// `messages` array carries only user|assistant, which is exactly DOTS's history
// shape. Auth is `x-api-key` + `anthropic-version`. Key from ANTHROPIC_API_KEY;
// default model claude-haiku-4-5 (cheapest/fastest, fits short chat replies),
// overridable via LLM_MODEL.

import { requestedTemperature, resolveMaxOutputTokens, resolveModel } from "./config";
import type { LLMInput, LLMOutput } from "./types";

type AnthropicResponse = {
  content?: Array<{ type?: string; text?: string }>;
  stop_reason?: string;
  usage?: { input_tokens?: number; output_tokens?: number };
  error?: { message?: string };
};

export async function claudeAdapter(input: LLMInput): Promise<LLMOutput> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error("ANTHROPIC_API_KEY is not configured");
  }

  const model = resolveModel("claude", "claude-haiku-4-5");
  const temperature = requestedTemperature(input);

  const messages = [
    ...(input.history ?? []).map((t) => ({ role: t.role, content: t.content })),
    { role: "user" as const, content: input.userMessage },
  ];

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model,
      max_tokens: resolveMaxOutputTokens(input),
      // Only sent when a caller asks for one — default path keeps the API default.
      ...(temperature !== undefined ? { temperature } : {}),
      ...(input.systemPrompt ? { system: input.systemPrompt } : {}),
      messages,
    }),
  });

  if (!res.ok) {
    const errBody = await res.text();
    throw new Error(`Claude API ${res.status}: ${errBody.slice(0, 300)}`);
  }

  const json = (await res.json()) as AnthropicResponse;
  // Safety classifiers / the model itself can decline with stop_reason
  // "refusal" on a 200 — guard before reading content so we surface a clear
  // error instead of "no text".
  if (json.stop_reason === "refusal") {
    throw new Error("Claude declined to respond (refusal)");
  }
  const text = json.content?.find((b) => b.type === "text")?.text;
  if (!text || typeof text !== "string") {
    throw new Error("Claude returned no text");
  }

  const u = json.usage;
  const usage =
    u && typeof u.input_tokens === "number"
      ? { inputTokens: u.input_tokens, outputTokens: u.output_tokens ?? 0 }
      : undefined;

  const truncated = json.stop_reason === "max_tokens";

  return { text: text.trim(), model, usage, truncated };
}
