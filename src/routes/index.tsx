import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { Shell, useShell } from "@/components/Shell";
import { ProcessingTrace } from "@/components/ProcessingTrace";
import { RecipeCard } from "@/components/RecipeCard";
import { PitchCard } from "@/components/PitchCard";
import { SummaryMarker } from "@/components/SummaryMarker";
import {
  PACKS,
  getCookingRecipe,
  type Pack,
  type PackRecipe,
  type Route as RouteType,
  type SuggestionOption,
} from "@/lib/dots-data";
import { step } from "@/lib/conversation-engine";
import {
  getActiveThread,
  appendMessage,
  createThread,
  markRecipeServed,
  patchMessage,
  renameThreadIfDefault,
  setThreadCluster,
  setThreadLastEntry,
  setThreadPack,
  useConversationStore,
  type ThreadMsg,
} from "@/lib/conversation-store";
import { usePreferences } from "@/lib/preferences";
import { composeAnswer } from "@/lib/ai/compose";
import { dispatchLLMCall, type DispatchTurn } from "@/lib/ai/dispatch";
import type { ProviderId } from "@/lib/ai/providers/types";
import {
  matchPackContent,
  buildPackSuggestion,
  inferDomainPack,
  hasDefinitionIntent,
  findSpecificPackTarget,
  synthesizePackLevelFallback,
} from "@/lib/packs/match";
import {
  classifyActionNegation,
  classifyCraving,
  classifyIntent,
  classifyNegationOrTrend,
  classifyRejection,
  classifySummaryIntent,
} from "@/lib/packs/intent";
import { topicParticle } from "@/lib/text/clean-noun";
import { detectLanguage } from "@/lib/text/detect-language";
import { getT, useT } from "@/lib/i18n";
import { MESSAGES_KO } from "@/lib/i18n/messages.ko";
import { MESSAGES_EN } from "@/lib/i18n/messages.en";
import { buildStoreSuggestion, searchStoreForQuery } from "@/lib/packs/store-search";
import {
  addAlias,
  addPreference,
  buildTopicSummary,
  collectPackMatches,
  extractTopic,
  filterMatchesByDislikes,
  incrementUsedCount,
  listAliases,
  listByType,
  listPreferences,
  matchLearnedResponse,
  matchLearnedTopicGroup,
  parseCalculation,
  parseCommand,
  parsePreference,
  parseRecall,
  rateLearned,
  removeAlias,
  saveLearned,
  useLearnedRating,
} from "@/lib/learning";
import { addUserSATProblem, getUserSATProblems } from "@/lib/packs/study/user-store";
import { buildSATMathDummy, buildSATMathFromLLM } from "@/lib/packs/study/parse-llm";
import { addDemoTrace } from "@/lib/demo/trace";
import type { ChatHooks } from "@/lib/demo/measure";
import { MeasurePanel } from "@/components/MeasurePanel";
import { useMemoryStore } from "@/lib/memory";
import type { ConversationSummary } from "@/lib/memory";
// V5.0 lite Phase I-4: 도메인 인지 layer. matchPackContent 호출 전에
// 사용자 입력의 도메인 점수와 pack의 excluded_domains 비교해 누수 차단.
import { matchDomain, computeDomainExclusions, type DomainMatch } from "@/lib/domain";
import type { AnswerPayload } from "@/lib/dots-data";

// Words that mean "give me another / something else / please do it" — when
// the previous assistant message is a pack-suggestion and the user's next
// input contains one of these, treat it as a follow-up choice (LLM direct)
// rather than re-running the matcher and showing the same suggestion again.
const FOLLOWUP_ACTION_PATTERNS = [
  "새 문",
  "새문",
  "새거",
  "새 거",
  "다른 거",
  "다른거",
  "다음 거",
  "다음거",
  "받아줘",
  "받아 줘",
  "부탁",
  "또 ",
  "또?",
  "또요",
  "더 줘",
  "더 만들",
  "추가",
];

function hasFollowUpIntent(input: string): boolean {
  const q = input.toLowerCase();
  return FOLLOWUP_ACTION_PATTERNS.some((p) => q.includes(p));
}

// V5.0 lite Phase I-4: trace.reason 에 박을 도메인 점수 요약. score > 0 인
// 도메인을 "음식(1)+맛집(2)" 형식으로 묶음. score 0 이거나 dom 미박힘 시 빈
// string — 기존 reason 텍스트에 영향 없게.
function domainSummary(dom: DomainMatch): string {
  if (dom.scores.length === 0) return "";
  return dom.scores.map((s) => `${s.domain}(${s.score})`).join("+");
}

// V5.0 Phase M-1: ConversationSummary.sourceMessagesCount 는 DispatchTurn
// 기준 (compose의 threadHistory 변환 후 카운트). UI는 ThreadMsg 인덱스가
// 필요. dispatch에 들어간 첫 N 메시지의 마지막에 해당하는 ThreadMsg id를
// 찾아 마커 박을 위치 결정.
function findMarkerMessageId(messages: ThreadMsg[], dispatchTurnCount: number): string | undefined {
  let count = 0;
  for (const m of messages) {
    const eligible = m.role === "user" || (!m.pending && !!m.text);
    if (eligible) count++;
    if (count === dispatchTurnCount) return m.id;
  }
  return undefined;
}

// Phase M0-4 옵션 풍부화: dislike filter 응답 측면 baek 측면 craving facet 옵션
// 세트 측면 동일 박음. show-recipe (만들기) + 3 cloud llm-call (시켜먹기 / 비슷한
// 메뉴 / cloud로 찾기). cloud 옵션 측면 dispatchLLMCall 측면 진입 → M0-5
// USER_CONTEXT 자동 inject 박혀 dislike 측면 cloud 응답 측면 자동 반영.
//
// 단일 filtered: show-recipe 1 + cloud 3 = 4 버튼.
// 다중 filtered: per-entry show-recipe (chooser) + cloud 3.
type CookingMatch = { kind: "cooking-recipe"; recipe: PackRecipe; score: number };
// Phase EN-fix A: dislike 라벨에 누적 garbage 박힘 회귀 차단. appliedDislikes
// (실제 매칭 hit) 측면 박혀 있어도 사용자 입력 언어 외 글자 (예: 영어 응답인데
// 한국어 dislike 가 hit) 가 박힌 경우 그쪽 언어만 노출. 그 언어로 hit 한 게
// 없으면 (예: EN 모드인데 KO dislike 만 hit) appliedDislikes 전체로 fallback —
// 빈 라벨 보내지 않음.
function pickLangDislikes(applied: string[], lang: "ko" | "en"): string {
  const isKoreanSubject = (d: string) => /[가-힣]/.test(d);
  const filtered =
    lang === "en" ? applied.filter((d) => !isKoreanSubject(d)) : applied.filter(isKoreanSubject);
  const final = filtered.length > 0 ? filtered : applied;
  return final.join(", ");
}

// Phase EN-fix: lang 받아 옵션 라벨 + cloud prompt 영어 분기. matched.lang
// 그대로 thread — 한국어 입력은 KO 라벨, 영어 입력은 EN 라벨 + 한국 음식
// 제목 (headTitle) 은 한국어 그대로 노출 (KO/EN 공통).
function buildFilteredOptions(
  cookingFiltered: CookingMatch[],
  requestedNoun: string | undefined,
  lang: "ko" | "en",
): SuggestionOption[] {
  if (cookingFiltered.length === 0) return [];
  const head = cookingFiltered[0];
  // Phase EN-fix C: EN 모드 headTitle / chooser 라벨도 EN 제목 — titleEn fallback.
  // headTitle 은 cloud prompt 본문에 박혀 Gemini 응답이 영어 이름으로 일관.
  const headTitle = lang === "en" ? (head.recipe.titleEn ?? head.recipe.title) : head.recipe.title;
  const fo = (lang === "en" ? MESSAGES_EN : MESSAGES_KO).chat.filterOptions;
  const entryOpts: SuggestionOption[] = cookingFiltered.slice(0, 4).map((m) => ({
    kind: "show-recipe",
    label:
      cookingFiltered.length === 1
        ? fo.cookSingle
        : lang === "en"
          ? (m.recipe.titleEn ?? m.recipe.title)
          : m.recipe.title,
    recipeId: m.recipe.id,
    action_area: "만들기",
  }));
  const cloudOpts: SuggestionOption[] = [
    {
      kind: "llm-call",
      label: fo.orderIn,
      prompt: fo.orderInPrompt(headTitle),
      action_area: "시켜먹기",
    },
    {
      kind: "llm-call",
      label: fo.similar,
      prompt: fo.similarPrompt(headTitle),
      action_area: "찾기",
    },
    {
      kind: "llm-call",
      label: fo.cloud,
      prompt: requestedNoun
        ? fo.cloudPromptWithNoun(requestedNoun)
        : fo.cloudPromptDefault(headTitle),
      action_area: "찾기",
    },
  ];
  return [...entryOpts, ...cloudOpts];
}

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "대화 — DOTS" },
      {
        name: "description",
        content:
          "DOTS는 사용자에게 맞춰지는 한 겹의 레이어입니다. 팩, 기억, 그리고 깊은 추론 사이를 조용히 오갑니다.",
      },
    ],
  }),
  component: ChatPage,
});

// Theme labels are no longer surfaced on the chat home — kept internal.

// "Continue from here" cards are produced by buildContinuations() —
// scored across recent threads, repeated topics, and recently used packs.

function ChatPage() {
  const [installed] = useState<Pack[]>(PACKS.filter((p) => p.installed));
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();

  const { threads, activeId } = useConversationStore();

  // Always have at least one thread; fall back to creating a fresh one.
  // Phase 2: seed 채팅 제거 후 첫 진입 시 자동 새 대화 1개 생성.
  useEffect(() => {
    if (threads.length === 0) createThread("open", getT().shell.newThreadDefaultTitle);
  }, [threads.length]);

  const thread = threads.find((t) => t.id === activeId) ?? threads[0];
  const messages = thread?.messages ?? [];

  // V5.0 Phase M-1: 활성 thread에 summary가 있으면 그 시점에 시각 마커 박음.
  // sourceMessagesCount는 DispatchTurn 기준 (user || (!pending && text))
  // 카운트라 ThreadMsg 인덱스로 변환 필요.
  const memSnap = useMemoryStore();
  const activeSummary: ConversationSummary | undefined = thread
    ? memSnap.summaries.find((s) => s.threadId === thread.id)
    : undefined;
  const summaryMarkerAfterId = activeSummary
    ? findMarkerMessageId(messages, activeSummary.sourceMessagesCount)
    : undefined;

  // CONSTITUTION: send() must NEVER call the LLM on its own.
  //   - Stage 1 (matchPackContent hit) → render suggestion + return
  //   - Stage 2 (searchStoreForQuery hit) → render suggestion + return
  //   - Stage 3 (no match anywhere) → engine + composeAnswer is allowed,
  //     because at that point we've exhausted local + store options.
  // The LLM is otherwise only invoked from onSuggestionAction("llm-call"),
  // which fires from an explicit user button click. If you're touching
  // this function: keep the early-returns, never let stages cascade.
  async function send(text: string) {
    if (!text.trim() || busy || !thread) return;

    // 안정성 정정 (2026-04-30): 회귀 진단용 timing 래퍼(t())는 제거.
    // 남기는 진단 로그는 세 줄 — [send] 입력+의도, [setThreadPack]
    // 매칭 hit 시점, [llm-call]은 dispatch.ts에서 직접. 실 사용자
    // 시연에서 콘솔이 너무 시끄러우면 안 된다.
    //
    // V0 데모 측정 (2026-04-30): startTime은 사용자 입력 받은 시점부터
    // 라우팅이 끝날 때까지의 wall-clock latency를 재기 위함. 각 stage가
    // 자기 시점에서 trace를 박는다 — pack/learned는 매칭 끝나는 즉시,
    // cloud는 composeAnswer.then 안에서.
    const startTime = Date.now();
    setBusy(true);
    setInput("");

    // ---- Stage 0 (V6A): 명시적 학습 명령 (@learn / @unlearn / @list).
    // intent 분류 / 매처 / 라우팅 모두 skip — 명령은 사용자가 직접 가르치는
    // 행위라 LLM 호출 불필요. cost 0. 일반 입력은 parseCommand 가 null
    // 반환 → 기존 흐름 그대로.
    const cmd = parseCommand(text);
    if (cmd) {
      // Phase EN-fix C: @learn 명령은 detectLanguage 가 박히기 전 단계에 진입 —
      // 여기서 local 박음. body / packName 모두 lang 분기.
      const cmdLang = detectLanguage(text);
      const cmdT = (cmdLang === "en" ? MESSAGES_EN : MESSAGES_KO).chat.command;
      const userId = crypto.randomUUID();
      const asstId = crypto.randomUUID();
      appendMessage(thread.id, { id: userId, role: "user", text });
      renameThreadIfDefault(thread.id, text);
      let body = "";
      if (cmd.command === "learn") {
        await addAlias(cmd.alias, cmd.canonical);
        body = cmdT.learnAck(cmd.alias, cmd.canonical);
      } else if (cmd.command === "unlearn") {
        const removed = await removeAlias(cmd.alias);
        body = removed ? cmdT.unlearnOk(cmd.alias) : cmdT.unlearnMiss(cmd.alias);
      } else {
        const aliases = listAliases();
        if (aliases.length === 0) {
          body = cmdT.listEmpty;
        } else {
          const lines = aliases.map((a) => `• ${a.alias} → ${a.canonical}`);
          body = `${cmdT.listHeader(aliases.length)}\n${lines.join("\n")}`;
        }
      }
      appendMessage(thread.id, {
        id: asstId,
        role: "assistant",
        route: "local",
        state: "found_local",
        reason: "",
        packName: cmdT.packName,
        pending: false,
        text: body,
        provider: "learned",
        lang: cmdLang,
      });
      addDemoTrace({
        input: text,
        intent: "casual",
        route: "local",
        externalCall: false,
        provider: "none",
        latencyMs: Date.now() - startTime,
        reason: `학습 명령 — ${cmd.command}`,
      });
      setBusy(false);
      requestAnimationFrame(() => {
        scrollRef.current?.scrollTo({
          top: scrollRef.current?.scrollHeight ?? 0,
          behavior: "smooth",
        });
      });
      return;
    }

    // Phase EN-1: 입력 언어 감지. preference / recall / Stage 3 cloud 모두 lang
    // 분기를 쓰므로 가장 일찍 박음. 계산기 (parseCalculation) 는 lang 무관 (식
    // 그대로 출력) 이라 그 앞 / 뒤 어디에 박혀도 OK.
    const lang = detectLanguage(text);

    // ---- Stage 0.4 (Phase Calc): 계산기 ("1+1" / "sqrt(16)" / "5 km to m").
    // mathjs 측면 Local 평가 — Cloud 호출 0. parseCalculation 이 두 단계
    // 게이트 (Hangul 차단 + operator/function 시그널 + mathjs try/catch) 로
    // 일반 발화를 모두 reject 하므로 회귀 위험 0.
    const calc = parseCalculation(text);
    if (calc) {
      const userId = crypto.randomUUID();
      const asstId = crypto.randomUUID();
      const body = `${calc.expression} = ${calc.result}`;
      appendMessage(thread.id, { id: userId, role: "user", text });
      renameThreadIfDefault(thread.id, text);
      appendMessage(thread.id, {
        id: asstId,
        role: "assistant",
        route: "local",
        state: "found_local",
        reason: "",
        packName: (lang === "en" ? MESSAGES_EN : MESSAGES_KO).chat.calculator.packName,
        pending: false,
        text: body,
        provider: "learned",
        lang,
      });
      addDemoTrace({
        input: text,
        intent: "casual",
        route: "local",
        externalCall: false,
        provider: "none",
        latencyMs: Date.now() - startTime,
        reason: `Calculator — ${calc.expression} = ${calc.result}`,
      });
      setBusy(false);
      requestAnimationFrame(() => {
        scrollRef.current?.scrollTo({
          top: scrollRef.current?.scrollHeight ?? 0,
          behavior: "smooth",
        });
      });
      return;
    }

    // ---- Stage 0.5 (Phase M0): 선호 표현 ("X 좋아해" / "X 싫어해").
    // 매처 / 라우팅 / LLM 모두 skip — 사용자 자신에 대한 사실을 메모에 박는
    // 행위. Cost 0. Tei 발견 ("나는 매운 음식을 좋아해" → Cooking Pack 매칭)
    // 차단의 핵심. parsePreference 가 null 반환 = 일반 입력 → 기존 흐름.
    const pref = parsePreference(text);
    if (pref) {
      const userId = crypto.randomUUID();
      const asstId = crypto.randomUUID();
      const entry = addPreference(pref.type, pref.subject);
      // Phase EN-4: 입력 언어 기준 응답 분기. 한국어 회귀 그대로 (lang === "ko"
      // 이면 기존 톤 유지).
      const body =
        lang === "en"
          ? pref.type === "like"
            ? `Got it — I'll remember you like ${pref.subject}.`
            : `Got it — I'll remember you don't like ${pref.subject}.`
          : `알겠어. ${pref.subject} ${pref.type === "like" ? "좋아하는" : "싫어하는"} 거 기억할게.`;
      appendMessage(thread.id, { id: userId, role: "user", text });
      renameThreadIfDefault(thread.id, text);
      appendMessage(thread.id, {
        id: asstId,
        role: "assistant",
        route: "local",
        state: "found_local",
        reason: "",
        packName: (lang === "en" ? MESSAGES_EN : MESSAGES_KO).chat.preference.packName,
        pending: false,
        text: body,
        provider: "learned",
        lang,
      });
      addDemoTrace({
        input: text,
        intent: "casual",
        route: "local",
        externalCall: false,
        provider: "none",
        latencyMs: Date.now() - startTime,
        reason: `선호 저장 — ${pref.type}:${entry.subject}`,
      });
      setBusy(false);
      requestAnimationFrame(() => {
        scrollRef.current?.scrollTo({
          top: scrollRef.current?.scrollHeight ?? 0,
          behavior: "smooth",
        });
      });
      return;
    }

    // ---- Stage 0.6 (Phase M0-3): 선호 회상 ("내가 뭘 좋아해?" / "내 선호 알려줘").
    // 저장된 선호는 store 에 이미 박혀 있어 Cloud (Gemini) 호출 불필요.
    // Tei 발견 — recall 질문이 Stage 3 까지 흘러가 외부 API 비용 발생.
    // 인지 시 listPreferences/listByType 으로 즉시 응답. Cost 0.
    const recall = parseRecall(text);
    if (recall) {
      const userId = crypto.randomUUID();
      const asstId = crypto.randomUUID();
      const likes = recall.type === "dislike" ? [] : listByType("like");
      const dislikes = recall.type === "like" ? [] : listByType("dislike");
      const likeSubjects = likes.map((e) => e.subject);
      const dislikeSubjects = dislikes.map((e) => e.subject);
      let body: string;
      // Phase EN-4: 입력 언어 기준 응답 분기.
      if (lang === "en") {
        if (recall.type === "all") {
          if (likeSubjects.length === 0 && dislikeSubjects.length === 0) {
            body = "I don't know your preferences yet. Tell me.";
          } else if (likeSubjects.length > 0 && dislikeSubjects.length > 0) {
            body = `You like ${likeSubjects.join(", ")} and don't like ${dislikeSubjects.join(", ")}.`;
          } else if (likeSubjects.length > 0) {
            body = `You like ${likeSubjects.join(", ")}.`;
          } else {
            body = `You don't like ${dislikeSubjects.join(", ")}.`;
          }
        } else if (recall.type === "like") {
          body =
            likeSubjects.length === 0
              ? "You haven't told me what you like yet. Tell me."
              : `You like ${likeSubjects.join(", ")}.`;
        } else {
          body =
            dislikeSubjects.length === 0
              ? "You haven't told me what you don't like yet. Tell me."
              : `You don't like ${dislikeSubjects.join(", ")}.`;
        }
      } else if (recall.type === "all") {
        if (likeSubjects.length === 0 && dislikeSubjects.length === 0) {
          body = "아직 너의 선호 정보가 없어. 알려줘.";
        } else if (likeSubjects.length > 0 && dislikeSubjects.length > 0) {
          body = `${likeSubjects.join(", ")} 좋아하고 ${dislikeSubjects.join(", ")} 싫어해.`;
        } else if (likeSubjects.length > 0) {
          body = `${likeSubjects.join(", ")} 좋아해.`;
        } else {
          body = `${dislikeSubjects.join(", ")} 싫어해.`;
        }
      } else if (recall.type === "like") {
        body =
          likeSubjects.length === 0
            ? "아직 좋아하는 거 알려준 게 없어. 알려줘."
            : `${likeSubjects.join(", ")} 좋아해.`;
      } else {
        body =
          dislikeSubjects.length === 0
            ? "아직 싫어하는 거 알려준 게 없어. 알려줘."
            : `${dislikeSubjects.join(", ")} 싫어해.`;
      }
      appendMessage(thread.id, { id: userId, role: "user", text });
      renameThreadIfDefault(thread.id, text);
      appendMessage(thread.id, {
        id: asstId,
        role: "assistant",
        route: "local",
        state: "found_local",
        reason: "",
        packName: (lang === "en" ? MESSAGES_EN : MESSAGES_KO).chat.preferenceRecall.packName,
        pending: false,
        text: body,
        provider: "learned",
        lang,
      });
      const totalCount = listPreferences().length;
      addDemoTrace({
        input: text,
        intent: "casual",
        route: "local",
        externalCall: false,
        provider: "none",
        latencyMs: Date.now() - startTime,
        reason: `선호 회상 — type=${recall.type}, 저장된 선호 ${totalCount}개`,
      });
      setBusy(false);
      requestAnimationFrame(() => {
        scrollRef.current?.scrollTo({
          top: scrollRef.current?.scrollHeight ?? 0,
          behavior: "smooth",
        });
      });
      return;
    }

    const intentResult = await classifyIntent(text);
    const intent = intentResult.intent;

    if (import.meta.env.DEV) {
      console.log("[send]", {
        input: text,
        intent,
        lang,
        confidence: intentResult.confidence,
        lastPackId: thread.lastPackId,
        lastEntry: thread.lastPackEntry?.entryName,
      });
    }

    // No `activePack` lookup: there's no "active mode" anymore.
    // matchPackContent (Stage 1) handles routing to the right pack;
    // when nothing matches, Stage 3 calls the LLM with default voice.
    const scrollDown = () =>
      requestAnimationFrame(() => {
        scrollRef.current?.scrollTo({
          top: scrollRef.current?.scrollHeight ?? 0,
          behavior: "smooth",
        });
      });

    // V5.0 Phase B2: 직전 응답이 partial/fuzzy 매칭이고 사용자가 거부 신호
    // ("없는데"·"무슨소리"·"엉뚱"·…)를 보냈으면 같은 entry 재노출 차단.
    // 즉시 정직 응답 + cloud 옵션으로 escalate. lastPackEntry는 클리어해
    // 다음 turn에서 일반 라우팅으로 복귀.
    const priorEntry = thread.lastPackEntry;
    if (priorEntry && classifyRejection(text)) {
      const userId = crypto.randomUUID();
      const asstId = crypto.randomUUID();
      const requestedLabel = priorEntry.requestedNoun ?? priorEntry.entryName;
      // V5.0 Phase B3c: 받침 인지 조사 — "김치복음밥는" / "김치복음밥은" 자동 선택.
      const honestText = `맞아, ${requestedLabel}${topicParticle(requestedLabel)} ${priorEntry.packName}에 정확히 없어. cloud로 찾아볼까?`;
      appendMessage(thread.id, { id: userId, role: "user", text });
      renameThreadIfDefault(thread.id, text);
      appendMessage(thread.id, {
        id: asstId,
        role: "assistant",
        route: "local",
        state: "found_local",
        reason: "",
        packName: priorEntry.packName,
        pending: false,
        text: honestText,
        suggestion: {
          matchedPackName: priorEntry.packName,
          matchedPackId: priorEntry.packId,
          options: [
            {
              kind: "llm-call",
              label: "cloud로 찾기",
              prompt: priorEntry.requestedNoun
                ? `${priorEntry.requestedNoun}에 대해 알려줘. 한국어로 짧고 정확하게.`
                : `${priorEntry.entryName}와 비슷한 다른 걸 알려줘.`,
            },
          ],
          badge: "local",
        },
      });
      setThreadLastEntry(thread.id, undefined);
      addDemoTrace({
        input: text,
        intent,
        route: "local",
        externalCall: false,
        provider: "none",
        packId: priorEntry.packId,
        packName: priorEntry.packName,
        latencyMs: Date.now() - startTime,
        reason: "skip: user_rejected_prior_match",
      });
      setBusy(false);
      scrollDown();
      return;
    }
    // V5.0 Phase B2: rejection 분기에 안 들어왔다 = 사용자가 다른 turn으로
    // 넘어감. 이전 lastPackEntry는 더 이상 유효 X. Stage 1 hit 시 다시 set.
    if (thread.lastPackEntry) {
      setThreadLastEntry(thread.id, undefined);
    }

    // ---- Multi-match cluster rotation: chooser 이후 사용자가 "다른 레시피"
    // 류 follow-up 박으면 같은 cluster 의 served 안 박힌 entry 로 즉시 rotate.
    // Cloud 호출 회피. cluster 안의 모든 entry 가 served 면 fall-through —
    // 일반 follow-up 흐름이 처리.
    if (thread.multiMatchCluster && hasFollowUpIntent(text)) {
      const cluster = thread.multiMatchCluster;
      const unservedId = cluster.recipeIds.find((id) => !thread.servedRecipeIds.includes(id));
      if (unservedId) {
        const recipe = getCookingRecipe(unservedId);
        if (recipe) {
          const userId = crypto.randomUUID();
          const asstId = crypto.randomUUID();
          appendMessage(thread.id, { id: userId, role: "user", text });
          renameThreadIfDefault(thread.id, text);
          appendMessage(thread.id, {
            id: asstId,
            role: "assistant",
            route: "local",
            state: "found_local",
            reason: "",
            packName: cluster.packName,
            pending: false,
            text:
              lang === "en"
                ? `Another ${cluster.term} — ${recipe.title}.`
                : `${cluster.term} 다른 레시피 — ${recipe.title}.`,
            recipes: [recipe],
            lang,
          });
          markRecipeServed(thread.id, recipe.id);
          // cluster 의 마지막 entry 까지 rotate 한 turn 이면 clear.
          const stillUnserved = cluster.recipeIds.filter(
            (id) => id !== recipe.id && !thread.servedRecipeIds.includes(id),
          );
          if (stillUnserved.length === 0) setThreadCluster(thread.id, undefined);
          addDemoTrace({
            input: text,
            intent,
            route: "pack",
            externalCall: false,
            provider: "pack",
            packId: cluster.packId,
            packName: cluster.packName,
            latencyMs: Date.now() - startTime,
            reason: `cluster rotation — ${cluster.term} / ${recipe.title}`,
          });
          setBusy(false);
          requestAnimationFrame(() => {
            scrollRef.current?.scrollTo({
              top: scrollRef.current?.scrollHeight ?? 0,
              behavior: "smooth",
            });
          });
          return;
        }
      }
    }

    // ---- On-device match: runs FIRST, before the engine and before any
    // pending bubble. The whole "이 기기 안에서" promise breaks if the user
    // sees a fallback line ("이건 안에서는 안 잡혀…") flash before the
    // suggestion. So when a match hits we skip the engine entirely and
    // render the user msg + final suggestion msg in one step.
    //
    // Skip the matcher when the previous assistant turn was a suggestion
    // AND this input has a follow-up action word ("새 문제", "또 부탁",
    // …). Re-matching on those would just show the same suggestion card
    // again. The exception preserved by design: typing the topic word
    // alone ("수학") still re-triggers a fresh match.
    const lastAsst = [...thread.messages]
      .reverse()
      .find((m): m is Extract<ThreadMsg, { role: "assistant" }> => m.role === "assistant");
    const justSawSuggestion = Boolean(lastAsst?.suggestion);

    // V3.5 게이트 (2026-05-01): demo-stable 우선 정정. matchPackContent
    // 시그니처는 그대로 두고 send() 측 게이트를 보강.
    //
    // 우선순위:
    //   1) negation/trend 토큰 ("말고"/"인기"/...) → 무조건 skip (override all)
    //   2) specific pack target (입력이 installed 팩 trigger에 hit) → 게이트
    //      통과. definition/follow-up/casual을 override (예: "김치찌개는 뭐야"는
    //      definition이지만 김치찌개 트리거 → pack 허용).
    //   3) 1·2 모두 X면 기존 V3 의도 게이트 적용.
    //
    // 결과적으로 "라면 인기있는게 뭐야" / "레시피말고 라면 알아봐"는 negation
    // /trend로 1번에서 skip → cloud. "김치찌개는 뭐야"는 2번에서 통과 → pack.
    // "뭐야" 단독은 specific 없이 definition → skip → cloud.
    const isFollowUpIntent = intent === "follow-up";

    // V5.0 Phase I-4: 도메인 인지 — Tei 누수 케이스 ("짜장면 ... 맛집 ... 배달",
    // "Cooking Essentials에 운동 루틴") 차단. computeDomainExclusions 가 두
    // 룰 (excluded hit + top-domain owner mismatch) 모두 적용한 excludedIds
    // 반환. 매처 본체 (matchPackContent body) 흐름은 그대로, 입력 installed
    // 리스트만 좁힘.
    const dom = matchDomain(text);
    const domainExcludedIds = computeDomainExclusions(dom, installed);
    const eligibleInstalled = installed.filter((p) => !domainExcludedIds.includes(p.id));
    const domSummary = domainSummary(dom);

    const negTrend = classifyNegationOrTrend(text); // "negation" | "trend" | null
    const specificTarget = findSpecificPackTarget(text, eligibleInstalled);

    let skipReason: string | null = null;
    if (negTrend) {
      skipReason = negTrend;
    } else if (!specificTarget) {
      if (intent === "casual") skipReason = "casual";
      else if (intent === "definition") skipReason = "definition";
      else if (isFollowUpIntent) skipReason = "follow-up";
      else if (hasDefinitionIntent(text)) skipReason = "definition";
      else if (justSawSuggestion && hasFollowUpIntent(text)) skipReason = "follow-up";
    }
    // V5.0 Phase I-4: 모든 installed pack이 도메인-excluded 이면 매처 본체
    // 자체를 skip. 이 분기가 Tei "짜장면 ... 맛집 ... 배달" 누수 차단의 핵심.
    if (!skipReason && eligibleInstalled.length === 0 && domainExcludedIds.length > 0) {
      skipReason = `domain-excluded:${domainExcludedIds.join(",")}`;
    }
    const skipMatchStep = skipReason !== null;

    let matched = skipMatchStep
      ? null
      : await matchPackContent(text, eligibleInstalled, undefined, intent);

    // ---- Phase EN-fix (c): specificTarget(trigger 단어) 잡혔지만 matchPack
    // Content score 0 으로 null 반환된 케이스 — 영어 "I want doenjang stew"
    // 처럼 trigger ("stew") 박혔지만 RECIPE_KEYWORDS/DOMAIN 매칭 X. craving
    // 신호 동반 시 그 팩의 모든 entry 를 packLevel matched 로 합성해 dislike
    // filter / 대체 추천 / cloud 옵션 흐름 진입. 회귀 차단 게이트 두 단계:
    //   1) specificTarget 박힘 (trigger 단어가 입력에 있음 — 그 팩 영역 신호)
    //   2) classifyCraving (사용자 desire 표현 — "had/yesterday" 같은 단순
    //      언급 차단). 한국어는 이미 점수 90으로 matched 반환됨 — 이 분기
    //      안 들어옴 (회귀 0).
    if (!matched && specificTarget && classifyCraving(text)) {
      matched = synthesizePackLevelFallback(specificTarget.pack, text, lang);
    }

    // ---- Phase M0-4: dislike memory filter. matched.matches 측면 사용자
    // dislike subject 박힌 entry 떨굼. removed + filtered 둘 다 비비어 있으면
    // 짧은 prefix 응답 — builder 우회 (사용자가 명시한 dislike 를 정직 반영).
    // filtered 빈 박힘 (모두 dislike hit) 또는 removed 빈 박힘 (영향 0) 일
    // 때는 원본 흐름 그대로.
    if (matched) {
      const filterResult = filterMatchesByDislikes(matched.matches);
      const filterApplied = filterResult.removed.length > 0 && filterResult.filtered.length > 0;
      if (filterApplied) {
        const userId = crypto.randomUUID();
        const asstId = crypto.randomUUID();
        // Phase EN-fix A: appliedDislikes (hit 한 것만) + 입력 언어 기준 필터링.
        // 누적 garbage / 영·한 혼재 dislike 가 라벨에 박히던 회귀 차단.
        const dislikeLabel = pickLangDislikes(filterResult.appliedDislikes, matched.lang);
        const cookingFiltered = filterResult.filtered.filter(
          (m): m is typeof m & { kind: "cooking-recipe" } => m.kind === "cooking-recipe",
        );
        // Phase EN-fix C: EN 모드 응답 본문 안 레시피 제목도 EN — titleEn fallback.
        const titles = cookingFiltered.map((m) =>
          matched.lang === "en" ? (m.recipe.titleEn ?? m.recipe.title) : m.recipe.title,
        );
        const dl = (matched.lang === "en" ? MESSAGES_EN : MESSAGES_KO).chat.dislikeFilter;
        const joiner = matched.lang === "en" ? ", " : " 또는 ";
        const body =
          titles.length === 1
            ? dl.single(dislikeLabel, titles[0])
            : dl.multi(dislikeLabel, titles.join(joiner));
        // 옵션 풍부화: baek-style 4-button set (만들기 + 시켜먹기 + 비슷한 메뉴 +
        // cloud로 찾기). cloud 옵션 클릭 시 dispatchLLMCall → M0-5 USER_CONTEXT
        // 자동 inject → dislike 측면 cloud 응답 자동 반영.
        const options = buildFilteredOptions(cookingFiltered, matched.requestedNoun, matched.lang);
        appendMessage(thread.id, { id: userId, role: "user", text });
        renameThreadIfDefault(thread.id, text);
        appendMessage(thread.id, {
          id: asstId,
          role: "assistant",
          route: "local",
          state: "found_local",
          reason: "",
          packName: matched.pack.name,
          pending: false,
          text: body,
          suggestion: {
            matchedPackName: matched.pack.name,
            matchedPackId: matched.pack.id,
            options,
            badge: "local",
          },
          // Phase EN-fix A: 옵션 click 시 m.lang 으로 sourceLang 결정.
          lang: matched.lang,
        });
        if (import.meta.env.DEV) {
          console.log("[setThreadPack]", {
            from: "stage1-dislike-filter",
            packId: matched.pack.id,
            intent,
          });
        }
        setThreadPack(thread.id, matched.pack.id);
        setThreadLastEntry(thread.id, undefined);
        // cluster 박음 — filtered 가 다수면 rotation 활성.
        if (cookingFiltered.length > 1) {
          setThreadCluster(thread.id, {
            packId: matched.pack.id,
            packName: matched.pack.name,
            recipeIds: cookingFiltered.map((m) => m.recipe.id),
            term: matched.multiMatchKey ?? dislikeLabel,
            setAt: Date.now(),
          });
        } else {
          setThreadCluster(thread.id, undefined);
        }
        const removedNames = filterResult.removed
          .filter((m): m is typeof m & { kind: "cooking-recipe" } => m.kind === "cooking-recipe")
          .map((m) => m.recipe.title)
          .join(",");
        addDemoTrace({
          input: text,
          intent,
          route: "pack",
          externalCall: false,
          provider: "pack",
          packId: matched.pack.id,
          packName: matched.pack.name,
          latencyMs: Date.now() - startTime,
          reason: `dislike-filter: dislikes=[${filterResult.dislikes.join(",")}] removed=[${removedNames}] kept=${titles.length}`,
        });
        setBusy(false);
        scrollDown();
        return;
      }
      // ---- Phase M0-4 fix: matched 후보 가 모두 dislike 떨굼 (filtered=0,
      // removed > 0) 일 때 — pack 의 전체 entry 측면 측면 다시 박아 살아남는
      // alternative 측면 "비슷한 건" 응답. 기존 buildCookingSuggestion 의 fuzzy
      // fallback ("비슷한 건 백종원식") 이 dislike 무시한 채 박히던 회귀 차단.
      if (filterResult.removed.length > 0 && filterResult.filtered.length === 0) {
        const expanded = filterMatchesByDislikes(collectPackMatches(matched.pack));
        const expandedCooking = expanded.filtered.filter(
          (m): m is typeof m & { kind: "cooking-recipe" } => m.kind === "cooking-recipe",
        );
        if (expandedCooking.length > 0) {
          const userId = crypto.randomUUID();
          const asstId = crypto.randomUUID();
          // Phase EN-fix A: appliedDislikes 측면 입력 언어 필터.
          const dislikeLabel = pickLangDislikes(expanded.appliedDislikes, matched.lang);
          // Phase EN-fix C: EN 모드 응답 본문 안 레시피 제목도 EN.
          const titles = expandedCooking.map((m) =>
            matched.lang === "en" ? (m.recipe.titleEn ?? m.recipe.title) : m.recipe.title,
          );
          const dl = (matched.lang === "en" ? MESSAGES_EN : MESSAGES_KO).chat.dislikeFilter;
          const joiner = matched.lang === "en" ? ", " : " 또는 ";
          const body =
            titles.length === 1
              ? dl.expandedSingle(dislikeLabel, titles[0])
              : dl.expandedMulti(dislikeLabel, titles.join(joiner));
          // 옵션 풍부화 (M0-4 fix branch): baek-style 4-button set. cloud 옵션
          // 측면 dispatchLLMCall → M0-5 USER_CONTEXT 측면 dislike 측면 자동
          // 반영. requestedNoun (사용자 원본 의도 — 예 "된장찌개") 박혀 박혀
          // 박힌 경우 "cloud로 찾기" prompt 측면 활용.
          const options = buildFilteredOptions(
            expandedCooking,
            matched.requestedNoun,
            matched.lang,
          );
          appendMessage(thread.id, { id: userId, role: "user", text });
          renameThreadIfDefault(thread.id, text);
          appendMessage(thread.id, {
            id: asstId,
            role: "assistant",
            route: "local",
            state: "found_local",
            reason: "",
            packName: matched.pack.name,
            pending: false,
            text: body,
            suggestion: {
              matchedPackName: matched.pack.name,
              matchedPackId: matched.pack.id,
              options,
              badge: "local",
            },
            // Phase EN-fix A: 옵션 click 시 m.lang 으로 sourceLang 결정.
            lang: matched.lang,
          });
          setThreadPack(thread.id, matched.pack.id);
          setThreadLastEntry(thread.id, undefined);
          if (expandedCooking.length > 1) {
            setThreadCluster(thread.id, {
              packId: matched.pack.id,
              packName: matched.pack.name,
              recipeIds: expandedCooking.map((m) => m.recipe.id),
              term: matched.requestedNoun ?? "비슷한 건",
              setAt: Date.now(),
            });
          } else {
            setThreadCluster(thread.id, undefined);
          }
          const removedNames = filterResult.removed
            .filter((m): m is typeof m & { kind: "cooking-recipe" } => m.kind === "cooking-recipe")
            .map((m) => m.recipe.title)
            .join(",");
          addDemoTrace({
            input: text,
            intent,
            route: "pack",
            externalCall: false,
            provider: "pack",
            packId: matched.pack.id,
            packName: matched.pack.name,
            latencyMs: Date.now() - startTime,
            reason: `dislike-filter-fallback: matched-removed=[${removedNames}] expanded-kept=${titles.length} (requestedNoun=${matched.requestedNoun ?? "(none)"})`,
          });
          setBusy(false);
          scrollDown();
          return;
        }
        // expanded 도 모두 떨굼 (pack 전체 dislike hit) → 원본 흐름 fallback.
      }
    }

    // V5.0 Phase I-6: 사용자 발화의 negation-aware 행동 영역 인지. 매칭이 hit
    // 한 시점에 박음 — buildPackSuggestion 이 동일 영역 카드 drop. matchPackContent
    // 본체 흐름 변경 X. excludedActions 빈 배열이면 builder 가 기존 옵션 그대로.
    const excludedActions = matched ? classifyActionNegation(text) : [];
    if (matched) {
      const userId = crypto.randomUUID();
      const asstId = crypto.randomUUID();
      const payload = buildPackSuggestion(matched, excludedActions);
      const sugText = payload.kind === "pack-suggestion" ? payload.text : "";
      const sugData =
        payload.kind === "pack-suggestion"
          ? {
              matchedPackName: payload.matchedPackName,
              matchedPackId: payload.matchedPackId,
              options: payload.options,
              badge: payload.badge ?? "local",
            }
          : undefined;

      appendMessage(thread.id, { id: userId, role: "user", text });
      renameThreadIfDefault(thread.id, text);
      appendMessage(thread.id, {
        id: asstId,
        role: "assistant",
        route: "local",
        state: "found_local",
        reason: "",
        packName: matched.pack.name,
        pending: false,
        text: sugText,
        suggestion: sugData,
      });
      // V3 lastPackId 정책: 명시적 매칭 hit일 때만 lastPackId 갱신.
      // skipMatchStep 게이트가 definition/casual/follow-up을 이미 막았으므로
      // 여기 도달했다 = intent ∈ {search, recommend, unknown} + matchPackContent
      // hit. routeQuery의 loose trigger matching("뭐야" → study) 같은 추정으로
      // 박지 않는다.
      if (import.meta.env.DEV) {
        console.log("[setThreadPack]", {
          from: "stage1-match",
          packId: matched.pack.id,
          intent,
        });
      }
      setThreadPack(thread.id, matched.pack.id);
      // V5.0 lite Phase B trace.reason 형식 (confidence별):
      //   exact:       "pack: <id> / <name> [facet=<kind>] [match=exact]"
      //   exact-alias: "pack: <id> / <name> [facet=<kind>] [match=exact-alias, alias=<a>]"  (B3b)
      //   partial:     "pack: <id> / <name> [facet=<kind>] [match=partial]"
      //   fuzzy:       "pack: <id> / <name> [match=fuzzy, requested=<noun>]"
      const entryName = matched.topEntryName ?? "?";
      const facetTag = matched.facet ? `[facet=${matched.facet.kind}]` : "[facet=none]";
      const conf = matched.confidence ?? "fuzzy";
      // V5.0 Phase B3b: exact 분기에서 matchedAlias가 있으면 exact-alias로 분기.
      const matchTag =
        conf === "fuzzy"
          ? `[match=fuzzy, requested=${matched.requestedNoun ?? "(none)"}]`
          : conf === "exact" && matched.matchedAlias
            ? `[match=exact-alias, alias=${matched.matchedAlias}]`
            : `[match=${conf}]`;
      const baseReason =
        conf === "fuzzy"
          ? `pack: ${matched.pack.id} / ${entryName} ${matchTag}`
          : `pack: ${matched.pack.id} / ${entryName} ${facetTag} ${matchTag}`;
      // V5.0 Phase I-4: 도메인 요약을 trace 에 박음 (있을 때만).
      // V5.0 Phase I-6: excludedActions 박힘 → trace 에 명시 (사용자 인지 검증).
      const reasonText = [
        baseReason,
        domSummary ? `domain:${domSummary}` : null,
        excludedActions.length > 0 ? `negation:${excludedActions.join(",")}` : null,
      ]
        .filter(Boolean)
        .join(" · ");
      addDemoTrace({
        input: text,
        intent,
        route: "pack",
        externalCall: false,
        provider: "pack",
        packId: matched.pack.id,
        packName: matched.pack.name,
        latencyMs: Date.now() - startTime,
        reason: reasonText,
      });
      // V5.0 Phase B2: partial/fuzzy 시 lastPackEntry 저장 → 다음 turn의
      // rejection 검출에 사용. exact 또는 매칭 미스는 클리어.
      if (conf === "partial" || conf === "fuzzy") {
        setThreadLastEntry(thread.id, {
          packId: matched.pack.id,
          packName: matched.pack.name,
          entryName,
          confidence: conf,
          requestedNoun: matched.requestedNoun,
          setAt: Date.now(),
        });
      } else {
        setThreadLastEntry(thread.id, undefined);
      }
      // Multi-match phase: chooser 박힌 turn 의 cluster 저장 → 다음 turn 의
      // "다른 레시피" 류 follow-up 이 servedRecipeIds 안 박힌 sibling 으로
      // rotation. 일반 single hit 은 cluster clear (다른 카테고리 발화 시
      // 잔존 방지).
      if (matched.multiMatchKey && matched.matches.length > 1) {
        const recipeIds = matched.matches
          .filter((m): m is typeof m & { kind: "cooking-recipe" } => m.kind === "cooking-recipe")
          .map((m) => m.recipe.id);
        setThreadCluster(thread.id, {
          packId: matched.pack.id,
          packName: matched.pack.name,
          recipeIds,
          term: matched.multiMatchKey,
          setAt: Date.now(),
        });
      } else {
        setThreadCluster(thread.id, undefined);
      }
      setBusy(false);
      scrollDown();
      return;
    }

    // ---- Stage 2: store search. Local match failed, but the input might
    // map to a recognized study/lifestyle domain we can route to the
    // marketplace. If a domain is detected (with or without store hits),
    // we render a store-suggestion bubble instead of dropping straight
    // to the LLM. Skipped on follow-up intent so we don't loop. ----
    const skipStoreStep = skipMatchStep;
    if (!skipStoreStep) {
      const storeResult = searchStoreForQuery(text);
      if (storeResult) {
        const payload = buildStoreSuggestion(text, storeResult);
        const userId = crypto.randomUUID();
        const asstId = crypto.randomUUID();
        const sugText = payload.kind === "pack-suggestion" ? payload.text : "";
        const sugData =
          payload.kind === "pack-suggestion"
            ? {
                matchedPackName: payload.matchedPackName,
                options: payload.options,
                badge: payload.badge ?? "store",
              }
            : undefined;
        appendMessage(thread.id, { id: userId, role: "user", text });
        renameThreadIfDefault(thread.id, text);
        appendMessage(thread.id, {
          id: asstId,
          role: "assistant",
          route: "local",
          state: "found_local",
          reason: "",
          packName: (lang === "en" ? MESSAGES_EN : MESSAGES_KO).chat.packStore.packName,
          pending: false,
          text: sugText,
          suggestion: sugData,
          lang,
        });
        addDemoTrace({
          input: text,
          intent,
          route: "store",
          externalCall: false,
          provider: "none",
          latencyMs: Date.now() - startTime,
          reason: "팩스토어 매칭 — 새 팩 제안",
        });
        setBusy(false);
        scrollDown();
        return;
      }
    }

    // ---- Stage 2.5: learned cache. V2 헌법 2번 (자동 학습) + 3번
    // (점진적 온디바이스 진화). Phase A: exact-match (lower+trim) on
    // userInput. Hit → render the cached response directly, no LLM call,
    // bump usedCount. Skipped on follow-up intent so "다른거" goes to a
    // fresh LLM turn instead of replaying the previous cached one.
    // Casual은 학습된 인사 응답 hit이면 그대로 사용 (인사 자체를 캐싱) — V2 동작.
    //
    // V4.1 종합 모드: "정리" / "전부" / "다 보여" 같은 메모 종합 의도가
    // 박혀 있고 같은 topic 그룹 entry 가 하나 이상 있으면, 가장 가까운
    // 1개 대신 그룹 전체를 메모 형태로 합쳐 노출. Pack 매처는 영향 X —
    // 메모리 layer 만의 행동.
    const skipLearnedStep = isFollowUpIntent || (justSawSuggestion && hasFollowUpIntent(text));
    if (!skipLearnedStep && classifySummaryIntent(text)) {
      const group = matchLearnedTopicGroup(text);
      const topic = extractTopic(text);
      if (group.length > 0 && topic) {
        const userId = crypto.randomUUID();
        const asstId = crypto.randomUUID();
        appendMessage(thread.id, { id: userId, role: "user", text });
        renameThreadIfDefault(thread.id, text);
        appendMessage(thread.id, {
          id: asstId,
          role: "assistant",
          route: "local",
          state: "found_local",
          reason: "",
          packName: undefined,
          pending: false,
          text: buildTopicSummary(topic, group),
          provider: "learned",
          // 종합 모드는 단일 entry rating 대상 X — learnedId 미박힘.
        });
        // 종합 모드도 사용된 entry 의 usedCount 를 모두 bump — 시연 시
        // dotsLearning.list() 로 어느 entry가 자주 호출되는지 추적 가능.
        for (const e of group) void incrementUsedCount(e.id);
        addDemoTrace({
          input: text,
          intent,
          route: "learned",
          externalCall: false,
          provider: "learned",
          latencyMs: Date.now() - startTime,
          reason: `학습 캐시 종합 — topic=${topic}, ${group.length}개 합침`,
        });
        setBusy(false);
        scrollDown();
        return;
      }
    }
    if (!skipLearnedStep) {
      const learned = await matchLearnedResponse(text);
      if (learned) {
        const userId = crypto.randomUUID();
        const asstId = crypto.randomUUID();
        appendMessage(thread.id, { id: userId, role: "user", text });
        renameThreadIfDefault(thread.id, text);
        appendMessage(thread.id, {
          id: asstId,
          role: "assistant",
          route: "local",
          state: "found_local",
          reason: "",
          packName: learned.packName,
          pending: false,
          text: learned.response,
          provider: "learned",
          // Phase B: 학습 hit이면 그 응답의 id를 그대로 핸들로 박는다 —
          // 사용자가 "다른 거" 누르면 이 id로 priority -1 → 다음 같은
          // 입력은 새 LLM 호출로 흘러간다.
          learnedId: learned.id,
        });
        void incrementUsedCount(learned.id);
        addDemoTrace({
          input: text,
          intent,
          route: "learned",
          externalCall: false,
          provider: "learned",
          packId: learned.packId,
          packName: learned.packName,
          latencyMs: Date.now() - startTime,
          reason: `학습 캐시 hit — 사용 ${learned.usedCount + 1}회 (priority ${learned.priority})`,
        });
        setBusy(false);
        scrollDown();
        return;
      }
    }

    // ---- Stage 3: nothing matched anywhere. Existing engine + composeAnswer flow. ----
    const userId = crypto.randomUUID();
    const asstId = crypto.randomUUID();

    const result = step(text, installed, {
      contextPackId: thread.lastPackId,
      servedRecipeIds: thread.servedRecipeIds,
    });
    const route: RouteType =
      result.state === "checking_external"
        ? "deep"
        : result.intent === "memory_lookup"
          ? "memory"
          : "local";

    appendMessage(thread.id, { id: userId, role: "user", text });
    renameThreadIfDefault(thread.id, text);
    appendMessage(thread.id, {
      id: asstId,
      role: "assistant",
      route,
      state: result.state,
      reason: result.reason,
      packName: result.pack?.name,
      pending: true,
      // V5.0 Phase I-5: Stage 3 cloud-direct 메시지 표시 — UI 라벨 강화
      // (ProviderBadge 가 "Cloud (Pack 외부)" 형태) + 검수 디버그 용.
      cloudMode: true,
    });

    // V3: Stage 3 진입 = matchPackContent miss = lastPackId 변경 X.
    // routeQuery의 trigger 기반 pack 추정은 너무 loose하다 — Study가
    // "뭐야"를 trigger로 가지고 있어서 모든 정의 질문이 study-companion
    // 누수를 일으켰던 회귀 (Tei 검증 2026-04-30). Stage 1에서 명시적
    // 매칭 hit일 때만 setThreadPack을 부른다. result.pack은 voice/tone용
    // composePack 계산에만 그대로 쓰인다.
    if (import.meta.env.DEV && result.pack) {
      console.log("[lastPackId-skip]", {
        from: "stage3-routeQuery",
        candidatePackId: result.pack.id,
        intent,
        reason: "match miss — routeQuery trigger 추정으로는 박지 않음",
      });
    }

    // V2 voice/tone inference: when matchPackContent returned null due to
    // the threshold (or routeQuery couldn't pin a pack), there may still
    // be a domain leaning. inferDomainPack returns the closest pack —
    // "메뉴 추천" → cooking, "수학" → study — so the LLM answers in the
    // right voice even when nothing was strong enough to surface a card.
    // Falls back to undefined for fully off-topic input ("양자역학").
    const composePack = result.pack ?? inferDomainPack(text, installed);

    // setBusy(true)/setInput("") are now done at the top of send() before
    // classifyIntent — by the time we get to Stage 3 they're already set.

    const renderPayload = (payload: AnswerPayload, provider?: "webllm" | ProviderId) => {
      let body = "";
      let recipes: PackRecipe[] | undefined;
      let suggestion:
        | {
            matchedPackName: string;
            options: SuggestionOption[];
            badge?: "local" | "store" | "create";
          }
        | undefined;
      if (payload.kind === "text") {
        body = payload.text;
      } else if (payload.kind === "recipe") {
        const r = getCookingRecipe(payload.recipeId);
        recipes = r ? [r] : undefined;
        body = payload.intro ?? "";
        if (r) markRecipeServed(thread.id, r.id);
      } else if (payload.kind === "memory-recipes") {
        recipes = payload.recipeIds
          .map((id) => getCookingRecipe(id))
          .filter((r): r is PackRecipe => Boolean(r));
        body = payload.intro;
      } else if (payload.kind === "pack-suggestion") {
        body = payload.text;
        suggestion = {
          matchedPackName: payload.matchedPackName,
          options: payload.options,
          badge: payload.badge ?? "local",
        };
      }
      patchMessage(thread.id, asstId, {
        pending: false,
        text: body,
        recipes,
        pitch: payload.kind === "pack-suggestion" ? undefined : payload.pitch,
        suggestion,
        provider,
        lang,
      });
      setBusy(false);
      scrollDown();

      // V2 Phase 2 자동 학습. Save only when an LLM actually ran (provider
      // set) and produced plain text — recipe cards / memory-recipes are
      // structured outputs whose value lives in the recipe ids, not the
      // intro text; pack-suggestion bubbles aren't LLM output at all.
      // Constitution: 사용자 명시 X 자동 작동 — but here we're caching a
      // call the user already made, not making a new one. Cache use on
      // the next exact-match query is what skips a future LLM call.
      if (provider && payload.kind === "text" && body.trim()) {
        const learnedId = crypto.randomUUID();
        void saveLearned({
          id: learnedId,
          userInput: text,
          response: body,
          provider,
          packId: composePack?.id,
          packName: composePack?.name,
          voice: composePack?.voice,
          tone: composePack?.tone,
          createdAt: Date.now(),
          usedCount: 0,
          priority: 0,
        });
        // Phase B: 메시지 버블에 학습 id를 박아둬야 사용자가 "좋아"·
        // "다른 거"를 눌렀을 때 어느 엔트리를 평가할지 알 수 있다.
        patchMessage(thread.id, asstId, { learnedId });
      }
    };

    // Greeting short-circuit: V3 casual intent은 LLM(짧은 응답)으로 흘려야
    // 하므로 캔드 응답 분기를 건너뛴다. 분류기가 unknown으로 떨어졌어도
    // engine이 "안녕"을 greeting으로 잡으면 이전처럼 캔드 사용.
    if (result.state === "greeting" && intent !== "casual") {
      setTimeout(() => renderPayload(result.payload), 500);
      addDemoTrace({
        input: text,
        intent,
        route: "local",
        externalCall: false,
        provider: "none",
        packId: composePack?.id,
        packName: composePack?.name,
        latencyMs: Date.now() - startTime,
        reason: "캔드 인사 응답 (engine greeting)",
      });
      return;
    }

    // Streaming: each delta extends the bubble's text while still pending.
    // The final renderPayload below replaces with the canonical text and
    // flips pending: false. text/recipe/memory-recipes payloads use the
    // streamed text as their body or intro; pack-suggestion payloads
    // ignore it (they don't carry LLM-generated prose).
    const onToken = (_delta: string, sofar: string) => {
      patchMessage(thread.id, asstId, { text: sofar });
      scrollDown();
    };

    composeAnswer({
      query: text,
      pack: composePack,
      lookup: result.lookup,
      fallback: result.payload,
      history: threadHistory(thread.messages),
      onToken,
      intent,
      // V5.0 Phase M-1: thread id 전달 → 임계점 도달 시 summary 자동 생성/활용.
      // suggestion onClick 분기는 ad-hoc compose라 threadId 미박힘 (의도).
      threadId: thread.id,
      // V5.0 Phase I-5: Stage 3 cloud-direct = matchPackContent miss 후 cloud
      // 호출. composePack 이 박혀 있어도 (thread.lastPackId 으로 inferred)
      // pack identity 흉내 X — 일반 cloud 톤. Tei 발견 ("Cooking Essentials에는
      // ... 정보는 없어") 누수 차단.
      cloudMode: true,
      // Phase EN-1: 사용자 입력 언어 → 영어 system prompt 분기.
      lang,
    }).then(({
      payload,
      provider,
      model,
      usage,
      systemPromptChars,
      overheadInputTokens,
      overheadOutputTokens,
      summaryUsed,
      summaryGenerated,
    }) => {
      renderPayload(payload, provider);
      // Stage 3 trace는 composeAnswer 결과가 돌아온 시점에. provider가
      // 박혔으면 클라우드 호출 성공, 없으면 catch path (캔드 fallback)인데
      // 둘 다 외부 호출은 시도된 것이라 externalCall: true로 통일.
      // payload.kind가 pack-suggestion인 비정상 경로는 발생할 일이 없지만
      // route는 "cloud"로 둔다 — Stage 3 흐름임을 보존.
      //
      // V3.5 trace.reason 새 형식: skipReason이 박혔으면 "skip: <reason>"이
      // 곧 cloud로 떨어진 사유. 매처를 통과해 cloud까지 간 경우(매칭 미스)는
      // 기존 "클라우드 LLM (...)" 텍스트 유지.
      addDemoTrace({
        input: text,
        intent,
        route: "cloud",
        externalCall: true,
        provider: provider ?? "none",
        model,
        inputTokens: usage?.inputTokens,
        outputTokens: usage?.outputTokens,
        thinkingTokens: usage?.thinkingTokens,
        systemPromptChars,
        overheadInputTokens,
        overheadOutputTokens,
        packId: composePack?.id,
        packName: composePack?.name,
        latencyMs: Date.now() - startTime,
        reason: [
          skipReason
            ? `skip: ${skipReason}`
            : provider
              ? `클라우드 LLM (${provider})`
              : "클라우드 LLM 실패 → 캔드 fallback",
          summaryGenerated
            ? "summary 생성됨 (별도 LLM 호출)"
            : summaryUsed
              ? "summary 활용됨"
              : null,
          // V5.0 Phase I-4: 도메인 점수 요약 — skip / cloud 어느 쪽이든
          // 박힘 (있을 때만). Tei 시각 검증용.
          domSummary ? `domain:${domSummary}` : null,
        ]
          .filter(Boolean)
          .join(" · "),
      });
    });
  }

  // Suggestion buttons — invoked from rendered messages. Each option is one
  // explicit user choice: open the folder, show a recipe inline (no LLM),
  // or call the LLM with a tailored prompt. Adds new assistant messages
  // rather than mutating the suggestion bubble so the conversation keeps
  // a clean trail.
  //
  // The `busy` guard is intentional: this handler is the ONLY entry point
  // for cloud calls outside Stage 3 of send(). Blocking it while another
  // call is in flight closes the door on accidental double-fires from
  // double-clicks or any unexpected re-invocation of the click handler.
  // Phase EN-fix A: sourceLang = 옵션이 생성된 메시지의 m.lang. AssistantBubble
  // 측면 `m.lang ?? "ko"` 박혀 호출. 옛 흐름 (`detectLanguage(option.prompt/label)`)
  // 은 prompt 본문에 박힌 한국 음식 이름 (예: "참치김치찌개") 때문에 영어 prompt
  // 도 "ko" 로 오판정 → 한국어 Gemini 응답 회귀. 메시지 lang 이 옵션의 진짜
  // 출처라 단일 진실. default "ko" — 옛 ThreadMsg (lang 미박힘) 호환.
  function onSuggestionAction(
    option: SuggestionOption,
    matchedPackId?: string,
    sourceLang: "ko" | "en" = "ko",
  ) {
    if (!thread || busy) return;
    const sa = (sourceLang === "en" ? MESSAGES_EN : MESSAGES_KO).chat.suggestionAction;
    // The matched pack is the one the suggestion came from. It used to be
    // looked up via thread.lastPackId (the old "active mode"), but with
    // activation removed, the suggestion itself carries the pack id —
    // matching IS the activation now.
    const matchedPack = matchedPackId ? installed.find((p) => p.id === matchedPackId) : undefined;
    if (option.kind === "open-folder") {
      navigate({ to: option.target });
      return;
    }
    if (option.kind === "show-recipe") {
      const r = getCookingRecipe(option.recipeId);
      if (!r) return;
      const id = crypto.randomUUID();
      // Phase EN-fix A: 옵션이 생성된 메시지 lang 그대로 — option.label 추정 제거.
      // 다중 chooser 의 라벨이 한국어 레시피 제목 (참치김치찌개) 이어도 영어 모드
      // 박혀 있으면 EN 으로 카드 렌더.
      const optLang = sourceLang;
      appendMessage(thread.id, {
        id,
        role: "assistant",
        route: "local",
        state: "found_local",
        reason: "",
        packName: matchedPack?.name,
        pending: false,
        recipes: [r],
        lang: optLang,
      });
      markRecipeServed(thread.id, r.id);
      requestAnimationFrame(() => {
        scrollRef.current?.scrollTo({
          top: scrollRef.current?.scrollHeight ?? 0,
          behavior: "smooth",
        });
      });
      return;
    }
    if (option.kind === "llm-call") {
      const id = crypto.randomUUID();
      const clickStart = Date.now();
      appendMessage(thread.id, {
        id,
        role: "assistant",
        route: "deep",
        state: "checking_external",
        reason: sa.cloudSendReason,
        packName: option.systemPrompt ? sa.satTutorName : matchedPack?.name,
        pending: true,
        lang: sourceLang,
      });
      setBusy(true);

      const scrollDown = () => {
        requestAnimationFrame(() => {
          scrollRef.current?.scrollTo({
            top: scrollRef.current?.scrollHeight ?? 0,
            behavior: "smooth",
          });
        });
      };
      const onDoneText = (text: string) => {
        patchMessage(thread.id, id, { pending: false, text });
        setBusy(false);
        scrollDown();
      };
      // postAction "save-as-sat-problem": parse the LLM response into a
      // SATMathProblem, persist it to the user store, and replace the
      // pending bubble with a folder-open suggestion. The raw LLM text
      // never goes to chat —헌법: LLM 응답을 일회용으로 흘려보내지 않는다.
      const onSavedProblem = (source: "llm" | "dummy") => {
        const noteText = source === "llm" ? sa.satSavedFromLLM : sa.satSavedDummy;
        patchMessage(thread.id, id, {
          pending: false,
          text: noteText,
          packName: "Study Companion",
          suggestion: {
            matchedPackName: "Study Companion",
            options: [{ kind: "open-folder", label: sa.openFolder, target: "/study" }],
          },
        });
        setBusy(false);
        scrollDown();
      };

      const postAction = option.postAction;
      const onFail = (err: unknown) => {
        console.error("[suggestion llm-call] failed:", err);
        if (postAction === "save-as-sat-problem") {
          // LLM down — still honor the constitution by storing a dummy.
          const dummy = buildSATMathDummy(getUserSATProblems().length);
          addUserSATProblem(dummy);
          onSavedProblem("dummy");
          return;
        }
        const msg = err instanceof Error ? err.message : String(err);
        onDoneText(sa.callFailed(msg));
      };

      // Streaming token sink — same shape as Stage 3. Skip while a
      // postAction will replace the bubble entirely (save-as-sat-problem
      // builds a "Study에 저장됨" message, so streaming raw output then
      // overwriting it would just flicker).
      const streamToken =
        postAction === "save-as-sat-problem"
          ? undefined
          : (_delta: string, sofar: string) => {
              patchMessage(thread.id, id, { text: sofar });
              scrollDown();
            };

      const onDoneTextWithProvider = (text: string, provider?: "webllm" | ProviderId) => {
        patchMessage(thread.id, id, { pending: false, text, provider });
        setBusy(false);
        scrollDown();
      };

      // Two paths:
      //  - With option.systemPrompt: bypass composeAnswer entirely so the
      //    matched-pack persona (e.g. SAT 수학 튜터) can override the
      //    chat thread's active mode. Without this override the cooking
      //    persona refuses SAT math requests. We also skip pack injection
      //    for the same reason — the option's prompt IS the persona.
      //  - Without: keep the active-pack injection from composeAnswer so
      //    "다른 음식" stays in cooking voice.
      if (option.systemPrompt) {
        dispatchLLMCall(
          {
            userMessage: option.prompt,
            systemPrompt: option.systemPrompt,
            history: threadHistory(thread.messages),
            // Phase EN-fix A: sourceLang (옵션을 생성한 메시지의 m.lang) 그대로.
            // detectLanguage(option.prompt) 는 prompt 본문에 박힌 한국 음식 이름
            // (예: 참치김치찌개) 때문에 영어 prompt 도 "ko" 로 오판정 → 회귀.
            lang: sourceLang,
          },
          streamToken,
        )
          .then((res) => {
            if (postAction === "save-as-sat-problem") {
              const built = buildSATMathFromLLM(res.text, getUserSATProblems().length);
              addUserSATProblem(built.problem);
              onSavedProblem(built.source);
            } else {
              onDoneTextWithProvider(res.text, res.provider);
            }
            addDemoTrace({
              input: option.label,
              intent: "follow-up",
              route: "cloud",
              externalCall: true,
              provider: res.provider,
              model: res.model,
              inputTokens: res.usage?.inputTokens,
              outputTokens: res.usage?.outputTokens,
              thinkingTokens: res.usage?.thinkingTokens,
              systemPromptChars: res.systemPromptChars,
              packName: matchedPack?.name,
              latencyMs: Date.now() - clickStart,
              reason: postAction
                ? `선택지 클릭 — 클라우드 LLM (postAction: ${postAction})`
                : "선택지 클릭 — 클라우드 LLM (custom systemPrompt)",
            });
          })
          .catch(onFail);
      } else {
        composeAnswer({
          query: option.prompt,
          pack: matchedPack,
          fallback: { kind: "text", text: sa.fallbackResponse },
          history: threadHistory(thread.messages),
          onToken: streamToken,
          // V5.0 Phase M-1: 일반 suggestion → thread context 유지 → summary 활성.
          // 위 분기 (option.systemPrompt — 예: SAT 출제) 는 ad-hoc 페르소나라
          // summary 비활성 (의도된 omit).
          threadId: thread.id,
          // Phase EN-fix A: sourceLang (옵션을 생성한 메시지의 m.lang) 그대로.
          // detectLanguage(option.prompt) 추정 제거 — 한국 음식 이름이 박힌 영어
          // prompt 도 "ko" 오판정 → KO charter → 한국어 응답 회귀 차단.
          lang: sourceLang,
        })
          .then(({
      payload,
      provider,
      model,
      usage,
      systemPromptChars,
      overheadInputTokens,
      overheadOutputTokens,
      summaryUsed,
      summaryGenerated,
    }) => {
            onDoneTextWithProvider(payload.kind === "text" ? payload.text : "", provider);
            addDemoTrace({
              input: option.label,
              intent: "follow-up",
              route: "cloud",
              externalCall: true,
              provider: provider ?? "none",
              model,
              inputTokens: usage?.inputTokens,
              outputTokens: usage?.outputTokens,
              thinkingTokens: usage?.thinkingTokens,
              systemPromptChars,
              overheadInputTokens,
              overheadOutputTokens,
              packId: matchedPack?.id,
              packName: matchedPack?.name,
              latencyMs: Date.now() - clickStart,
              reason: [
                provider
                  ? `선택지 클릭 — 클라우드 LLM (${provider})`
                  : "선택지 클릭 — 클라우드 LLM 실패",
                summaryGenerated
                  ? "summary 생성됨 (별도 LLM 호출)"
                  : summaryUsed
                    ? "summary 활용됨"
                    : null,
              ]
                .filter(Boolean)
                .join(" · "),
            });
          })
          .catch(onFail);
      }
    }
  }

  // Convert thread messages → DispatchTurn[] for LLM context. Drops
  // pending bubbles, recipe-only / suggestion-only assistant messages
  // (no `text`), and anything that wouldn't help the model interpret
  // the next user turn. dispatch trims to N internally.
  function threadHistory(msgs: ThreadMsg[]): DispatchTurn[] {
    const turns: DispatchTurn[] = [];
    for (const m of msgs) {
      if (m.role === "user") {
        turns.push({ role: "user", content: m.text });
      } else if (!m.pending && m.text) {
        turns.push({ role: "assistant", content: m.text });
      }
    }
    return turns;
  }

  // ---- Measurement (dev only, ?measure=1). The panel drives the REAL send()
  // so a measured turn takes exactly the path a typed turn takes. Refs keep
  // the latest send/busy visible to the long-running loop across re-renders.
  const sendRef = useRef(send);
  sendRef.current = send;
  const busyRef = useRef(busy);
  busyRef.current = busy;
  const measureHooks: ChatHooks = {
    submitAndWait: async (text: string) => {
      const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
      const deadline = Date.now() + 120_000;
      // A previous turn may still be settling.
      while (busyRef.current && Date.now() < deadline) await sleep(100);
      const before = getActiveThread().messages.length;
      await sendRef.current(text);
      // Idle = user message landed, busy cleared, no pending bubble — and it
      // stays that way for a short settle window.
      let stableSince = 0;
      for (;;) {
        if (Date.now() > deadline) throw new Error("timeout waiting for the chat to settle");
        const msgs = getActiveThread().messages;
        const idle =
          msgs.length > before &&
          !busyRef.current &&
          !msgs.some((m) => m.role === "assistant" && m.pending);
        if (idle) {
          if (!stableSince) stableSince = Date.now();
          if (Date.now() - stableSince >= 400) {
            const added = msgs.slice(before).filter((m) => m.role === "assistant");
            const answer = added
              .map((m) => (m.role === "assistant" ? (m.text ?? "") : ""))
              .filter(Boolean)
              .join("\n");
            return { answer };
          }
        } else {
          stableSince = 0;
        }
        await sleep(100);
      }
    },
  };
  // Decided after mount so server and client render the same first frame.
  const [showMeasure, setShowMeasure] = useState(false);
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    setShowMeasure(new URLSearchParams(window.location.search).get("measure") === "1");
  }, []);

  if (!thread) return null;

  // Quick-entry pack row (top 3) — shown on mobile as shortcuts.
  const quickPacks = installed.slice(0, 3);
  const hasMessages = messages.length > 0;

  return (
    <Shell>
      <ChatBody
        quickPacks={quickPacks}
        hasMessages={hasMessages}
        messages={messages}
        scrollRef={scrollRef}
        input={input}
        setInput={setInput}
        busy={busy}
        send={send}
        onSuggestionAction={onSuggestionAction}
        onOpenFolder={(route) => navigate({ to: route })}
        summaryMarkerAfterId={summaryMarkerAfterId}
        activeSummary={activeSummary}
      />
      {showMeasure && <MeasurePanel hooks={measureHooks} />}
    </Shell>
  );
}

function ChatBody({
  quickPacks,
  hasMessages,
  messages,
  scrollRef,
  input,
  setInput,
  busy,
  send,
  onSuggestionAction,
  onOpenFolder,
  summaryMarkerAfterId,
  activeSummary,
}: {
  quickPacks: Pack[];
  hasMessages: boolean;
  messages: ThreadMsg[];
  scrollRef: React.RefObject<HTMLDivElement | null>;
  input: string;
  setInput: (v: string) => void;
  busy: boolean;
  send: (text: string) => void;
  onSuggestionAction: (
    option: SuggestionOption,
    matchedPackId?: string,
    sourceLang?: "ko" | "en",
  ) => void;
  onOpenFolder: (route: string) => void;
  // V5.0 Phase M-1: summary 마커 위치 + summary 본체.
  summaryMarkerAfterId?: string;
  activeSummary?: ConversationSummary;
}) {
  const shell = useShell();
  const t = useT();

  return (
    <div className="flex flex-col h-screen">
      {/* Header — mobile menu button + quick pack row, no titles or status */}
      <header className="border-b border-border">
        <div className="flex items-center gap-2 px-3 sm:px-8 md:px-12 py-3">
          {/* Mobile menu button */}
          <button
            type="button"
            onClick={() => shell?.openMobile()}
            className="md:hidden shrink-0 h-9 w-9 -ml-1 inline-flex items-center justify-center rounded-md text-ink-soft hover:text-ink hover:bg-surface-2 transition-colors"
            aria-label={t.shell.menuOpen}
          >
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <line x1="4" y1="7" x2="20" y2="7" />
              <line x1="4" y1="12" x2="20" y2="12" />
              <line x1="4" y1="17" x2="20" y2="17" />
            </svg>
          </button>

          {/* Pack pill row — each pill is a folder shortcut. There is no
              "active mode" anymore: voice/tone is decided by what the user
              types (auto-matching), not by what they toggled. Clicking a
              pack opens its folder if it has one, otherwise the catalog. */}
          <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar">
            {quickPacks.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => onOpenFolder(p.folderRoute ?? "/packs")}
                className="shrink-0 px-3 py-1.5 rounded-full hairline text-[12px] bg-surface-2 text-ink-soft hover:text-ink transition-colors"
                title={
                  p.folderRoute ? t.home.chipTitleFolder(p.name) : t.home.chipTitleCards(p.name)
                }
              >
                {p.name}
              </button>
            ))}
          </div>
        </div>
        {/* Single-line tagline — replaces the old "{name} 모드 · voice · tone"
            indicator. With activation gone, voice/tone is decided by the
            input itself, so there's nothing fixed to display here. */}
        <div className="px-3 sm:px-8 md:px-12 pb-2 -mt-1 text-[11px] text-ink-soft">
          {t.home.tagline}
        </div>
      </header>

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 md:px-10 py-6 sm:py-10 space-y-8">
          {messages.map((m) => {
            const node =
              m.role === "user" ? (
                <div key={m.id} className="flex justify-end fade-in">
                  <div className="max-w-[80%] px-4 py-2.5 rounded-2xl rounded-br-md bg-ink text-background text-[14px] leading-relaxed">
                    {m.text}
                  </div>
                </div>
              ) : (
                <AssistantBubble key={m.id} m={m} onSuggestionAction={onSuggestionAction} />
              );
            // V5.0 Phase M-1: summary 마커. summary가 cover한 마지막 메시지
            // 직후 박힘. dispatch가 그 이후부터 raw multi-turn 보냄.
            if (activeSummary && m.id === summaryMarkerAfterId) {
              return (
                <div key={`${m.id}-with-marker`} className="space-y-8">
                  {node}
                  <SummaryMarker summary={activeSummary} />
                </div>
              );
            }
            return node;
          })}
        </div>
      </div>

      {/* Composer */}
      <div className="border-t border-border bg-surface">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 md:px-10 py-4">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              send(input);
            }}
            className="flex items-end gap-3 rounded-xl border border-border bg-card px-4 py-3 focus-within:border-strong transition-colors"
          >
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key !== "Enter" || e.shiftKey) return;
                // 한국어 IME 합자 중 Enter는 합자 확정에만 쓰여. 여기서
                // send()를 부르면 setInput("") 후에 IME가 마지막 글자를
                // 다시 끼워넣어 입력창에 한 글자가 남는 React + IME 동기화
                // 버그가 난다. keyCode 229는 구형 브라우저용 백업.
                if (e.nativeEvent.isComposing || e.keyCode === 229) return;
                e.preventDefault();
                send(input);
              }}
              rows={1}
              placeholder={t.home.composerPlaceholder}
              className="flex-1 resize-none bg-transparent outline-none text-[14.5px] leading-relaxed text-ink placeholder:text-ink-soft/70 max-h-40"
            />
            <button
              type="submit"
              disabled={!input.trim() || busy}
              className="shrink-0 h-8 px-3 rounded-md bg-ink text-background text-[12.5px] font-medium disabled:opacity-30 transition-opacity"
            >
              {t.home.send}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}

function AssistantBubble({
  m,
  onSuggestionAction,
}: {
  m: Extract<ThreadMsg, { role: "assistant" }>;
  onSuggestionAction: (
    option: SuggestionOption,
    matchedPackId?: string,
    sourceLang?: "ko" | "en",
  ) => void;
}) {
  // Streaming state: while pending, partial text from onToken trickles
  // in. Show the trace until the first delta lands, then swap to the
  // streaming bubble with a blinking caret. When pending flips false
  // the caret disappears and the rest of the bubble (suggestions,
  // recipes, pitch) renders.
  const isStreaming = Boolean(m.pending && m.text);
  const showTrace = m.pending ? !m.text : m.route === "deep";
  return (
    <div className="space-y-3 fade-in">
      {showTrace && <ProcessingTrace route={m.route} reason={m.reason} packName={m.packName} />}
      {(isStreaming || !m.pending) && (
        <div className="space-y-3">
          {m.text && (
            <div className="text-[14.5px] leading-[1.65] text-ink max-w-2xl whitespace-pre-wrap">
              {m.text}
              {isStreaming && (
                <span
                  aria-hidden
                  className="inline-block w-[2px] h-[1em] align-[-0.15em] ml-[1px] bg-ink animate-pulse"
                />
              )}
            </div>
          )}
          {!m.pending && m.provider && (
            <ProviderBadge provider={m.provider} cloudMode={m.cloudMode} />
          )}
          {!m.pending && m.learnedId && <RatingControls learnedId={m.learnedId} />}
          {!m.pending && m.suggestion && (
            <SuggestionBlock
              packName={m.suggestion.matchedPackName}
              options={m.suggestion.options}
              badge={m.suggestion.badge ?? "local"}
              onAction={(opt) =>
                onSuggestionAction(opt, m.suggestion?.matchedPackId, m.lang ?? "ko")
              }
            />
          )}
          {!m.pending &&
            m.recipes?.map((r) => <RecipeCard key={r.id} recipe={r} lang={m.lang ?? "ko"} />)}
          {!m.pending && m.pitch && <PitchCard pitch={m.pitch} />}
        </div>
      )}
    </div>
  );
}

function RatingControls({ learnedId }: { learnedId: string }) {
  // Phase B 큐레이션. LLM 응답(웹llm/gemini) 또는 학습 hit(learned) 메시지
  // 아래 "좋아 / 다른 거" 텍스트 버튼을 띄운다. 사용자가 평가하면 store가
  // 갱신되고 같은 입력의 다음 매칭에 곧장 반영된다 — bad는 매칭에서 제외,
  // good은 priority 정렬 우선.
  const rating = useLearnedRating(learnedId);
  const t = useT().chat.rating;
  if (rating === "good" || rating === "bad") {
    return (
      <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-ink-soft">
        {rating === "good" ? t.liked : t.shownDifferent}
      </p>
    );
  }
  return (
    <div className="flex items-center gap-2 text-[11px]">
      <button
        type="button"
        onClick={() => void rateLearned(learnedId, "good")}
        className="text-ink-soft hover:text-ink transition-colors"
      >
        {t.like}
      </button>
      <span className="text-ink-soft/40">·</span>
      <button
        type="button"
        onClick={() => void rateLearned(learnedId, "bad")}
        className="text-ink-soft hover:text-ink transition-colors"
      >
        {t.different}
      </button>
    </div>
  );
}

function ProviderBadge({
  provider,
  cloudMode,
}: {
  provider: "webllm" | ProviderId | "learned";
  // V5.0 Phase I-5: Stage 3 cloud-direct 응답 (matchPackContent miss). 박혀
  // 있으면 cloud 라벨이 "Cloud (Pack 외부) · 외부 API" 형태로 강화 — pack
  // identity 응답 (suggestion onClick 등) 과 시각 분리.
  cloudMode?: boolean;
}) {
  // Three-tone visual contract across the chat:
  //   red   — local match or learned cache (no LLM call this turn)
  //   green — WebLLM (private, on-device, zero external calls)
  //   blue  — cloud API (active provider: gemini | openai | claude | grok)
  // V2 narrative: as the learning cache grows, red appears more often
  // and blue/green less. The user watches their AI go local over time.
  // Hidden when showLLMProvenance is off (no settings UI yet).
  const prefs = usePreferences();
  const t = useT().chat.provider;
  if (!prefs.showLLMProvenance) return null;
  // Any external provider shares one "cloud" tone (blue); the swap between
  // them is a server-side config detail, not a user-facing distinction.
  const CLOUD_LABELS: Record<Exclude<ProviderId, "gemini">, string> = {
    openai: "OpenAI",
    claude: "Claude",
    grok: "Grok",
  };
  const dot =
    provider === "webllm" ? "bg-green-500" : provider === "learned" ? "bg-red-500" : "bg-blue-500";
  const label =
    provider === "webllm"
      ? t.webllm
      : provider === "learned"
        ? t.learned
        : provider === "gemini"
          ? cloudMode
            ? t.geminiCloud
            : t.gemini
          : CLOUD_LABELS[provider];
  return (
    <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-ink-soft flex items-center gap-1.5">
      <span className={`h-1.5 w-1.5 rounded-full ${dot}`} aria-hidden />
      {label}
    </p>
  );
}

function SuggestionBlock({
  packName,
  options,
  badge,
  onAction,
}: {
  packName: string;
  options: SuggestionOption[];
  badge: "local" | "store" | "create";
  onAction: (option: SuggestionOption) => void;
}) {
  // Footer label tracks where the suggestion came from. "local" = installed
  // pack content; "store" = marketplace search hit; "create" = no match
  // anywhere yet, the LLM button would manufacture it.
  const tc = useT().chat;
  const footer =
    badge === "local"
      ? tc.suggestionFooter.local(packName)
      : badge === "store"
        ? tc.suggestionFooter.store
        : tc.suggestionFooter.create;
  // Red dot = on-device match (Stage 1/2). Used uniformly across the
  // three badge variants — the differentiation now lives in the footer
  // text, not the color. "create" stays slightly dim because nothing
  // actually exists yet; clicking will trigger a fresh LLM call that
  // would then earn the blue ProviderBadge below.
  const dotTone = badge === "create" ? "bg-red-500/40" : "bg-red-500";
  return (
    <div className="max-w-2xl">
      <div className="flex flex-wrap gap-2">
        {options.map((o, idx) => {
          const isLlm = o.kind === "llm-call";
          return (
            <button
              key={`${o.kind}-${idx}`}
              // Explicit type="button" so this button never gets pulled into
              // any sibling form's submit handler and accidentally fires the
              // LLM call on Enter / form submission. Constitution: cloud
              // calls only on explicit user click.
              type="button"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onAction(o);
              }}
              className={`h-9 px-3.5 rounded-full text-[12.5px] font-medium transition-colors ${
                isLlm
                  ? "border border-border text-ink-soft hover:text-ink hover:bg-surface-2"
                  : "bg-ink text-background hover:opacity-90"
              }`}
              title={isLlm ? tc.optionTitle.llm : tc.optionTitle.local}
            >
              {o.label}
              {isLlm && (
                <span className="ml-1.5 font-mono text-[9.5px] uppercase tracking-[0.14em] opacity-70">
                  cloud
                </span>
              )}
            </button>
          );
        })}
      </div>
      <div className="mt-2 flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.14em] text-ink-soft">
        <span className={`h-1.5 w-1.5 rounded-full ${dotTone}`} />
        {footer}
      </div>
    </div>
  );
}
