// Grok (xAI) adapter. xAI exposes an OpenAI-compatible Chat Completions API, so
// this is just the shared adapter from openai.ts pointed at api.x.ai with Grok's
// key and model. Key from XAI_API_KEY; model override via LLM_MODEL.

import { resolveModel } from "./config";
import { openaiCompatibleAdapter } from "./openai";
import type { LLMInput, LLMOutput } from "./types";

export async function grokAdapter(input: LLMInput): Promise<LLMOutput> {
  return openaiCompatibleAdapter(input, {
    label: "Grok",
    baseUrl: "https://api.x.ai/v1",
    apiKey: process.env.XAI_API_KEY,
    model: resolveModel("grok", "grok-2-latest"),
  });
}
