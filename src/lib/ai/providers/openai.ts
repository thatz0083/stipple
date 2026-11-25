// OpenAI (ChatGPT) adapter — and the shared Chat Completions implementation.
//
// OpenAI and xAI's Grok speak the exact same wire format (`/v1/chat/completions`,
// `Authorization: Bearer`, `messages[]` with role system|user|assistant, and a
// `choices[0].message.content` response). So both adapters route through one
// function; only the base URL, key, model, and display label differ. See grok.ts.

import { requestedTemperature, resolveMaxOutputTokens, resolveModel } from "./config";
import type { LLMInput, LLMOutput } from "./types";

type OpenAIChatResponse = {
  choices?: Array<{ message?: { content?: string }; finish_reason?: string }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
  error?: { message?: string };
};

export async function openaiCompatibleAdapter(
  input: LLMInput,
  cfg: { label: string; baseUrl: string; apiKey: string | undefined; model: string },
): Promise<LLMOutput> {
  if (!cfg.apiKey) {
    throw new Error(`${cfg.label} API key is not configured`);
  }

  // Chat Completions carries the system prompt as a message with role "system",
  // then the alternating history, then the current user turn.
  const messages = [
    ...(input.systemPrompt ? [{ role: "system" as const, content: input.systemPrompt }] : []),
    ...(input.history ?? []).map((t) => ({ role: t.role, content: t.content })),
    { role: "user" as const, content: input.userMessage },
  ];

  const res = await fetch(`${cfg.baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${cfg.apiKey}`,
    },
    body: JSON.stringify({
      model: cfg.model,
      messages,
      temperature: requestedTemperature(input) ?? 0.7,
      max_tokens: resolveMaxOutputTokens(input),
    }),
  });

  if (!res.ok) {
    const errBody = await res.text();
    throw new Error(`${cfg.label} API ${res.status}: ${errBody.slice(0, 300)}`);
  }

  const json = (await res.json()) as OpenAIChatResponse;
  const text = json.choices?.[0]?.message?.content;
  if (!text || typeof text !== "string") {
    throw new Error(`${cfg.label} returned no text`);
  }

  const u = json.usage;
  const usage =
    u && typeof u.prompt_tokens === "number"
      ? { inputTokens: u.prompt_tokens, outputTokens: u.completion_tokens ?? 0 }
      : undefined;

  const truncated = json.choices?.[0]?.finish_reason === "length";

  return { text: text.trim(), model: cfg.model, usage, truncated };
}

export async function openaiAdapter(input: LLMInput): Promise<LLMOutput> {
  return openaiCompatibleAdapter(input, {
    label: "OpenAI",
    baseUrl: "https://api.openai.com/v1",
    apiKey: process.env.OPENAI_API_KEY,
    model: resolveModel("openai", "gpt-4o-mini"),
  });
}
