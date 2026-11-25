// Memory operating system — type model.
//
// v1 unit is topic-based (decision: keep simple, evolve later). The optional
// `content` slot is shaped as a discriminated union so a v2 fact-based unit
// can be added without breaking existing records.

export type MemoryState = "temporary" | "active" | "dormant" | "archived";

export type MemoryContent =
  | { kind: "topic"; text: string }
  | {
      kind: "fact";
      subject: string;
      predicate: string;
      object: string;
    };

export type EmotionSources = {
  // Auto-detected: repetition, emphasis ("정말", "진짜", "!"), pos/neg keywords.
  heuristic: number;
  // User-marked: 👍, "기억해줘", explicit save action. Weighted higher when
  // emotionScore is computed (see scoring rules in stage 2).
  explicit: number;
};

export type MemoryRecord = {
  id: string;
  topic: string;
  state: MemoryState;
  createdAt: number;
  lastAccessedAt: number;
  accessCount: number;
  // Denormalized cache of (heuristic + explicit*W). Source of truth is
  // `emotionSources`; this field exists for sort/query without iteration.
  emotionScore: number;
  emotionSources: EmotionSources;
  sourceThreadId?: string;
  content?: MemoryContent;
};

export type ArchiveGranularity = "day" | "week" | "month" | "quarter" | "year";

export type ArchiveEntry = {
  id: string;
  granularity: ArchiveGranularity;
  windowStart: number;
  windowEnd: number;
  topics: { topic: string; count: number }[];
  sourceMemoryIds: string[];
  createdAt: number;
};

export type MetaRecord = {
  key: string;
  value: unknown;
  updatedAt: number;
};

// V5.0 Phase M-1: 긴 대화 영속용 thread-level summary. MemoryRecord와 별도
// 엔티티 — 토픽/감정/access 필드가 summary에 부적합. 별도 IDB store
// (summaries) 에 thread당 최대 1개 저장 (재요약 시 supersede).
export type ConversationSummary = {
  // `summary-${threadId}` — thread당 단일 entry라 1:1 키 박음. 재요약은
  // 같은 id에 put → 자동 supersede.
  id: string;
  threadId: string;
  // LLM이 생성한 요약 본문. system prompt에 CONVERSATION_SUMMARY 섹션으로 박힘.
  content: string;
  // ms epoch.
  createdAt: number;
  // 이 summary가 커버하는 thread.messages 길이. 인덱스 [0..sourceMessagesCount)
  // 가 요약됨. 이후 메시지는 "recent" 으로 LLM에 multi-turn 그대로 전달.
  sourceMessagesCount: number;
  // 입력으로 들어간 history의 char 길이 (토큰 proxy). 비용 추정 + 디버그.
  tokensUsed: number;
  // Provider-reported tokens spent generating this summary (a hidden cloud
  // call Stipple makes). Counted as Stipple overhead in measurement.
  usageInputTokens?: number;
  usageOutputTokens?: number;
};
