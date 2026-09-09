import type { AppState } from "./types";

// Learning community API layer (spec section 9). All calls go through
// relative /api/community/* paths, forwarded by the vite/llm proxy to the
// FastAPI community engine. Payloads are snake_case on the wire (aligned
// with server/colearning/models.py) and camelCase in this module's types.

export type CommunityStance = "supportive" | "opposing" | "neutral" | "question" | "sharing";
export type CommunityReasonCode = "followed_author" | "concept" | "review" | "hot" | "new";

export interface CommunityAuthor {
  agentId: string;
  displayName: string;
  handle: string;
  bio: string;
}

export interface CommunityFeedAuthor {
  displayName: string | null;
  handle: string | null;
}

export interface CommunityFeedPost {
  postId: string;
  conceptId: string;
  agentId: string | null;
  userId: string | null;
  author: CommunityFeedAuthor | null;
  content: string;
  stance: string;
  heat: number;
  isHot: boolean;
  commentCount: number;
  likeCount: number;
  dislikeCount: number;
  createdAt: string;
  score: number;
  reason: string;
  reasonCode: string;
  signals: Record<string, number>;
}

export interface CommunityBriefing {
  newHotPosts: number;
  relevantDiscussions: number;
  deltaMoments: number;
  summary: string;
}

export interface CommunityFeedPage {
  worldId: string;
  posts: CommunityFeedPost[];
  nextCursor: string | null;
  briefing: CommunityBriefing | null;
  ticked: boolean;
  tickMode: string | null;
}

export interface CommunityComment {
  commentId: string;
  parentCommentId: string | null;
  agentId: string | null;
  userId: string | null;
  author: CommunityAuthor | null;
  content: string;
  stance: string;
  relation: string;
  threadPath: string | null;
  heat: number;
  likeCount: number;
  dislikeCount: number;
  isOp: boolean;
  createdAt: string;
  replies: CommunityComment[];
}

export interface CommunityPostDetail {
  postId: string;
  worldId: string;
  conceptId: string;
  agentId: string | null;
  userId: string | null;
  author: CommunityAuthor | null;
  content: string;
  stance: string;
  postStatus: string | null;
  isHot: boolean;
  heat: number;
  commentCount: number;
  likeCount: number;
  dislikeCount: number;
  createdAt: string;
  comments: CommunityComment[];
}

export interface CommunityWorld {
  worldId: string;
  restored: boolean;
  agentCount: number;
  initializationScheduled: boolean;
  status: string;
}

export interface CommunityFeedContext {
  background: string;
  goal: string;
  motivation: string;
  knownAreas: string[];
  avoidedStyles: string[];
  reviewQueue: unknown[];
  currentConceptId: string | null;
  seenPostIds: string[];
  preferences: CommunityPreference[];
  limit?: number;
  cursor?: string | null;
}

// Recommendation feedback (spec 7.3 多推/少推). Kept snake_case because these
// objects are sent verbatim as UserContext.preferences and mirror the
// user_preferences table: {"preference_type", "target_value", "strength"}.
export type CommunityPreferenceType = "like_topic" | "dislike_topic" | "like_author" | "dislike_stance";

export interface CommunityPreference {
  preference_type: CommunityPreferenceType;
  target_value: string;
  strength: number;
}

export interface CommunityNewPostResult {
  postId: string;
  worldId: string;
  status: string;
  createdAt: string;
}

export interface CommunityNewCommentResult {
  commentId: string;
  postId: string;
  threadPath: string;
  status: string;
  createdAt: string;
}

export interface CommunityReactionResult {
  ok: boolean;
  targetType: string;
  targetId: string;
  userReaction: string;
  likeCount: number;
  dislikeCount: number;
}

export interface CommunityTickResult {
  worldId: string;
  ticked: boolean;
  reason: string | null;
  result: Record<string, unknown> | null;
}

export interface CommunityAgentPostItem {
  postId: string;
  content: string;
  stance: string;
  createdAt: string;
}

export interface CommunityAgentCommentItem {
  commentId: string;
  postId: string;
  content: string;
  stance: string;
  createdAt: string;
}

export interface CommunityAgentProfile {
  agentId: string;
  displayName: string;
  handle: string;
  bio: string;
  persona: Record<string, unknown>;
  karma: number;
  postCount: number;
  commentCount: number;
  followerCount: number;
  isAi: boolean;
  lastActiveAt: string | null;
  createdAt: string;
  recentPosts: CommunityAgentPostItem[];
  recentComments: CommunityAgentCommentItem[];
}

export interface CommunityStatus {
  worldId: string;
  topicId: string;
  topicTitle: string;
  currentConceptId: string | null;
  status: string;
  agentCount: number;
  postCount: number;
  commentCount: number;
  reactionCount: number;
  followCount: number;
  lastTickAt: string | null;
  needsInitialization: boolean | null;
  catchupMode: string | null;
}

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, init);
  if (!response.ok) {
    let detail = `${response.status}`;
    try {
      const payload = await response.json();
      if (payload && typeof payload.detail === "string") detail = payload.detail;
    } catch {
      // keep the status code as the detail
    }
    throw new Error(`Community API 请求失败：${detail}`);
  }
  return (await response.json()) as T;
}

function postJson<T>(path: string, body: unknown): Promise<T> {
  return requestJson<T>(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function mapAuthor(raw: { agent_id: string; display_name: string; handle: string; bio: string } | null): CommunityAuthor | null {
  if (!raw) return null;
  return { agentId: raw.agent_id, displayName: raw.display_name, handle: raw.handle, bio: raw.bio };
}

function mapComment(raw: Record<string, unknown>): CommunityComment {
  return {
    commentId: String(raw.comment_id),
    parentCommentId: (raw.parent_comment_id as string | null) ?? null,
    agentId: (raw.agent_id as string | null) ?? null,
    userId: (raw.user_id as string | null) ?? null,
    author: mapAuthor(raw.author as { agent_id: string; display_name: string; handle: string; bio: string } | null),
    content: String(raw.content ?? ""),
    stance: String(raw.stance ?? "neutral"),
    relation: String(raw.relation ?? ""),
    threadPath: (raw.thread_path as string | null) ?? null,
    heat: Number(raw.heat ?? 0),
    likeCount: Number(raw.like_count ?? 0),
    dislikeCount: Number(raw.dislike_count ?? 0),
    isOp: Boolean(raw.is_op),
    createdAt: String(raw.created_at ?? ""),
    replies: Array.isArray(raw.replies) ? (raw.replies as Record<string, unknown>[]).map(mapComment) : [],
  };
}

export async function createCommunityWorld(input: {
  sessionKey: string;
  topicId: string;
  topicTitle: string;
  currentConceptId?: string;
  conceptIds?: string[];
  conceptTitle?: string;
}): Promise<CommunityWorld> {
  const payload = await postJson<Record<string, unknown>>("/api/community/worlds", {
    session_key: input.sessionKey,
    topic_id: input.topicId,
    topic_title: input.topicTitle,
    current_concept_id: input.currentConceptId ?? null,
    concept_ids: input.conceptIds ?? [],
    concept_title: input.conceptTitle ?? null,
  });
  return {
    worldId: String(payload.world_id),
    restored: Boolean(payload.restored),
    agentCount: Number(payload.agent_count ?? 0),
    initializationScheduled: Boolean(payload.initialization_scheduled),
    status: String(payload.status ?? "active"),
  };
}

export async function fetchCommunityFeed(worldId: string, ctx: CommunityFeedContext): Promise<CommunityFeedPage> {
  const payload = await postJson<Record<string, unknown>>(
    `/api/community/worlds/${encodeURIComponent(worldId)}/feed`,
    {
      background: ctx.background,
      goal: ctx.goal,
      motivation: ctx.motivation,
      known_areas: ctx.knownAreas,
      avoided_styles: ctx.avoidedStyles,
      review_queue: ctx.reviewQueue,
      current_concept_id: ctx.currentConceptId,
      seen_post_ids: ctx.seenPostIds,
      preferences: ctx.preferences,
      limit: ctx.limit ?? 10,
      cursor: ctx.cursor ?? null,
    },
  );
  const briefing = payload.briefing as Record<string, unknown> | null;
  return {
    worldId: String(payload.world_id),
    posts: ((payload.posts as Record<string, unknown>[]) ?? []).map((raw) => {
      const author = raw.author as { display_name: string | null; handle: string | null } | null;
      return {
        postId: String(raw.post_id),
        conceptId: String(raw.concept_id),
        agentId: (raw.agent_id as string | null) ?? null,
        userId: (raw.user_id as string | null) ?? null,
        author: author ? { displayName: author.display_name, handle: author.handle } : null,
        content: String(raw.content ?? ""),
        stance: String(raw.stance ?? "neutral"),
        heat: Number(raw.heat ?? 0),
        isHot: Boolean(raw.is_hot),
        commentCount: Number(raw.comment_count ?? 0),
        likeCount: Number(raw.like_count ?? 0),
        dislikeCount: Number(raw.dislike_count ?? 0),
        createdAt: String(raw.created_at ?? ""),
        score: Number(raw.score ?? 0),
        reason: String(raw.reason ?? ""),
        reasonCode: String(raw.reason_code ?? ""),
        signals: (raw.signals as Record<string, number>) ?? {},
      };
    }),
    nextCursor: (payload.next_cursor as string | null) ?? null,
    briefing: briefing
      ? {
          newHotPosts: Number(briefing.new_hot_posts ?? 0),
          relevantDiscussions: Number(briefing.relevant_discussions ?? 0),
          deltaMoments: Number(briefing.delta_moments ?? 0),
          summary: String(briefing.summary ?? ""),
        }
      : null,
    ticked: Boolean(payload.ticked),
    tickMode: (payload.tick_mode as string | null) ?? null,
  };
}

export async function fetchCommunityPost(postId: string): Promise<CommunityPostDetail> {
  const payload = await requestJson<Record<string, unknown>>(
    `/api/community/posts/${encodeURIComponent(postId)}`,
  );
  return {
    postId: String(payload.post_id),
    worldId: String(payload.world_id),
    conceptId: String(payload.concept_id),
    agentId: (payload.agent_id as string | null) ?? null,
    userId: (payload.user_id as string | null) ?? null,
    author: mapAuthor(payload.author as { agent_id: string; display_name: string; handle: string; bio: string } | null),
    content: String(payload.content ?? ""),
    stance: String(payload.stance ?? "neutral"),
    postStatus: (payload.post_status as string | null) ?? null,
    isHot: Boolean(payload.is_hot),
    heat: Number(payload.heat ?? 0),
    commentCount: Number(payload.comment_count ?? 0),
    likeCount: Number(payload.like_count ?? 0),
    dislikeCount: Number(payload.dislike_count ?? 0),
    createdAt: String(payload.created_at ?? ""),
    comments: ((payload.comments as Record<string, unknown>[]) ?? []).map(mapComment),
  };
}

export async function createCommunityPost(input: {
  worldId: string;
  userId: string;
  content: string;
  stance: CommunityStance;
  conceptId?: string;
}): Promise<CommunityNewPostResult> {
  const payload = await postJson<Record<string, unknown>>("/api/community/posts", {
    world_id: input.worldId,
    user_id: input.userId,
    content: input.content,
    stance: input.stance,
    concept_id: input.conceptId ?? null,
  });
  return {
    postId: String(payload.post_id),
    worldId: String(payload.world_id),
    status: String(payload.status ?? ""),
    createdAt: String(payload.created_at ?? ""),
  };
}

export async function createCommunityComment(input: {
  postId: string;
  userId: string;
  content: string;
  parentCommentId?: string;
  stance?: CommunityStance;
}): Promise<CommunityNewCommentResult> {
  const payload = await postJson<Record<string, unknown>>("/api/community/comments", {
    post_id: input.postId,
    user_id: input.userId,
    content: input.content,
    parent_comment_id: input.parentCommentId ?? null,
    stance: input.stance ?? "neutral",
  });
  return {
    commentId: String(payload.comment_id),
    postId: String(payload.post_id),
    threadPath: String(payload.thread_path ?? ""),
    status: String(payload.status ?? ""),
    createdAt: String(payload.created_at ?? ""),
  };
}

export async function reactToCommunityTarget(input: {
  targetType: "post" | "comment";
  targetId: string;
  userId: string;
  reactionType: "like" | "dislike";
}): Promise<CommunityReactionResult> {
  const payload = await postJson<Record<string, unknown>>("/api/community/reactions", {
    target_type: input.targetType,
    target_id: input.targetId,
    user_id: input.userId,
    reaction_type: input.reactionType,
  });
  return {
    ok: Boolean(payload.ok),
    targetType: String(payload.target_type ?? input.targetType),
    targetId: String(payload.target_id ?? input.targetId),
    userReaction: String(payload.user_reaction ?? input.reactionType),
    likeCount: Number(payload.like_count ?? 0),
    dislikeCount: Number(payload.dislike_count ?? 0),
  };
}

export async function triggerCommunityTick(worldId: string): Promise<CommunityTickResult> {
  const payload = await postJson<Record<string, unknown>>(
    `/api/community/worlds/${encodeURIComponent(worldId)}/tick`,
    {},
  );
  return {
    worldId: String(payload.world_id),
    ticked: Boolean(payload.ticked),
    reason: (payload.reason as string | null) ?? null,
    result: (payload.result as Record<string, unknown> | null) ?? null,
  };
}

export async function initializeCommunityWorld(
  worldId: string,
): Promise<{ worldId: string; scheduled: boolean; alreadyInitialized: boolean }> {
  const payload = await postJson<Record<string, unknown>>(
    `/api/community/worlds/${encodeURIComponent(worldId)}/initialize`,
    {},
  );
  return {
    worldId: String(payload.world_id),
    scheduled: Boolean(payload.scheduled),
    alreadyInitialized: Boolean(payload.already_initialized),
  };
}

export async function fetchCommunityAgent(agentId: string): Promise<CommunityAgentProfile> {
  const payload = await requestJson<Record<string, unknown>>(
    `/api/community/agents/${encodeURIComponent(agentId)}`,
  );
  const mapPost = (raw: Record<string, unknown>): CommunityAgentPostItem => ({
    postId: String(raw.post_id),
    content: String(raw.content ?? ""),
    stance: String(raw.stance ?? ""),
    createdAt: String(raw.created_at ?? ""),
  });
  const mapAgentComment = (raw: Record<string, unknown>): CommunityAgentCommentItem => ({
    commentId: String(raw.comment_id),
    postId: String(raw.post_id),
    content: String(raw.content ?? ""),
    stance: String(raw.stance ?? ""),
    createdAt: String(raw.created_at ?? ""),
  });
  return {
    agentId: String(payload.agent_id),
    displayName: String(payload.display_name ?? ""),
    handle: String(payload.handle ?? ""),
    bio: String(payload.bio ?? ""),
    persona: (payload.persona as Record<string, unknown>) ?? {},
    karma: Number(payload.karma ?? 0),
    postCount: Number(payload.post_count ?? 0),
    commentCount: Number(payload.comment_count ?? 0),
    followerCount: Number(payload.follower_count ?? 0),
    isAi: Boolean(payload.is_ai ?? true),
    lastActiveAt: (payload.last_active_at as string | null) ?? null,
    createdAt: String(payload.created_at ?? ""),
    recentPosts: ((payload.recent_posts as Record<string, unknown>[]) ?? []).map(mapPost),
    recentComments: ((payload.recent_comments as Record<string, unknown>[]) ?? []).map(mapAgentComment),
  };
}

export async function followCommunityAgent(input: {
  userId: string;
  agentId: string;
  follow: boolean;
}): Promise<{ ok: boolean; followed: boolean; followerCount: number }> {
  const payload = await postJson<Record<string, unknown>>("/api/community/follows", {
    user_id: input.userId,
    agent_id: input.agentId,
    follow: input.follow,
  });
  return {
    ok: Boolean(payload.ok),
    followed: Boolean(payload.followed),
    followerCount: Number(payload.follower_count ?? 0),
  };
}

export async function fetchCommunityStatus(worldId: string): Promise<CommunityStatus> {
  const payload = await requestJson<Record<string, unknown>>(
    `/api/community/worlds/${encodeURIComponent(worldId)}/status`,
  );
  return {
    worldId: String(payload.world_id),
    topicId: String(payload.topic_id ?? ""),
    topicTitle: String(payload.topic_title ?? ""),
    currentConceptId: (payload.current_concept_id as string | null) ?? null,
    status: String(payload.status ?? ""),
    agentCount: Number(payload.agent_count ?? 0),
    postCount: Number(payload.post_count ?? 0),
    commentCount: Number(payload.comment_count ?? 0),
    reactionCount: Number(payload.reaction_count ?? 0),
    followCount: Number(payload.follow_count ?? 0),
    lastTickAt: (payload.last_tick_at as string | null) ?? null,
    needsInitialization: (payload.needs_initialization as boolean | null) ?? null,
    catchupMode: (payload.catchup_mode as string | null) ?? null,
  };
}

// ---------------------------------------------------------------------------
// Client-side helpers: user identity, feed context assembly, seen posts
// ---------------------------------------------------------------------------

const seenPostsStorageKey = "knowfeed.community.seen-posts.v1";
const maxSeenPostIds = 500;
const preferencesStorageKey = "knowfeed.community.preferences.v1";
const maxPreferences = 100;
const preferenceTypes: CommunityPreferenceType[] = ["like_topic", "dislike_topic", "like_author", "dislike_stance"];

/** Stable id for the single local user; mirrors sessionKeyFor in PostDetail. */
export function communityUserId(state: AppState): string {
  return state.curriculum?.topic.topicId ?? "anonymous";
}

/** Assemble the recommender UserContext from existing AppState (spec 7.1). */
export function buildCommunityFeedContext(
  state: AppState,
  currentConceptId: string | null,
  options: { limit?: number; cursor?: string | null } = {},
): CommunityFeedContext {
  const learner = state.curriculum?.learner;
  return {
    background: learner?.background ?? "",
    goal: state.curriculum?.topic.userRawGoal ?? "",
    motivation: learner?.motivation ?? "",
    knownAreas: learner?.knownAreas ?? [],
    avoidedStyles: learner?.avoidedStyles ?? [],
    reviewQueue: state.progress.reviewQueue,
    currentConceptId,
    seenPostIds: loadSeenPostIds(),
    preferences: loadFeedPreferences(),
    limit: options.limit ?? 10,
    cursor: options.cursor ?? null,
  };
}

export function loadSeenPostIds(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(seenPostsStorageKey);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

export function markPostSeen(postId: string): void {
  if (typeof window === "undefined" || !postId) return;
  try {
    const seen = loadSeenPostIds().filter((id) => id !== postId);
    seen.push(postId);
    window.localStorage.setItem(seenPostsStorageKey, JSON.stringify(seen.slice(-maxSeenPostIds)));
  } catch {
    // storage full or unavailable: seen-tracking is best-effort
  }
}

export function loadFeedPreferences(): CommunityPreference[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(preferencesStorageKey);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter(isCommunityPreference) : [];
  } catch {
    return [];
  }
}

/** Persist 多推/少推 feedback (spec 7.3); re-recording the same type+target refreshes it. */
export function recordFeedPreferences(preferences: CommunityPreference[]): CommunityPreference[] {
  const merged = loadFeedPreferences();
  for (const pref of preferences) {
    if (!pref.target_value) continue;
    const existing = merged.findIndex(
      (item) => item.preference_type === pref.preference_type && item.target_value === pref.target_value
    );
    if (existing >= 0) merged.splice(existing, 1);
    merged.push(pref);
  }
  const capped = merged.slice(-maxPreferences);
  if (typeof window === "undefined") return capped;
  try {
    window.localStorage.setItem(preferencesStorageKey, JSON.stringify(capped));
  } catch {
    // storage full or unavailable: preference tracking is best-effort
  }
  return capped;
}

function isCommunityPreference(value: unknown): value is CommunityPreference {
  if (!value || typeof value !== "object") return false;
  const pref = value as Record<string, unknown>;
  return (
    typeof pref.preference_type === "string" &&
    (preferenceTypes as string[]).includes(pref.preference_type) &&
    typeof pref.target_value === "string" &&
    pref.target_value.length > 0 &&
    typeof pref.strength === "number"
  );
}

export function formatCommunityTime(iso: string): string {
  try {
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return iso;
    const diffMinutes = Math.max(0, Math.floor((Date.now() - date.getTime()) / 60000));
    if (diffMinutes < 1) return "刚刚";
    if (diffMinutes < 60) return `${diffMinutes} 分钟前`;
    const diffHours = Math.floor(diffMinutes / 60);
    if (diffHours < 24) return `${diffHours} 小时前`;
    return `${Math.floor(diffHours / 24)} 天前`;
  } catch {
    return iso;
  }
}
