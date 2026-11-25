// "Model direct" arm for measurement: the same server function and adapters as
// every Stipple cloud call, but with nothing Stipple adds — no local gates, no
// charter / pack persona, no memory or USER_CONTEXT, no cache. What the caller
// passes is exactly what the model sees.
//
//   B0 (no memory):        askDirect({ userMessage })
//   B1 (full history):     askDirect({ userMessage, history: everythingSoFar })

import { askLLM, type AskLLMResult } from "./llm";
import type { LLMHistoryTurn, ProviderId } from "./providers/types";

export type DirectInput = {
  userMessage: string;
  history?: LLMHistoryTurn[];
  provider?: ProviderId;
  temperature?: number;
  maxOutputTokens?: number;
};

export async function askDirect(input: DirectInput): Promise<AskLLMResult> {
  return askLLM({
    data: {
      userMessage: input.userMessage,
      history: input.history,
      provider: input.provider,
      temperature: input.temperature,
      maxOutputTokens: input.maxOutputTokens,
    },
  });
}
