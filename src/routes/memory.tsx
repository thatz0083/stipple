import { createFileRoute } from "@tanstack/react-router";
import { useSyncExternalStore } from "react";
import { Shell } from "@/components/Shell";
import { SAVED_RECIPES } from "@/lib/dots-data";
import {
  useMemoryStore,
  type ArchiveEntry,
  type ArchiveGranularity,
  type MemoryRecord,
} from "@/lib/memory";
import { useT, type Messages } from "@/lib/i18n";
import {
  getPreferencesSnapshot,
  removePreference,
  subscribePreferencesStore,
} from "@/lib/learning/preferences-store";

export const Route = createFileRoute("/memory")({
  head: () => ({
    meta: [
      { title: "기억 — DOTS" },
      {
        name: "description",
        content:
          "DOTS의 기억은 임시·자주 나온 것·저장된 것·아카이브로 나뉩니다. 모두 이 기기 안에서.",
      },
    ],
  }),
  component: MemoryPage,
});

type ShelfItem = { t: string; meta: string };

type Shelf = {
  key: string;
  name: string;
  desc: string;
  badge: string;
  items: ShelfItem[];
  empty: string;
};

const DAY_MS = 86_400_000;
const GRANULARITY_ORDER: Record<ArchiveGranularity, number> = {
  day: 0,
  week: 1,
  month: 2,
  quarter: 3,
  year: 4,
};

// Phase 2 i18n: 모든 시간 라벨은 t.memory.relTime / archiveWindow / seasons
// 사전을 거침. 컴포넌트 외부 함수라 매개변수 t 로 받음 (테스트 용이).
function relTime(ts: number, now: number, t: Messages["memory"]["relTime"]): string {
  const diff = now - ts;
  if (diff < 60_000) return t.justNow;
  const m = Math.floor(diff / 60_000);
  if (m < 60) return t.minutesAgo(m);
  const h = Math.floor(m / 60);
  if (h < 24) return t.hoursAgo(h);
  const d = Math.floor(diff / DAY_MS);
  if (d < 7) return t.daysAgo(d);
  const w = Math.floor(d / 7);
  if (w < 5) return t.weeksAgo(w);
  const date = new Date(ts);
  const nowDate = new Date(now);
  const sameYear = date.getFullYear() === nowDate.getFullYear();
  return sameYear
    ? t.monthDay(date.getMonth() + 1, date.getDate())
    : t.ymd(date.getFullYear(), date.getMonth() + 1, date.getDate());
}

function formatArchiveWindow(
  g: ArchiveGranularity,
  windowStart: number,
  now: number,
  aw: Messages["memory"]["archiveWindow"],
  seasons: Messages["memory"]["seasons"],
): string {
  const ws = new Date(windowStart);
  const n = new Date(now);

  if (g === "day") {
    const todayStart = Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate());
    if (windowStart === todayStart) return aw.today;
    if (windowStart === todayStart - DAY_MS) return aw.yesterday;
    const daysAgo = Math.floor((todayStart - windowStart) / DAY_MS);
    if (daysAgo > 0 && daysAgo < 7) return aw.daysAgo(daysAgo);
    const sameYear = ws.getUTCFullYear() === n.getUTCFullYear();
    return sameYear
      ? aw.monthDayWeek(ws.getUTCMonth() + 1, ws.getUTCDate())
      : aw.ymdWeek(ws.getUTCFullYear(), ws.getUTCMonth() + 1, ws.getUTCDate());
  }

  if (g === "week") {
    const dow = (n.getUTCDay() || 7) - 1;
    const thisWeekStart = Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate() - dow);
    if (windowStart === thisWeekStart) return aw.thisWeek;
    if (windowStart === thisWeekStart - 7 * DAY_MS) return aw.lastWeek;
    const weeksAgo = Math.round((thisWeekStart - windowStart) / (7 * DAY_MS));
    if (weeksAgo > 0 && weeksAgo < 5) return aw.weeksAgo(weeksAgo);
    const sameYear = ws.getUTCFullYear() === n.getUTCFullYear();
    return sameYear
      ? aw.monthDayWeek(ws.getUTCMonth() + 1, ws.getUTCDate())
      : aw.ymdWeek(ws.getUTCFullYear(), ws.getUTCMonth() + 1, ws.getUTCDate());
  }

  if (g === "month") {
    const thisMonth = Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), 1);
    const lastMonth = Date.UTC(n.getUTCFullYear(), n.getUTCMonth() - 1, 1);
    if (windowStart === thisMonth) return aw.thisMonth;
    if (windowStart === lastMonth) return aw.lastMonth;
    const sameYear = ws.getUTCFullYear() === n.getUTCFullYear();
    return sameYear
      ? aw.monthOnly(ws.getUTCMonth() + 1)
      : aw.yearMonth(ws.getUTCFullYear(), ws.getUTCMonth() + 1);
  }

  if (g === "quarter") {
    const thisQStart = Date.UTC(n.getUTCFullYear(), Math.floor(n.getUTCMonth() / 3) * 3, 1);
    if (windowStart === thisQStart) return aw.thisQuarter;
    const sameYear = ws.getUTCFullYear() === n.getUTCFullYear();
    const seasonArr = [seasons.winter, seasons.spring, seasons.summer, seasons.autumn];
    const season = seasonArr[Math.floor(ws.getUTCMonth() / 3)];
    return sameYear ? aw.thisYearSeason(season) : aw.yearSeason(ws.getUTCFullYear(), season);
  }

  // year
  const thisY = n.getUTCFullYear();
  const wsY = ws.getUTCFullYear();
  if (wsY === thisY) return aw.thisYear;
  if (wsY === thisY - 1) return aw.lastYear;
  if (wsY === thisY - 2) return aw.twoYearsAgo;
  return aw.yearOnly(wsY);
}

function temporaryShelf(
  memories: MemoryRecord[],
  now: number,
  rt: Messages["memory"]["relTime"],
): ShelfItem[] {
  return memories
    .filter((m) => m.state === "temporary")
    .sort((a, b) => b.lastAccessedAt - a.lastAccessedAt)
    .map((m) => ({ t: m.topic, meta: relTime(m.lastAccessedAt, now, rt) }));
}

function frequentShelf(
  memories: MemoryRecord[],
  now: number,
  mem: Messages["memory"],
): ShelfItem[] {
  return memories
    .filter((m) => m.state === "active")
    .sort((a, b) => {
      if (b.accessCount !== a.accessCount) return b.accessCount - a.accessCount;
      return b.lastAccessedAt - a.lastAccessedAt;
    })
    .map((m) => ({
      t: mem.accessCount(m.topic, m.accessCount),
      meta: relTime(m.lastAccessedAt, now, mem.relTime),
    }));
}

function archiveShelf(archives: ArchiveEntry[], now: number, mem: Messages["memory"]): ShelfItem[] {
  return [...archives]
    .sort((a, b) => {
      const oa = GRANULARITY_ORDER[a.granularity];
      const ob = GRANULARITY_ORDER[b.granularity];
      if (oa !== ob) return oa - ob;
      return b.windowStart - a.windowStart;
    })
    .map((e) => {
      const top = e.topics
        .slice()
        .sort((a, b) => b.count - a.count)
        .slice(0, 3)
        .map((tp) => tp.topic)
        .join(", ");
      const label = top || mem.archiveItemCount(e.sourceMemoryIds.length);
      return {
        t: label,
        meta: formatArchiveWindow(
          e.granularity,
          e.windowStart,
          now,
          mem.archiveWindow,
          mem.seasons,
        ),
      };
    });
}

function MemoryPage() {
  const { memories, archives } = useMemoryStore();
  const now = Date.now();
  const mem = useT().memory;
  // What Stipple has learned from the user's own sentences — newest first.
  const prefsRaw = useSyncExternalStore(
    subscribePreferencesStore,
    getPreferencesSnapshot,
    getPreferencesSnapshot,
  );
  const known = [...prefsRaw].sort((a, b) => b.lastSeenAt - a.lastSeenAt);

  const shelves: Shelf[] = [
    {
      key: "temp",
      name: mem.shelves.temporary.name,
      desc: mem.shelves.temporary.desc,
      badge: mem.shelves.temporary.badge,
      items: temporaryShelf(memories, now, mem.relTime),
      empty: mem.shelves.temporary.empty,
    },
    {
      key: "frequent",
      name: mem.shelves.frequent.name,
      desc: mem.shelves.frequent.desc,
      badge: mem.shelves.frequent.badge,
      items: frequentShelf(memories, now, mem),
      empty: mem.shelves.frequent.empty,
    },
    {
      key: "saved",
      name: mem.shelves.saved.name,
      desc: mem.shelves.saved.desc,
      badge: mem.shelves.saved.badge,
      items: SAVED_RECIPES.map((r) => ({ t: r.title, meta: r.mentioned })),
      empty: mem.shelves.saved.empty,
    },
    {
      key: "archive",
      name: mem.shelves.archive.name,
      desc: mem.shelves.archive.desc,
      badge: mem.shelves.archive.badge,
      items: archiveShelf(archives, now, mem),
      empty: mem.shelves.archive.empty,
    },
  ];

  return (
    <Shell>
      <div className="flex flex-col">
        <header className="px-8 md:px-12 pt-10 pb-8 border-b border-border">
          <p className="font-mono text-[10.5px] uppercase tracking-[0.18em] text-ink-soft">
            {mem.eyebrow}
          </p>
          <h1 className="mt-2 text-[32px] font-semibold tracking-tight text-ink">{mem.title}</h1>
          <p className="mt-2 text-[14px] text-ink-soft max-w-xl">{mem.subtitle}</p>
        </header>

        <div className="px-8 md:px-12 py-10 max-w-3xl space-y-3">
          <section className="rounded-xl border border-border bg-card overflow-hidden slide-in">
            <div className="px-5 py-4 flex items-baseline justify-between border-b border-border">
              <div>
                <h2 className="text-[15px] font-semibold tracking-tight text-ink">
                  {mem.known.name}
                </h2>
                <p className="text-[12px] text-ink-soft mt-0.5">{mem.known.desc}</p>
              </div>
              <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-ink-soft shrink-0 ml-3">
                {mem.known.badge}
              </span>
            </div>
            <ul className="divide-y divide-border">
              {known.length === 0 ? (
                <li className="px-5 py-4 text-[13px] text-ink-soft/80 italic">{mem.known.empty}</li>
              ) : (
                known.map((k) => (
                  <li key={k.id} className="px-5 py-3 flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-[13.5px] text-ink">
                        <span className="font-mono text-[10.5px] uppercase tracking-[0.12em] text-ink-soft mr-2">
                          {k.type === "like" ? mem.known.like : mem.known.dislike}
                        </span>
                        {k.subject}
                      </div>
                      {k.sourceText && (
                        <div className="mt-1 text-[12px] text-ink-soft truncate">
                          {mem.known.from} “{k.sourceText}”
                        </div>
                      )}
                    </div>
                    <div className="flex items-center gap-3 shrink-0">
                      {k.count > 1 && (
                        <span className="font-mono text-[10.5px] text-ink-soft">
                          {mem.known.times(k.count)}
                        </span>
                      )}
                      <button
                        type="button"
                        onClick={() => removePreference(k.id)}
                        className="font-mono text-[10.5px] uppercase tracking-[0.12em] text-ink-soft hover:text-ink"
                      >
                        {mem.known.remove}
                      </button>
                    </div>
                  </li>
                ))
              )}
            </ul>
          </section>

          {shelves.map((shelf) => (
            <section
              key={shelf.key}
              className="rounded-xl border border-border bg-card overflow-hidden slide-in"
            >
              <div className="px-5 py-4 flex items-baseline justify-between border-b border-border">
                <div>
                  <h2 className="text-[15px] font-semibold tracking-tight text-ink">
                    {shelf.name}
                  </h2>
                  <p className="text-[12px] text-ink-soft mt-0.5">{shelf.desc}</p>
                </div>
                <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-ink-soft shrink-0 ml-3">
                  {shelf.badge}
                </span>
              </div>
              <ul className="divide-y divide-border">
                {shelf.items.length === 0 ? (
                  <li className="px-5 py-4 text-[13px] text-ink-soft/80 italic">{shelf.empty}</li>
                ) : (
                  shelf.items.map((item, i) => (
                    <li key={i} className="px-5 py-3 flex items-center justify-between gap-3">
                      <span className="text-[13.5px] text-ink min-w-0 truncate">{item.t}</span>
                      <span className="font-mono text-[10.5px] text-ink-soft shrink-0">
                        {item.meta}
                      </span>
                    </li>
                  ))
                )}
              </ul>
            </section>
          ))}

          <div className="mt-8 p-4 rounded-lg bg-surface-2 border border-border">
            <p className="text-[12.5px] text-ink-soft leading-relaxed">
              <span className="text-ink font-medium">{mem.footerLine1}</span> {mem.footerLine2}
            </p>
          </div>
        </div>
      </div>
    </Shell>
  );
}
