export type Screen = "onboarding" | "path-preview" | "feed" | "lesson" | "post" | "agent-profile" | "new-post" | "map" | "settings";
export type GenerationSource = "research-llm" | "llm" | "fallback";
export type CurriculumSource = "planner" | "deterministic-fallback" | "sample-seed";
export type TargetDepth = "casual" | "conversational" | "practical" | "strategic";
export type PreferredTone = "default" | "light" | "professional" | "debate-heavy";

export interface Concept {
  id: string;
  title: string;
  plainName: string;
  order: number;
  unlockHint: string;
  prerequisiteIds: string[];
  mastery: number;
}

export interface LessonChoice {
  id: string;
  label: string;
  correct: boolean;
  feedback: string;
}

export interface StableLesson {
  id: string;
  conceptId: string;
  day: number;
  estimatedMinutes: number;
  promptGoal: string;
  choices: LessonChoice[];
}

export interface GeneratedLesson {
  title: string;
  hook: string;
  explanation: string;
  analogy: string;
  recallPrompt: string;
  completionFeedback: string;
}

export interface FeedAuthor {
  id: string;
  displayName: string;
  handle: string;
  role: string;
  stance: "支持派" | "反对派" | "看热闹" | "学习分身";
}

export interface FeedPost {
  id: string;
  conceptId: string;
  author: FeedAuthor;
  body: string;
  hook: string;
  metricText: string;
  learnCta: string;
  createdAtLabel: string;
}

export interface FeedComment {
  id: string;
  author: FeedAuthor;
  body: string;
  heat: number;
  stance: "赞成" | "反对" | "补充" | "挑刺";
  replies?: FeedCommentReply[];
  // Community API flag: this comment was written by the post author (OP).
  isOp?: boolean;
}

export interface FeedCommentReply {
  id: string;
  author: FeedAuthor;
  body: string;
  heat: number;
  replyToCommentId: string;
  relation: "追问" | "补充" | "反驳";
  quote?: string;
  source?: "llm" | "repair";
  // Community comment trees nest up to 3 levels (spec section 13); bundle
  // replies stay flat, so this stays optional.
  replies?: FeedCommentReply[];
  // Community API flag: this reply was written by the post author.
  isOp?: boolean;
}

export interface ShadowDraft {
  id: string;
  conceptId: string;
  generationSource?: GenerationSource;
  body: string;
  confidence: number;
  status: "draft" | "approved";
}

export interface ReplyTarget {
  kind: "post" | "comment" | "reply";
  authorName: string;
  excerpt: string;
  // Community comment id, set when the reply targets a community comment.
  commentId?: string;
}

export interface LocalReply {
  body: string;
  target?: ReplyTarget;
}

export interface GeneratedKnowledgeBundle {
  source: GenerationSource;
  conceptId: string;
  generatedAt: string;
  lesson: GeneratedLesson;
  post: FeedPost;
  comments: FeedComment[];
  shadowDraft: ShadowDraft;
}

export interface DailyMission {
  conceptId: string;
  lessonId: string;
  title: string;
  minutes: number;
  reason: string;
}

export interface TopicProfile {
  topicId: string;
  title: string;
  userRawGoal: string;
  targetDepth: TargetDepth;
  language: "zh-CN";
  dayCount: 7;
}

export interface LearnerProfile {
  background: string;
  knownAreas: string[];
  avoidedStyles: string[];
  dailyMinutes: 3 | 5 | 10 | 15;
  motivation: string;
  preferredTone: PreferredTone;
}

export interface ResearchSource {
  title: string;
  url: string;
  publisher?: string;
  publishedAt?: string;
  retrievedAt: string;
  summary: string;
  reliabilityNote: string;
  qualityScore?: number;
  qualitySignals?: string[];
  factReviewStatus?: "planning-only" | "needs-review";
}

export interface ResearchBrief {
  topic: string;
  querySet: string[];
  sources: ResearchSource[];
  keyIdeas: string[];
  disputedIdeas: string[];
  beginnerPitfalls: string[];
  source: "web" | "fallback";
}

export interface OnboardingInput {
  topicTitle: string;
  background: string;
  avoidedStyles?: string;
  goal: string;
  dailyMinutes: 3 | 5 | 10 | 15;
  targetDepth: TargetDepth;
  preferredTone: PreferredTone;
}

export interface GeneratedCurriculumDraft {
  title: string;
  promise: string;
  days: Array<{
    day: number;
    title: string;
    whyNow: string;
    concepts: Array<{
      temporaryName: string;
      plainLanguageGoal: string;
      prerequisiteNames: string[];
      misconceptionToFix: string;
      feedHook: string;
      sourceUrls: string[];
    }>;
  }>;
}

export interface ValidatedCurriculum {
  curriculumId: string;
  source: CurriculumSource;
  topic: TopicProfile;
  learner: LearnerProfile;
  researchBrief?: ResearchBrief;
  title: string;
  promise: string;
  concepts: Concept[];
  lessons: StableLesson[];
}

export interface ProgressState {
  activeTopic: string;
  streak: number;
  xp: number;
  completedLessonIds: string[];
  conceptMastery: Record<string, number>;
  lastCompletedConceptId?: string;
  reviewQueue: string[];
}

export interface ColearningAgent {
  agentId: string;
  displayName: string;
  handle: string;
  bio: string;
}

export interface ColearningPost {
  postId: string;
  conceptId: string;
  agentId: string | null;
  author: ColearningAgent | null;
  content: string;
  stance: string;
  heat: number;
  commentCount: number;
  likeCount: number;
  dislikeCount: number;
  createdAt: string;
}

export interface ColearningComment {
  commentId: string;
  parentCommentId: string | null;
  agentId: string | null;
  author: ColearningAgent | null;
  content: string;
  stance: string;
  relation: string;
  heat: number;
  likeCount: number;
  dislikeCount: number;
  createdAt: string;
  replies: ColearningComment[];
}

export interface ColearningWorld {
  worldId: string;
  agents: ColearningAgent[];
}

export interface AppState {
  topicProfile?: TopicProfile;
  learnerProfile?: LearnerProfile;
  researchBrief?: ResearchBrief;
  curriculum?: ValidatedCurriculum;
  progress: ProgressState;
  shadowDrafts: ShadowDraft[];
  approvedShadowPosts: ShadowDraft[];
  postReplies: Record<string, LocalReply[]>;
  colearningWorldId?: string;
  communityWorldId?: string;
}

export interface LessonResult {
  lessonId: string;
  conceptId: string;
  selectedChoiceId: string;
  freeResponse: string;
  completedAt: string;
}
