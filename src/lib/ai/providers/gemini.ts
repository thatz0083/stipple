// Gemini adapter (Google Generative Language API). This is the original DOTS
// cloud caller, moved verbatim behind the LLMAdapter interface — behavior is
// byte-identical to the previous ai/gemini.ts so the default path never
// regresses. Key is read from GEMINI_API_KEY; model override via LLM_MODEL.
//
// Free tier (gemini-2.5-flash): 15 RPM, 1500 RPD. More than enough for v1.

import type { LLMInput, LLMOutput } from "./types";

type GeminiResponse = {
  candidates?: Array<{
    content?: {
      parts?: Array<{ text?: string }>;
    };
    finishReason?: string;
  }>;
  promptFeedback?: {
    blockReason?: string;
  };
};

// 429(rate limit) / 503(overloaded) / 5xx(일시적) 은 짧게 기다렸다 재시도.
// 무료 Gemini 티어(15 RPM)에서 산발적 429 로 데모가 깨지던 걸 완화한다.
// 재시도 소진 시 원래 Response 를 그대로 반환해 기존 에러 처리(아래)로 흐른다.
async function fetchWithRetry(
  url: string,
  init: RequestInit,
  maxRetries = 3,
): Promise<Response> {
  const RETRYABLE = new Set([429, 500, 502, 503, 504]);
  let lastErr: unknown;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const res = await fetch(url, init);
      if (RETRYABLE.has(res.status) && attempt < maxRetries) {
        const wait = 500 * 2 ** attempt + Math.random() * 300; // 0.5s,1s,2s + jitter
        await new Promise((r) => setTimeout(r, wait));
        continue;
      }
      return res;
    } catch (e) {
      lastErr = e;
      if (attempt < maxRetries) {
        const wait = 500 * 2 ** attempt + Math.random() * 300;
        await new Promise((r) => setTimeout(r, wait));
        continue;
      }
      throw lastErr;
    }
  }
  throw lastErr ?? new Error("fetchWithRetry: exhausted");
}

export async function geminiAdapter(input: LLMInput): Promise<LLMOutput> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY is not configured");
  }

  const model = process.env.LLM_MODEL ?? "gemini-2.5-flash";
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;

  // Stitch history (oldest → newest) before the current turn. Gemini wants
  // role "user" | "model" and refuses messages where two consecutive turns
  // share the same role, so adjacent same-role entries get folded into one —
  // defensive, since the chat store should already alternate.
  const historyContents = (input.history ?? [])
    .map((t) => ({
      role: t.role === "assistant" ? "model" : "user",
      parts: [{ text: t.content }],
    }))
    .reduce<{ role: string; parts: { text: string }[] }[]>((acc, turn) => {
      const last = acc[acc.length - 1];
      if (last && last.role === turn.role) {
        last.parts.push(...turn.parts);
      } else {
        acc.push(turn);
      }
      return acc;
    }, []);

  const body = {
    contents: [
      ...historyContents,
      {
        role: "user",
        parts: [{ text: input.userMessage }],
      },
    ],
    ...(input.systemPrompt
      ? {
          systemInstruction: {
            parts: [{ text: input.systemPrompt }],
          },
        }
      : {}),
    generationConfig: {
      temperature: 0.7,
      maxOutputTokens: 800,
    },
  };

  const res = await fetchWithRetry(`${endpoint}?key=${apiKey}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errBody = await res.text();
    throw new Error(`Gemini API ${res.status}: ${errBody.slice(0, 300)}`);
  }

  const json = (await res.json()) as GeminiResponse;
  if (json.promptFeedback?.blockReason) {
    throw new Error(`Gemini blocked: ${json.promptFeedback.blockReason}`);
  }
  const text = json.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text || typeof text !== "string") {
    throw new Error("Gemini returned no text");
  }

  return { text: text.trim() };
}
