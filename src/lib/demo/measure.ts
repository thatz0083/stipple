// Paired measurement: the same question goes to (A) Stipple — the REAL chat
// send() path, so every gate/cache/memory behaves exactly as in the app — and
// (B) the same provider+model called directly with nothing Stipple adds.
//
// This module holds the data shapes, the pairing loop and the summary. The
// React panel (MeasurePanel) supplies the hooks into the live chat.
//
// Fairness rules encoded here:
//   - Same provider, same server-resolved model, same temperature on both arms.
//   - The direct arm keeps ITS OWN conversation (its own previous answers), and
//     by default receives that full history every turn ("full"). "none" sends
//     each question cold — a reference arm, not the fair comparison.
//   - Token counts are the provider's reported usage; nothing is estimated.
//   - Stipple's hidden summary call is counted as Stipple tokens (overhead*).
//
// NOT covered: the API has no cross-session memory, so this does not compare
// against a provider's consumer-app memory feature. Say so wherever results
// are shown.

import { askDirect } from "@/lib/ai/baseline";
import { setCallOverride } from "@/lib/ai/override";
import type { LLMHistoryTurn, ProviderId } from "@/lib/ai/providers/types";

import { getDemoTraces, type DemoTrace } from "./trace";

export type BaselineHistoryMode = "full" | "none";

export type MeasureConfig = {
  provider: ProviderId;
  temperature: number;
  baselineHistory: BaselineHistoryMode;
  // Output cap applied to BOTH arms (app default is 800, which cuts long
  // direct answers short and understates the direct arm).
  maxOutputTokens: number;
  // Pause between questions (ms). Use ~5000 on a free tier with a low
  // requests-per-minute limit; 0 on paid keys.
  pauseMs: number;
  // Label stored with the run (e.g. "random-pool-v1", "pref-scenario-new-session").
  label: string;
};

// `thinking` is the part of `output` spent on hidden reasoning (when reported).
export type ArmTokens = { input: number; output: number; thinking: number };

export type MeasureRow = {
  index: number;
  question: string;
  stipple: {
    // "local" = finished with zero cloud calls (pack / store / learned / local).
    handledLocally: boolean;
    routes: string[];
    provider?: string;
    model?: string;
    answer: string;
    tokens: ArmTokens;
    systemPromptChars: number;
    latencyMs: number;
    error?: string;
  };
  direct: {
    provider?: string;
    model?: string;
    answer: string;
    tokens: ArmTokens;
    truncated?: boolean;
    latencyMs: number;
    error?: string;
  };
};

export type MeasureSummary = {
  questions: number;
  localCount: number;
  localRate: number;
  stippleTokens: ArmTokens;
  directTokens: ArmTokens;
  // (stipple in+out) / (direct in+out). < 1 means Stipple used fewer tokens.
  tokenRatio: number | null;
  stippleErrors: number;
  directErrors: number;
  // Direct answers cut off by the output cap (incomplete; raise the cap).
  directTruncated: number;
};

export type MeasureRun = {
  label: string;
  startedAt: string;
  finishedAt?: string;
  config: MeasureConfig;
  rows: MeasureRow[];
  summary: MeasureSummary;
  caveats: string[];
};

// What the panel must provide to drive the live chat.
export type ChatHooks = {
  // Submit a user message through the real send() and resolve once the chat is
  // idle again (no busy flag, no pending bubble). Returns the assistant text
  // that was produced ("" for card-only replies).
  submitAndWait: (text: string) => Promise<{ answer: string }>;
};

const CAVEATS = [
  "Direct arm = raw API call. It has no cross-session memory; this is not a comparison against a provider's consumer-app memory feature.",
  "Token counts are provider-reported usage. Rows where a provider returned no usage count as 0 and are listed under errors only if the call failed.",
  "A locally handled Stipple turn that ends in a suggestion card (cloud only on explicit click) counts as local with 0 tokens — the same as in the app.",
];

export function summarize(rows: MeasureRow[]): MeasureSummary {
  const s: MeasureSummary = {
    questions: rows.length,
    localCount: 0,
    localRate: 0,
    stippleTokens: { input: 0, output: 0, thinking: 0 },
    directTokens: { input: 0, output: 0, thinking: 0 },
    tokenRatio: null,
    stippleErrors: 0,
    directErrors: 0,
    directTruncated: 0,
  };
  for (const r of rows) {
    if (r.stipple.handledLocally) s.localCount++;
    s.stippleTokens.input += r.stipple.tokens.input;
    s.stippleTokens.output += r.stipple.tokens.output;
    s.stippleTokens.thinking += r.stipple.tokens.thinking;
    s.directTokens.input += r.direct.tokens.input;
    s.directTokens.output += r.direct.tokens.output;
    s.directTokens.thinking += r.direct.tokens.thinking;
    if (r.direct.truncated) s.directTruncated++;
    if (r.stipple.error) s.stippleErrors++;
    if (r.direct.error) s.directErrors++;
  }
  s.localRate = rows.length ? s.localCount / rows.length : 0;
  const d = s.directTokens.input + s.directTokens.output;
  s.tokenRatio = d > 0 ? (s.stippleTokens.input + s.stippleTokens.output) / d : null;
  return s;
}

function foldTraces(traces: DemoTrace[]) {
  let input = 0;
  let output = 0;
  let chars = 0;
  let thinking = 0;
  let external = false;
  let provider: string | undefined;
  let model: string | undefined;
  for (const t of traces) {
    input += (t.inputTokens ?? 0) + (t.overheadInputTokens ?? 0);
    output += (t.outputTokens ?? 0) + (t.overheadOutputTokens ?? 0);
    chars += t.systemPromptChars ?? 0;
    thinking += t.thinkingTokens ?? 0;
    if (t.externalCall) {
      external = true;
      provider = t.provider;
      model = t.model ?? model;
    }
  }
  return { input, output, thinking, chars, external, provider, model };
}

export async function runMeasurement(
  questions: string[],
  config: MeasureConfig,
  hooks: ChatHooks,
  onProgress: (run: MeasureRun) => void,
  shouldStop: () => boolean,
): Promise<MeasureRun> {
  const run: MeasureRun = {
    label: config.label,
    startedAt: new Date().toISOString(),
    config,
    rows: [],
    summary: summarize([]),
    caveats: CAVEATS,
  };
  const directHistory: LLMHistoryTurn[] = [];

  setCallOverride({
    provider: config.provider,
    temperature: config.temperature,
    maxOutputTokens: config.maxOutputTokens,
  });
  try {
    for (let i = 0; i < questions.length; i++) {
      if (shouldStop()) break;
      const question = questions[i];

      // ---- Arm A: Stipple, through the real chat.
      const tracesBefore = getDemoTraces().length;
      const aStart = Date.now();
      let aAnswer = "";
      let aError: string | undefined;
      try {
        aAnswer = (await hooks.submitAndWait(question)).answer;
      } catch (err) {
        aError = err instanceof Error ? err.message : String(err);
      }
      const aLatency = Date.now() - aStart;
      const newTraces = getDemoTraces().slice(tracesBefore);
      const folded = foldTraces(newTraces);

      // ---- Arm B: same provider/model/temperature, nothing added.
      const bStart = Date.now();
      let bAnswer = "";
      let bError: string | undefined;
      let bProvider: string | undefined;
      let bModel: string | undefined;
      const bTokens: ArmTokens = { input: 0, output: 0, thinking: 0 };
      let bTruncated = false;
      try {
        const res = await askDirect({
          userMessage: question,
          history: config.baselineHistory === "full" ? [...directHistory] : undefined,
          provider: config.provider,
          temperature: config.temperature,
          maxOutputTokens: config.maxOutputTokens,
        });
        bAnswer = res.text;
        bTruncated = !!res.truncated;
        bTokens.thinking = res.usage?.thinkingTokens ?? 0;
        bProvider = res.provider;
        bModel = res.model;
        bTokens.input = res.usage?.inputTokens ?? 0;
        bTokens.output = res.usage?.outputTokens ?? 0;
      } catch (err) {
        bError = err instanceof Error ? err.message : String(err);
      }
      const bLatency = Date.now() - bStart;
      directHistory.push({ role: "user", content: question });
      if (bAnswer) directHistory.push({ role: "assistant", content: bAnswer });

      run.rows.push({
        index: i,
        question,
        stipple: {
          handledLocally: !folded.external && !aError,
          routes: newTraces.map((t) => t.route),
          provider: folded.provider,
          model: folded.model,
          answer: aAnswer,
          tokens: { input: folded.input, output: folded.output, thinking: folded.thinking },
          systemPromptChars: folded.chars,
          latencyMs: aLatency,
          error: aError,
        },
        direct: {
          provider: bProvider,
          model: bModel,
          answer: bAnswer,
          tokens: bTokens,
          truncated: bTruncated,
          latencyMs: bLatency,
          error: bError,
        },
      });
      run.summary = summarize(run.rows);
      onProgress({ ...run, rows: [...run.rows] });
      if (config.pauseMs > 0 && i < questions.length - 1) {
        await new Promise((r) => setTimeout(r, config.pauseMs));
      }
    }
  } finally {
    setCallOverride(null);
  }
  run.finishedAt = new Date().toISOString();
  return run;
}

export function parseQuestions(raw: string): string[] {
  return raw
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith("#"));
}

export function downloadRun(run: MeasureRun): void {
  const blob = new Blob([JSON.stringify(run, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  const stamp = run.startedAt.replace(/[:.]/g, "-");
  a.href = url;
  a.download = `stipple-measure_${run.config.provider}_${run.label || "run"}_${stamp}.json`;
  a.click();
  URL.revokeObjectURL(url);
}
