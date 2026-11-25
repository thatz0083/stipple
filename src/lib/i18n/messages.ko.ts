// Phase 2 i18n — 한국어 사전 (마스터). Messages 타입의 source-of-truth.
// EN 사전은 이 구조를 satisfies 로 강제 매칭 — 타입 빌드 단계에서 키 누락
// 자동 감지.
//
// 키 구조: nested namespace (shell, home, packs, store, sudoku, study, …).
// 함수 값 허용 — 파라미터 보간이 필요한 문자열은 (n: number) => string 형태.
// 템플릿 토큰 ({n}) 대신 함수로 정의해 TS 가 파라미터 타입까지 보장.

export const MESSAGES_KO = {
  // 언어 토글 자기 라벨. UX 관행상 양쪽 언어 사용자 모두 자기 언어를
  // 직관적으로 알아볼 수 있게 KO/EN 사전 동일값 — 토글 컴포넌트는 이걸
  // 거치지 않고 하드코딩 literal 사용 (사전 등록은 일관성 + 추후 참조용).
  toggle: { korean: "한국어", english: "English" },

  // 사이드바 (Shell.tsx).
  shell: {
    nav: {
      packs: "팩",
      store: "팩스토어",
      memory: "기억",
      settings: "설정",
      demo: "데모 측정",
    },
    newThread: "새 대화",
    newThreadDefaultTitle: "새 대화",
    sectionChats: "채팅",
    sectionSystem: "시스템",
    emptyTitle: "아직 시작된 대화가 없어.",
    emptyHint: "위의 + 새 대화로 시작해.",
    deviceBadge: "이 기기 안에서",
    menuOpen: "메뉴 열기",
    relTime: {
      justNow: "방금",
      minutesAgo: (m: number) => `${m}분 전`,
      hoursAgo: (h: number) => `${h}시간 전`,
      daysAgo: (d: number) => `${d}일 전`,
    },
  },

  // 채팅 홈 (routes/index.tsx).
  home: {
    tagline: "DOTS — 한국어 도우미. 입력에 맞춰 자동으로 톤이 바뀌어.",
    chipTitleFolder: (name: string) => `${name} 폴더 열기`,
    chipTitleCards: (name: string) => `${name} 카드 보기`,
    composerPlaceholder: "DOTS에게 말 걸기",
    send: "보내기",
  },

  // 팩 카탈로그 (routes/packs.tsx).
  packs: {
    eyebrow: "팩 라이브러리",
    title: "팩",
    subtitle:
      "팩은 작은 실행 단위. DOTS가 같은 질문을 어떻게 해석하고 정리해줄지 한 영역에서 바꿔.",
    detailsMore: "더 자세히",
    install: "설치",
    uninstall: "제거",
    pause: "일시정지",
    activate: "활성화",
    categories: {
      all: "전체",
      game: "게임",
      education: "학습",
      lifestyle: "라이프",
    },
    state: {
      notInstalled: "설치 안 됨",
      active: "활성",
      idle: "대기",
    },
    behaviorLines: {
      cookingEssentials: "요리 질문을 재료·순서·시간으로 바로 정리해줘.",
      studyCompanion: "설명 대신 단계로 풀고, 막힌 지점을 먼저 물어봐.",
      sudoku: "한 판 풀면 직전 결과 보고 다음 판 난이도를 한 단계 조정해.",
      morningRoutine: "오늘 일정·날씨를 기기 안에서 바로 답해.",
    },
  },

  // 팩스토어 (routes/store.tsx).
  store: {
    eyebrow: "마켓플레이스",
    title: "팩스토어",
    subtitle: "더 많은 콘텐츠와 행동 패턴을 추가하세요. 설치한 팩은 채팅과 매칭에서 곧장 작동해.",
    searchPlaceholder: "팩, 작가, 주제 검색",
    categories: {
      all: "전체",
      learning: "학습",
      cooking: "요리",
      lifestyle: "라이프스타일",
      work: "업무",
      entertainment: "엔터테인먼트",
    },
    emptyTitle: "지금은 추가 가능한 팩이 없어.",
    emptyDescription: "실제 동작하는 팩만 진열하기로 정리했어. 곧 새 팩이 도착할 거야.",
    buttonInstalledRemove: "설치됨 — 제거",
    buttonFreeInstall: "무료 설치",
    buttonBuyInstall: "구매하고 설치",
    priceFree: "무료",
  },

  // 스도쿠 (routes/sudoku.tsx). Phase 1 의 LABELS 객체에서 흡수.
  sudoku: {
    title: "스도쿠",
    description:
      "한 판 풀면 직전 결과를 기억해 다음 판 난이도를 한 단계 올리거나 내려. 채팅과 같은 기억 레이어 — 화면이 달라도 DOTS 는 너를 따라가.",
    difficulty: "난이도",
    demoBoard: "데모 보드",
    demoTooltip: "3칸만 채우면 끝나는 데모 보드 — 촬영용",
    newGame: "새 게임",
    check: "확인",
    nextGame: "다음 게임",
    clearTooltip: "지우기",
    incomplete: (n: number) => `아직 빈칸이 ${n}개 남았어. 다 채운 뒤 확인을 눌러.`,
    solved: (time: string) => `맞췄어. 오답 0개, ${time}.`,
    mistakes: (n: number, time: string) => `오답 ${n}개, ${time}.`,
    nextAdjust: (diff: string) => `다음 판은 ${diff} 로 조정.`,
    nextHold: (diff: string) => `다음 판도 ${diff} 유지.`,
  },

  // 채팅 응답 메타 — ProviderBadge / SuggestionBlock / RatingControls /
  // ProcessingTrace. 응답마다 노출되는 핵심 영역.
  chat: {
    // ProviderBadge — 응답 출처. 색·라벨 짝.
    provider: {
      webllm: "내 기기 (WebLLM) · 외부 호출 0",
      geminiCloud: "Cloud (Pack 외부) · Gemini API",
      gemini: "클라우드 (Gemini) · 외부 API",
      learned: "학습됨 · 캐시에서 (외부 호출 0)",
    },
    // SuggestionBlock footer — 매칭 출처.
    suggestionFooter: {
      local: (packName: string) => `${packName}에서 매칭됨 · 로컬 매칭`,
      store: "팩스토어에서 검색됨 · 로컬 매칭",
      create: "콘텐츠 없음 · 새로 만들 수 있어",
    },
    // SuggestionBlock 옵션 버튼 hover title.
    optionTitle: {
      llm: "이 옵션은 클라우드 호출이 들어가",
      local: "이 기기 안에서 처리",
    },
    // RatingControls — 응답 평가 (✓ 좋아함 / 다른 거 + 버튼).
    rating: {
      liked: "✓ 좋아함",
      shownDifferent: "✓ 다른 거 표시됨",
      like: "좋아",
      different: "다른 거",
    },
    // ProcessingTrace deep route — 1초 후 표시되는 부가 라벨.
    processingTrace: {
      deepWithPack: "일단 안에 있는 걸 먼저 봤는데, 더 찾아보면 정확해질 것 같아.",
      deepWithoutPack: "지금 가진 걸로는 애매해서 조금 더 확인해볼게.",
    },
    // Stage 0 명령어 (@learn / @unlearn / @list) 응답 본문 + packName 라벨.
    // lang 분기로 KO/EN 양쪽 노출.
    command: {
      packName: "명령어",
      learnAck: (alias: string, canonical: string) =>
        `알겠어. '${alias}'를 '${canonical}'로 기억할게.`,
      unlearnOk: (alias: string) => `'${alias}' 잊을게.`,
      unlearnMiss: (alias: string) => `'${alias}'는 학습된 적 없어.`,
      listEmpty:
        "학습된 alias 가 아직 없어. `@learn 두쫀쿠 = 두바이 쫀득쿠키` 같은 형식으로 가르쳐줘.",
      listHeader: (n: number) => `학습된 alias ${n}개:`,
    },
    // Stage 0.4 계산기 응답 packName ("학습됨 · Calculator Pack").
    calculator: {
      packName: "학습됨 · Calculator Pack",
    },
    // Stage 0.5 선호 저장 ("X 좋아해" / "X 싫어해") packName.
    preference: {
      packName: "학습됨 · 선호 저장",
    },
    // Stage 0.6 선호 회상 ("내가 뭘 좋아해?") packName.
    preferenceRecall: {
      packName: "학습됨 · 선호 회상",
    },
    // 팩스토어 매칭 (미설치 팩 제안) packName.
    packStore: {
      packName: "팩스토어",
    },
    // SummaryMarker — 이전 대화 요약 마커.
    summaryMarker: {
      ariaLabel: "이전 대화 요약 지점",
      summarized: (n: number) => `이전 대화 요약됨 (${n} 메시지)`,
    },
    // PitchCard — 마이크로 광고 카드.
    pitchCard: {
      sponsoredPrefix: (brand: string) => `협찬 · ${brand}`,
      closeAria: "광고 닫기",
      learnMore: "자세히 →",
    },
    // onSuggestionAction handler — llm-call 옵션 클릭 시 노출되는 라벨/메시지.
    // sourceLang (옵션이 생성된 메시지의 m.lang) 기준 KO/EN 분기. detectLanguage
    // 로 prompt 추정하던 옛 흐름 제거 — prompt 본문에 한국 음식 이름 박혀도
    // 응답 언어 오판정 X.
    suggestionAction: {
      cloudSendReason: "클라우드로 보낼게.",
      satTutorName: "SAT 수학 튜터",
      satSavedFromLLM: "새 SAT 수학 문제를 만들어서 Study 팩에 저장했어.",
      satSavedDummy: "(샘플 문제로 대체) Study 팩에 저장됐어. 폴더에서 풀어볼래?",
      openFolder: "폴더 열기",
      callFailed: (msg: string) => `(클라우드 호출 실패: ${msg})`,
      fallbackResponse: "지금은 응답을 가져오지 못했어.",
    },
    // dislike filter 응답 — matched.matches 측면 dislike 박힌 entry 제거 후
    // 사용자에게 정직 응답. 레시피 제목 (한국 음식) 은 KO/EN 모두 한국어 그대로
    // (요리 데이터는 한국어 유지 — 한국 음식은 한국어 이름이 진짜).
    dislikeFilter: {
      // Normal branch — matched.matches 측면 일부만 dislike hit, 나머지 살아남음.
      single: (dislikes: string, title: string) => `${dislikes} 싫어한다고 했어서 — ${title} 어때?`,
      multi: (dislikes: string, titles: string) =>
        `${dislikes} 싫어한다고 했어서 — ${titles} 중에 어떤 거?`,
      // Expanded branch — matched.matches 전부 dislike 떨굼 후 collectPackMatches
      // 측면 pack 전체 entry 측면 다시 박아 살아남는 대안 노출.
      expandedSingle: (dislikes: string, title: string) =>
        `${dislikes} 싫어한다고 했어서 — 비슷한 건 ${title} 어때?`,
      expandedMulti: (dislikes: string, titles: string) =>
        `${dislikes} 싫어한다고 했어서 — 비슷한 건 ${titles} 중에 어떤 거?`,
    },
    // dislike filter 옵션 라벨 + cloud prompts. buildFilteredOptions 측면 사용.
    // headTitle 은 head 레시피의 한국어 제목 그대로 노출 (KO/EN 모두).
    filterOptions: {
      cook: "만들기",
      cookSingle: "만들기",
      orderIn: "시켜먹기",
      orderInPrompt: (headTitle: string) =>
        `근처 한식당이나 배달앱에서 ${headTitle} 잘하는 곳 후보 3곳만 추천해줘. 한국어로 짧게.`,
      similar: "비슷한 메뉴",
      similarPrompt: (headTitle: string) =>
        `${headTitle}랑 비슷한 결인데 살짝 다른 한식 추천해줘. 1-2개만.`,
      cloud: "cloud로 찾기",
      cloudPromptWithNoun: (noun: string) => `${noun}에 대해 알려줘. 한국어로 짧고 정확하게.`,
      cloudPromptDefault: (headTitle: string) =>
        `${headTitle}랑 비슷한 다른 음식 추천해줘. 한국어로 짧고 정확하게.`,
    },
  },

  // 기억 (routes/memory.tsx) — 4 선반 + relTime + archive window + header/footer.
  memory: {
    eyebrow: "개인 레이어",
    title: "기억",
    subtitle: "한 통이 아니라 네 칸이야. 각자 역할이 달라서, 무엇을 가까이 둘지는 네가 정해.",
    shelves: {
      temporary: {
        name: "임시 기억",
        desc: "지금 대화 안에서만 살아 있어. 따로 저장하지 않으면 곧 잊어.",
        badge: "휘발",
        empty: "지금은 비어 있어. 새 대화에서 잠깐 머무는 정보가 여기 들어와.",
      },
      frequent: {
        name: "자주 나온 것",
        desc: "여러 대화에 반복해서 등장한 주제. 가까이에 두고 바로 꺼내.",
        badge: "근접",
        empty: "아직 자주 등장한 게 없어. 같은 주제가 반복되면 여기로 올라와.",
      },
      saved: {
        name: "저장된 것",
        desc: "내가 직접 보관한 것. 팩이 필요할 때 먼저 여기서 찾아.",
        badge: "고정",
        empty: "저장된 게 아직 없어.",
      },
      archive: {
        name: "아카이브",
        desc: "지난 대화 기록. 추론에는 쓰이지 않고, 필요할 때 들춰볼 수 있어.",
        badge: "보관만",
        empty: "아카이브가 비어 있어. 오래된 대화가 쌓이면 여기로 모여.",
      },
    },
    accessCount: (topic: string, n: number) => `${topic} — ${n}번 등장`,
    archiveItemCount: (n: number) => `${n}개 항목`,
    relTime: {
      justNow: "방금",
      minutesAgo: (m: number) => `${m}분 전`,
      hoursAgo: (h: number) => `${h}시간 전`,
      daysAgo: (d: number) => `${d}일 전`,
      weeksAgo: (w: number) => `${w}주 전`,
      monthDay: (month: number, day: number) => `${month}월 ${day}일`,
      ymd: (y: number, m: number, d: number) => `${y}.${m}.${d}`,
    },
    archiveWindow: {
      today: "오늘",
      yesterday: "어제",
      daysAgo: (n: number) => `${n}일 전`,
      monthDayWeek: (month: number, day: number) => `${month}월 ${day}일 주`,
      ymdWeek: (y: number, m: number, d: number) => `${y}.${m}.${d} 주`,
      thisWeek: "이번 주",
      lastWeek: "지난주",
      weeksAgo: (n: number) => `${n}주 전`,
      thisMonth: "이번 달",
      lastMonth: "지난달",
      monthOnly: (m: number) => `${m}월`,
      yearMonth: (y: number, m: number) => `${y}년 ${m}월`,
      thisQuarter: "이번 분기",
      thisYearSeason: (season: string) => `올해 ${season}`,
      yearSeason: (y: number, season: string) => `${y}년 ${season}`,
      thisYear: "올해",
      lastYear: "작년",
      twoYearsAgo: "재작년",
      yearOnly: (y: number) => `${y}년`,
    },
    seasons: { winter: "겨울", spring: "봄", summer: "여름", autumn: "가을" },
    known: {
      name: "내가 아는 너",
      desc: "네가 한 말에서 배운 것들이야. 어느 문장에서 나왔는지 같이 보여줘. 뭐든 지울 수 있어.",
      badge: "네 것",
      empty: "아직 없어. 좋아하는 것, 싫어하는 것을 말해주면 여기 쌓여.",
      like: "좋아함",
      dislike: "싫어함",
      from: "출처:",
      times: (n: number) => `${n}번 말함`,
      remove: "지우기",
    },
    footerLine1: "기기 밖으로 안 나가.",
    footerLine2: "기억은 이 기기 안에 머물러. 아카이브는 언제든 설정에서 내보낼 수 있어.",
  },

  // 설정 (routes/settings.tsx) — 주요 섹션. 기술 섹션 (Pitch/Wake/Embedding/
  // Reranker/WebLLM) 의 세부는 본 사전 외부 (data layer) 라 별도.
  settings: {
    eyebrow: "환경",
    title: "설정",
    homePriority: {
      title: "홈에서 먼저 보여줄 흐름",
      desc: "DOTS가 새 대화를 열 때 어디서부터 시작할지.",
      memoryFirst: {
        title: "기억 우선",
        desc: "전에 얘기한 것부터 꺼내. 같은 주제 반복이 잦을 때 좋아.",
      },
      packsFirst: {
        title: "팩 우선",
        desc: "활성 팩의 결과를 먼저 보여줘. 새 일에 빠르게 들어갈 때.",
      },
      balanced: { title: "균형", desc: "그 순간 가장 자연스러운 쪽으로. 기본값." },
    },
    defaultMode: {
      title: "기본 모드",
      desc: "답의 길이와 속도의 기본값.",
      calm: { title: "차분한 모드", desc: "짧고 부드럽게. 끼어들지 않게." },
      fast: { title: "빠른 모드", desc: "한 줄 답을 먼저. 필요하면 더 풀어줄게." },
      deep: { title: "깊은 모드", desc: "단계적으로 풀어. 시간이 조금 더 걸려." },
    },
    packOrder: {
      title: "팩 우선순위",
      desc: "위에 있는 팩이 라이브러리와 홈에서 먼저 보여.",
      installed: "설치됨",
      notInstalled: "설치 안 됨",
      moveUp: "위로",
      moveDown: "아래로",
    },
    privacy: {
      title: "프라이버시",
      badge: "기기 안",
      line1: "개인화된 데이터는 이 기기 안에 머물러.",
      line2:
        "기억, 팩 설정, 학습된 습관은 로컬에 저장돼. 더 깊은 추론이 필요할 때만 프롬프트와 팩 시그니처가 베이스 모델로 가.",
      telemetry: "익명 사용 통계",
      telemetryDesc: "팩 개선용. 기본은 꺼져 있어.",
    },
    about: {
      title: "DOTS 정보",
      version: "버전",
      versionValue: "0.1.0 · 프로토타입",
      baseModel: "베이스 모델",
      baseModelValue: "설정 가능",
      personalLayer: "개인 레이어",
      personalLayerValue: "로컬",
    },
    // Wake 라벨 — Phase EN-fix D: 정적 객체 (WAKE_KIND_LABEL / WAKE_TONE_LABEL)
    // 톱-레벨 박혀 lang 받을 자리 X. 사전 이동.
    wakeKind: {
      morning: "아침 인사",
      lunch: "점심 멘트",
      evening: "저녁 회상",
      bedtime: "자기 전",
      homecoming: "귀가",
    },
    wakeTone: {
      warm: "편안하게",
      brief: "짧게",
      calm: "차분하게",
    },
    wakeRow: {
      activeWindowStart: "활성 시간대 시작",
      activeWindowEnd: "활성 시간대 끝",
      minBackgroundHours: "최소 외출 시간",
      hoursPlus: (h: number) => `${h}시간↑`,
      preview: "들어보기",
    },
    // 능동 인사 (proactive hello) 섹션.
    proactiveHello: {
      title: "능동 인사",
      unsupportedBadge: "미지원 브라우저",
      intro: "시간 되면 음성으로 먼저 말 걸어줄게. 대화 내용은 말하지 않아 — 시간대와 흐름만.",
      browserNotice:
        "이 브라우저는 Web Speech API를 지원하지 않아. Chrome / Safari 에서 다시 열어봐.",
    },
    // 마이크로 광고 섹션.
    microAds: {
      title: "마이크로 광고",
      deviceBadge: "기기 안",
      intro:
        "DOTS의 광고는 디바이스 안에 머물러. 광고주는 네 데이터를 안 받아 — 매칭은 로컬에서만.",
      showAds: "광고 표시",
      showAdsDesc: "대화 흐름과 맞을 때만, 답변 옆에 한 장.",
      categoriesLabel: "카테고리",
      cacheCount: (n: number) => `광고 ${n}개 캐시됨 · 로컬`,
      statsTitle: "내 노출 통계",
      statsLine: (views: number, taps: number) => `노출 ${views} · 클릭 ${taps}`,
      statsNote: "이 통계는 디바이스 안에만 머물러. 광고주는 받지 못해.",
      weekly: "주간",
      monthly: "월간",
      viewsSuffix: (n: number) => `${n} 노출`,
      tapsSuffix: (n: number) => `${n} 클릭`,
      resetStats: "통계 초기화",
      confirmReset: "이 디바이스의 광고 노출 통계를 모두 지워. 계속할까?",
      footerTitle: "DOTS의 광고는 다르게 작동해",
      footerBullets: [
        "광고주는 카테고리와 기간을 구매해 (정액제)",
        "네 데이터는 외부로 안 나가",
        "노출 통계는 네 디바이스 안에만 머물러",
        "카운트는 광고 효과를 네가 직접 볼 수 있게 한 거야",
      ],
    },
    // 시맨틱 매칭 (V4) 섹션.
    semanticMatching: {
      title: "시맨틱 매칭 (V4)",
      deviceBadge: "기기 안",
      desc1:
        '의미 기반 매칭 — "양자역학" / "양자역학에 대해" / "양자역학이 뭐야"가 같은 응답으로 묶인다.',
      desc2: "모델이 다운로드된 뒤부터 작동. 안 켜도 V3 정확-일치 매칭은 그대로.",
      recommendedBadge: "추천",
      disable: "비활성화",
      downloading: "다운로드 중…",
      download: "다운로드",
      ready: "✓ 준비 완료 — 시맨틱 매칭 작동 중",
      failed: (err: string) => `실패: ${err}`,
      unknownError: "알 수 없는 오류",
      footer1: "다운로드는 1회만. IndexedDB에 저장되어 다음부터 즉시 작동.",
      footerRecommended: (name: string, size: string) => ` 추천: ${name} (${size}).`,
    },
    // 비활성 카드 (WebLLM/Reranker) — 데모용 컨셉 carrier.
    disabledCards: {
      webllmTitle: "온디바이스 LLM",
      webllmStatus: "준비 중",
      webllmDesc:
        "브라우저 안에서 도는 AI 모드. 외부 호출이 사라지는 대신 응답 정보량이 줄어든다. 지금은 안정성 작업 중이라 잠시 비활성화 — 모든 응답은 기본 모드(클라우드)로 흘러간다.",
      webllmFooter: "다음 단계 (베타) — 인프라 안정화 후 복구",
      rerankerTitle: "정확도 향상 (V4.5)",
      rerankerStatus: "다음 단계 (베타)",
      rerankerDesc:
        "Cross-encoder 재정렬 — V4 임베딩이 잡은 후보를 한 번 더 정밀 점검. 모델 호환성 작업 중이라 잠시 가려둠. V4 시맨틱 매칭은 그대로 작동.",
    },
  },

  // 404 + 사이드바 외 공통 — __root.tsx.
  notFound: {
    code: "404",
    title: "Nothing routed here.",
    subtitle: "DOTS could not match this path to a local pack or known screen.",
    backToChat: "Back to chat",
  },

  // SAT / Study (routes/study.tsx). Phase 1 의 LABELS 객체에서 흡수.
  study: {
    packFolder: "팩 폴더",
    // Phase EN-fix E: Study 헤더 본문 — `dots-data.Pack.short` 한국어 raw 가
    // packs 카탈로그 자기 i18n 매핑은 거치지만 Study 라우트에선 raw 직박 →
    // 한·영 섞임. Study 헤더는 i18n 키 직접 read.
    packShortBody: "설명 대신 단계로 풀고, 막힌 지점을 먼저 물어봐.",
    packShortSuffix: "답안 검증은 이 기기 안에서. 더 깊은 설명만 클라우드로 넘어가.",
    backToChat: "← 채팅으로",
    backToFolder: "← 폴더",
    problemsSuffix: (n: number) => `SAT 수학 · ${n}문제`,
    newProblem: "새 문제",
    retry: "다시 풀기",
    showHint: "힌트 보기",
    hint: "힌트",
    correct: "정답",
    incorrect: "오답",
    chosenLabel: "선택",
    correctLabel: "정답",
    showSolution: "정답 풀이 보기",
    matchedLocal: "· 이 기기 안에서 매칭됨",
    cloudFallback: "자주 틀리는 답 목록엔 안 잡혀. 더 깊게 보려면 클라우드로 넘길게.",
    moreExplain: "더 자세한 설명 보기",
    loadingExplain: "설명 가져오는 중…",
    makeVariant: "변형 문제 만들어줘",
    loadingVariant: "변형 문제 만드는 중…",
    moreExplainSection: "추가 설명",
    variantSection: "변형 문제",
    cloudFailed: "클라우드 호출 실패",
    cloudBadge: "클라우드",
    metaPrefix: "SAT 수학",
    errorExplainFetch: "설명 가져오기 실패",
    errorVariantFetch: "변형 문제 생성 실패",
  },

  // 데모 측정 (routes/demo.tsx + DemoMetricsPanel). 시연 영상 핵심 화면.
  demo: {
    eyebrow: "검증",
    title: "데모 측정",
    description:
      '라우팅 결정이 어디로 흘러갔는지 — 30개 고정 입력으로 검증 + 누적 분포 시각화. "더 똑똑한 라우터"가 아니라 "현재 라우터가 어떤 결정을 했는지 증명"하는 장치.',
    status: {
      running: "실행 중…",
      pass: "✓ 통과",
      mismatch: "✗ 불일치",
      idle: "대기",
      expectedActual: (expected: string, actual: string) => `예상 ${expected} / 실제 ${actual}`,
    },
    automation: {
      title: "자동 검증",
      progress: (completed: number, total: number, passed: number, failed: number) =>
        `${completed}/${total} · ${passed} 통과 · ${failed} 불일치`,
      desc: "헤드리스 평가 — 매처는 실제로 돌지만 클라우드 LLM은 호출 안 함. 30개 입력 × 평균 50ms = 약 1.5초.",
      runAll: "Run All",
      runHint: '각 행의 "Run" 버튼으로 단일 실행도 가능.',
    },
    testCases: {
      title: (total: number) => `테스트 케이스 (${total}개)`,
      hint: "표시된 케이스는 같은 입력을 채팅에서 한 번 cloud로 처리해야 학습 캐시에 hit. 신선한 상태에서는 cloud로 떨어진다.",
      needsPrior: "선행 채팅 필요",
    },
    panel: {
      confirmClear: "모든 trace를 지울까? 이 디바이스에만 저장돼 있어.",
      title: "데모 측정 (V0)",
      deviceBadge: "이 디바이스",
      description:
        'DOTS의 라우팅 결정 — 빅테크 대비 차별점. 각 입력이 어디로 흘러갔는지 / 외부 호출을 몇 번이나 피했는지가 여기에 박힌다. 본질은 "더 똑똑한 라우터"가 아니라 "현재 라우터가 어떤 결정을 했는지 증명".',
      empty: "아직 trace가 없어. 채팅에서 한 번 입력하거나 /demo 의 검증 도구를 돌려.",
      totals: "총 요청",
      local: "로컬",
      cloud: "클라우드",
      byBranch: "분기 별",
      edge: {
        title: "빅테크 대비 차별점",
        avoided: "회피한 외부 호출",
        rate: "회피율",
        latency: "평균 지연",
      },
      byPack: "팩 별",
    },
  },
};

// Messages 타입 — 구조형 (값 = string / 함수). as const 로 literal 좁히면
// EN 사전의 다른 literal 값이 satisfy 실패하므로 의도적으로 widen.
export type Messages = typeof MESSAGES_KO;
