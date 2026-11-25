// Phase 2 i18n — 영어 사전. messages.ko.ts 의 Messages 타입을 satisfies 로
// 강제 매칭 — KO 에 키 추가 후 EN 미추가 시 tsc 빌드 단계에서 실패.

import type { Messages } from "./messages.ko";

export const MESSAGES_EN: Messages = {
  toggle: { korean: "한국어", english: "English" },

  shell: {
    nav: {
      packs: "Packs",
      store: "Pack Store",
      memory: "Memory",
      settings: "Settings",
      demo: "Demo Metrics",
    },
    newThread: "New chat",
    newThreadDefaultTitle: "New chat",
    sectionChats: "Chats",
    sectionSystem: "System",
    emptyTitle: "No conversations yet.",
    emptyHint: "Hit + above to start one.",
    deviceBadge: "On this device",
    menuOpen: "Open menu",
    relTime: {
      justNow: "just now",
      minutesAgo: (m: number) => `${m}m ago`,
      hoursAgo: (h: number) => `${h}h ago`,
      daysAgo: (d: number) => `${d}d ago`,
    },
  },

  home: {
    tagline: "DOTS — your local AI. Tone follows your language.",
    chipTitleFolder: (name: string) => `Open ${name} folder`,
    chipTitleCards: (name: string) => `View ${name} card`,
    composerPlaceholder: "Talk to DOTS",
    send: "Send",
  },

  packs: {
    eyebrow: "Pack Library",
    title: "Packs",
    subtitle:
      "Packs are small execution units. Each one changes how DOTS reads and organizes the same question, in one area.",
    detailsMore: "More details",
    install: "Install",
    uninstall: "Uninstall",
    pause: "Pause",
    activate: "Activate",
    categories: {
      all: "All",
      game: "Game",
      education: "Education",
      lifestyle: "Lifestyle",
    },
    state: {
      notInstalled: "Not installed",
      active: "Active",
      idle: "Idle",
    },
    behaviorLines: {
      cookingEssentials: "Reformats food questions into ingredients, steps, and timing.",
      studyCompanion: "Walks through it step by step and asks where you got stuck.",
      sudoku:
        "After each round, looks at your result and adjusts the next puzzle's difficulty one step.",
      morningRoutine: "Answers today's schedule and weather right on this device.",
    },
  },

  store: {
    eyebrow: "Marketplace",
    title: "Pack Store",
    subtitle:
      "Add more content and behavior patterns. Installed packs work in chat and matching right away.",
    searchPlaceholder: "Search packs, authors, topics",
    categories: {
      all: "All",
      learning: "Learning",
      cooking: "Cooking",
      lifestyle: "Lifestyle",
      work: "Work",
      entertainment: "Entertainment",
    },
    emptyTitle: "No packs available right now.",
    emptyDescription: "We've curated to working packs only. New packs are coming soon.",
    buttonInstalledRemove: "Installed — Remove",
    buttonFreeInstall: "Install (free)",
    buttonBuyInstall: "Buy & install",
    priceFree: "Free",
  },

  sudoku: {
    title: "Sudoku",
    description:
      "Solve one puzzle, DOTS remembers the result and adjusts the next puzzle's difficulty one step up or down. Same memory layer as chat — different screens, DOTS still follows you.",
    difficulty: "Difficulty",
    demoBoard: "Demo Board",
    demoTooltip: "Demo board with only 3 empty cells — for recording",
    newGame: "New Game",
    check: "Check",
    nextGame: "Next Game",
    clearTooltip: "Clear",
    incomplete: (n: number) =>
      `${n} empty ${n === 1 ? "cell" : "cells"} remaining. Fill the board first.`,
    solved: (time: string) => `Solved. 0 mistakes, ${time}.`,
    mistakes: (n: number, time: string) => `${n} mistake${n === 1 ? "" : "s"}, ${time}.`,
    nextAdjust: (diff: string) => `Next round adjusted to ${diff}.`,
    nextHold: (diff: string) => `Holding at ${diff}.`,
  },

  chat: {
    provider: {
      webllm: "On device (WebLLM) · 0 external calls",
      geminiCloud: "Cloud (outside Pack) · Gemini API",
      gemini: "Cloud (Gemini) · External API",
      learned: "Learned · From cache (0 external calls)",
    },
    suggestionFooter: {
      local: (packName: string) => `Matched in ${packName} · Local match`,
      store: "Found in Pack Store · Local match",
      create: "No content yet · could create one",
    },
    optionTitle: {
      llm: "This option triggers a cloud call",
      local: "Handled on this device",
    },
    rating: {
      liked: "✓ Liked",
      shownDifferent: "✓ Showed something else",
      like: "Like",
      different: "Different",
    },
    processingTrace: {
      deepWithPack: "Checked here first — a wider look should sharpen it.",
      deepWithoutPack: "What I have is fuzzy — let me check a bit more.",
    },
    command: {
      packName: "Command",
      learnAck: (alias: string, canonical: string) =>
        `Got it — I'll remember '${alias}' as '${canonical}'.`,
      unlearnOk: (alias: string) => `Forgot '${alias}'.`,
      unlearnMiss: (alias: string) => `'${alias}' was never learned.`,
      listEmpty:
        "No aliases learned yet. Teach me with something like `@learn ddujon = Dubai chewy cookie`.",
      listHeader: (n: number) => `${n} learned aliases:`,
    },
    calculator: {
      packName: "Learned · Calculator Pack",
    },
    preference: {
      packName: "Learned · Preferences",
    },
    preferenceRecall: {
      packName: "Learned · Recall",
    },
    packStore: {
      packName: "Pack Store",
    },
    summaryMarker: {
      ariaLabel: "Previous conversation summary marker",
      summarized: (n: number) => `Previous conversation summarized (${n} messages)`,
    },
    pitchCard: {
      sponsoredPrefix: (brand: string) => `Sponsored · ${brand}`,
      closeAria: "Close ad",
      learnMore: "Learn more →",
    },
    suggestionAction: {
      cloudSendReason: "Sending to cloud…",
      satTutorName: "SAT Math Tutor",
      satSavedFromLLM: "Generated a new SAT math problem and saved it to the Study pack.",
      satSavedDummy:
        "(Used a sample problem instead.) Saved to the Study pack. Want to open the folder?",
      openFolder: "Open folder",
      callFailed: (msg: string) => `(Cloud call failed: ${msg})`,
      fallbackResponse: "Couldn't fetch a response right now.",
    },
    // 한국 음식 레시피 제목은 한국어 그대로 노출 — "참치김치찌개" 처럼.
    // 영어 응답 안 한국어 음식명 의도된 (한국 음식은 한국어 이름이 진짜).
    dislikeFilter: {
      single: (dislikes: string, title: string) =>
        `You said you don't like ${dislikes} — how about ${title}?`,
      multi: (dislikes: string, titles: string) =>
        `You said you don't like ${dislikes} — ${titles}, which one?`,
      expandedSingle: (dislikes: string, title: string) =>
        `You said you don't like ${dislikes} — closest match is ${title}.`,
      expandedMulti: (dislikes: string, titles: string) =>
        `You said you don't like ${dislikes} — closest matches: ${titles}.`,
    },
    filterOptions: {
      cook: "Cook it",
      cookSingle: "Cook it",
      orderIn: "Order in",
      orderInPrompt: (headTitle: string) =>
        `Suggest 3 nearby Korean restaurants or delivery apps that do ${headTitle} well. Keep it short.`,
      similar: "Similar dishes",
      similarPrompt: (headTitle: string) =>
        `Recommend 1-2 Korean dishes similar to ${headTitle} but slightly different.`,
      cloud: "Search in cloud",
      cloudPromptWithNoun: (noun: string) => `Tell me about ${noun}. Keep it short and clear.`,
      cloudPromptDefault: (headTitle: string) =>
        `Recommend something different but similar to ${headTitle}. Keep it short and clear.`,
    },
  },

  memory: {
    eyebrow: "Personal layer",
    title: "Memory",
    subtitle: "Not one bucket but four. Each one has its own role — you decide what to keep close.",
    shelves: {
      temporary: {
        name: "Temporary",
        desc: "Alive only inside the current conversation. Forgotten soon unless you save it.",
        badge: "Volatile",
        empty: "Empty for now. Bits passing through new chats land here.",
      },
      frequent: {
        name: "Frequent",
        desc: "Topics that came up across many chats. Kept close for quick recall.",
        badge: "Close",
        empty: "Nothing frequent yet. Repeated topics will surface here.",
      },
      saved: {
        name: "Saved",
        desc: "Things you saved yourself. Packs check here first when needed.",
        badge: "Pinned",
        empty: "Nothing saved yet.",
      },
      archive: {
        name: "Archive",
        desc: "Past conversation records. Not used for inference — there when you want to look back.",
        badge: "Storage only",
        empty: "Archive is empty. Old chats collect here over time.",
      },
    },
    accessCount: (topic: string, n: number) => `${topic} — ${n} mention${n === 1 ? "" : "s"}`,
    archiveItemCount: (n: number) => `${n} item${n === 1 ? "" : "s"}`,
    relTime: {
      justNow: "just now",
      minutesAgo: (m: number) => `${m}m ago`,
      hoursAgo: (h: number) => `${h}h ago`,
      daysAgo: (d: number) => `${d}d ago`,
      weeksAgo: (w: number) => `${w}w ago`,
      monthDay: (month: number, day: number) => `${month}/${day}`,
      ymd: (y: number, m: number, d: number) => `${y}.${m}.${d}`,
    },
    archiveWindow: {
      today: "Today",
      yesterday: "Yesterday",
      daysAgo: (n: number) => `${n}d ago`,
      monthDayWeek: (month: number, day: number) => `Week of ${month}/${day}`,
      ymdWeek: (y: number, m: number, d: number) => `Week of ${y}.${m}.${d}`,
      thisWeek: "This week",
      lastWeek: "Last week",
      weeksAgo: (n: number) => `${n}w ago`,
      thisMonth: "This month",
      lastMonth: "Last month",
      monthOnly: (m: number) => `Month ${m}`,
      yearMonth: (y: number, m: number) => `${y}.${m}`,
      thisQuarter: "This quarter",
      thisYearSeason: (season: string) => `${season} this year`,
      yearSeason: (y: number, season: string) => `${season} ${y}`,
      thisYear: "This year",
      lastYear: "Last year",
      twoYearsAgo: "Two years ago",
      yearOnly: (y: number) => `${y}`,
    },
    seasons: { winter: "Winter", spring: "Spring", summer: "Summer", autumn: "Autumn" },
    known: {
      name: "What I know about you",
      desc: "Learned from what you said. Each item shows the sentence it came from. Remove anything.",
      badge: "Yours",
      empty: "Nothing yet. Tell me what you like or don't like and it shows up here.",
      like: "Likes",
      dislike: "Dislikes",
      from: "From:",
      times: (n: number) => `said ${n}×`,
      remove: "Remove",
    },
    footerLine1: "Stays on this device.",
    footerLine2: "Memory lives on this device. You can export the archive any time in Settings.",
  },

  settings: {
    eyebrow: "Environment",
    title: "Settings",
    homePriority: {
      title: "What shows first on the home view",
      desc: "Where DOTS starts when you open a new chat.",
      memoryFirst: {
        title: "Memory first",
        desc: "Pull from what we talked about before. Good for recurring topics.",
      },
      packsFirst: {
        title: "Packs first",
        desc: "Show active pack results first. Good for jumping into new tasks.",
      },
      balanced: { title: "Balanced", desc: "Whatever feels natural in the moment. Default." },
    },
    defaultMode: {
      title: "Default mode",
      desc: "Default length and pace for replies.",
      calm: { title: "Calm", desc: "Short and gentle. Stays out of the way." },
      fast: { title: "Fast", desc: "One-line answer first. Expand on request." },
      deep: { title: "Deep", desc: "Walk through step by step. Takes a bit longer." },
    },
    packOrder: {
      title: "Pack priority",
      desc: "Packs higher in the list appear first in the library and home.",
      installed: "Installed",
      notInstalled: "Not installed",
      moveUp: "Move up",
      moveDown: "Move down",
    },
    privacy: {
      title: "Privacy",
      badge: "On device",
      line1: "Your personalized data stays on this device.",
      line2:
        "Memory, pack settings, and learned habits are stored locally. Only when deeper reasoning is needed do prompts and pack signatures go to the base model.",
      telemetry: "Anonymous usage stats",
      telemetryDesc: "For pack improvement. Off by default.",
    },
    about: {
      title: "About DOTS",
      version: "Version",
      versionValue: "0.1.0 · prototype",
      baseModel: "Base model",
      baseModelValue: "Configurable",
      personalLayer: "Personal layer",
      personalLayerValue: "Local",
    },
    wakeKind: {
      morning: "Morning hello",
      lunch: "Lunch nudge",
      evening: "Evening recap",
      bedtime: "Before bed",
      homecoming: "Homecoming",
    },
    wakeTone: {
      warm: "Warm",
      brief: "Brief",
      calm: "Calm",
    },
    wakeRow: {
      activeWindowStart: "Active window start",
      activeWindowEnd: "Active window end",
      minBackgroundHours: "Minimum away time",
      hoursPlus: (h: number) => `${h}h+`,
      preview: "Preview",
    },
    proactiveHello: {
      title: "Proactive hello",
      unsupportedBadge: "Unsupported browser",
      intro:
        "I'll speak up first when the time fits. I don't read your chats — only the time of day and flow.",
      browserNotice: "This browser doesn't support the Web Speech API. Open in Chrome / Safari.",
    },
    microAds: {
      title: "Micro ads",
      deviceBadge: "On device",
      intro: "DOTS ads stay on the device. Advertisers don't get your data — matching is local.",
      showAds: "Show ads",
      showAdsDesc: "Only when it fits the chat flow — one card next to a reply.",
      categoriesLabel: "Categories",
      cacheCount: (n: number) => `${n} ads cached · local`,
      statsTitle: "Your impression stats",
      statsLine: (views: number, taps: number) => `${views} views · ${taps} taps`,
      statsNote: "These stats stay on the device. Advertisers can't access them.",
      weekly: "Weekly",
      monthly: "Monthly",
      viewsSuffix: (n: number) => `${n} views`,
      tapsSuffix: (n: number) => `${n} taps`,
      resetStats: "Reset stats",
      confirmReset: "Clear all ad impression stats on this device. Continue?",
      footerTitle: "DOTS ads work differently",
      footerBullets: [
        "Advertisers buy a category and a period (flat rate)",
        "Your data doesn't leave this device",
        "Impression stats stay on your device",
        "Counts let you see ad performance yourself",
      ],
    },
    semanticMatching: {
      title: "Semantic matching (V4)",
      deviceBadge: "On device",
      desc1:
        'Meaning-based matching — "quantum mechanics" / "about quantum mechanics" / "what is quantum mechanics" all route to the same answer.',
      desc2: "Works once the model downloads. V3 exact-match keeps working without it.",
      recommendedBadge: "Recommended",
      disable: "Disable",
      downloading: "Downloading…",
      download: "Download",
      ready: "✓ Ready — semantic matching active",
      failed: (err: string) => `Failed: ${err}`,
      unknownError: "Unknown error",
      footer1: "One-time download. Stored in IndexedDB — instant from next time.",
      footerRecommended: (name: string, size: string) => ` Recommended: ${name} (${size}).`,
    },
    disabledCards: {
      webllmTitle: "On-device LLM",
      webllmStatus: "In progress",
      webllmDesc:
        "AI mode that runs inside the browser. External calls disappear but response detail drops. Temporarily disabled for stability work — all answers route through the default mode (cloud).",
      webllmFooter: "Next phase (beta) — restored after infra stabilizes",
      rerankerTitle: "Accuracy boost (V4.5)",
      rerankerStatus: "Next phase (beta)",
      rerankerDesc:
        "Cross-encoder reranking — a precise second pass on V4 embedding candidates. Hidden for now while we work on model compatibility. V4 semantic matching still works.",
    },
  },

  notFound: {
    code: "404",
    title: "Nothing routed here.",
    subtitle: "DOTS could not match this path to a local pack or known screen.",
    backToChat: "Back to chat",
  },

  study: {
    packFolder: "Pack folder",
    packShortBody: "Walks through it step by step and asks where you got stuck first.",
    packShortSuffix:
      "Answer checking runs on this device. Cloud only kicks in for deeper explanations.",
    backToChat: "← Back to chat",
    backToFolder: "← Folder",
    problemsSuffix: (n: number) => `SAT Math · ${n} problem${n === 1 ? "" : "s"}`,
    newProblem: "New",
    retry: "Try again",
    showHint: "Show hint",
    hint: "Hint",
    correct: "Correct",
    incorrect: "Incorrect",
    chosenLabel: "Chosen",
    correctLabel: "Correct",
    showSolution: "Show solution",
    matchedLocal: "· Matched on this device",
    cloudFallback: "Not in the common-mistakes table. Want a deeper look from the cloud?",
    moreExplain: "Get a detailed explanation",
    loadingExplain: "Fetching explanation…",
    makeVariant: "Make a variant",
    loadingVariant: "Generating variant…",
    moreExplainSection: "Detailed explanation",
    variantSection: "Variant problem",
    cloudFailed: "Cloud call failed",
    cloudBadge: "Cloud",
    metaPrefix: "SAT Math",
    errorExplainFetch: "Failed to fetch explanation",
    errorVariantFetch: "Failed to generate variant",
  },

  demo: {
    eyebrow: "Verification",
    title: "Demo metrics",
    description:
      'Where DOTS routed each query — verified with 30 fixed inputs + cumulative distribution. Not "a smarter router" but "proof of what the current router decided."',
    status: {
      running: "Running…",
      pass: "✓ Pass",
      mismatch: "✗ Mismatch",
      idle: "Idle",
      expectedActual: (expected: string, actual: string) => `Expected ${expected} / got ${actual}`,
    },
    automation: {
      title: "Automated verification",
      progress: (completed: number, total: number, passed: number, failed: number) =>
        `${completed}/${total} · ${passed} passed · ${failed} mismatched`,
      desc: "Headless evaluation — the matcher actually runs but the cloud LLM is not called. 30 inputs × 50ms avg ≈ 1.5s.",
      runAll: "Run All",
      runHint: 'Each row\'s "Run" button runs a single case.',
    },
    testCases: {
      title: (total: number) => `Test cases (${total})`,
      hint: "Marked cases need the same input processed once in chat through cloud so the learned cache hits. Fresh state falls through to cloud.",
      needsPrior: "Needs prior chat",
    },
    panel: {
      confirmClear: "Clear all traces? They're stored on this device only.",
      title: "Demo metrics (V0)",
      deviceBadge: "This device",
      description:
        'How DOTS routes — the edge over Big Tech. Where each input went / how many external calls were avoided lands here. The point isn\'t "a smarter router" but "proof of what the router decided."',
      empty: "No traces yet. Type something in chat or run /demo's verifier.",
      totals: "Total requests",
      local: "Local",
      cloud: "Cloud",
      byBranch: "By branch",
      edge: {
        title: "Edge over Big Tech",
        avoided: "External calls avoided",
        rate: "Avoid rate",
        latency: "Avg latency",
      },
      byPack: "By pack",
    },
  },
};
