// Phase M0: Preference store — 선호 표현 (좋아/싫어) 영구 저장.
//
// 별도 키 "dots:preferences" — learning/store.ts (응답 캐시) 와 분리. Memory
// inject (다음 단계) 시 Cloud system prompt 의 USER_CONTEXT 에 박힐 데이터.
//
// 패턴: learning/store.ts + dictionary.ts 와 동일 — module-level cache + Set
// of listeners, localStorage 직렬화. 5MB cap 안에서 preference 수천 개까지 충분.
//
// addPreference 는 같은 (type, subject) 중복을 피해 갱신 — 사용자가 "매운 음식
// 좋아해" 를 두 번 말해도 entry 가 두 개 박히지 X.

const STORAGE_KEY = "dots:preferences";

export interface PreferenceEntry {
  id: string;
  type: "like" | "dislike";
  subject: string;
  createdAt: number;
  // The user's own sentence this was learned from, verbatim. Shown on the
  // memory screen so every stored item can be traced to what was actually said.
  sourceText?: string;
  // How many times the user has said it, and when last.
  count: number;
  lastSeenAt: number;
}

let cache: PreferenceEntry[] = [];
let hydrated = false;

const listeners = new Set<() => void>();
function emit() {
  listeners.forEach((l) => l());
}

function persist(): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(cache));
  } catch (err) {
    console.warn("[preferences] persist failed:", err);
  }
}

export function hydratePreferencesStore(): void {
  if (hydrated) return;
  hydrated = true;
  if (typeof localStorage === "undefined") return;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw) as Array<Partial<PreferenceEntry>>;
    if (Array.isArray(parsed)) {
      cache = parsed
        .filter((e): e is PreferenceEntry =>
          Boolean(e?.id && e?.subject && (e?.type === "like" || e?.type === "dislike")),
        )
        .map((e) => ({
          id: e.id,
          type: e.type,
          subject: e.subject,
          createdAt: e.createdAt ?? Date.now(),
          sourceText: e.sourceText,
          count: e.count ?? 1,
          lastSeenAt: e.lastSeenAt ?? e.createdAt ?? Date.now(),
        }));
      emit();
    }
  } catch (err) {
    console.warn("[preferences] hydrate failed:", err);
  }
}

// 같은 대상인지 판정하는 키. 소문자화 + 뜻을 바꾸지 않는 일반 꼬리말만 제거.
// "meat" 와 "meat substitutes" 처럼 뜻이 달라지는 경우는 합치지 않는다.
const GENERIC_TAIL = /\s*(?:foods?|dishes|stuff|things|음식|요리)$/iu;
export function subjectKey(subject: string): string {
  const s = subject.trim().toLowerCase().replace(/\s+/g, " ");
  const stripped = s.replace(GENERIC_TAIL, "").trim();
  return stripped || s;
}

export function addPreference(
  type: "like" | "dislike",
  subject: string,
  sourceText?: string,
): PreferenceEntry {
  // Never write before reading: if the module was re-evaluated (dev hot reload)
  // or a caller runs before the root effect, an add on an un-hydrated cache
  // would overwrite everything already stored.
  hydratePreferencesStore();
  const trimmed = subject.trim();
  // 중복 제거: 같은 대상이면 (대소문자 / "spicy" vs "spicy food" 같은 일반
  // 꼬리말 차이 무시) 기존 것을 떨궈낸 후 새 entry 박음. type 이 반대여도
  // 떨군다 — "좋아" 라고 했다가 "싫어" 라고 하면 최신 발화가 이긴다.
  const key = subjectKey(trimmed);
  // 같은 대상 + 같은 방향을 다시 말한 경우 → 횟수 누적, 처음 말한 시점 유지.
  const prior = cache.find((e) => subjectKey(e.subject) === key && e.type === type);
  cache = cache.filter((e) => subjectKey(e.subject) !== key);
  const now = Date.now();
  const entry: PreferenceEntry = {
    id: crypto.randomUUID(),
    type,
    subject: trimmed,
    createdAt: prior?.createdAt ?? now,
    sourceText: sourceText?.trim() || prior?.sourceText,
    count: (prior?.count ?? 0) + 1,
    lastSeenAt: now,
  };
  cache = [...cache, entry];
  persist();
  emit();
  return entry;
}

export function removePreference(id: string): boolean {
  hydratePreferencesStore();
  const before = cache.length;
  cache = cache.filter((e) => e.id !== id);
  if (cache.length === before) return false;
  persist();
  emit();
  return true;
}

export function listPreferences(): PreferenceEntry[] {
  return [...cache].sort((a, b) => b.lastSeenAt - a.lastSeenAt);
}

// Stable reference for useSyncExternalStore (changes only when the store does).
export function getPreferencesSnapshot(): PreferenceEntry[] {
  return cache;
}

export function listByType(type: "like" | "dislike"): PreferenceEntry[] {
  return listPreferences().filter((e) => e.type === type);
}

export function subscribePreferencesStore(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export function clearPreferences(): void {
  cache = [];
  persist();
  emit();
}
