import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AgentProfile } from "./AgentProfile";
import { HomeFeed } from "./HomeFeed";
import { NewPost } from "./NewPost";
import { PostDetail } from "./PostDetail";
import { loadFeedPreferences } from "../domain/communityApi";
import { initializeStateForCurriculum, validateCurriculumDraft } from "../domain/curriculumValidator";
import { buildFallbackBundle } from "../domain/fallbackGenerator";
import { buildProfiles } from "../domain/profileBuilder";
import { buildFallbackResearchBrief } from "../domain/researchEngine";
import { buildFallbackDraft } from "../domain/topicPlanner";
import type { AppState, DailyMission } from "../domain/types";

function jsonResponse(value: unknown, ok = true, status = ok ? 200 : 500) {
  return { ok, status, json: async () => value } as Response;
}

function buildTestState(): AppState {
  const { topicProfile, learnerProfile } = buildProfiles({
    topicTitle: "Fintech 入门",
    background: "AI 工程师",
    goal: "看懂行业讨论",
    dailyMinutes: 5,
    targetDepth: "conversational",
    preferredTone: "debate-heavy"
  });
  const research = buildFallbackResearchBrief(topicProfile, learnerProfile);
  const draft = buildFallbackDraft(topicProfile, learnerProfile, research);
  const curriculum = validateCurriculumDraft(draft, topicProfile, learnerProfile, research, "deterministic-fallback");
  return { ...initializeStateForCurriculum(curriculum), communityWorldId: "w1" };
}

const testState = buildTestState();
const firstConceptId = testState.curriculum?.concepts[0].id ?? "concept-1";

const testMission: DailyMission = {
  conceptId: firstConceptId,
  lessonId: "lesson-1",
  title: "今日微课",
  minutes: 5,
  reason: "今天的学习任务"
};

const testBundle = buildFallbackBundle(testState, firstConceptId);

function feedPostFixture(overrides: Record<string, unknown> = {}) {
  return {
    post_id: "p1",
    concept_id: "concept-1",
    agent_id: "a1",
    user_id: null,
    author: { display_name: "资料哥", handle: "@data_guy" },
    content: "支付系统的信任边界不在技术，在清算网络。",
    stance: "sharing",
    heat: 42,
    is_hot: true,
    comment_count: 18,
    like_count: 9,
    dislike_count: 1,
    created_at: "2026-07-16T10:00:00Z",
    score: 0.87,
    reason: "🎯 和你正在学的“concept-1”相关",
    reason_code: "concept",
    signals: { interest: 0.5 },
    ...overrides
  };
}

function feedResponseFixture(posts: unknown[]) {
  return {
    world_id: "w1",
    posts,
    next_cursor: null,
    briefing: null,
    ticked: false,
    tick_mode: null
  };
}

function postDetailFixture() {
  return {
    post_id: "p1",
    world_id: "w1",
    concept_id: "concept-1",
    agent_id: "a1",
    user_id: null,
    author: { agent_id: "a1", display_name: "资料哥", handle: "@data_guy", bio: "爱甩资料" },
    content: "支付系统的信任边界不在技术，在清算网络。",
    stance: "sharing",
    post_status: "active",
    is_hot: true,
    heat: 42,
    comment_count: 2,
    like_count: 9,
    dislike_count: 1,
    created_at: "2026-07-16T10:00:00Z",
    comments: [
      {
        comment_id: "c1",
        parent_comment_id: null,
        agent_id: "a2",
        user_id: null,
        author: { agent_id: "a2", display_name: "怀疑论者99", handle: "@skeptic_99", bio: "先别急着下结论" },
        content: "清算网络也是技术堆出来的，这个二分法站不住。",
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
            content: "我补个资料：清算网络的信任来自多方对账。",
            stance: "supportive",
            relation: "补充",
            thread_path: "1/1",
            heat: 3,
            like_count: 1,
            dislike_count: 0,
            is_op: true,
            created_at: "2026-07-16T10:02:00Z",
            replies: [
              {
                comment_id: "c3",
                parent_comment_id: "c2",
                agent_id: "a3",
                user_id: null,
                author: { agent_id: "a3", display_name: "类比狂魔", handle: "@analogy_king", bio: "爱打比方" },
                content: "就像球场需要裁判，清算网络就是裁判。",
                stance: "neutral",
                relation: "歪楼",
                thread_path: "1/1/1",
                heat: 1,
                like_count: 0,
                dislike_count: 0,
                is_op: false,
                created_at: "2026-07-16T10:03:00Z",
                replies: []
              }
            ]
          }
        ]
      }
    ]
  };
}

describe("HomeFeed community adaptation", () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.restoreAllMocks();
  });

  function renderHomeFeed(overrides: { onOpenPost?: (postId?: string) => void; onNewPost?: () => void } = {}) {
    const opened: Array<string | undefined> = [];
    render(
      <HomeFeed
        state={testState}
        mission={testMission}
        bundle={testBundle}
        onStartDaily={() => undefined}
        onStartConcept={() => undefined}
        onOpenPost={(postId) => {
          opened.push(postId);
          overrides.onOpenPost?.(postId);
        }}
        onOpenMap={() => undefined}
        onOpenAgent={() => undefined}
        onNewPost={overrides.onNewPost ?? (() => undefined)}
      />
    );
    return opened;
  }

  it("renders the community feed post with reason tag, AI badge and counts", async () => {
    const fetchMock = vi.fn(async (_url: unknown, _init?: RequestInit) => jsonResponse(feedResponseFixture([feedPostFixture()])));
    vi.stubGlobal("fetch", fetchMock);

    renderHomeFeed();

    expect(await screen.findByText("支付系统的信任边界不在技术，在清算网络。")).toBeInTheDocument();
    expect(screen.getByText("🎯 和你正在学的“concept-1”相关")).toBeInTheDocument();
    expect(screen.getAllByText("AI").length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: "评论 18" })).toBeInTheDocument();
    expect(screen.getByText(/9 赞同 · 18 评论/)).toBeInTheDocument();

    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    const body = JSON.parse(String(init.body));
    expect(fetchMock.mock.calls[0][0]).toBe("/api/community/worlds/w1/feed");
    expect(body).toMatchObject({
      background: "AI 工程师",
      goal: "看懂行业讨论",
      current_concept_id: firstConceptId
    });
  });

  it("lists additional community posts below the main card and keeps learning modules", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse(
          feedResponseFixture([
            feedPostFixture(),
            feedPostFixture({ post_id: "p2", content: "风控模型最容易犯的错是过拟合历史。", is_hot: false, reason: "🆕 新帖 · 刚发 5 分钟", reason_code: "new", comment_count: 4, like_count: 2 })
          ])
        )
      )
    );

    renderHomeFeed();

    expect(await screen.findByText("风控模型最容易犯的错是过拟合历史。")).toBeInTheDocument();
    expect(screen.getByText("🆕 新帖 · 刚发 5 分钟")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "💬 4" })).toBeInTheDocument();
    // Learning modules stay in place.
    expect(screen.getByLabelText("今日学习任务")).toBeInTheDocument();
    expect(screen.getByLabelText("学习路径预览")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "直接开始" })).toBeInTheDocument();
  });

  it("falls back to the generated bundle when the community is unreachable", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({}, false, 503)));

    renderHomeFeed();

    await waitFor(() => expect(screen.getByRole("article", { name: "生成的社区讨论" })).toBeInTheDocument());
    expect(screen.getByRole("button", { name: "看懂这条讨论" })).toBeInTheDocument();
  });

  it("opens the new-post screen from the composer entry", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(feedResponseFixture([]))));
    const posted: string[] = [];
    renderHomeFeed({ onNewPost: () => posted.push("new-post") });

    await userEvent.setup().click(screen.getByRole("button", { name: "发帖" }));
    expect(posted).toEqual(["new-post"]);
  });

  it("records 多推这类 feedback, hints the learner and reloads the feed with preferences", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn(async (_url: unknown, _init?: RequestInit) => jsonResponse(feedResponseFixture([feedPostFixture()])));
    vi.stubGlobal("fetch", fetchMock);

    renderHomeFeed();

    expect(await screen.findByText("支付系统的信任边界不在技术，在清算网络。")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "推荐反馈" }));
    expect(screen.getByRole("menu", { name: "推荐反馈选项" })).toBeInTheDocument();
    await user.click(screen.getByRole("menuitem", { name: "多推这类" }));

    expect(await screen.findByText("已调整推荐")).toBeInTheDocument();
    expect(screen.queryByRole("menu", { name: "推荐反馈选项" })).not.toBeInTheDocument();
    expect(loadFeedPreferences()).toEqual([
      { preference_type: "like_topic", target_value: "concept-1", strength: 1 },
      { preference_type: "like_author", target_value: "@data_guy", strength: 1 }
    ]);

    await waitFor(() => expect(fetchMock.mock.calls.length).toBeGreaterThanOrEqual(2));
    const [, init] = fetchMock.mock.calls[1] as unknown as [string, RequestInit];
    expect(JSON.parse(String(init.body)).preferences).toEqual([
      { preference_type: "like_topic", target_value: "concept-1", strength: 1 },
      { preference_type: "like_author", target_value: "@data_guy", strength: 1 }
    ]);
  });

  it("records 少推这类 feedback with the post stance", async () => {
    const user = userEvent.setup();
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(feedResponseFixture([feedPostFixture()]))));

    renderHomeFeed();

    await screen.findByText("支付系统的信任边界不在技术，在清算网络。");
    await user.click(screen.getByRole("button", { name: "推荐反馈" }));
    await user.click(screen.getByRole("menuitem", { name: "少推这类" }));

    expect(await screen.findByText("已调整推荐")).toBeInTheDocument();
    expect(loadFeedPreferences()).toEqual([
      { preference_type: "dislike_topic", target_value: "concept-1", strength: 1 },
      { preference_type: "dislike_stance", target_value: "sharing", strength: 1 }
    ]);
  });

  it("closes the feedback menu from 取消 without recording preferences", async () => {
    const user = userEvent.setup();
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(feedResponseFixture([feedPostFixture()]))));

    renderHomeFeed();

    await screen.findByText("支付系统的信任边界不在技术，在清算网络。");
    await user.click(screen.getByRole("button", { name: "推荐反馈" }));
    await user.click(screen.getByRole("menuitem", { name: "取消" }));

    expect(screen.queryByRole("menu", { name: "推荐反馈选项" })).not.toBeInTheDocument();
    expect(screen.queryByText("已调整推荐")).not.toBeInTheDocument();
    expect(loadFeedPreferences()).toEqual([]);
  });

  it("keeps the feedback menu usable on the fallback bundle card", async () => {
    const user = userEvent.setup();
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({}, false, 503)));

    renderHomeFeed();

    await waitFor(() => expect(screen.getByRole("article", { name: "生成的社区讨论" })).toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: "推荐反馈" }));
    await user.click(screen.getByRole("menuitem", { name: "多推这类" }));

    expect(await screen.findByText("已调整推荐")).toBeInTheDocument();
    expect(loadFeedPreferences()).toEqual([{ preference_type: "like_topic", target_value: firstConceptId, strength: 1 }]);
  });
});

describe("PostDetail community adaptation", () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.restoreAllMocks();
  });

  function renderPostDetail(extraProps: Partial<Parameters<typeof PostDetail>[0]> = {}) {
    return render(
      <PostDetail
        state={testState}
        bundle={testBundle}
        postId="p1"
        userReplies={[]}
        onBack={() => undefined}
        onDismissLessonHandoff={() => undefined}
        onStartLesson={() => undefined}
        onAddReply={() => undefined}
        onOpenAgent={() => undefined}
        {...extraProps}
      />
    );
  }

  it("renders the community comment tree with OP badge and AI badges", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: unknown) => {
        if (String(url).includes("/api/community/posts/p1")) return jsonResponse(postDetailFixture());
        return jsonResponse({}, false, 404);
      })
    );

    renderPostDetail();

    expect(await screen.findByText("清算网络也是技术堆出来的，这个二分法站不住。")).toBeInTheDocument();
    expect(screen.getByText("我补个资料：清算网络的信任来自多方对账。")).toBeInTheDocument();
    // Third nesting level renders too.
    expect(screen.getByText("就像球场需要裁判，清算网络就是裁判。")).toBeInTheDocument();
    // OP badge on the post author's reply.
    expect(screen.getByText("楼主")).toBeInTheDocument();
    // AI badges on agent avatars (post + 3 comments).
    expect(screen.getAllByText("AI").length).toBeGreaterThanOrEqual(4);
  });

  it("posts a reply to a comment, renders it immediately and awaits responses", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn(async (url: unknown, init?: RequestInit) => {
      const target = String(url);
      if (target.includes("/api/community/comments")) {
        return jsonResponse({ comment_id: "c9", post_id: "p1", thread_path: "1/2", status: "awaiting_responses", created_at: "2026-07-16T12:00:00Z" });
      }
      if (target.includes("/api/community/posts/p1")) return jsonResponse(postDetailFixture());
      return jsonResponse({}, false, 404);
    });
    vi.stubGlobal("fetch", fetchMock);

    renderPostDetail();

    const firstComment = (await screen.findByText("清算网络也是技术堆出来的，这个二分法站不住。")).closest("article") as HTMLElement;
    const [replyButton] = within(firstComment).getAllByRole("button", { name: "回复" });
    await user.click(replyButton);
    expect(screen.getByLabelText("回复目标")).toBeInTheDocument();

    await user.type(screen.getByRole("textbox", { name: "你的回复" }), "两方说的信任来源只是层级不同。");
    await user.click(screen.getByRole("button", { name: "发布回复" }));

    expect(await screen.findByText("两方说的信任来源只是层级不同。")).toBeInTheDocument();
    expect(screen.getByLabelText("等待 AI 居民回应")).toBeInTheDocument();

    const commentCalls = fetchMock.mock.calls.filter(([url]) => String(url).includes("/api/community/comments"));
    expect(commentCalls).toHaveLength(1);
    const [, init] = commentCalls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toMatchObject({ post_id: "p1", parent_comment_id: "c1", user_id: testState.curriculum?.topic.topicId });
  });

  it("keeps the bundle fallback and local replies when the community is unreachable", async () => {
    const user = userEvent.setup();
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({}, false, 503)));
    const localReplies: Array<{ postId: string; body: string }> = [];

    render(
      <PostDetail
        state={testState}
        bundle={testBundle}
        postId="p1"
        userReplies={[]}
        onBack={() => undefined}
        onDismissLessonHandoff={() => undefined}
        onStartLesson={() => undefined}
        onAddReply={(postId, reply) => localReplies.push({ postId, body: reply.body })}
        onOpenAgent={() => undefined}
      />
    );

    await user.click(screen.getByRole("button", { name: "写下你的追问或理解..." }));
    await user.type(screen.getByRole("textbox", { name: "你的回复" }), "离线时先记在本地的回复。");
    await user.click(screen.getByRole("button", { name: "发布回复" }));

    expect(localReplies).toHaveLength(1);
    expect(localReplies[0].body).toBe("离线时先记在本地的回复。");
  });
});

describe("AgentProfile", () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.restoreAllMocks();
  });

  it("renders the persona card with AI disclosure and toggles follow", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn(async (url: unknown) => {
      if (String(url).includes("/api/community/follows")) {
        return jsonResponse({ ok: true, followed: true, follower_count: 4 });
      }
      return jsonResponse({
        agent_id: "a1",
        display_name: "资料哥",
        handle: "@data_guy",
        bio: "爱甩资料的研究生",
        persona: { role: "研究生", traits: ["较真"], voice: "爱甩资料", concern: "理论边界", habit: "喜欢追问 source?", catchphrase: "资料呢？" },
        karma: 128,
        post_count: 6,
        comment_count: 40,
        follower_count: 3,
        is_ai: true,
        last_active_at: "2026-07-16T11:00:00Z",
        created_at: "2026-07-10T08:00:00Z",
        recent_posts: [{ post_id: "p1", content: "支付信任边界长文", stance: "sharing", created_at: "2026-07-16T09:00:00Z" }],
        recent_comments: []
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<AgentProfile state={testState} agentId="a1" onBack={() => undefined} onOpenPost={() => undefined} />);

    expect(await screen.findByText("资料哥")).toBeInTheDocument();
    expect(screen.getByText("AI 居民")).toBeInTheDocument();
    expect(screen.getByText("这是 KnowFeed 的 AI 学习伙伴，不是真人用户。")).toBeInTheDocument();
    expect(screen.getByText("karma 128")).toBeInTheDocument();
    expect(screen.getByText("资料呢？")).toBeInTheDocument();
    expect(screen.getByText("支付信任边界长文")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "关注这位居民" }));
    expect(await screen.findByRole("button", { name: "已关注 · 点按取关" })).toBeInTheDocument();
    expect(screen.getByText("4 关注")).toBeInTheDocument();
  });
});

describe("NewPost", () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.restoreAllMocks();
  });

  it("maps stance choices and submits the post", async () => {
    const user = userEvent.setup();
    const posted: string[] = [];
    const fetchMock = vi.fn(async () =>
      jsonResponse({ post_id: "p9", world_id: "w1", status: "awaiting_responses", created_at: "2026-07-16T12:00:00Z" })
    );
    vi.stubGlobal("fetch", fetchMock);

    render(
      <NewPost
        state={testState}
        worldId="w1"
        currentConceptId={firstConceptId}
        onCancel={() => undefined}
        onPosted={(postId) => posted.push(postId)}
      />
    );

    expect(screen.getByRole("radio", { name: "提问" })).toHaveAttribute("aria-checked", "true");
    await user.click(screen.getByRole("radio", { name: "质疑" }));
    await user.type(screen.getByRole("textbox", { name: "帖子内容" }), "清算网络的信任真的不靠技术吗？");
    await user.click(screen.getByRole("button", { name: "发布帖子" }));

    await waitFor(() => expect(posted).toEqual(["p9"]));
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toMatchObject({
      world_id: "w1",
      user_id: testState.curriculum?.topic.topicId,
      stance: "opposing",
      concept_id: firstConceptId
    });
  });
});
