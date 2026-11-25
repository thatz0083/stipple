// Dev-only measurement panel. Shown on the chat page when the URL carries
// ?measure=1 AND the app runs in dev mode — it never renders in a production
// build, so the public deployment cannot be used to burn API credit.
//
// It feeds a list of questions through the real chat send() (Stipple arm) and
// pairs each with a direct call to the same provider/model (see measure.ts).

import { useRef, useState } from "react";

import type { ProviderId } from "@/lib/ai/providers/types";
import {
  downloadRun,
  parseQuestions,
  runMeasurement,
  type BaselineHistoryMode,
  type ChatHooks,
  type MeasureRun,
} from "@/lib/demo/measure";

const PROVIDERS: ProviderId[] = ["gemini", "openai", "claude", "grok"];

function pct(n: number): string {
  return `${(n * 100).toFixed(1)}%`;
}

export function MeasurePanel({ hooks }: { hooks: ChatHooks }) {
  const [raw, setRaw] = useState("");
  const [provider, setProvider] = useState<ProviderId>("gemini");
  const [temperature, setTemperature] = useState(0);
  const [baselineHistory, setBaselineHistory] = useState<BaselineHistoryMode>("full");
  const [label, setLabel] = useState("");
  const [pauseSec, setPauseSec] = useState(0);
  const [running, setRunning] = useState(false);
  const [run, setRun] = useState<MeasureRun | null>(null);
  const stopRef = useRef(false);

  const questions = parseQuestions(raw);

  async function start() {
    if (running || questions.length === 0) return;
    stopRef.current = false;
    setRunning(true);
    setRun(null);
    try {
      const finished = await runMeasurement(
        questions,
        {
          provider,
          temperature,
          baselineHistory,
          maxOutputTokens: 4096,
          pauseMs: Math.max(0, pauseSec) * 1000,
          label: label.trim(),
        },
        hooks,
        setRun,
        () => stopRef.current,
      );
      setRun(finished);
    } finally {
      setRunning(false);
    }
  }

  const s = run?.summary;
  const field = "rounded border border-black/15 bg-white px-2 py-1 text-[12px]";

  return (
    <div className="fixed bottom-4 right-4 z-50 w-[340px] rounded-lg border border-black/15 bg-white/95 p-3 text-[12px] shadow-lg">
      <div className="mb-2 font-mono text-[10.5px] uppercase tracking-[0.14em]">
        Measure · dev only
      </div>

      <textarea
        className={`${field} mb-2 h-28 w-full font-mono`}
        placeholder={"One question per line.\n# lines starting with # are skipped"}
        value={raw}
        onChange={(e) => setRaw(e.target.value)}
        disabled={running}
      />

      <div className="mb-2 grid grid-cols-2 gap-2">
        <label className="flex flex-col gap-1">
          provider
          <select
            className={field}
            value={provider}
            onChange={(e) => setProvider(e.target.value as ProviderId)}
            disabled={running}
          >
            {PROVIDERS.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          temperature
          <input
            className={field}
            type="number"
            min={0}
            max={1}
            step={0.1}
            value={temperature}
            onChange={(e) => setTemperature(Number(e.target.value))}
            disabled={running}
          />
        </label>
        <label className="flex flex-col gap-1">
          direct arm history
          <select
            className={field}
            value={baselineHistory}
            onChange={(e) => setBaselineHistory(e.target.value as BaselineHistoryMode)}
            disabled={running}
          >
            <option value="full">full (fair)</option>
            <option value="none">none (reference)</option>
          </select>
        </label>
        <label className="flex flex-col gap-1">
          pause (sec)
          <input
            className={field}
            type="number"
            min={0}
            step={1}
            value={pauseSec}
            onChange={(e) => setPauseSec(Number(e.target.value))}
            disabled={running}
          />
        </label>
        <label className="flex flex-col gap-1">
          run label
          <input
            className={field}
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            disabled={running}
          />
        </label>
      </div>

      <div className="mb-2 flex gap-2">
        <button
          className="rounded bg-black px-3 py-1 text-white disabled:opacity-40"
          onClick={start}
          disabled={running || questions.length === 0}
        >
          Run {questions.length}
        </button>
        <button
          className="rounded border border-black/20 px-3 py-1 disabled:opacity-40"
          onClick={() => (stopRef.current = true)}
          disabled={!running}
        >
          Stop
        </button>
        <button
          className="rounded border border-black/20 px-3 py-1 disabled:opacity-40"
          onClick={() => run && downloadRun(run)}
          disabled={!run || run.rows.length === 0}
        >
          Download
        </button>
      </div>

      {run && s && (
        <div className="space-y-0.5 font-mono text-[11px]">
          <div>
            {run.rows.length}/{questions.length} done{running ? " …" : ""}
          </div>
          <div>
            local: {s.localCount} ({pct(s.localRate)})
          </div>
          <div>
            stipple tok: {s.stippleTokens.input} in / {s.stippleTokens.output} out
          </div>
          <div>
            direct tok: {s.directTokens.input} in / {s.directTokens.output} out
          </div>
          <div>ratio (stipple/direct): {s.tokenRatio === null ? "—" : s.tokenRatio.toFixed(2)}</div>
          <div>
            errors: stipple {s.stippleErrors} · direct {s.directErrors} · cut off{" "}
            {s.directTruncated}
          </div>
        </div>
      )}

      <div className="mt-2 text-[10.5px] leading-snug text-black/55">
        Runs in the current thread with the current memory. Start a new thread and clear state first
        if you need a clean run. Direct arm is a raw API call — not a provider app with memory.
      </div>
    </div>
  );
}
