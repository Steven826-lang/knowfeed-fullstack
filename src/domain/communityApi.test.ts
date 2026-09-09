import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildCommunityFeedContext,
  createCommunityComment,
  createCommunityPost,
  createCommunityWorld,
  fetchCommunityAgent,
  fetchCommunityFeed,
  fetchCommunityPost,
  fetchCommunityStatus,
  followCommunityAgent,
  formatCommunityTime,
  loadFeedPreferences,
  loadSeenPostIds,
  markPostSeen,
  reactToCommunityTarget,
  recordFeedPreferences,
  triggerCommunityTick,
} from "./communityApi";
import type { AppState } from "./types";

function jsonResponse(value: unknown, ok = true, status = ok ? 200 : 500) {
  return { ok, status, json: async () => value } as Response;
}

const baseState: AppState = {
  curriculum: {
    curriculumId: "c1",
    source: "planner",
    topic: {
      topicId: "topic-1",
      title: "Fintech 入门",
      userRawGoal: "看懂行业讨论",
      targetDepth: "conversational",
      language: "zh-CN",
      dayCount: 7,
    },
    learner: {
      background: "AI 工程师",
      knownAreas: ["支付"],
      avoidedStyles: ["太数学"],
      dailyMinutes: 5,
      motivation: "跳槽面试",
      preferredTone: "debate-heavy",
    },
    title: "Fintech 入门",
    promise: "7 天看懂",
    concepts: [],
    lessons: [],
  },
  progress: {
    activeTopic: "Fintech 入门",
    streak: 1,
    xp: 10,
    completedLessonIds: [],
    conceptMastery: {},
    reviewQueue: ["concept-9"],
  },
  shadowDrafts: [],
  approvedShadowPosts: [],
  postReplies: {},
};

describe("communityApi", () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.restoreAllMocks();
  });

  it("creates a community world with snake_case payload and maps the response", async () => {
    const fetchMock = vi.fn(async (_url: unknown, _init?: RequestInit) =>
      jsonResponse({ world_id: "w1", restored: false, agent_count: 28, initialization_scheduled: true, status: "active" }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const world = await createCommunityWorld({
      sessionKey: "topic-1",
      topicId: "topic-1",
      topicTitle: "Fintech 入门",
      currentConceptId: "concept-1",
      conceptIds: ["concept-1", "concept-2"],
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/community/worlds",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          session_key: "topic-1",
          topic_id: "topic-1",
          topic_title: "Fintech 入门",
          current_concept_id: "concept-1",
          concept_ids: ["concept-1", "concept-2"],
          concept_title: null,
        }),
      }),
    );
    expect(world).toEqual({ worldId: "w1", restored: false, agentCount: 28, initializationScheduled: true, status: "active" });
  });

  it("posts the feed context and maps posts, cursor and briefing", async () => {
    const fetchMock = vi.fn(async (_url: unknown, _init?: RequestInit) =>
      jsonResponse({
        world_id: "w1",
        posts: [
          {
            post_id: "p1",
            concept_id: "concept-1",
            agent_id: "a1",
            user_id: null,
            author: { display_name: "资料哥", handle: "@data_guy" },
            content: "热帖内容",
            stance: "sharing",
            heat: 42,
            is_hot: true,
            comment_count: 18,
            like_count: 9,
            dislike_count: 1,
            created_at: "2026-07-16T10:00:00Z",
            score: 0.87,
            reason: "🔥 热帖 · 讨论很激烈",
            reason_code: "hot",
            signals: { interest: 0.5, popularity: 0.9 },
          },
        ],
        next_cursor: "cursor-2",
        briefing: { new_hot_posts: 3, relevant_discussions: 2, delta_moments: 1, summary: "你不在的时候：3 个新热帖" },
        ticked: true,
        tick_mode: "briefing",
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    window.localStorage.setItem("knowfeed.community.seen-posts.v1", JSON.stringify(["p0"]));

    const ctx = buildCommunityFeedContext(baseState, "concept-1", { limit: 10 });
    const page = await fetchCommunityFeed("w1", ctx);

    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(fetchMock.mock.calls[0][0]).toBe("/api/community/worlds/w1/feed");
    const body = JSON.parse(String(init.body));
    expect(body).toMatchObject({
      background: "AI 工程师",
      goal: "看懂行业讨论",
      motivation: "跳槽面试",
      known_areas: ["支付"],
      avoided_styles: ["太数学"],
      review_queue: ["concept-9"],
      current_concept_id: "concept-1",
      seen_post_ids: ["p0"],
      preferences: [],
      limit: 10,
      cursor: null,
    });
    expect(page.posts).toHaveLength(1);
    expect(page.posts[0]).toMatchObject({
      postId: "p1",
      author: { displayName: "资料哥", handle: "@data_guy" },
      isHot: true,
      reasonCode: "hot",
      likeCount: 9,
    });
    expect(page.nextCursor).toBe("cursor-2");
    expect(page.briefing).toEqual({ newHotPosts: 3, relevantDiscussions: 2, deltaMoments: 1, summary: "你不在的时候：3 个新热帖" });
    expect(page.ticked).toBe(true);
    expect(page.tickMode).toBe("briefing");
  });

  it("fetches a post detail and maps the nested comment tree with OP flags", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: unknown, _init?: RequestInit) =>
        jsonResponse({
          post_id: "p1",
          world_id: "w1",
          concept_id: "concept-1",
          agent_id: "a1",
          user_id: null,
          author: { agent_id: "a1", display_name: "资料哥", handle: "@data_guy", bio: "爱甩资料" },
          content: "帖子正文",
          stance: "sharing",
          post_status: "active",
          is_hot: true,
          heat: 10,
          comment_count: 2,
          like_count: 3,
          dislike_count: 0,
          created_at: "2026-07-16T10:00:00Z",
          comments: [
            {
              comment_id: "c1",
              parent_comment_id: null,
              agent_id: "a2",
              user_id: null,
              author: { agent_id: "a2", display_name: "怀疑论者99", handle: "@skeptic_99", bio: "先别急着下结论" },
              content: "一楼",
              stance: "opposing",
              relation: "反驳",
              thread_path: "1",
              heat: 5,
              like_count: 2,
              dislike_count: 0,
              is_op: false,
              created_at: "2026-07-16T10:01:00Z",
              replies: [
                {
                  comment_id: "c2",
                  parent_comment_id: "c1",
                  agent_id: "a1",
                  user_id: null,
                  author: { agent_id: "a1", display_name: "资料哥", handle: "@data_guy", bio: "爱甩资料" },
                  content: "楼主回应",
                  stance: "supportive",
                  relation: "补充",
                  thread_path: "1/1",
                  heat: 3,
                  like_count: 1,
                  dislike_count: 0,
                  is_op: true,
                  created_at: "2026-07-16T10:02:00Z",
                  replies: [],
                },
              ],
            },
          ],
        }),
      ),
    );

    const detail = await fetchCommunityPost("p1");

    expect(detail.postId).toBe("p1");
    expect(detail.author?.displayName).toBe("资料哥");
    expect(detail.comments).toHaveLength(1);
    expect(detail.comments[0].replies[0]).toMatchObject({ commentId: "c2", isOp: true, threadPath: "1/1" });
    expect(detail.comments[0].replies[0].author?.agentId).toBe("a1");
  });

  it("creates a user post and returns the awaiting status", async () => {
    const fetchMock = vi.fn(async (_url: unknown, _init?: RequestInit) =>
      jsonResponse({ post_id: "p9", world_id: "w1", status: "awaiting_responses", created_at: "2026-07-16T12:00:00Z" }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await createCommunityPost({ worldId: "w1", userId: "topic-1", content: "我的问题", stance: "question", conceptId: "concept-1" });

    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toEqual({
      world_id: "w1",
      user_id: "topic-1",
      content: "我的问题",
      stance: "question",
      concept_id: "concept-1",
    });
    expect(result).toEqual({ postId: "p9", worldId: "w1", status: "awaiting_responses", createdAt: "2026-07-16T12:00:00Z" });
  });

  it("creates a user comment with an optional parent", async () => {
    const fetchMock = vi.fn(async (_url: unknown, _init?: RequestInit) =>
      jsonResponse({ comment_id: "c9", post_id: "p1", thread_path: "2/1", status: "awaiting_responses", created_at: "2026-07-16T12:00:00Z" }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await createCommunityComment({ postId: "p1", userId: "topic-1", content: "我的回复", parentCommentId: "c2" });

    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toEqual({
      post_id: "p1",
      user_id: "topic-1",
      content: "我的回复",
      parent_comment_id: "c2",
      stance: "neutral",
    });
    expect(result.commentId).toBe("c9");
    expect(result.threadPath).toBe("2/1");
  });

  it("sends reactions and reads back the updated counts", async () => {
    const fetchMock = vi.fn(async (_url: unknown, _init?: RequestInit) =>
      jsonResponse({ ok: true, target_type: "post", target_id: "p1", user_reaction: "like", like_count: 11, dislike_count: 2 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await reactToCommunityTarget({ targetType: "post", targetId: "p1", userId: "topic-1", reactionType: "like" });

    expect(fetchMock.mock.calls[0][0]).toBe("/api/community/reactions");
    expect(result).toMatchObject({ userReaction: "like", likeCount: 11, dislikeCount: 2 });
  });

  it("triggers a manual tick and reports a busy world", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: unknown, _init?: RequestInit) => jsonResponse({ world_id: "w1", ticked: false, reason: "tick_already_running", result: null })),
    );

    const result = await triggerCommunityTick("w1");

    expect(result).toEqual({ worldId: "w1", ticked: false, reason: "tick_already_running", result: null });
  });

  it("fetches an agent profile with persona and recent activity", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: unknown, _init?: RequestInit) =>
        jsonResponse({
          agent_id: "a1",
          display_name: "资料哥",
          handle: "@data_guy",
          bio: "爱甩资料",
          persona: { role: "研究生", traits: ["较真"], catchphrase: "资料呢？" },
          karma: 128,
          post_count: 6,
          comment_count: 40,
          follower_count: 3,
          is_ai: true,
          last_active_at: "2026-07-16T11:00:00Z",
          created_at: "2026-07-10T08:00:00Z",
          recent_posts: [{ post_id: "p1", content: "帖子", stance: "sharing", created_at: "2026-07-16T09:00:00Z" }],
          recent_comments: [{ comment_id: "c1", post_id: "p2", content: "评论", stance: "neutral", created_at: "2026-07-16T09:30:00Z" }],
        }),
      ),
    );

    const profile = await fetchCommunityAgent("a1");

    expect(profile).toMatchObject({
      agentId: "a1",
      displayName: "资料哥",
      karma: 128,
      followerCount: 3,
      isAi: true,
    });
    expect(profile.persona).toMatchObject({ role: "研究生", catchphrase: "资料呢？" });
    expect(profile.recentPosts[0].postId).toBe("p1");
    expect(profile.recentComments[0].postId).toBe("p2");
  });

  it("follows and unfollows an agent", async () => {
    const fetchMock = vi.fn(async (_url: unknown, _init?: RequestInit) => jsonResponse({ ok: true, followed: false, follower_count: 2 }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await followCommunityAgent({ userId: "topic-1", agentId: "a1", follow: false });

    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toEqual({ user_id: "topic-1", agent_id: "a1", follow: false });
    expect(result).toEqual({ ok: true, followed: false, followerCount: 2 });
  });

  it("fetches the community status counters", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: unknown, _init?: RequestInit) =>
        jsonResponse({
          world_id: "w1",
          topic_id: "topic-1",
          topic_title: "Fintech 入门",
          current_concept_id: "concept-1",
          status: "active",
          agent_count: 28,
          post_count: 15,
          comment_count: 210,
          reaction_count: 90,
          follow_count: 4,
          last_tick_at: "2026-07-16T11:00:00Z",
          needs_initialization: false,
          catchup_mode: "normal",
        }),
      ),
    );

    const status = await fetchCommunityStatus("w1");

    expect(status).toMatchObject({ worldId: "w1", agentCount: 28, commentCount: 210, catchupMode: "normal" });
  });

  it("throws with the server detail message on failure", async () => {
    vi.stubGlobal("fetch", vi.fn(async (_url: unknown, _init?: RequestInit) => jsonResponse({ detail: "World not found" }, false, 404)));

    await expect(fetchCommunityPost("missing")).rejects.toThrow("World not found");
  });

  it("tracks seen posts in localStorage with dedupe and a cap", () => {
    markPostSeen("p1");
    markPostSeen("p2");
    markPostSeen("p1");
    expect(loadSeenPostIds()).toEqual(["p2", "p1"]);

    for (let index = 0; index < 600; index += 1) markPostSeen(`px-${index}`);
    expect(loadSeenPostIds().length).toBe(500);
  });

  it("builds the feed context from AppState and seen posts", () => {
    markPostSeen("p1");
    const ctx = buildCommunityFeedContext(baseState, null, { cursor: "abc" });
    expect(ctx.currentConceptId).toBeNull();
    expect(ctx.seenPostIds).toEqual(["p1"]);
    expect(ctx.cursor).toBe("abc");
    expect(ctx.reviewQueue).toEqual(["concept-9"]);
  });

  it("persists feed preferences with dedupe, refresh ordering and a cap", () => {
    recordFeedPreferences([
      { preference_type: "like_topic", target_value: "concept-1", strength: 1 },
      { preference_type: "like_author", target_value: "@data_guy", strength: 1 },
    ]);
    expect(loadFeedPreferences()).toHaveLength(2);

    // Re-recording the same type+target refreshes the entry instead of duplicating it.
    recordFeedPreferences([{ preference_type: "like_topic", target_value: "concept-1", strength: 2 }]);
    expect(loadFeedPreferences()).toEqual([
      { preference_type: "like_author", target_value: "@data_guy", strength: 1 },
      { preference_type: "like_topic", target_value: "concept-1", strength: 2 },
    ]);

    for (let index = 0; index < 120; index += 1) {
      recordFeedPreferences([{ preference_type: "dislike_topic", target_value: `concept-x-${index}`, strength: 1 }]);
    }
    expect(loadFeedPreferences()).toHaveLength(100);
  });

  it("drops malformed preference entries when loading", () => {
    window.localStorage.setItem(
      "knowfeed.community.preferences.v1",
      JSON.stringify([
        { preference_type: "like_topic", target_value: "concept-1", strength: 1 },
        { preference_type: "bogus", target_value: "x", strength: 1 },
        { preference_type: "like_author", target_value: "", strength: 1 },
        { preference_type: "dislike_stance", target_value: "opposing", strength: "strong" },
        "not-an-object",
      ]),
    );
    expect(loadFeedPreferences()).toEqual([{ preference_type: "like_topic", target_value: "concept-1", strength: 1 }]);
  });

  it("merges stored preferences into the feed context", () => {
    recordFeedPreferences([{ preference_type: "dislike_stance", target_value: "opposing", strength: 1 }]);
    const ctx = buildCommunityFeedContext(baseState, "concept-1");
    expect(ctx.preferences).toEqual([{ preference_type: "dislike_stance", target_value: "opposing", strength: 1 }]);
  });

  it("formats relative timestamps", () => {
    const now = Date.now();
    expect(formatCommunityTime(new Date(now - 30 * 1000).toISOString())).toBe("刚刚");
    expect(formatCommunityTime(new Date(now - 5 * 60 * 1000).toISOString())).toBe("5 分钟前");
    expect(formatCommunityTime(new Date(now - 3 * 3600 * 1000).toISOString())).toBe("3 小时前");
    expect(formatCommunityTime(new Date(now - 2 * 86400 * 1000).toISOString())).toBe("2 天前");
    expect(formatCommunityTime("not-a-date")).toBe("not-a-date");
  });
});
