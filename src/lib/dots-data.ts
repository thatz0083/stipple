// Shared mock data + simulated DOTS routing logic.
// DOTS = local-first. Check packs and memory before reaching for anything deeper.

import { lookupMemory, type LookupResult } from "@/lib/memory";
import type { Pitch } from "@/lib/pitch/types";

// Folder content reference. The actual content lives in
// `src/lib/packs/<pack>/...`; the pack only carries pointers so dots-data.ts
// stays a flat catalog and doesn't transitively pull every pack's data into
// every consumer.
export type PackContentRef =
  | { kind: "sat-math"; problemId: string }
  | { kind: "cooking-recipe"; recipeId: string };

export type Pack = {
  id: string;
  name: string;
  category: "Game" | "Education" | "Lifestyle";
  installed: boolean;
  short: string;
  behavior: string;
  triggers: string[];
  // Persona label shown in UI (chat header, pack cards). Short noun phrase
  // — "요리 전문가", "학습 코치". Today this is purely cosmetic, but the
  // intent is that once WebLLM lands, voice + tone become the source of
  // truth for the persona prompt and `systemPrompt` below is generated
  // from them. Keep them aligned.
  voice: string;
  // One-line tone descriptor — answer shape, register, what to avoid.
  // Mirrors the bullet points inside `systemPrompt` so the user sees the
  // same promise the model is being given.
  tone: string;
  // Injected into the AI's system prompt when this pack is the active mode.
  // Defines tone, answer shape, recommendation flow — not just a trigger label.
  systemPrompt: string;
  // Phase EN-1: 영어 입력 시 사용되는 systemPrompt 영어 미러. buildPackPersona
  // 가 lang==="en" 이면 이걸 우선 사용. 미박힘이면 한국어 systemPrompt로
  // fallback (방어 — 현재 4 작동 팩은 모두 채워짐).
  systemPromptEn?: string;
  // Phase EN-fix F: /packs 카드 렌더용 평행 EN 필드. 미박힘 시 KO fallback.
  // voice/tone/short 은 카드 상단, behavior 는 "More details" 펼침 본문.
  shortEn?: string;
  voiceEn?: string;
  toneEn?: string;
  behaviorEn?: string;
  // Content the pack ships as a folder. Empty/undefined = mode-only pack
  // (no folder view).
  contents?: PackContentRef[];
  // Route for this pack's folder UI. Only set on packs that have a
  // dedicated folder screen — drives the ◇ icon in the chat header. A
  // pack can have contents (used by matchPackContent) without having a
  // folderRoute (no dedicated screen, content rendered inline).
  folderRoute?: string;
  // V5.0 lite Phase I-2: 팩이 다루는 도메인. 사용자 입력의 도메인 점수가
  // 이 도메인과 일치하면 매칭 흐름 진입. 도메인 사전 (src/lib/domain/dictionary)
  // 의 키와 일치해야 — domain 매칭은 단순 string equality.
  domain?: string[];
  // 이 팩이 명시적으로 안 다루는 도메인. 사용자 입력 도메인 점수가 여기에
  // 매칭되면 cloud 직행 — 매처 본체 우회. cooking pack에 "맛집 추천" 누수
  // 차단용. domain 보다 우선 적용 (excluded이면 domain hit 무시).
  excluded_domains?: string[];
};

export const PACKS: Pack[] = [
  {
    id: "cooking-essentials",
    name: "Cooking Essentials",
    category: "Lifestyle",
    installed: true,
    short: "요리 질문을 재료·순서·시간 단위로 정리해서 답해.",
    behavior:
      "음식 질문을 재료·조리법·타이밍·팁 카드로 재조립해. 매운 정도와 인분 수 같은 기호도 기억해 다음 추천에 반영.",
    triggers: [
      "불고기",
      "bulgogi",
      "비빔밥",
      "bibimbap",
      "요리",
      "레시피",
      "recipe",
    ],
    voice: "요리 전문가",
    voiceEn: "Cooking expert",
    tone: "짧고 실용적 — 재료·조리법·타이밍·팁 위주",
    toneEn: "Short and practical — ingredients, steps, timing, tips",
    shortEn: "Reorganizes food questions into ingredients, steps, and timing.",
    behaviorEn:
      "Reframes food questions into ingredients, recipe, timing, and tips cards. Remembers preferences like spice level and serving size for next suggestions.",
    systemPrompt: [
      "지금 당신은 요리 전문가 모드입니다.",
      "- 답변은 짧고 실용적으로. 재료, 조리법, 타이밍, 팁 위주로.",
      "- 음식 추천 흐름으로 자연스럽게 끌어가세요. 사용자가 음식 얘기를 안 해도, 식사 시간대(아침·점심·저녁)면 자연스럽게 음식 화제로 연결하세요.",
      "- 모호한 질문도 음식·식사·장보기 관점으로 다시 풀어서 답하세요.",
    ].join("\n"),
    systemPromptEn: [
      "You're in Cooking Essentials mode.",
      "- Keep replies short and practical. Focus on ingredients, steps, timing, and tips.",
      "- Steer toward food naturally. Even if the user doesn't mention food, if it's mealtime (breakfast / lunch / dinner), make the food connection.",
      "- Re-frame even vague questions through food, meals, or groceries.",
    ].join("\n"),
    contents: [
      { kind: "cooking-recipe", recipeId: "bulgogi" },
      { kind: "cooking-recipe", recipeId: "bibimbap" },
    ],
    // V5.0 lite Phase I-2: cooking pack은 레시피·요리법·음식 도메인. 맛집·
    // 지역·배달·건강 정보 누수 차단 (Tei 박은 "짜장면 ... 맛집 ... 배달"
    // 케이스).
    domain: ["레시피", "요리법", "음식"],
    excluded_domains: ["맛집", "지역 정보", "배달", "건강 정보"],
  },
  {
    id: "study-companion",
    name: "Study Companion",
    category: "Education",
    installed: true,
    short: "설명 대신 단계로 풀고, 막힌 지점을 먼저 물어봐.",
    behavior:
      "어려운 주제를 비유 → 예시 → 핵심 정리 3단계로 쪼개고, 강의 대신 작은 퀴즈로 이해도를 확인해.",
    triggers: ["explain", "what is", "study", "homework", "설명", "공부", "뭐야"],
    voice: "학습 코치",
    voiceEn: "Study coach",
    tone: "단계적이고 차분 — 비유 → 예시 → 핵심 정리 3단계",
    toneEn: "Step-by-step and calm — analogy → example → key takeaway",
    shortEn: "Walks through it step by step and asks where you got stuck first.",
    behaviorEn:
      "Breaks hard topics into analogy → example → key takeaway, then checks understanding with small quizzes instead of lectures.",
    systemPrompt: [
      "지금 당신은 학습 코치 모드입니다.",
      "- 답변은 단계적이고 차분하게. 톤은 침착함을 유지하세요.",
      "- 개념을 설명할 땐 비유 → 예시 → 핵심 정리, 3단계로 구조화하세요.",
      "- 사용자의 질문이 흐트러져 있으면, 먼저 한 줄로 정리해주고 답변을 시작하세요.",
      "- 모호한 질문도 학습·이해·정리 관점으로 풀어서 답하세요.",
    ].join("\n"),
    systemPromptEn: [
      "You're in Study Companion mode.",
      "- Answer step by step, calmly. Hold the steady tone.",
      "- Explain concepts in three layers: analogy → example → key takeaway.",
      "- If the user's question is scattered, restate it in one line before answering.",
      "- Re-frame even vague questions through learning, understanding, and structure.",
    ].join("\n"),
    contents: [
      { kind: "sat-math", problemId: "sat-m-001" },
      { kind: "sat-math", problemId: "sat-m-002" },
      { kind: "sat-math", problemId: "sat-m-003" },
      { kind: "sat-math", problemId: "sat-m-004" },
      { kind: "sat-math", problemId: "sat-m-005" },
    ],
    folderRoute: "/study",
    // V5.0 lite Phase I-2: 학습·문제풀이·수학 도메인. 엔터테인먼트 누수 차단.
    domain: ["학습", "문제풀이", "수학"],
    excluded_domains: ["엔터테인먼트"],
  },
  {
    id: "sudoku",
    name: "Sudoku",
    category: "Game",
    installed: true,
    short: "온디바이스 스도쿠 — 풀이 실력에 따라 난이도 자동 조정.",
    behavior:
      "전용 화면에서 9×9 보드를 풀고, 직전 판의 오답/시간을 기억해 다음 판 난이도를 한 단계씩 올리거나 내려.",
    triggers: ["sudoku", "스도쿠", "퍼즐"],
    voice: "퍼즐 코치",
    voiceEn: "Puzzle coach",
    tone: "짧고 담백 — 결과만 한 줄로",
    toneEn: "Short and plain — one line for the result or feel",
    shortEn: "On-device Sudoku — difficulty auto-adjusts to your skill.",
    behaviorEn:
      "Solve a 9×9 board in a dedicated screen. Tracks last round's mistakes and time to nudge the next round's difficulty one step up or down.",
    systemPrompt: [
      "지금 당신은 퍼즐 코치 모드입니다.",
      "- 답변은 짧고 담백하게. 결과/감만 한 줄로.",
      "- 사용자의 최근 스도쿠 기록(난이도·오답·시간)이 USER_CONTEXT에 박혀 있으면 자연스럽게 참조하세요.",
    ].join("\n"),
    systemPromptEn: [
      "You're in Sudoku Coach mode.",
      "- Keep it short and plain. One line is enough — just the result or feel.",
      "- If USER_CONTEXT has the user's recent Sudoku record (difficulty, mistakes, time), reference it naturally.",
    ].join("\n"),
    folderRoute: "/sudoku",
    domain: ["스도쿠", "퍼즐"],
    excluded_domains: ["요리", "학습"],
  },
  {
    id: "morning-routine",
    name: "Morning Routine",
    category: "Lifestyle",
    installed: true,
    short: "오늘 일정·날씨·컨디션을 기기 안에서 짧게 답해.",
    behavior:
      "아침 흐름에 맞춰 날씨·일정·리마인더를 1~2 문장으로 짚어줘. cloud 호출 없이 온디바이스 메모리만 사용.",
    triggers: ["weather", "schedule", "today", "remind", "날씨", "오늘", "일정"],
    voice: "아침 루틴 동반자",
    voiceEn: "Morning companion",
    tone: "짧고 부드러움 — 1~2 문장, 에너지는 끌어올리되 과하지 않게",
    toneEn: "Short and gentle — 1-2 sentences, energizing but not over the top",
    shortEn: "Answers today's schedule, weather, and energy briefly on-device.",
    behaviorEn:
      "Points out weather, schedule, and reminders in 1-2 sentences matching the morning flow. Uses only on-device memory — no cloud.",
    systemPrompt: [
      "지금 당신은 아침 루틴 동반자 모드입니다.",
      "- 답변은 짧고 부드럽게. 에너지를 끌어올리는 톤이지만 과하지 않게.",
      "- 운동, 식사, 컨디션, 일정 위주로 답하세요.",
      "- 절대 길게 말하지 마세요 — 사용자가 하루를 시작하는 데 방해되면 안 됩니다. 1~2 문장이 기본입니다.",
    ].join("\n"),
    systemPromptEn: [
      "You're in Morning Routine mode.",
      "- Keep it short and gentle. Energizing tone, but not over the top.",
      "- Focus on exercise, meals, energy, and schedule.",
      "- Never go long — don't disrupt the user's start to the day. 1-2 sentences is the default.",
    ].join("\n"),
    // V5.0 lite Phase I-2: 루틴·일상 도메인. 요리·학습 누수 차단 — morning
    // routine은 짧은 일정/컨디션 응답 전용이라 cooking/study 매처 우회.
    domain: ["루틴", "일상"],
    excluded_domains: ["요리", "학습"],
  },
];

export type Route = "local" | "memory" | "deep";

// ---------------------------------------------------------------------------
// Seeded local memory — what DOTS already knows about this user.
// ---------------------------------------------------------------------------

export const LOCAL_MEMORY = {
  recentTopics: ["점심 메뉴", "요리", "공부"],
  preferences: ["김치찌개", "된장찌개"],
  savedRecipeTitles: ["불고기", "비빔밥"],
};

export type SavedRecipe = {
  id: string;
  title: string;
  mentioned: string;
  note: string;
  matches: string[];
};

export const SAVED_RECIPES: SavedRecipe[] = [
  {
    id: "bulgogi",
    title: "불고기",
    mentioned: "2주 전에 저장",
    note: "배를 갈아 넣어 고기를 연하게 하는 간장 양념 버전.",
    matches: ["bulgogi", "불고기", "소고기", "간장", "양념"],
  },
  {
    id: "bibimbap",
    title: "비빔밥",
    mentioned: "지난주에 저장",
    note: "고기 없이 나물만으로 완성하는 색색 한 그릇.",
    matches: ["bibimbap", "비빔밥", "나물", "고추장", "계란"],
  },
];

// ---------------------------------------------------------------------------
// Pack content — Cooking Essentials structured recipes.
// ---------------------------------------------------------------------------

export type PackRecipe = {
  id: string;
  title: string;
  serves: string;
  total: string;
  ingredients: { item: string; amount: string }[];
  steps: { t: string; minutes?: number }[];
  tip: string;
  // Phase EN-fix C: 영어 모드 카드 렌더용 평행 필드. 미박힘 → 한국어 fallback.
  // 매처 / dislike-filter / answerFor 등 데이터 read 호출자는 KO 필드만 사용
  // (한국어 텍스트 검색이라 영어 필드 보면 회귀). 카드 렌더 (RecipeCard) 만
  // lang 분기로 EN 우선. 한국 음식 이름은 로마자 + 영어 병기 (정체성 유지).
  titleEn?: string;
  servesEn?: string;
  totalEn?: string;
  ingredientsEn?: { item: string; amount: string }[];
  stepsEn?: { t: string; minutes?: number }[];
  tipEn?: string;
  // V5.0 lite Phase A facet 스키마. matchPackContent가 intent별 응답 텍스트를
  // entry 자체에서 뽑게 하기 위해 추가. 모두 optional — 미마이그레이션 entry는
  // 기존 ingredients/steps/tip 구조로 그대로 렌더링 (backward compat 보장).
  // Phase A: baek-kimchi-jjigae 1종만 채움. 나머지는 Phase B+에서.
  definition?: string;
  pack_context?: string;
  how_to?: string;
  examples?: string[];
  related_terms?: string[];
  // V5.0 lite Phase B3a 자기-기술 스키마.
  // - aliases: 사용자 자연 발화 대안 표기. matchPackContent가 entry name 외에
  //   추가 매칭 키로 사용. 예: "참치김치찌개"의 alias "참치찌개" / "참치 김치국".
  //   exact match가 alias로 성립하면 confidence=exact + matchedAlias 기록.
  // - contexts: 의미 컨텍스트 태그. 향후 builder/응답 분기에 사용 (B3c+).
  //   예: ["craving","how_to","definition"]. 이번 단계엔 데이터 필드만 추가.
  aliases?: string[];
  contexts?: string[];
  // V5.0 lite Phase B3c — entry가 자기 응답 옵션(버튼)을 facet 별로 제공.
  // builder가 facet kind를 키로 lookup. 미정의 facet은 기존 hardcoded fallback.
  // 예: action_options.craving = [{만들기}, {시켜먹기}, {비슷한 메뉴}]
  action_options?: Record<string, SuggestionOption[]>;
};

export const COOKING_RECIPES: PackRecipe[] = [
  {
    id: "bulgogi",
    title: "불고기",
    serves: "2인분",
    total: "약 25분 (재우기 20분 별도)",
    ingredients: [
      { item: "소고기 (불고기감, 등심)", amount: "300g, 얇게" },
      { item: "양파", amount: "1/2개" },
      { item: "대파", amount: "1대" },
      { item: "간장", amount: "3 큰술" },
      { item: "설탕", amount: "1 큰술" },
      { item: "배 (간 것)", amount: "2 큰술" },
      { item: "다진 마늘", amount: "1 큰술" },
      { item: "참기름", amount: "1 큰술" },
      { item: "후추", amount: "약간" },
    ],
    steps: [
      { t: "간장·설탕·배·마늘·참기름·후추를 섞어 양념장을 만든다.", minutes: 3 },
      { t: "얇게 썬 소고기를 양념에 20분 재운다.", minutes: 20 },
      { t: "센 불에 양파와 함께 볶는다.", minutes: 6 },
      { t: "대파를 넣고 한 번 더 볶아 마무리.", minutes: 2 },
    ],
    tip: "배를 갈아 넣으면 고기가 연해지고 단맛이 자연스러워. 센 불에 빠르게 볶아야 질기지 않아.",
    titleEn: "Bulgogi (Korean Marinated Beef)",
    servesEn: "Serves 2",
    totalEn: "~25 min (plus 20 min marinating)",
    ingredientsEn: [
      { item: "Beef (thinly sliced, sirloin)", amount: "300g" },
      { item: "Onion", amount: "1/2" },
      { item: "Green onion", amount: "1 large stalk" },
      { item: "Soy sauce", amount: "3 tbsp" },
      { item: "Sugar", amount: "1 tbsp" },
      { item: "Grated pear", amount: "2 tbsp" },
      { item: "Minced garlic", amount: "1 tbsp" },
      { item: "Sesame oil", amount: "1 tbsp" },
      { item: "Black pepper", amount: "a pinch" },
    ],
    stepsEn: [
      { t: "Mix soy sauce, sugar, pear, garlic, sesame oil, and pepper into a marinade.", minutes: 3 },
      { t: "Marinate the thinly sliced beef for 20 minutes.", minutes: 20 },
      { t: "Stir-fry over high heat with the onion.", minutes: 6 },
      { t: "Add green onion and stir-fry once more to finish.", minutes: 2 },
    ],
    tipEn: "Grated pear tenderizes the beef and adds natural sweetness. Stir-fry fast over high heat so it doesn't toughen.",
    definition:
      "불고기는 얇게 썬 소고기를 간장 양념에 재워 볶거나 구운 한국 대표 요리야. 간장·설탕·배의 균형에서 오는 단짠 양념이 핵심이야.",
    pack_context:
      "이 팩엔 누구나 아는 한식 2종(불고기, 비빔밥)이 들어 있어. 다른 한식은 cloud나 별도 팩으로 가.",
    how_to:
      "간장 3·설탕 1·배 2큰술로 양념을 만들어 얇은 소고기 300g을 20분 재운 뒤, 센 불에 양파와 볶고 대파로 마무리해. 약 25분.",
    examples: ["불고기", "비빔밥"],
    related_terms: ["소고기", "간장", "양념", "구이"],
    aliases: ["소불고기", "불고기볶음"],
    contexts: ["craving", "definition", "how_to", "casual"],
    action_options: {
      craving: [
        { kind: "show-recipe", label: "만들기", recipeId: "bulgogi", action_area: "만들기" },
        { kind: "llm-call", label: "비슷한 메뉴", prompt: "불고기랑 비슷한 결인데 살짝 다른 한식 추천해줘. 1-2개만.", action_area: "찾기" },
      ],
      how_to: [
        { kind: "show-recipe", label: "보여줘", recipeId: "bulgogi", action_area: "만들기" },
        { kind: "llm-call", label: "다른 음식", prompt: "다른 요리 하나 추천해줘. 비슷한 결인데 살짝 다른 걸로.", action_area: "찾기" },
      ],
      definition: [
        { kind: "show-recipe", label: "레시피 보기", recipeId: "bulgogi", action_area: "정보" },
        { kind: "llm-call", label: "다른 한식", prompt: "불고기 말고 다른 대표 한식 알려줘. 한국어로 짧게.", action_area: "찾기" },
      ],
      casual: [
        { kind: "show-recipe", label: "만들기", recipeId: "bulgogi", action_area: "만들기" },
        { kind: "llm-call", label: "다른 음식", prompt: "다른 요리 추천해줘. 가볍게.", action_area: "찾기" },
      ],
    },
  },
  {
    id: "bibimbap",
    title: "비빔밥",
    serves: "2인분",
    total: "약 25분",
    ingredients: [
      { item: "밥", amount: "2공기" },
      { item: "시금치", amount: "1줌" },
      { item: "콩나물", amount: "1줌" },
      { item: "당근", amount: "1/2개, 채썰어" },
      { item: "애호박", amount: "1/2개, 채썰어" },
      { item: "계란", amount: "2개" },
      { item: "고추장", amount: "2 큰술" },
      { item: "참기름", amount: "1 큰술" },
      { item: "통깨", amount: "약간" },
    ],
    steps: [
      { t: "시금치·콩나물을 데쳐 참기름·소금으로 무친다.", minutes: 8 },
      { t: "당근·애호박을 각각 살짝 볶는다.", minutes: 6 },
      { t: "계란을 반숙 프라이로 부친다.", minutes: 3 },
      { t: "밥 위에 나물을 색색으로 올리고 계란·고추장·참기름을 더해 마무리.", minutes: 3 },
    ],
    tip: "나물은 각각 따로 무쳐야 색과 맛이 살아. 고추장은 비비기 직전에 넣어 짜지 않게 조절해.",
    titleEn: "Bibimbap (Mixed Rice with Vegetables)",
    servesEn: "Serves 2",
    totalEn: "~25 min",
    ingredientsEn: [
      { item: "Cooked rice", amount: "2 bowls" },
      { item: "Spinach", amount: "1 handful" },
      { item: "Bean sprouts", amount: "1 handful" },
      { item: "Carrot", amount: "1/2, julienned" },
      { item: "Zucchini", amount: "1/2, julienned" },
      { item: "Eggs", amount: "2" },
      { item: "Gochujang (red chili paste)", amount: "2 tbsp" },
      { item: "Sesame oil", amount: "1 tbsp" },
      { item: "Toasted sesame seeds", amount: "a pinch" },
    ],
    stepsEn: [
      { t: "Blanch spinach and bean sprouts; season with sesame oil and salt.", minutes: 8 },
      { t: "Lightly stir-fry the carrot and zucchini separately.", minutes: 6 },
      { t: "Fry the eggs sunny-side up.", minutes: 3 },
      { t: "Arrange the vegetables over rice by color, top with egg, gochujang, and sesame oil.", minutes: 3 },
    ],
    tipEn: "Season each vegetable separately so colors and flavors stay distinct. Add gochujang right before mixing so it isn't too salty.",
    definition:
      "비빔밥은 밥 위에 여러 나물과 계란을 색색으로 올려 고추장에 비벼 먹는 한국 대표 요리야. 고기 없이 나물만으로도 완성되는 균형 잡힌 한 그릇이야.",
    pack_context:
      "이 팩엔 누구나 아는 한식 2종(불고기, 비빔밥)이 들어 있어. 다른 한식은 cloud나 별도 팩으로 가.",
    how_to:
      "시금치·콩나물을 데쳐 무치고 당근·애호박을 볶은 뒤, 밥 위에 색색으로 올려 계란·고추장·참기름을 더해 비벼. 고기 없이 나물만으로 약 25분.",
    examples: ["불고기", "비빔밥"],
    related_terms: ["나물", "고추장", "계란", "밥"],
    aliases: ["나물비빔밥", "채소비빔밥"],
    contexts: ["craving", "definition", "how_to", "casual"],
    action_options: {
      craving: [
        { kind: "show-recipe", label: "만들기", recipeId: "bibimbap", action_area: "만들기" },
        { kind: "llm-call", label: "비슷한 메뉴", prompt: "비빔밥이랑 비슷한 결인데 살짝 다른 한식 추천해줘. 1-2개만.", action_area: "찾기" },
      ],
      how_to: [
        { kind: "show-recipe", label: "보여줘", recipeId: "bibimbap", action_area: "만들기" },
        { kind: "llm-call", label: "다른 음식", prompt: "다른 요리 하나 추천해줘. 비슷한 결인데 살짝 다른 걸로.", action_area: "찾기" },
      ],
      definition: [
        { kind: "show-recipe", label: "레시피 보기", recipeId: "bibimbap", action_area: "정보" },
        { kind: "llm-call", label: "다른 한식", prompt: "비빔밥 말고 다른 대표 한식 알려줘. 한국어로 짧게.", action_area: "찾기" },
      ],
      casual: [
        { kind: "show-recipe", label: "만들기", recipeId: "bibimbap", action_area: "만들기" },
        { kind: "llm-call", label: "다른 음식", prompt: "다른 요리 추천해줘. 가볍게.", action_area: "찾기" },
      ],
    },
  },
];

// ---------------------------------------------------------------------------
// Study Companion pack content.
// ---------------------------------------------------------------------------

export const STUDY_PACK = {
  prompts: [
    "어디까지 알고 있는지 한 줄만 말해줘.",
    "지금 막히는 지점이 정확히 어디야?",
    "이게 시험용인지, 그냥 이해하고 싶은 건지?",
  ],
  shortAnswerHint: "한 문장으로 정리해줄게.",
  deepExplanationHint: "그럼 단계별로 풀어볼게.",
};

// ---------------------------------------------------------------------------
// Routing — local-first decision making.
// ---------------------------------------------------------------------------

const MEMORY_TRIGGERS = ["전에", "아까", "저장", "기억", "지난번", "예전"];
const COOKING_TRIGGERS = ["recipe", "cook", "김치찌개", "찌개", "요리", "레시피", "끓"];

export type RouteDecision = {
  route: Route;
  pack?: Pack;
  reason: string;
  lookup?: LookupResult;
};

export function routeQuery(query: string, installedPacks: Pack[]): RouteDecision {
  const q = query.toLowerCase().trim();

  // Light greetings — answer naturally, no status. Skip lookup entirely.
  const isGreeting =
    /^(안녕|하이|반가워|헬로|hi|hello|hey|yo|오랜만)/i.test(q) || q.split(/\s+/).length <= 1;
  if (isGreeting) {
    return { route: "local", reason: "" };
  }

  // Local-first: consult memory + archives before any pack/deep decision.
  // Side-effect: dormant matches get woken to active.
  const lookup = lookupMemory(query);

  // Memory-first: user explicitly references prior context.
  const wantsMemory = MEMORY_TRIGGERS.some((t) => q.includes(t));
  if (wantsMemory) {
    return {
      route: "memory",
      reason: "전에 얘기한 거 먼저 볼게.",
      lookup,
    };
  }

  // Cooking-first: explicit cooking signal goes to the pack.
  const cookingHit = COOKING_TRIGGERS.some((t) => q.includes(t));
  const cookingPack = installedPacks.find((p) => p.id === "cooking-essentials");
  if (cookingHit && cookingPack) {
    return {
      route: "local",
      pack: cookingPack,
      reason: "",
      lookup,
    };
  }

  // Other pack triggers.
  const hit = installedPacks.find((p) => p.triggers.some((t) => q.includes(t)));
  if (hit) {
    return { route: "local", pack: hit, reason: "", lookup };
  }

  // No pack matched — but if local memory has hits, prefer memory over deep.
  // This is the rule-book's "로컬 우선 판단": deep is the last resort.
  if (lookup.totalScore > 0) {
    return {
      route: "memory",
      reason: "전에 본 게 있어서 그쪽 먼저 볼게.",
      lookup,
    };
  }

  // Nothing local — go deeper.
  return {
    route: "deep",
    reason: "안에서는 바로 안 잡혀.",
    lookup,
  };
}

// Saved recipes are a separate, hand-curated collection from the auto-captured
// memory layer. We still trigger a memory lookup here so dormant memories that
// the user is asking about wake up correctly — even when the saved-recipe
// match is what ends up rendered.
export function recallFromMemory(query: string): SavedRecipe[] {
  lookupMemory(query);
  const q = query.toLowerCase();
  return SAVED_RECIPES.filter((r) => r.matches.some((m) => q.includes(m)));
}

// Greetings stay low-effort.
const KO_GREETINGS = ["안녕.", "응, 왔어.", "안녕. 편하게 있어.", "어, 안녕.", "왔구나."];

function pickGreeting(): string {
  return KO_GREETINGS[Math.floor(Math.random() * KO_GREETINGS.length)];
}

// ---------------------------------------------------------------------------
// Answer composition — varied, local-first, no fixed fallback.
// ---------------------------------------------------------------------------

// One-click action attached to a pack-suggestion. The whole point of the
// suggestion is to offer the user a no-LLM path (open the folder, render
// the matched recipe inline) plus a single explicit "fall back to LLM"
// choice — so the model isn't called speculatively.
//
// llm-call carries an optional systemPrompt so the matched pack (e.g. SAT
// 수학 튜터 페르소나) can override the chat thread's active-pack persona.
// Without this, asking for SAT math while the thread is in cooking mode
// makes the cooking persona refuse or drift off-task.
//
// postAction tells the chat handler what to do with the LLM response. The
// default is "show as text". "save-as-sat-problem" parses the response,
// saves it to the Study pack's user-content store, and renders a folder-
// open message instead of raw text — the constitution's "LLM 응답을
// 일회용으로 흘려보내지 말고 팩에 저장한다" rule.
// V5.0 Phase I-6: 행동 영역 (action area). 사용자 발화의 negation 이 어느
// 영역을 부정하는지 분류 후, builder 가 동일 영역 카드 박지 X.
// 만들기 = user 직접 행동 (요리, 풀이, 제조).
// 시켜먹기 = 외부 주문 (배달, 시키기).
// 찾기 = 대안 / 추천 / 탐색.
// 정보 = passive viewing (정의/설명/보여주기).
export type ActionArea = "만들기" | "시켜먹기" | "찾기" | "정보";

export type SuggestionOption =
  | { kind: "open-folder"; label: string; target: string; action_area?: ActionArea }
  | { kind: "show-recipe"; label: string; recipeId: string; action_area?: ActionArea }
  | {
      kind: "llm-call";
      label: string;
      prompt: string;
      systemPrompt?: string;
      postAction?: "save-as-sat-problem";
      action_area?: ActionArea;
    };

export type AnswerPayload =
  | { kind: "text"; text: string; pitch?: Pitch }
  | { kind: "recipe"; recipeId: string; intro?: string; pitch?: Pitch }
  | { kind: "memory-recipes"; recipeIds: string[]; intro: string; pitch?: Pitch }
  | {
      kind: "pack-suggestion";
      text: string;
      options: SuggestionOption[];
      matchedPackName: string;
      // Pack id behind the match — only set when this came from an
      // installed pack (Stage 1). Threaded into onSuggestionAction so the
      // matched pack's voice/tone applies on llm-call clicks.
      matchedPackId?: string;
      // Where the suggestion came from. Drives the small footer label
      // under the buttons:
      //   "local"  (default) — local pack content matched ("이 기기 안에서")
      //   "store"           — store-search hit ("팩스토어에서 검색됨")
      //   "create"          — no match anywhere; LLM will fabricate ("새로 만들 수 있어")
      badge?: "local" | "store" | "create";
    };

export function answerFor(query: string, pack?: Pack, route?: Route): AnswerPayload {
  const q = query.toLowerCase();

  // No `\b` — JS word-boundary doesn't fire on Hangul, which made "안녕" miss
  // this branch and fall through to the deep-route fallback text.
  if (/^(안녕|하이|반가워|헬로|오랜만|hi|hello|hey|yo)/i.test(q)) {
    return { kind: "text", text: pickGreeting() };
  }

  // ---- MEMORY HIT: warm, recall-flavored. References "전에", "저장해둔". ----
  if (route === "memory") {
    const matches = recallFromMemory(query);
    if (matches.length === 1) {
      const m = matches[0];
      const intros = [
        `응, 전에 저장해둔 ${m.title} 있어.`,
        `${m.mentioned}한 ${m.title}, 이거 맞아?`,
      ];
      return {
        kind: "memory-recipes",
        recipeIds: [m.id],
        intro: intros[Math.floor(Math.random() * intros.length)],
      };
    }
    if (matches.length > 1) {
      const titles = matches.map((m) => m.title);
      const intros = [
        `응, 전에 저장해둔 김치찌개 쪽에서 ${matches.length}개가 보여. ${titles.join(", ")}.`,
        `전에 이야기한 레시피 중엔 김치찌개가 ${matches.length}가지 있어 — ${titles.join(", ")}. 어느 쪽 볼래?`,
      ];
      return {
        kind: "memory-recipes",
        recipeIds: matches.map((m) => m.id),
        intro: intros[Math.floor(Math.random() * intros.length)],
      };
    }
    // Memory route triggered but nothing actually saved on this topic.
    return {
      kind: "text",
      text: "그 얘기는 저장된 게 안 잡히네. 어떤 거였는지 한 마디만 더 줄래?",
    };
  }

  // ---- PACK HIT: text-only canned fallbacks. ----
  // CONSTITUTION: Stage 3 LLM 응답에 — 자동 콘텐츠 첨부 X.
  // 모드 활성은 voice/tone 적용까지. 콘텐츠 표시는 매칭 hit 시에만.
  // 사용자 명시 X 자동 작동 X.
  //
  // The cooking-essentials branch used to return `{ kind: "recipe",
  // recipeId }` here, which made every Stage 3 input under cooking mode
  // (e.g. "양자역학") show a kimchi recipe alongside the LLM reply. That
  // path is dead since matchPackContent (Stage 1) catches real cooking
  // queries and the follow-up "다른거" branch in engine.step builds its
  // recipe payloads directly. So Stage 3 cooking just falls through to
  // the text fallbacks below — LLM voice/tone still applies via dispatch.

  if (pack?.id === "morning-routine") {
    return {
      kind: "text",
      text: "맑은 아침이고 14도야. 10시 30분에 미라랑 약속 하나 있고, 점심 전까지는 그것 말곤 별다른 일정 없어.",
    };
  }

  if (pack?.id === "study-companion") {
    return {
      kind: "text",
      text: STUDY_PACK.prompts[0],
    };
  }

  // Generic kimchi mention without an active pack.
  if (q.includes("김치") || q.includes("kimchi")) {
    return {
      kind: "text",
      text: "김치찌개는 보통 묵은지에 돼지고기나 참치, 두부, 양파를 넣고 끓여. 자세한 비율 필요하면 말해.",
    };
  }

  // ---- NO LOCAL RESULT: honest, slightly slower, signals it's reaching. ----
  const deepReplies = [
    "지금 안에 있는 것만으론 애매해서 조금 더 확인해볼게.",
    "이건 안에서는 안 잡혀. 잠깐 더 봐야겠다.",
    "음, 가진 걸로는 부족해. 조금만 시간 줘.",
  ];
  return {
    kind: "text",
    text: deepReplies[Math.floor(Math.random() * deepReplies.length)],
  };
}

export function getCookingRecipe(id: string): PackRecipe | undefined {
  return COOKING_RECIPES.find((r) => r.id === id);
}
