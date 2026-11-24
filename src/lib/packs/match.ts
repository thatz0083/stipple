// 온디바이스 콘텐츠 매처. 사용자 입력이 들어오면 먼저 여기를 통해 활성 팩
// + 다른 설치 팩의 contents를 훑는다. 매칭이 있으면 buildPackSuggestion이
// 버튼 옵션이 붙은 답변 페이로드를 만들어 LLM 호출 없이 화면에 띄울 수
// 있게 한다. 매칭이 없을 때만 기존처럼 composeAnswer → Gemini로 흘러간다.

import {
  COOKING_RECIPES,
  type AnswerPayload,
  type Pack,
  type PackRecipe,
  type SuggestionOption,
} from "@/lib/dots-data";
import type { ActionArea } from "@/lib/dots-data";
import type { Intent } from "@/lib/packs/intent";
import { classifyCraving } from "@/lib/packs/intent";
import { cleanRequestedNoun } from "@/lib/text/clean-noun";
import { extractNouns, extractNounsEn } from "@/lib/text/extract-nouns";
import { detectLanguage, type Lang } from "@/lib/text/detect-language";
import {
  cosineSimilarity,
  embed,
  embedBatch,
  getEmbeddingStatus,
  PACK_SIMILARITY_THRESHOLD,
} from "@/lib/embedding";
import { getSATMathProblem } from "@/lib/packs/study/sat-math";
import type { SATMathProblem } from "@/lib/packs/study/types";
import { getUserSATProblems } from "@/lib/packs/study/user-store";
// 안정성 정정 (2026-04-30): GTE reranker Transformers.js 호환 작업 중 →
// V4.5 단계 통째로 skip. import는 type만 살려두면 ESLint unused import
// 경고가 떠서 const 가드 + dead-code 방식으로 통제. PACK_RERANK_THRESHOLD /
// RERANK_TOP_N은 dead 분기 안에서 참조되므로 import 그대로 둔다.
import { PACK_RERANK_THRESHOLD, RERANK_TOP_N } from "@/lib/reranker";

const RERANKER_ENABLED = false;

// 문제별 키워드 — 특정 문제를 정확히 가리키는 단어들. "삼각비" 같은 입력이
// 들어오면 sat-m-005만 점수 받음.
const SAT_MATH_KEYWORDS: Record<string, string[]> = {
  "sat-m-001": ["일차", "방정식", "linear", "equation"],
  "sat-m-002": ["이차", "꼭짓점", "포물선", "parabola", "quadratic", "vertex"],
  "sat-m-003": ["삼각형", "넓이", "직각", "triangle", "area"],
  "sat-m-004": ["확률", "주사위", "probability", "dice"],
  "sat-m-005": ["삼각비", "삼각함수", "sin", "cos", "tan", "trig"],
};

// Study 팩 도메인 키워드. SAT 수학 전용("수학", "방정식")부터 학습 전반
// ("공부", "설명")까지 묶음. 이 중 한 단어 hit이면 팩 매칭이 성립 —
// "수학" 단독이면 5문제 전부 약하게 매치되어 pack-level로 분류된다.
// "공부"/"설명"이 빠져 있어 inferDomainPack soft에서 cooking이 잘못
// 잡히던 버그(회귀 진단 BUG #2) 수정 차원에서 보강.
const STUDY_DOMAIN = [
  "수학",
  "math",
  "sat",
  "방정식",
  "함수",
  "기하",
  "확률",
  "삼각",
  "통계",
  "대수",
  "공부",
  "study",
  "homework",
  "설명",
];

// 일반 학습 키워드. 단독으로는 매칭 X — DOMAIN 또는 specific 키워드와
// 함께 있어야 점수에 가산된다. 이 게이트가 "사회문제" / "국어 문제"
// 같은 입력이 SAT 수학으로 잘못 잡히던 버그를 막는다.
const STUDY_GENERIC = ["문제", "퀴즈", "테스트", "problem", "quiz", "test"];

// Phase EN-3: 영어 specific 키워드 추가. "kimchi stew" / "kimchi jjigae" / "baek"
// 같은 다어 / 이름 형식만 — 단어 "tuna" / "tofu" / "pork" 단독은 식문화 무관
// 발화 ("tuna fishing" / "pork barrel") 충돌 위험으로 제외.
const COOKING_RECIPE_KEYWORDS: Record<string, string[]> = {
  bulgogi: ["불고기", "소불고기", "bulgogi"],
  bibimbap: ["비빔밥", "나물비빔밥", "채소비빔밥", "bibimbap"],
};

// Cooking-domain substrings — any single hit counts as a cooking signal.
// Mirrors STUDY_DOMAIN's role: prevents an input like "양자역학" from
// drifting into Cooking just because the cooking pack is installed.
//
// Note: "국" / "밥" / "면" are very short Korean tokens and can collide
// (e.g. "한국어" contains "국"). Kept per spec — if false positives show
// up in production we narrow to compounds like "국밥" / "찌개국" instead.
// Phase EN-3: 영어 도메인 키워드는 보수적으로 — "kimchi" / "korean food" /
// "korean recipe" 같은 식문화 specific 토큰만. "soup" / "dish" / "meal" /
// "food" 단독은 일상 영어에 흔히 박혀 ("I had a rough day" 같은 무관 입력이
// cooking 으로 끌려가는 회귀) 의도적 제외.
const COOKING_DOMAIN = [
  "요리",
  "레시피",
  "음식",
  "cook",
  "recipe",
  "조리",
  "반찬",
  "재료",
  "양념",
  "불고기",
  "비빔밥",
  "korean food",
  "korean recipe",
];

// Cooking-generic — too broad to match alone. Only counts when a
// specific-recipe or domain keyword also fired. "맛집 추천해줘" alone
// shouldn't surface kimchi recipes; "한식 레시피" should (domain hit
// via "레시피").
const COOKING_GENERIC = ["맛", "한식", "양식", "추천"];

// Score weights — rescaled so we can apply a "must be confident" threshold
// before forcing the user into a local match. With these weights:
//   "김치찌개"        → specific(60) + domain(30) = 90   → match
//   "한식 레시피"     → domain(30)   + generic(5)  = 35   → match (pack-level)
//   "수학"            → domain(30)                 = 30   → match (pack-level)
//   "메뉴 추천"       → only generic, gated to 0           → LLM
//   "양자역학"        → no hit                     = 0    → LLM
// 회귀 진단 BUG #1: domain alone(20)이 MATCH_THRESHOLD(30) 미만이라 "수학"
// 단독 입력이 카드로 안 떴다. 30으로 올려 domain hit만으로도 pack-level
// 매칭이 성립하게.
// V2 헌법: 자연스러움 우선. 점수 낮으면 억지로 카드 띄우지 말고 LLM이
// 자연스러운 톤으로 답하게.
const SPECIFIC_HIT_SCORE = 60;
const DOMAIN_HIT_SCORE = 30;
const GENERIC_HIT_SCORE = 5;

// Below this, matchPackContent returns null even though we found a
// non-zero score — the input is too ambiguous to justify a SuggestionBlock.
// inferDomainPack still surfaces the leaning pack so the LLM can pick up
// its voice/tone for a natural response.
export const MATCH_THRESHOLD = 30;

export type ContentMatch =
  | { kind: "sat-math"; problem: SATMathProblem; score: number }
  | { kind: "cooking-recipe"; recipe: PackRecipe; score: number };

// V5.0 lite Phase A: facet — entry가 intent별로 자기 응답 텍스트를 갖는다.
// 매처 내부에서 intent를 보고 entry의 어떤 필드를 노출할지 결정 (selectFacet).
// kind는 trace.reason의 facet 태그에도 그대로 사용.
// V5.0 Phase B3c: "craving" kind 추가 — 식욕 발화 ("먹고싶다") 감지 시 entry의
// definition 텍스트를 craving 톤으로 노출.
export type Facet = {
  kind: "definition" | "how_to" | "casual" | "craving";
  text: string;
  // definition 분기일 때 pack_context를 함께 노출. UI는 두 텍스트를 이어붙여
  // 렌더링 — pack 자기-노출 (#13 Phase B 의 사전 단계).
  pack_context?: string;
};

// V5.0 lite Phase B1: 매칭 우선순위.
//   exact   — text가 entry.title을 그대로 substring으로 포함. 동률 0.
//   partial — extractNouns(text) 명사구 ↔ entry.title 부분 매칭.
//   fuzzy   — 기존 V3.5 keyword/임베딩 score 매칭 (fallback only).
// 모든 pack 범용. pack-id / entry-id 기반 hardcode 0.
export type MatchConfidence = "exact" | "partial" | "fuzzy";

export type PackMatchResult = {
  pack: Pack;
  isActivePack: boolean;
  // True when no specific content scored above the generic threshold —
  // the user's query is about the pack as a whole, not one item.
  packLevel: boolean;
  matches: ContentMatch[];
  // V5.0 lite Phase A: 선택된 facet.
  facet?: Facet;
  // V5.0 lite Phase A: trace.reason의 [entry_name] 자리.
  topEntryName?: string;
  // V5.0 lite Phase B1: 매칭 confidence.
  confidence?: MatchConfidence;
  // V5.0 lite Phase B1: fuzzy 분기에서 사용자가 입력했지만 entry에 없는
  // 명사. "[pack]에 [requestedNoun] 정확히 없어" 응답 텍스트 + B2 부정
  // 처리에 사용.
  requestedNoun?: string;
  // V5.0 lite Phase B3b: alias로 매칭된 경우 매칭된 alias 텍스트. confidence는
  // exact 또는 partial 그대로 유지. trace.reason 형식만 분기 (exact-alias).
  matchedAlias?: string;
  // Phase EN-3: 입력 언어. 빌더가 영어 응답 분기에 사용 (Step 4). 매처 본체
  // 동작은 lang 무관 — partial step 의 명사 추출만 lang 따라 갈림.
  lang: Lang;
  // Multi-match phase: 같은 카테고리 (예: 김치찌개) 의 peer entry 가 2 이상
  // 동시 매칭됐을 때 set. 값 = 사용자가 입력한 공통 키 (alias 또는 noun) — 빌더
  // 가 "{key} 종류 N가지 있어. 어떤 거 볼래?" 응답 + 카드 선택 박음.
  // matches.length > 1 이고 이 필드가 set 된 경우만 chooser. fuzzy 다중
  // matches 는 이 필드 미박힘 → 기존 "비슷한 레시피 N개" 텍스트 유지.
  multiMatchKey?: string;
};

function lower(s: string): string {
  return s.toLowerCase();
}

// V3.5 게이트 보강 (2026-05-01): specific pack target 동적 스캔.
// installed packs의 Pack.triggers를 그대로 사용 — 별도 사전 X / 하드코딩 X.
// 입력에 어떤 trigger 단어라도 substring으로 들어 있으면 그 트리거+팩을
// 반환. send()는 이 결과를 보고 definition/follow-up 게이트를 override.
//
// 주의: matchPackContent의 매칭 결과와 다를 수 있다. 이 헬퍼는 게이트용 —
// specific 점수 계산이 아니라 "사용자가 명시적으로 팩을 가리켰는가" 판단.
// 매처 본체 로직은 건드리지 않는다.
export function findSpecificPackTarget(
  text: string,
  installed: Pack[],
): { pack: Pack; trigger: string } | null {
  const q = lower(text);
  for (const pack of installed) {
    for (const trigger of pack.triggers) {
      if (q.includes(lower(trigger))) {
        return { pack, trigger };
      }
    }
  }
  return null;
}

// Two scoring modes:
//   "strict" — matchPackContent. Generic-only inputs ("맛집 추천") gate
//              to 0 so we don't surface a SuggestionBlock from a single
//              broad word.
//   "soft"   — inferDomainPack. Generic-only is enough to lean toward a
//              pack, because all we're doing is hinting voice/tone for
//              the LLM. "메뉴 추천" leans cooking; we want that.
type ScoreMode = "strict" | "soft";

function scoreSATMath(q: string, problem: SATMathProblem, mode: ScoreMode): number {
  let specific = 0;
  let domain = 0;
  let generic = 0;
  for (const k of SAT_MATH_KEYWORDS[problem.id] ?? []) {
    if (q.includes(lower(k))) {
      specific += SPECIFIC_HIT_SCORE;
      break;
    }
  }
  for (const k of STUDY_DOMAIN) {
    if (q.includes(lower(k))) {
      domain = DOMAIN_HIT_SCORE;
      break;
    }
  }
  for (const k of STUDY_GENERIC) {
    if (q.includes(lower(k))) {
      generic = GENERIC_HIT_SCORE;
      break;
    }
  }
  if (mode === "strict" && specific === 0 && domain === 0) return 0;
  return specific + domain + generic;
}

function scoreCookingRecipe(q: string, recipe: PackRecipe, mode: ScoreMode): number {
  let specific = 0;
  let domain = 0;
  let generic = 0;
  for (const k of COOKING_RECIPE_KEYWORDS[recipe.id] ?? []) {
    if (q.includes(lower(k))) {
      specific += SPECIFIC_HIT_SCORE;
      // Don't break — multiple recipe keywords reinforcing the signal
      // (김치 + 찌개 + 백종원) is fine, but cap at one bonus per recipe
      // to keep scoring comparable across packs.
      break;
    }
  }
  for (const k of COOKING_DOMAIN) {
    if (q.includes(lower(k))) {
      domain = DOMAIN_HIT_SCORE;
      break;
    }
  }
  for (const k of COOKING_GENERIC) {
    if (q.includes(lower(k))) {
      generic = GENERIC_HIT_SCORE;
      break;
    }
  }
  if (mode === "strict" && specific === 0 && domain === 0) return 0;
  return specific + domain + generic;
}

type Candidate = {
  pack: Pack;
  isActive: boolean;
  matches: ContentMatch[];
  bestScore: number;
};

// V4 Hybrid Search — 팩 콘텐츠 시맨틱 매칭. 모듈 단위 캐시: 첫 매칭 호출
// 시 모든 팩 콘텐츠를 batch로 임베딩해서 보관. 사용자가 모델을 바꾸면
// (768d ↔ 384d) 차원이 달라지므로 캐시를 비우고 다시 구축.
const packVectorCache = new Map<string, Float32Array>();
let packVectorBuildPromise: Promise<void> | null = null;
let lastBuildModelId: string | undefined;

function packVectorKey(kind: ContentMatch["kind"], id: string): string {
  return `${kind}:${id}`;
}

function getRecipeMatchText(r: PackRecipe): string {
  // 매칭에 가장 중요한 신호: 제목 + 주요 재료. 단계는 매칭 노이즈 많음
  // ("끓이다"·"썰다" 같은 일반 동사). 시연 시 "백종원" / "참치" / "두부"가
  // 핵심 식별자.
  const ingredients = r.ingredients.map((i) => i.item).join(" ");
  return `${r.title} ${ingredients}`;
}

function getSATMatchText(p: SATMathProblem): string {
  // 한국어 토픽 라벨 + 문제 본문. 라벨이 한국어이므로 사용자가 한국어로
  // 입력해도 의미 거리가 가깝다 ("기하" / "삼각형" 등).
  return `${SAT_TOPIC_LABEL[p.topic]} ${p.question}`;
}

async function ensurePackVectors(installedPacks: Pack[]): Promise<void> {
  const status = getEmbeddingStatus();
  if (status.state !== "ready") return;
  // 모델이 바뀌면 차원도 바뀌므로 캐시 폐기 후 다시 구축.
  if (lastBuildModelId !== status.model) {
    packVectorCache.clear();
    lastBuildModelId = status.model;
    packVectorBuildPromise = null;
  }
  if (packVectorBuildPromise) return packVectorBuildPromise;

  packVectorBuildPromise = (async () => {
    type Item = { key: string; text: string };
    const items: Item[] = [];
    for (const pack of installedPacks) {
      if (!pack.contents) continue;
      for (const ref of pack.contents) {
        if (ref.kind === "sat-math") {
          const p = getSATMathProblem(ref.problemId);
          if (!p) continue;
          const key = packVectorKey("sat-math", p.id);
          if (packVectorCache.has(key)) continue;
          items.push({ key, text: getSATMatchText(p) });
        } else if (ref.kind === "cooking-recipe") {
          const r = COOKING_RECIPES.find((x) => x.id === ref.recipeId);
          if (!r) continue;
          const key = packVectorKey("cooking-recipe", r.id);
          if (packVectorCache.has(key)) continue;
          items.push({ key, text: getRecipeMatchText(r) });
        }
      }
      if (pack.id === "study-companion") {
        for (const p of getUserSATProblems()) {
          const key = packVectorKey("sat-math", p.id);
          if (packVectorCache.has(key)) continue;
          items.push({ key, text: getSATMatchText(p) });
        }
      }
    }
    if (items.length === 0) return;
    try {
      const vectors = await embedBatch(items.map((i) => i.text));
      items.forEach((item, i) => packVectorCache.set(item.key, vectors[i]));
    } catch (err) {
      console.warn("[packs] 콘텐츠 임베딩 실패, 키워드만 사용:", err);
    }
  })();

  await packVectorBuildPromise;
  packVectorBuildPromise = null;
}

// 키워드 점수와 시맨틱 점수를 합친다. 두 신호 중 큰 값을 사용 — OR 게이트.
//   - 키워드 hit (specific 60 / domain 30 / generic 5)이 강하면 그대로
//   - 시맨틱 유사도 0.85 이상이면 sim*100으로 스케일해서 같이 비교
//   - 둘 다 약하면 합쳐도 약함 → 매칭 임계값(30) 미달로 미스
function combineScores(
  keywordScore: number,
  queryVec: Float32Array | null,
  vectorKey: string,
): number {
  if (!queryVec) return keywordScore;
  // 키워드 신호가 전혀 없으면(도메인도 specific도 0점) 임베딩만으로
  // 끌어올리지 않는다. 도메인 밖 입력("cilantro")이 엉뚱한 pack entry
  // (Trigonometry)에 허위 임베딩 유사도로 걸려 억지 매칭되던 회귀 차단 —
  // 모르는 입력은 cloud로 흘려보낸다 ("로컬은 확실한 것만").
  if (keywordScore === 0) return 0;
  const stored = packVectorCache.get(vectorKey);
  if (!stored) return keywordScore;
  const sim = cosineSimilarity(queryVec, stored);
  if (sim < PACK_SIMILARITY_THRESHOLD) return keywordScore;
  return Math.max(keywordScore, sim * 100);
}

// Shared scoring loop. Builds candidates with non-zero scores; sorts so
// the active pack wins ties, then highest-score wins. Both
// matchPackContent and inferDomainPack use this — same scoring different
// modes (strict gates generic-only to 0; soft keeps it).
//
// V4: queryVec이 주어지면 시맨틱 점수를 키워드 점수와 max로 합친다.
// queryVec === null이면 V3 키워드만 — 모델 미사용 / inferDomainPack soft
// 모드 호출 시.
function scoreCandidates(
  query: string,
  installedPacks: Pack[],
  activePackId: string | undefined,
  mode: ScoreMode,
  queryVec: Float32Array | null = null,
): Candidate[] {
  const q = lower(query);
  const candidates: Candidate[] = [];

  for (const pack of installedPacks) {
    if (!pack.contents || pack.contents.length === 0) continue;
    const matches: ContentMatch[] = [];
    for (const ref of pack.contents) {
      if (ref.kind === "sat-math") {
        const problem = getSATMathProblem(ref.problemId);
        if (!problem) continue;
        const keyword = scoreSATMath(q, problem, mode);
        const score = combineScores(keyword, queryVec, packVectorKey("sat-math", problem.id));
        if (score > 0) matches.push({ kind: "sat-math", problem, score });
      } else if (ref.kind === "cooking-recipe") {
        const recipe = COOKING_RECIPES.find((r) => r.id === ref.recipeId);
        if (!recipe) continue;
        const keyword = scoreCookingRecipe(q, recipe, mode);
        const score = combineScores(keyword, queryVec, packVectorKey("cooking-recipe", recipe.id));
        if (score > 0) matches.push({ kind: "cooking-recipe", recipe, score });
      }
    }
    // User-generated SAT problems live outside the static contents array
    // (added at runtime). Pull them in here so a user-saved problem also
    // counts toward "Study에 N문제 있어".
    if (pack.id === "study-companion") {
      for (const problem of getUserSATProblems()) {
        const keyword = scoreSATMath(q, problem, mode);
        const score = combineScores(keyword, queryVec, packVectorKey("sat-math", problem.id));
        if (score > 0) matches.push({ kind: "sat-math", problem, score });
      }
    }
    if (matches.length === 0) continue;
    matches.sort((a, b) => b.score - a.score);
    candidates.push({
      pack,
      isActive: pack.id === activePackId,
      matches,
      bestScore: matches[0].score,
    });
  }

  // Active pack wins ties; otherwise highest-scoring pack wins.
  candidates.sort((a, b) => {
    if (a.isActive !== b.isActive) return a.isActive ? -1 : 1;
    return b.bestScore - a.bestScore;
  });

  return candidates;
}

// V5.0 lite Phase A: intent별 facet 선택. entry에 facet 필드가 있고 intent와
// 매핑되는 데이터가 있을 때만 Facet 반환. 그 외 (Phase A 미마이그레이션 entry,
// intent 미상, follow-up 등) → null → 호출 측이 기존 렌더링으로 fallback.
//
// 분기:
//   definition / casual → entry.definition (definition만 pack_context 동반)
//   search / recommend / unknown → entry.how_to
//   follow-up           → Phase A에선 how_to 동일 처리. lastFacet 추적은 Phase B.
//
// V5.0 lite Phase A.5: 입력 타입을 duck-typed FacetFields로 완화 — Study pack의
// SATMathProblem도 같은 5필드를 갖도록 type 확장 후 그대로 통과시킨다.
// PackRecipe도 FacetFields 호환 (5필드 모두 동일 이름·optional).
// V5.0 Phase B3a/B3c: contexts 필드도 같이 평탄화 — selectFacet이 contexts
// 멤버십 게이트 필요할 때 사용.
type FacetFields = {
  definition?: string;
  pack_context?: string;
  how_to?: string;
  examples?: string[];
  related_terms?: string[];
  contexts?: string[];
};

// V5.0 Phase B3c: facet 선택 보조 신호. craving은 intent enum에 없는 별도
// 표현 검출 (먹고싶다 / 당기다 / 먹으러 등). selectFacet이 craving + entry
// 의 contexts에 "craving" 있을 때 craving facet 우선 반환.
type FacetOpts = { craving?: boolean };

// V5.0 lite Phase A.5: ContentMatch에서 facet payload 추출. cooking-recipe와
// sat-math 모두 FacetFields 호환 — head.kind만 분기해서 같은 selectFacet에 통과.
// V5.0 Phase B3c: opts (craving 등) 같이 전달.
function pickFacetFromMatch(
  head: ContentMatch,
  intent?: Intent,
  opts: FacetOpts = {},
): Facet | undefined {
  if (head.kind === "cooking-recipe") return selectFacet(head.recipe, intent, opts) ?? undefined;
  if (head.kind === "sat-math") return selectFacet(head.problem, intent, opts) ?? undefined;
  return undefined;
}

function selectFacet(entry: FacetFields, intent?: Intent, opts: FacetOpts = {}): Facet | null {
  const ctx = entry.contexts;

  // V5.0 Phase B3c: craving 우선 분기. intent가 craving 의도를 잡지 못하므로
  // 보조 신호로 분리. entry.contexts에 "craving" 있고 (또는 contexts 미정의),
  // entry.definition도 있을 때 craving facet으로 노출. casual과 텍스트 동일하나
  // kind는 craving — 응답 빌더 (action_options) 분기 + trace.reason 가시화에 사용.
  if (opts.craving && (!ctx || ctx.includes("craving")) && entry.definition) {
    return { kind: "craving", text: entry.definition };
  }

  if (!intent) return null;

  // V5.0 Phase B3c: contexts 게이트. entry.contexts가 정의되어 있고 해당 intent
  // 매핑이 contexts에 없으면 facet 미반환 — entry가 자기 답변 범위를 명시한 경우
  // 그 범위 밖 의도엔 일반 fallback (기존 hardcoded 톤) 사용.
  if (intent === "definition") {
    if (!entry.definition) return null;
    if (ctx && !ctx.includes("definition")) return null;
    return { kind: "definition", text: entry.definition, pack_context: entry.pack_context };
  }
  if (intent === "casual") {
    if (!entry.definition) return null;
    if (ctx && !ctx.includes("casual")) return null;
    return { kind: "casual", text: entry.definition };
  }
  if (intent === "search" || intent === "recommend" || intent === "unknown") {
    if (!entry.how_to) return null;
    if (ctx && !ctx.includes("how_to") && !ctx.includes(intent)) return null;
    return { kind: "how_to", text: entry.how_to };
  }
  if (intent === "follow-up") {
    if (entry.how_to) {
      if (ctx && !ctx.includes("how_to")) return null;
      return { kind: "how_to", text: entry.how_to };
    }
    return null;
  }
  return null;
}

const SAT_TOPIC_LABEL_FOR_TRACE: Record<string, string> = {
  algebra: "대수",
  geometry: "기하",
  statistics: "확률·통계",
  trigonometry: "삼각함수",
};

function getEntryNameForTrace(m: ContentMatch | undefined): string {
  if (!m) return "?";
  if (m.kind === "cooking-recipe") return m.recipe.title;
  if (m.kind === "sat-math") {
    return SAT_TOPIC_LABEL_FOR_TRACE[m.problem.topic] ?? m.problem.id;
  }
  return "?";
}

// V5.0 Phase B1 — 모든 pack의 모든 entry를 단일 배열로 평탄화. exact/partial
// 매칭이 pack-id 무관하게 한 번에 스캔할 수 있게. 범용 코드.
// V5.0 Phase B3b — entry.aliases도 EntryRef에 평탄화. matcher가 entryName 외에
// alias도 동일 priority로 검사 (단, exact-alias 매칭 시 trace.reason만 분기).
type EntryRef = { pack: Pack; match: ContentMatch; entryName: string; aliases: string[] };

function collectEntries(installedPacks: Pack[]): EntryRef[] {
  const out: EntryRef[] = [];
  for (const pack of installedPacks) {
    if (!pack.contents) continue;
    for (const ref of pack.contents) {
      if (ref.kind === "cooking-recipe") {
        const r = COOKING_RECIPES.find((x) => x.id === ref.recipeId);
        if (r)
          out.push({
            pack,
            match: { kind: "cooking-recipe", recipe: r, score: 100 },
            entryName: r.title,
            aliases: r.aliases ?? [],
          });
      } else if (ref.kind === "sat-math") {
        const p = getSATMathProblem(ref.problemId);
        if (p) {
          const name = SAT_TOPIC_LABEL_FOR_TRACE[p.topic] ?? p.id;
          out.push({
            pack,
            match: { kind: "sat-math", problem: p, score: 100 },
            entryName: name,
            aliases: p.aliases ?? [],
          });
        }
      }
    }
    if (pack.id === "study-companion") {
      for (const p of getUserSATProblems()) {
        const name = SAT_TOPIC_LABEL_FOR_TRACE[p.topic] ?? p.id;
        out.push({
          pack,
          match: { kind: "sat-math", problem: p, score: 100 },
          entryName: name,
          aliases: p.aliases ?? [],
        });
      }
    }
  }
  return out;
}

// Step 1: text가 entry.title을 그대로 substring으로 포함 + token 경계 일치
// 시 exact. 경계 검사가 없으면 2자 entry name ("대수")이 더 긴 합성어
// ("선형대수학")의 substring으로 false-exact 됨. 경계 = 시작/끝, 공백,
// 조사 (는/은/이/가/...), 또는 구두점.
const KOREAN_PARTICLE_BOUNDARIES = /[는은이가을를의에도만,.!?]/;

function isExactBoundary(text: string, name: string): boolean {
  const lowerText = text.toLowerCase();
  const lowerName = name.toLowerCase();
  let from = 0;
  while (from < lowerText.length) {
    const idx = lowerText.indexOf(lowerName, from);
    if (idx === -1) return false;
    const before = idx === 0 ? null : lowerText[idx - 1];
    const afterIdx = idx + lowerName.length;
    const after = afterIdx >= lowerText.length ? null : lowerText[afterIdx];
    const beforeOk = before === null || /\s/.test(before);
    const afterOk = after === null || /\s/.test(after) || KOREAN_PARTICLE_BOUNDARIES.test(after);
    if (beforeOk && afterOk) return true;
    from = idx + 1;
  }
  return false;
}

// V5.0 Phase B3b: entryName 외에 aliases도 동일 priority로 검사. 가장 긴
// 매칭 텍스트 (entry name 또는 alias) 우선. entry name과 alias가 동률이면
// entry name 우선 (정렬 안정성). alias로 매칭되면 matchedAlias 기록.
//
// matchedText — 빌더가 peer 검출 + 카테고리 키로 쓰는 텍스트 (alias 또는 entryName).
function findExactEntry(
  text: string,
  entries: EntryRef[],
): { entry: EntryRef; matchedAlias?: string; matchedText: string } | null {
  let best: {
    entry: EntryRef;
    matchedAlias?: string;
    matchedText: string;
    matchLength: number;
  } | null = null;

  for (const e of entries) {
    // entry name 먼저 — 동률 시 우선.
    if (isExactBoundary(text, e.entryName)) {
      if (!best || e.entryName.length > best.matchLength) {
        best = { entry: e, matchedText: e.entryName, matchLength: e.entryName.length };
      }
    }
    for (const alias of e.aliases) {
      if (isExactBoundary(text, alias)) {
        if (!best || alias.length > best.matchLength) {
          best = {
            entry: e,
            matchedAlias: alias,
            matchedText: alias,
            matchLength: alias.length,
          };
        }
      }
    }
  }

  if (!best) return null;
  return { entry: best.entry, matchedAlias: best.matchedAlias, matchedText: best.matchedText };
}

// Multi-match 측면: best 가 잡힌 뒤 같은 pack 안의 다른 entry 중 matchedText 를
// 자기 entryName 또는 alias 의 substring 으로 포함하는 entry 들. 동시에 best 가
// 갖는 unique token (entryName + alias 중 어떤 peer 도 안 가지는 것) 이 query 에
// 등장하면 specificity 신호로 보고 peers 를 떨굼 — 사용자가 best 를 명시했을
// 가능성 ↑.
function findPeers(
  query: string,
  best: EntryRef,
  matchedText: string,
  allEntries: EntryRef[],
): EntryRef[] {
  const needle = matchedText.toLowerCase();
  const peerCandidates = allEntries.filter((e) => {
    if (e === best) return false;
    if (e.pack.id !== best.pack.id) return false; // 같은 pack 내에서만 묶음
    if (e.entryName.toLowerCase().includes(needle)) return true;
    return e.aliases.some((a) => a.toLowerCase().includes(needle));
  });
  if (peerCandidates.length === 0) return [];
  const q = query.toLowerCase();
  // best 의 모든 token (entryName + aliases) 중 어떤 peer 도 안 가진 것 = unique.
  const bestTokens = [best.entryName, ...best.aliases];
  const uniqueTokens = bestTokens.filter((t) => {
    const tLower = t.toLowerCase();
    return !peerCandidates.some(
      (p) =>
        p.entryName.toLowerCase().includes(tLower) ||
        p.aliases.some((a) => a.toLowerCase().includes(tLower)),
    );
  });
  // query 가 unique token 을 박고 있으면 user 가 best 를 명시 → peers 떨굼.
  const hasUniqueSignal = uniqueTokens.some((t) => q.includes(t.toLowerCase()));
  return hasUniqueSignal ? [] : peerCandidates;
}

// Step 2: 추출된 명사가 entry.title 또는 entry.aliases의 substring이면 partial.
// 가장 긴 명사 우선 (구체성). 동률이면 매칭 텍스트(entry name 또는 alias)
// 길이순. exact가 실패한 뒤에만 호출.
// V5.0 Phase B3b: aliases도 검사. matchedAlias 기록 — partial-alias는 trace.
// reason 형식 변경 X (현 spec 대로 [match=partial] 그대로). matchedAlias는
// PackMatchResult에 박혀 향후 builder/B3c가 사용 가능.
//
// Multi-match: 같은 noun 으로 hit 한 모든 entry 를 모음. best (longest title) 가
// head 로, 나머지는 peers — 빌더가 chooser 박음.
function findPartialEntry(
  nouns: string[],
  entries: EntryRef[],
): {
  entry: EntryRef;
  matchedNoun: string;
  matchedAlias?: string;
  peers: EntryRef[];
} | null {
  const sortedNouns = [...nouns].sort((a, b) => b.length - a.length);
  for (const noun of sortedNouns) {
    const needle = noun.toLowerCase();
    type Hit = { entry: EntryRef; matchLength: number; matchedAlias?: string };
    const hits: Hit[] = [];
    for (const e of entries) {
      let entryHit: Hit | null = null;
      if (e.entryName.toLowerCase().includes(needle)) {
        entryHit = { entry: e, matchLength: e.entryName.length };
      }
      for (const alias of e.aliases) {
        if (alias.toLowerCase().includes(needle)) {
          if (!entryHit || alias.length > entryHit.matchLength) {
            entryHit = { entry: e, matchLength: alias.length, matchedAlias: alias };
          }
        }
      }
      if (entryHit) hits.push(entryHit);
    }
    if (hits.length === 0) continue;
    hits.sort((a, b) => b.matchLength - a.matchLength);
    const head = hits[0];
    // peers — head 와 같은 pack 의 다른 hit 들. 다른 pack 이 peer 가 되면 chooser
    // 가 cross-pack 으로 박힘 — 의도와 어긋남.
    const peers = hits
      .slice(1)
      .filter((h) => h.entry.pack.id === head.entry.pack.id)
      .map((h) => h.entry);
    return {
      entry: head.entry,
      matchedNoun: noun,
      matchedAlias: head.matchedAlias,
      peers,
    };
  }
  return null;
}

// V5.0 Phase B1: 새 매칭 흐름. exact > partial > fuzzy 우선순위로 entry 검색.
// 각 단계 hit 시 PackMatchResult를 confidence와 함께 반환.
//
// Step 1: exact — text가 entry.title을 그대로 substring 포함.
// Step 2: partial — extractNouns(text) 명사가 entry.title의 substring.
// Step 3: fuzzy — 기존 V3.5 keyword/임베딩 score 매칭 (fallback).
//
// step 1·2가 hit하면 V4 임베딩이 fuzzy step에서만 돌도록 — 실제로 step 3
// 진입할 때만 await. exact/partial는 즉시 반환되어 fuzzy 비용 회피.
export async function matchPackContent(
  query: string,
  installedPacks: Pack[],
  activePackId?: string,
  intent?: Intent,
): Promise<PackMatchResult | null> {
  const allEntries = collectEntries(installedPacks);
  // V5.0 Phase B3c: craving 신호 한 번 계산해 모든 facet 분기에 공통 전달.
  const craving = classifyCraving(query);
  const facetOpts = { craving };
  // Phase EN-3: 입력 언어 한 번만 감지 → 결과에 박아 빌더에 전달 (Step 4 영어
  // 응답 분기). partial step 의 명사 추출도 lang 따라 분기.
  const lang = detectLanguage(query);

  // ── Step 1: exact match ───────────────────────────────────────────
  // V5.0 Phase B3b: findExactEntry는 이제 entry name + aliases 둘 다 검사.
  // alias로 매칭되면 result.matchedAlias 박혀 trace.reason 분기에 사용.
  const exactHit = findExactEntry(query, allEntries);
  if (exactHit) {
    const peers = findPeers(query, exactHit.entry, exactHit.matchedText, allEntries);
    const head = exactHit.entry.match;
    const multi = peers.length > 0;
    // 카테고리 chooser 가 켜진 turn 은 entry 고유 facet 응답 (definition 등) 을
    // 흘리지 않음 — 사용자가 선택지 박을 자리.
    const facet = multi ? undefined : pickFacetFromMatch(head, intent, facetOpts);
    return {
      pack: exactHit.entry.pack,
      isActivePack: exactHit.entry.pack.id === activePackId,
      packLevel: false,
      matches: multi ? [head, ...peers.map((p) => p.match)] : [head],
      facet,
      topEntryName: exactHit.entry.entryName,
      confidence: "exact",
      matchedAlias: exactHit.matchedAlias,
      multiMatchKey: multi ? exactHit.matchedText : undefined,
      lang,
    };
  }

  // ── Step 2: partial match ─────────────────────────────────────────
  // Phase EN-3: 영어 입력은 공백 split + stopword 필터로 명사 추출. 한국어는
  // 기존 조사/어미 제거 path.
  const nouns = lang === "en" ? extractNounsEn(query) : extractNouns(query);
  const partialHit = findPartialEntry(nouns, allEntries);
  if (partialHit) {
    const head = partialHit.entry.match;
    const multi = partialHit.peers.length > 0;
    const facet = multi ? undefined : pickFacetFromMatch(head, intent, facetOpts);
    return {
      pack: partialHit.entry.pack,
      isActivePack: partialHit.entry.pack.id === activePackId,
      packLevel: false,
      matches: multi ? [head, ...partialHit.peers.map((p) => p.match)] : [head],
      facet,
      topEntryName: partialHit.entry.entryName,
      confidence: "partial",
      matchedAlias: partialHit.matchedAlias,
      multiMatchKey: multi ? partialHit.matchedNoun : undefined,
      lang,
    };
  }

  // ── Step 3: fuzzy match (existing V3.5 logic) ─────────────────────
  await ensurePackVectors(installedPacks);

  let queryVec: Float32Array | null = null;
  if (getEmbeddingStatus().state === "ready") {
    try {
      queryVec = await embed(query);
    } catch (err) {
      console.warn("[packs] 사용자 입력 임베딩 실패, 키워드만 사용:", err);
    }
  }

  const candidates = scoreCandidates(query, installedPacks, activePackId, "strict", queryVec);
  if (candidates.length === 0) return null;

  const winner = candidates[0];
  if (winner.bestScore < MATCH_THRESHOLD) return null;

  const packLevel = winner.bestScore < SPECIFIC_HIT_SCORE;

  if (RERANKER_ENABLED) {
    void PACK_RERANK_THRESHOLD;
    void RERANK_TOP_N;
  }

  const matches = packLevel
    ? winner.matches
    : winner.matches.filter((m) => m.score === winner.bestScore).slice(0, 2);

  const head = matches[0];
  const facet = head ? pickFacetFromMatch(head, intent, facetOpts) : undefined;

  // V5.0 Phase B1: requestedNoun — 사용자가 입력했지만 어떤 entry name과도
  // 매칭 안 된 명사. 가장 긴 unmatched 명사를 골라 응답 텍스트에 노출.
  // V5.0 Phase B3c: cleanRequestedNoun으로 어색한 형태 ("풀고싶") 를 원본
  // token ("풀고싶어") 으로 복원해 응답 텍스트 자연성 ↑.
  const allEntryNames = allEntries.map((e) => e.entryName.toLowerCase());
  const unmatched = nouns
    .filter((n) => !allEntryNames.some((name) => name.includes(n.toLowerCase())))
    .sort((a, b) => b.length - a.length);
  const requestedNounRaw = unmatched[0];
  const requestedNoun = requestedNounRaw ? cleanRequestedNoun(requestedNounRaw, query) : undefined;

  return {
    pack: winner.pack,
    isActivePack: winner.isActive,
    packLevel,
    matches,
    facet,
    topEntryName: getEntryNameForTrace(head),
    confidence: "fuzzy",
    requestedNoun,
    lang,
  };
}

// V2 voice/tone hint: when matchPackContent returns null but the input
// still leans toward a domain ("메뉴 추천" → cooking domain via "추천"
// generic, "수학" → study domain via "수학" domain), surface the
// closest pack so Stage 3 dispatch can apply its voice/tone. Matching
// itself is too soft to show a SuggestionBlock, but the LLM answering
// in cooking voice still feels right.
//
// Returns undefined when no pack scored above 0 — fully off-topic input
// like "양자역학" gets the default DOTS tone.
export function inferDomainPack(
  query: string,
  installedPacks: Pack[],
  activePackId?: string,
): Pack | undefined {
  // Soft mode: generic-only inputs ("메뉴 추천" → only "추천" GENERIC)
  // count as cooking-leaning even though matchPackContent would gate
  // them to 0. The point is to give the LLM a voice/tone hint, not to
  // surface a card.
  const candidates = scoreCandidates(query, installedPacks, activePackId, "soft");
  return candidates[0]?.pack;
}

// ---------------------------------------------------------------------------
// Intent: definition / explanation request
// ---------------------------------------------------------------------------
//
// V2 라우터 진화. "찜부추국수는 뭐야?" 같은 입력은 음식 도메인 키워드는
// hit이지만 사용자 의도는 카드(레시피/스토어 추천)가 아니라 *설명*이다.
// 도메인 매칭만 보고 카드를 띄우면 의도와 어긋난 응답이 된다.
//
// 이 함수가 true면 send()는 Stage 1(matchPackContent)과 Stage 2
// (searchStoreForQuery)를 skip하고 Stage 2.5(학습 캐시) → Stage 3(LLM)
// 으로 흘려보낸다. inferDomainPack은 그대로 호출되므로 voice/tone은
// 도메인에 맞춰 따라간다 — 단지 카드가 안 뜰 뿐.
//
// 키워드 선정 노트:
//   - "뭐야"·"뭐지"·"뭐예요"는 명백한 WHAT-IS 질문. "뭐" 단독은
//     "뭐든 추천" 같은 비-정의 표현과 충돌하므로 **포함하지 않는다**.
//   - "?" 단독은 신호로 안 친다. "김치찌개 만드는 법?"이 정의 요청으로
//     오인되어 레시피 카드가 사라지면 회귀.
//   - 키워드 hit이 없으면 false → 기존 매칭 흐름 그대로.
const DEFINITION_PATTERNS = [
  // WHAT-IS 형 질문
  "뭐야",
  "뭐지",
  "뭐예요",
  "뭔데",
  "무엇",
  // 명시적 설명 요청
  "설명해",
  "설명 해",
  "설명해줘",
  // 미지(unfamiliarity) 표현
  "처음 들어",
  "들어봐",
  "처음이야",
  "모르는데",
  "모르겠어",
  "잘 모르",
  // 어떤 것 / which-is 형
  "어떤 거",
  "어떤 것",
  // 영어
  "what is",
  "what's",
  "explain",
  "never heard",
  "don't know",
];

export function hasDefinitionIntent(text: string): boolean {
  const q = lower(text);
  return DEFINITION_PATTERNS.some((p) => q.includes(p));
}

// Phase EN-fix: specificTarget (Pack trigger 단어) 잡혔지만 matchPackContent
// 가 score 0 으로 null 반환한 케이스용 fallback. 영어 "I want doenjang stew"
// 처럼 trigger ("stew") 가 박혀 있는데 COOKING_RECIPE_KEYWORDS / DOMAIN 에
// 매칭 안 되는 입력을 한국어와 같은 packLevel 흐름으로 끌어들임.
//
// 그 팩의 모든 contents 를 packLevel matched 로 합성 — dislike filter / 대체
// 추천 / cloud 옵션 후속 단계 진입. send() 측면 craving 신호 (사용자 desire)
// 와 같이 게이트 박혀 — 단순 trigger 단어 우연 매칭 (예 "I had stew yesterday")
// 은 craving 게이트에서 차단.
export function synthesizePackLevelFallback(
  pack: Pack,
  query: string,
  lang: Lang,
): PackMatchResult | null {
  if (!pack.contents || pack.contents.length === 0) return null;
  const matches: ContentMatch[] = [];
  for (const ref of pack.contents) {
    if (ref.kind === "cooking-recipe") {
      const r = COOKING_RECIPES.find((x) => x.id === ref.recipeId);
      if (r) matches.push({ kind: "cooking-recipe", recipe: r, score: 0 });
    } else if (ref.kind === "sat-math") {
      const p = getSATMathProblem(ref.problemId);
      if (p) matches.push({ kind: "sat-math", problem: p, score: 0 });
    }
  }
  if (matches.length === 0) return null;
  // requestedNoun — 입력에서 가장 긴 명사 (lang 기준 추출). 응답 텍스트
  // ("..에 ${noun} 정확히 없어..." / "you said you don't like X — how about Y?")
  // 와 cloud 옵션 prompt 에 노출.
  const nouns = lang === "en" ? extractNounsEn(query) : extractNouns(query);
  const requestedNoun = nouns.sort((a, b) => b.length - a.length)[0];
  return {
    pack,
    isActivePack: false,
    packLevel: true,
    matches,
    confidence: "fuzzy",
    lang,
    requestedNoun,
  };
}

// ---------------------------------------------------------------------------
// Suggestion text + button options
// ---------------------------------------------------------------------------

const SAT_TOPIC_LABEL: Record<SATMathProblem["topic"], string> = {
  algebra: "대수",
  geometry: "기하",
  statistics: "확률·통계",
  trigonometry: "삼각함수",
};

// Phase EN-4: 영어 라벨 (빌더가 result.lang === "en" 일 때 사용).
const SAT_TOPIC_LABEL_EN: Record<SATMathProblem["topic"], string> = {
  algebra: "Algebra",
  geometry: "Geometry",
  statistics: "Probability & Stats",
  trigonometry: "Trigonometry",
};

const SAT_DIFFICULTY_LABEL_EN: Record<SATMathProblem["difficulty"], string> = {
  easy: "Easy",
  medium: "Medium",
  hard: "Hard",
};

const SAT_DIFFICULTY_LABEL_KO: Record<SATMathProblem["difficulty"], string> = {
  easy: "쉬움",
  medium: "보통",
  hard: "어려움",
};

// V5.0 Phase I-6: action_options 박힌 후 사용자 발화의 negation-aware
// 영역 제외 처리. excludedActions 박힌 영역의 카드 모두 drop. 모두 drop이면
// 빈 배열 반환 — caller (buildCooking/buildSATMath) 가 fallback 박음.
function filterByExcludedActions(
  options: SuggestionOption[],
  excludedActions: ActionArea[],
): SuggestionOption[] {
  if (excludedActions.length === 0) return options;
  return options.filter((opt) => !opt.action_area || !excludedActions.includes(opt.action_area));
}

// 빈 카드 박힐 때 fallback. cloud 옵션 + 일반 다른 거 — 사용자가 박은 영역
// 외 escape 경로 보장. 핵심: 사용자가 모든 옵션을 부정해도 응답이 카드 0개로
// 무력화되지 X.
function buildExclusionFallback(lang: Lang): SuggestionOption[] {
  if (lang === "en") {
    return [
      {
        kind: "llm-call",
        label: "Search in cloud",
        prompt: "Help me from a different angle. Keep it short.",
        action_area: "찾기",
      },
    ];
  }
  return [
    {
      kind: "llm-call",
      label: "cloud로 찾기",
      prompt: "다른 방향으로 도와줘. 한국어로 짧고 정확하게.",
      action_area: "찾기",
    },
  ];
}

function buildSATMathSuggestion(
  result: PackMatchResult,
  excludedActions: ActionArea[] = [],
): {
  text: string;
  options: SuggestionOption[];
} {
  const { pack, packLevel, matches, facet, confidence, requestedNoun, lang } = result;
  const head = matches[0];
  if (head?.kind !== "sat-math") {
    const fallbackText =
      lang === "en"
        ? `Found something similar in ${pack.name}.`
        : `${pack.name}에서 비슷한 게 보여.`;
    return { text: fallbackText, options: [] };
  }

  const entryMiss = confidence === "fuzzy" && packLevel;
  let text: string;
  if (lang === "en") {
    const topicEn = SAT_TOPIC_LABEL_EN[head.problem.topic];
    const diffEn = SAT_DIFFICULTY_LABEL_EN[head.problem.difficulty];
    if (entryMiss) {
      text = `${pack.name} matches the domain, but ${requestedNoun ?? "this topic"} isn't here exactly. Search in cloud?`;
    } else if (confidence === "fuzzy") {
      text = `${pack.name} doesn't have ${requestedNoun ?? "that"} exactly. Closest is one ${topicEn} problem. Try cloud for something else?`;
    } else if (facet) {
      // facet 텍스트는 entry 의 한국어 데이터 — 영어 모드에선 노출 X. 일반
      // packLevel 톤으로 fallthrough.
      text = `${pack.name} has ${matches.length} SAT math problem${matches.length === 1 ? "" : "s"}. Want to solve one? Or get a new one?`;
    } else if (packLevel) {
      text = `${pack.name} has ${matches.length} SAT math problem${matches.length === 1 ? "" : "s"}. Want to solve one? Or get a new one?`;
    } else {
      text = `${pack.name} has one ${topicEn} problem (${diffEn}). Want to try it?`;
    }
  } else {
    if (entryMiss) {
      text = `${pack.name}의 도메인은 맞지만, ${requestedNoun ?? "이 주제"} 정확한 문제로는 없어. cloud로 찾아볼까?`;
    } else if (confidence === "fuzzy") {
      text = `${pack.name}에 ${requestedNoun ?? "그건"} 정확히 없어. 비슷한 건 ${SAT_TOPIC_LABEL[head.problem.topic]} 문제. 다른 거 원하면 cloud로 찾아볼까?`;
    } else if (facet) {
      const body =
        facet.kind === "definition" && facet.pack_context
          ? `${facet.text}\n\n${facet.pack_context}`
          : facet.text;
      text = confidence === "partial" ? `${body}\n\n(비슷한 entry로 매칭됐어.)` : body;
    } else if (packLevel) {
      text = `${pack.name}에 SAT 수학 ${matches.length}문제 있어. 풀어볼래? 아니면 새 문제 받을래?`;
    } else {
      text = `${pack.name}에 ${SAT_TOPIC_LABEL[head.problem.topic]} 문제(${SAT_DIFFICULTY_LABEL_KO[head.problem.difficulty]}) 있어. 풀어볼래?`;
    }
  }

  const cloudOption: SuggestionOption | null =
    confidence === "fuzzy"
      ? lang === "en"
        ? {
            kind: "llm-call",
            label: "Search in cloud",
            prompt: requestedNoun
              ? `Tell me about ${requestedNoun}. Keep it short and clear.`
              : "Tell me about this topic. Keep it short and clear.",
          }
        : {
            kind: "llm-call",
            label: "cloud로 찾기",
            prompt: requestedNoun
              ? `${requestedNoun}에 대해 알려줘. 한국어로 짧고 정확하게.`
              : "이 주제에 대해 알려줘. 한국어로 짧고 정확하게.",
          }
      : null;

  // 영어 모드에선 entry 한국어 action_options 노출 X — hardcoded fallback 사용.
  const entryOptions =
    lang === "en" ? undefined : facet ? head.problem.action_options?.[facet.kind] : undefined;

  const baseOptions: SuggestionOption[] =
    lang === "en"
      ? entryMiss
        ? [
            {
              kind: "open-folder",
              label: "Other problems in this pack",
              target: "/study",
              action_area: "찾기",
            },
          ]
        : [
            { kind: "open-folder", label: "Solve it", target: "/study", action_area: "만들기" },
            {
              kind: "llm-call",
              label: "New problem",
              systemPrompt:
                "You are an SAT math tutor. Reply in English, friendly but concise. Follow the exact format the user requested.",
              prompt: [
                "Create one new SAT math multiple-choice problem. Follow this exact format.",
                "",
                "Problem: [one or two sentences]",
                "① [choice 1]",
                "② [choice 2]",
                "③ [choice 3]",
                "④ [choice 4]",
                "Answer: [number]",
                "Solution: [two or three short lines]",
              ].join("\n"),
              postAction: "save-as-sat-problem",
              action_area: "찾기",
            },
          ]
      : entryMiss
        ? [
            {
              kind: "open-folder",
              label: "Pack 다른 문제 보기",
              target: "/study",
              action_area: "찾기",
            },
          ]
        : entryOptions
          ? [...entryOptions]
          : [
              { kind: "open-folder", label: "풀어볼래", target: "/study", action_area: "만들기" },
              {
                kind: "llm-call",
                label: "새 문제 받을래",
                systemPrompt:
                  "당신은 SAT 수학 튜터입니다. 한국어로 친절하지만 간결하게 답하세요. 사용자가 요청한 형식을 정확히 지키세요.",
                prompt: [
                  "SAT 수학 객관식 문제 1개를 새로 만들어 주세요. 다음 형식을 정확히 지켜주세요.",
                  "",
                  "문제: [한 두 문장의 문제]",
                  "① [보기 1]",
                  "② [보기 2]",
                  "③ [보기 3]",
                  "④ [보기 4]",
                  "정답: [번호]",
                  "풀이: [두세 줄의 짧은 풀이]",
                ].join("\n"),
                postAction: "save-as-sat-problem",
                action_area: "찾기",
              },
            ];

  const filteredOptions = filterByExcludedActions(baseOptions, excludedActions);
  const options: SuggestionOption[] = [
    ...(filteredOptions.length === 0 ? buildExclusionFallback(lang) : filteredOptions),
    ...(cloudOption ? [cloudOption] : []),
  ];

  return { text, options };
}

function buildCookingSuggestion(
  result: PackMatchResult,
  excludedActions: ActionArea[] = [],
): {
  text: string;
  options: SuggestionOption[];
} {
  const { pack, packLevel, matches, facet, confidence, requestedNoun, multiMatchKey, lang } =
    result;
  const head = matches[0];
  if (head?.kind !== "cooking-recipe") {
    const fallbackText =
      lang === "en"
        ? `Found something similar in ${pack.name}.`
        : `${pack.name}에서 비슷한 게 보여.`;
    return { text: fallbackText, options: [] };
  }

  // 카테고리 chooser — 같은 키로 2 entry 이상 동시 매칭됐을 때.
  if (multiMatchKey && matches.length > 1) {
    const chooserOptions = matches
      .filter((m): m is ContentMatch & { kind: "cooking-recipe" } => m.kind === "cooking-recipe")
      .slice(0, 4)
      .map<SuggestionOption>((m) => ({
        kind: "show-recipe",
        // Phase EN-fix C: EN 모드 chooser 라벨도 EN 제목 — titleEn fallback to title.
        label: lang === "en" ? (m.recipe.titleEn ?? m.recipe.title) : m.recipe.title,
        recipeId: m.recipe.id,
        action_area: "만들기",
      }));
    const chooserText =
      lang === "en"
        ? `Found ${chooserOptions.length} ${multiMatchKey} versions. Which one?`
        : `${multiMatchKey} 종류 ${chooserOptions.length}가지 있어. 어떤 거 볼래?`;
    return { text: chooserText, options: chooserOptions };
  }

  const entryMiss = confidence === "fuzzy" && packLevel;
  let text: string;
  if (lang === "en") {
    if (entryMiss) {
      const label = requestedNoun ?? "this";
      text = `${pack.name} matches the domain, but ${label} isn't here exactly. Search in cloud?`;
    } else if (confidence === "fuzzy") {
      const label = requestedNoun ?? "that";
      const headTitle = head.recipe.titleEn ?? head.recipe.title;
      text = `${pack.name} doesn't have ${label} exactly. Closest is ${headTitle}. Try cloud for something else?`;
    } else if (facet) {
      // facet 텍스트는 entry 의 한국어 데이터. 영어 모드에선 노출 X — packLevel 톤.
      text = `${pack.name} has ${matches.length} recipe${matches.length === 1 ? "" : "s"}. Want to see?`;
    } else if (packLevel) {
      text = `${pack.name} has ${matches.length} recipe${matches.length === 1 ? "" : "s"}. Want to see?`;
    } else if (matches.length === 1) {
      const headTitle = head.recipe.titleEn ?? head.recipe.title;
      text = `${pack.name} has ${headTitle}. Want to see? Or something else?`;
    } else {
      text = `${pack.name} has ${matches.length} similar recipes. Which one?`;
    }
  } else {
    if (entryMiss) {
      const requestedLabel = requestedNoun ?? "이 주제";
      text = `${pack.name}의 도메인은 맞지만, ${requestedLabel} 정확한 레시피로는 없어. cloud로 찾아볼까?`;
    } else if (confidence === "fuzzy") {
      const requestedLabel = requestedNoun ?? "그건";
      text = `${pack.name}에 ${requestedLabel} 정확히 없어. 비슷한 건 ${head.recipe.title}. 다른 거 원하면 cloud로 찾아볼까?`;
    } else if (facet) {
      const body =
        facet.kind === "definition" && facet.pack_context
          ? `${facet.text}\n\n${facet.pack_context}`
          : facet.text;
      text = confidence === "partial" ? `${body}\n\n(비슷한 entry로 매칭됐어.)` : body;
    } else if (packLevel) {
      text = `${pack.name}에 레시피 ${matches.length}개 있어. 보여줄까?`;
    } else if (matches.length === 1) {
      text = `${pack.name}에 ${head.recipe.title} 레시피 있어. 보여줄까? 아니면 다른 음식?`;
    } else {
      text = `${pack.name}에 비슷한 레시피 ${matches.length}개 있어. 어떤 거 볼래?`;
    }
  }

  const recipeOptions: SuggestionOption[] = matches
    .filter((m): m is ContentMatch & { kind: "cooking-recipe" } => m.kind === "cooking-recipe")
    .slice(0, 2)
    .map((m) => ({
      kind: "show-recipe",
      // Phase EN-fix C: chooser 라벨 (matches > 1) 도 EN 모드에선 titleEn fallback.
      label:
        matches.length === 1
          ? lang === "en"
            ? "Show me"
            : "보여줘"
          : lang === "en"
            ? (m.recipe.titleEn ?? m.recipe.title)
            : m.recipe.title,
      recipeId: m.recipe.id,
      action_area: "만들기",
    }));

  const cloudOption: SuggestionOption | null =
    confidence === "fuzzy"
      ? lang === "en"
        ? {
            kind: "llm-call",
            label: "Search in cloud",
            prompt: requestedNoun
              ? `Tell me about ${requestedNoun}. Keep it short and clear.`
              : "Tell me about this. Keep it short and clear.",
          }
        : {
            kind: "llm-call",
            label: "cloud로 찾기",
            prompt: requestedNoun
              ? `${requestedNoun}에 대해 알려줘. 한국어로 짧고 정확하게.`
              : "이 주제에 대해 알려줘. 한국어로 짧고 정확하게.",
          }
      : null;

  // 영어 모드에선 entry 한국어 action_options 노출 X — hardcoded fallback 사용.
  const entryOptions =
    lang === "en" ? undefined : facet ? head.recipe.action_options?.[facet.kind] : undefined;

  const baseOptions: SuggestionOption[] =
    lang === "en"
      ? entryMiss
        ? [
            {
              kind: "llm-call",
              label: "Other recipes in this pack",
              prompt: `Show me what's in ${pack.name}.`,
              action_area: "찾기",
            },
          ]
        : [
            ...recipeOptions,
            {
              kind: "llm-call",
              label: "Something else",
              prompt: "Recommend one different dish — similar vibe, slightly different.",
              action_area: "찾기",
            },
          ]
      : entryMiss
        ? [
            {
              kind: "llm-call",
              label: "Pack 다른 레시피 보기",
              prompt: `${pack.name}에 어떤 레시피가 있는지 보여줘.`,
              action_area: "찾기",
            },
          ]
        : entryOptions
          ? [...entryOptions]
          : [
              ...recipeOptions,
              {
                kind: "llm-call",
                label: "다른 음식",
                prompt: "다른 요리 하나 추천해줘. 비슷한 결인데 살짝 다른 걸로.",
                action_area: "찾기",
              },
            ];

  const filteredOptions = filterByExcludedActions(baseOptions, excludedActions);
  const options: SuggestionOption[] = [
    ...(filteredOptions.length === 0 ? buildExclusionFallback(lang) : filteredOptions),
    ...(cloudOption ? [cloudOption] : []),
  ];

  return { text, options };
}

export function buildPackSuggestion(
  result: PackMatchResult,
  excludedActions: ActionArea[] = [],
): AnswerPayload {
  const head = result.matches[0];
  let body: { text: string; options: SuggestionOption[] };
  if (head?.kind === "sat-math") {
    body = buildSATMathSuggestion(result, excludedActions);
  } else if (head?.kind === "cooking-recipe") {
    body = buildCookingSuggestion(result, excludedActions);
  } else {
    body = { text: `${result.pack.name}에서 비슷한 게 보여.`, options: [] };
  }
  return {
    kind: "pack-suggestion",
    text: body.text,
    options: body.options,
    matchedPackName: result.pack.name,
    matchedPackId: result.pack.id,
  };
}
