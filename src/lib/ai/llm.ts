// Single server-side entry point for every cloud LLM call DOTS makes (replaces
// the old askGemini). Reads LLM_PROVIDER, dispatches to the matching adapter,
// and returns the text plus which provider answered (for the chat provenance
// badge). The handler is compiled out of the client bundle by createServerFn,
// so no API key ever ships to the browser — the same boundary askGemini had.
//
// Provider selection lives in ./providers (server-only). This module is the
// seam the client-side dispatch layer talks to.

import { createServerFn } from "@tanstack/react-start";
import { selectProvider } from "./providers";
import type { LLMHistoryTurn, LLMInput, LLMOutput, LLMUsage, ProviderId } from "./providers/types";

export type { LLMHistoryTurn, LLMInput, LLMOutput, LLMUsage, ProviderId };

export type AskLLMResult = {
  text: string;
  provider: ProviderId;
  // Concrete model that answered + provider-reported token counts. Used by the
  // measurement harness; the chat UI can ignore them.
  model: string;
  usage?: LLMUsage;
  truncated?: boolean;
};

export const askLLM = createServerFn({ method: "POST" })
  .validator((data: LLMInput) => data)
  .handler(async ({ data }): Promise<AskLLMResult> => {
    const { id, adapter } = selectProvider(data.provider);
    const out = await adapter(data);
    return {
      text: out.text,
      provider: id,
      model: out.model,
      usage: out.usage,
      truncated: out.truncated,
    };
  });
