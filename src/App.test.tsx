import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import { initializeStateForCurriculum, validateCurriculumDraft } from "./domain/curriculumValidator";
import { buildFallbackBundle } from "./domain/fallbackGenerator";
import { buildProfiles } from "./domain/profileBuilder";
import { buildFallbackResearchBrief } from "./domain/researchEngine";
import { saveGeneratedBundle } from "./domain/storage";
import { buildFallbackDraft } from "./domain/topicPlanner";

describe("App", () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: false, status: 503 }))
    );
  });

  async function completeOnboarding(user: ReturnType<typeof userEvent.setup>) {
    await fillOnboarding(user);
    await user.click(screen.getByRole("button", { name: "生成我的学习信息流" }));
    await screen.findByRole("heading", { name: /Fintech 入门/ });
    await user.click(screen.getByRole("button", { name: "进入信息流" }));
    await screen.findByRole("button", { name: "看懂这条讨论" });
  }

  async function fillOnboarding(user: ReturnType<typeof userEvent.setup>) {
    await user.type(screen.getByLabelText("想学的主题或问题"), "Fintech 入门");
    await user.type(screen.getByLabelText("你的背景"), "我是 AI 工程师，想了解 Fintech，目标是能看懂行业讨论。");
    await user.type(screen.getByLabelText("不想看到的风格"), "太数学、太技术、太学术");
    await user.type(screen.getByLabelText("这次想达成什么"), "能看懂行业讨论，并知道评论区在吵什么");
  }

  function savePsychologyState(options: { researchSource?: "web" | "fallback"; curriculumSource?: "planner" | "deterministic-fallback" } = {}) {
    const { topicProfile, learnerProfile } = buildProfiles({
      topicTitle: "心理学入门",
      background: "我是普通兴趣用户，想看懂心理学讨论，每天 5 分钟。",
      goal: "能看懂心理学研究和社交平台争论",
      dailyMinutes: 5,
      targetDepth: "conversational",
      preferredTone: "debate-heavy"
    });
    const baseResearch = buildFallbackResearchBrief(topicProfile, learnerProfile);
    const research =
      options.researchSource === "web"
        ? {
            ...baseResearch,
            source: "web" as const,
            sources: [
              {
                title: "Psychology research methods overview",
                url: "https://example.org/psychology-research-methods",
                publisher: "Example Review",
                retrievedAt: "2026-06-18T00:00:00.000Z",
                summary: "心理学入门资料强调实验发现、临床实践和大众心理学之间的边界。",
                reliabilityNote: "用于测试真实 web research 来源在界面中的可见性。",
                qualityScore: 8,
                qualitySignals: ["reference-or-institutional", "topic-match"],
                factReviewStatus: "planning-only" as const
              }
            ]
          }
        : { ...baseResearch, source: options.researchSource ?? "fallback" };
    const draft = buildFallbackDraft(topicProfile, learnerProfile, research);
    const curriculum = validateCurriculumDraft(
      draft,
      topicProfile,
      learnerProfile,
      research,
      options.curriculumSource ?? "deterministic-fallback"
    );
    const state = initializeStateForCurriculum(curriculum);
    window.localStorage.setItem("knowfeed.prototype.state.v1", JSON.stringify(state));
    return state;
  }

  function webResearchBriefFixture() {
    return {
      topic: "Fintech 入门",
      querySet: ["Fintech beginner guide"],
      sources: [
        {
          title: "Fintech trust and regulation overview",
          url: "https://example.org/fintech-trust-regulation",
          publisher: "Example Review",
          retrievedAt: "2026-06-18T00:00:00.000Z",
          summary: "Fintech 入门资料强调支付、信贷、风控和监管科技之间的信任边界。",
          reliabilityNote: "用于测试 web research + planner 路径不会把内容 fallback 当作完成。",
          qualityScore: 8,
          qualitySignals: ["topic-match"],
          factReviewStatus: "planning-only" as const
        }
      ],
      keyIdeas: ["支付、信贷、风控和监管科技是 Fintech 入门的四个抓手"],
      disputedIdeas: ["创新速度和监管边界经常冲突"],
      beginnerPitfalls: ["把 Fintech 等同于炒币"],
      source: "web" as const
    };
  }

  function plannerDraftFixture() {
    return {
      title: "Fintech 入门：7 天看懂行业讨论",
      promise: "用工程师视角看懂支付、信贷、风控和监管边界。",
      days: Array.from({ length: 7 }, (_, index) => ({
        day: index + 1,
        title: `Day ${index + 1} Fintech 讨论入口`,
        whyNow: "先把讨论拆成参与方、风险和信任边界。",
        concepts: [
          {
            temporaryName: index === 0 ? "支付信任边界" : `Fintech 主题 ${index + 1}`,
            plainLanguageGoal: "分清技术效率和金融信任边界。",
            prerequisiteNames: index === 0 ? [] : ["支付信任边界"],
            misconceptionToFix: "Fintech 不是把金融 App 做得更炫。",
            feedHook: "Fintech 热帖为什么总绕不开信任和监管？",
            sourceUrls: ["https://example.org/fintech-trust-regulation"]
          }
        ]
      }))
    };
  }

  function jsonResponse(value: unknown, ok = true, status = ok ? 200 : 500) {
    return {
      ok,
      status,
      json: async () => value
    } as Response;
  }

  it("previews the generated path before entering the feed after onboarding", async () => {
    const user = userEvent.setup();
    render(<App />);

    await fillOnboarding(user);
    await user.click(screen.getByRole("button", { name: "生成我的学习信息流" }));

    expect(await screen.findByRole("button", { name: "直接开始" })).toBeInTheDocument();
    expect(screen.getByLabelText("生成后的学习路径预览")).toBeInTheDocument();
    expect(screen.getByText("7 天路径已生成")).toBeInTheDocument();
    expect(screen.getByLabelText("学习路径生成来源")).toBeInTheDocument();
    expect(screen.getAllByText(/Day [1-7]/)).toHaveLength(7);
    expect(screen.getByRole("button", { name: "进入信息流" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "查看完整地图" })).toBeInTheDocument();
    expect(screen.getAllByText(/Fintech 入门/).length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: "社区" })).not.toHaveClass("active");
  });

  it("shows staged generation feedback while real content is being prepared", async () => {
    const user = userEvent.setup();
    vi.stubGlobal("fetch", vi.fn(() => new Promise(() => undefined)));
    render(<App />);

    await fillOnboarding(user);
    await user.click(screen.getByRole("button", { name: "生成我的学习信息流" }));

    expect(await screen.findByRole("list", { name: "生成进度" })).toBeInTheDocument();
    expect(screen.getByText("联网检索").closest("li")).toHaveAttribute("aria-current", "step");
    expect(screen.getByText("抓取真实资料锚点")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "正在生成学习信息流" })).toBeDisabled();
  });

  it("does not finish onboarding with fallback content after web research and planner succeed", async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url, init) => {
        const body = String((init as { body?: unknown } | undefined)?.body ?? "");
        if (String(url).includes("/api/research")) return jsonResponse(webResearchBriefFixture());
        if (String(url).includes("/api/generate") && body.includes("课程规划引擎")) {
          return jsonResponse({ content: JSON.stringify(plannerDraftFixture()) });
        }
        if (String(url).includes("/api/generate") && body.includes("内容生成引擎")) {
          return jsonResponse({ content: "not valid generated JSON" });
        }
        return jsonResponse({}, false, 404);
      })
    );
    render(<App />);

    await fillOnboarding(user);
    await user.click(screen.getByRole("button", { name: "生成我的学习信息流" }));

    expect(await screen.findByText("AI 生成内容未通过质量校验，请保留表单重试")).toBeInTheDocument();
    expect(screen.queryByLabelText("生成后的学习路径预览")).not.toBeInTheDocument();
    expect(screen.getByLabelText("想学的主题或问题")).toHaveValue("Fintech 入门");
    const saved = JSON.parse(window.localStorage.getItem("knowfeed.prototype.state.v1") ?? "{}");
    expect(saved.curriculum).toBeUndefined();
  });

  it("builds a non-Web3 path from onboarding and renders dual entry points", async () => {
    const user = userEvent.setup();
    render(<App />);

    expect(screen.getByRole("heading", { name: "输入你想看懂的真实讨论" })).toBeInTheDocument();
    await completeOnboarding(user);

    expect(screen.getAllByText(/Fintech 入门/).length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: "直接开始" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "看懂这条讨论" })).toBeInTheDocument();
    const generatedDiscussion = screen.getByRole("article", { name: "生成的社区讨论" });
    const dailyTask = screen.getByRole("region", { name: "今日学习任务" });
    const pathPreview = screen.getByRole("region", { name: "学习路径预览" });
    expect(generatedDiscussion.compareDocumentPosition(dailyTask) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(generatedDiscussion.compareDocumentPosition(pathPreview) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("keeps the bottom navigation focused on community, map, and settings", async () => {
    const user = userEvent.setup();
    render(<App />);

    await completeOnboarding(user);

    const nav = within(screen.getByRole("navigation", { name: "主导航" }));
    expect(nav.getAllByRole("button").map((button) => button.textContent)).toEqual(["社区", "学习地图", "设置"]);
    expect(screen.queryByRole("button", { name: "搜索" })).not.toBeInTheDocument();
    expect(nav.queryByRole("button", { name: "评论" })).not.toBeInTheDocument();
    expect(nav.queryByRole("button", { name: "今日" })).not.toBeInTheDocument();
    expect(nav.queryByRole("button", { name: "分身" })).not.toBeInTheDocument();
  });

  it("uses the saved topic for the temporary bundle while reload generation is pending", () => {
    savePsychologyState();
    render(<App />);

    expect(screen.getAllByText(/心理学/).length).toBeGreaterThan(0);
    expect(screen.queryByText(/Web3 钱包|链上|Gas/)).not.toBeInTheDocument();
  });

  it("starts new users from blank onboarding instead of restoring the Web3 sample seed", () => {
    const { topicProfile, learnerProfile } = buildProfiles({
      topicTitle: "Web3 入门",
      background: "我是产品经理，想了解 Web3 但不懂技术。",
      goal: "想看懂 Web3 相关讨论",
      dailyMinutes: 5,
      targetDepth: "conversational",
      preferredTone: "debate-heavy"
    });
    const research = buildFallbackResearchBrief(topicProfile, learnerProfile);
    const draft = buildFallbackDraft(topicProfile, learnerProfile, research);
    const curriculum = validateCurriculumDraft(draft, topicProfile, learnerProfile, research, "sample-seed");
    window.localStorage.setItem(
      "knowfeed.prototype.state.v1",
      JSON.stringify({ ...initializeStateForCurriculum(curriculum), curriculum: { ...curriculum, curriculumId: "sample-web3-curriculum" } })
    );

    render(<App />);

    expect(screen.getByRole("heading", { name: "输入你想看懂的真实讨论" })).toBeInTheDocument();
    expect(screen.getByLabelText("想学的主题或问题")).toHaveValue("");
    expect(screen.queryByText(/Web3 钱包|Gas|链上热评机/)).not.toBeInTheDocument();
  });

  it("rehydrates a cached generated bundle on reload instead of flashing fallback content", async () => {
    const state = savePsychologyState();
    const conceptId = state.curriculum?.concepts[0].id ?? "";
    const bundle = buildFallbackBundle(state, conceptId);
    saveGeneratedBundle(state.curriculum?.curriculumId ?? "", conceptId, {
      ...bundle,
      source: "research-llm",
      post: {
        ...bundle.post,
        body: "缓存的真实 LLM 主帖：心理学讨论要先看证据、边界和研究方法。"
      }
    });

    render(<App />);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(screen.getByText(/缓存的真实 LLM 主帖/)).toBeInTheDocument();
    const contentGenerationCalls = vi.mocked(fetch).mock.calls.filter(([url, init]) => {
      const body = (init as { body?: unknown } | undefined)?.body;
      return String(url).includes("/api/generate") && String(body).includes("内容生成引擎");
    });
    expect(contentGenerationCalls).toHaveLength(0);
  });

  it("shows visible source provenance for cached real LLM content", async () => {
    const user = userEvent.setup();
    const state = savePsychologyState({ researchSource: "web", curriculumSource: "planner" });
    const conceptId = state.curriculum?.concepts[0].id ?? "";
    const bundle = buildFallbackBundle(state, conceptId);
    saveGeneratedBundle(state.curriculum?.curriculumId ?? "", conceptId, {
      ...bundle,
      source: "research-llm",
      post: {
        ...bundle.post,
        body: "缓存的真实 LLM 主帖：心理学讨论要先看证据、边界和研究方法。"
      }
    });

    render(<App />);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(screen.getAllByText("Research brief + LLM").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Research: web").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Path: planner").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Fact: planning-only").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Quality 8.0").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Fresh 2026-06-18").length).toBeGreaterThan(0);
    expect(screen.getAllByText("网页资料辅助的 AI 生成").length).toBeGreaterThan(0);
    expect(screen.getAllByText("已接入网页资料").length).toBeGreaterThan(0);
    expect(screen.getAllByText("AI 规划路径").length).toBeGreaterThan(0);
    expect(screen.getAllByText("用途: 学习规划参考").length).toBeGreaterThan(0);
    expect(screen.getAllByText("来源质量 8.0").length).toBeGreaterThan(0);
    expect(screen.getAllByText("更新 2026-06-18").length).toBeGreaterThan(0);
    await user.click(screen.getAllByLabelText("讨论来源详情")[0]);
    expect(screen.getAllByText("研究锚点").length).toBeGreaterThan(0);
    expect(screen.getAllByText(/实验发现/).length).toBeGreaterThan(0);
    expect(screen.getAllByText("资料来源").length).toBeGreaterThan(0);
    expect(screen.getAllByRole("link", { name: /Psychology research methods overview/ })[0]).toHaveAttribute(
      "href",
      "https://example.org/psychology-research-methods"
    );

    await user.click(screen.getByRole("button", { name: "看懂这条讨论" }));

    expect(screen.getByLabelText("讨论生成来源")).toBeInTheDocument();
    expect(screen.getAllByText("网页资料辅助的 AI 生成").length).toBeGreaterThan(0);
    expect(screen.getAllByText("已接入网页资料").length).toBeGreaterThan(0);
    expect(screen.getAllByText("AI 规划路径").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Research brief + LLM").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Research: web").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Path: planner").length).toBeGreaterThan(0);
    await user.click(screen.getAllByLabelText("讨论来源详情")[0]);
    expect(screen.getByLabelText("讨论研究锚点")).toBeInTheDocument();
    expect(screen.getAllByText(/实验发现/).length).toBeGreaterThan(0);
    expect(screen.getByLabelText("讨论资料来源")).toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: /Psychology research methods overview/ }).length).toBeGreaterThan(0);
  });

  it("persists deterministic planner fallback separately from planner output", async () => {
    const user = userEvent.setup();
    render(<App />);

    await completeOnboarding(user);

    await waitFor(() => {
      const saved = JSON.parse(window.localStorage.getItem("knowfeed.prototype.state.v1") ?? "{}");
      expect(saved.curriculum.source).toBe("deterministic-fallback");
      expect(saved.curriculum.learner.avoidedStyles).toEqual(
        expect.arrayContaining(["太数学", "太技术", "太学术", "长篇术语堆砌", "考试式讲解"])
      );
    });
  });

  it("completes a micro lesson and creates a shadow draft", async () => {
    const user = userEvent.setup();
    render(<App />);

    await completeOnboarding(user);
    await user.click(screen.getByRole("button", { name: "直接开始" }));
    await user.type(screen.getByPlaceholderText("写一句你自己的理解"), "这个概念能帮我看懂评论区在吵什么。");
    await user.click(screen.getByRole("button", { name: "完成并回评论区" }));
    await user.click(screen.getByRole("button", { name: "设置" }));

    expect(screen.getByText(/可发布草稿/)).toBeInTheDocument();
    expect(screen.getByText("AI 生成 · 需你确认")).toBeInTheDocument();
    expect(screen.getAllByText(/Fintech|术语|限制/).length).toBeGreaterThan(0);
  });

  it("shows a completion handoff when returning from a micro lesson", async () => {
    const user = userEvent.setup();
    render(<App />);

    await completeOnboarding(user);
    await user.click(screen.getByRole("button", { name: "直接开始" }));
    await user.type(screen.getByPlaceholderText("写一句你自己的理解"), "这个概念能帮我看懂评论区在吵什么。");
    await user.click(screen.getByRole("button", { name: "完成并回评论区" }));

    expect(screen.getByLabelText("微课完成反馈")).toBeInTheDocument();
    expect(screen.getByText(/\+47 XP/)).toBeInTheDocument();
    expect(screen.getByText(/AI 分身已经/)).toBeInTheDocument();
  });

  it("reflects the actual computed XP in the completion handoff", async () => {
    const user = userEvent.setup();
    render(<App />);

    await completeOnboarding(user);
    await user.click(screen.getByRole("button", { name: "直接开始" }));
    await user.type(screen.getByPlaceholderText("写一句你自己的理解"), "短");
    await user.click(screen.getByRole("button", { name: "完成并回评论区" }));

    expect(screen.getByLabelText("微课完成反馈")).toBeInTheDocument();
    expect(screen.getByText(/\+35 XP/)).toBeInTheDocument();
  });

  it("opens the next mission from the learning map after progress advances", async () => {
    const user = userEvent.setup();
    render(<App />);

    await completeOnboarding(user);

    await user.click(screen.getByRole("button", { name: "直接开始" }));
    await user.type(screen.getByPlaceholderText("写一句你自己的理解"), "这个概念能帮我看懂评论区在吵什么。");
    await user.click(screen.getByRole("button", { name: "完成并回评论区" }));
    await user.click(screen.getByRole("button", { name: "学习地图" }));
    expect(screen.getByText("推荐下一步")).toBeInTheDocument();
    expect(screen.getByLabelText("学习地图生成来源")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "继续学习" }));

    expect(screen.getByText(/快速判断/)).toBeInTheDocument();
  });

  it("lets learners edit and approve shadow drafts with visible learning basis", async () => {
    const user = userEvent.setup();
    render(<App />);

    await completeOnboarding(user);
    await user.click(screen.getByRole("button", { name: "直接开始" }));
    await user.type(screen.getByPlaceholderText("写一句你自己的理解"), "这个概念能帮我看懂评论区在吵什么。");
    await user.click(screen.getByRole("button", { name: "完成并回评论区" }));
    await user.click(screen.getByRole("button", { name: "设置" }));

    expect(screen.getByText("依据的学习记录")).toBeInTheDocument();
    expect(screen.getByText(/已完成 1 个微课/)).toBeInTheDocument();
    const pendingDraftCard = screen.getByText("AI 生成草稿").closest("article");
    expect(pendingDraftCard).not.toBeNull();
    const draftBasis = within(pendingDraftCard as HTMLElement).getByLabelText("依据的学习记录");
    const draftEditor = within(pendingDraftCard as HTMLElement).getByRole("textbox", { name: "编辑分身草稿" });
    expect(draftBasis.compareDocumentPosition(draftEditor) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    const editedDraft = "我会先看证据、限制和评论区的反方问题，再决定是否认同这个观点。";
    await user.clear(draftEditor);
    await user.type(draftEditor, editedDraft);
    await user.click(screen.getByRole("button", { name: "保存修改" }));

    expect(screen.getByDisplayValue(editedDraft)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "批准发布" }));

    expect(screen.getByText("1 条已批准")).toBeInTheDocument();
    expect(screen.getByText("已批准内容")).toBeInTheDocument();
    expect(screen.getByText(editedDraft)).toBeInTheDocument();
    expect(screen.getByText(/AI 生成，经你确认/)).toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: "编辑分身草稿" })).not.toBeInTheDocument();
  });

  it("lets learners reject a pending shadow draft without publishing it", async () => {
    const user = userEvent.setup();
    render(<App />);

    await completeOnboarding(user);
    await user.click(screen.getByRole("button", { name: "直接开始" }));
    await user.type(screen.getByPlaceholderText("写一句你自己的理解"), "这个概念能帮我看懂评论区在吵什么。");
    await user.click(screen.getByRole("button", { name: "完成并回评论区" }));
    await user.click(screen.getByRole("button", { name: "设置" }));

    await user.click(screen.getByRole("button", { name: "拒绝草稿" }));

    expect(screen.getByText("没有待发布草稿")).toBeInTheDocument();
    expect(screen.getByText("0 条已批准")).toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: "编辑分身草稿" })).not.toBeInTheDocument();
  });

  it("requires confirmation before resetting local progress", async () => {
    const user = userEvent.setup();
    render(<App />);

    await completeOnboarding(user);
    await user.click(screen.getByRole("button", { name: "设置" }));
    await user.click(screen.getByRole("button", { name: "重置原型进度" }));

    expect(screen.getByText("重置会清空本机进度、学习路径和分身草稿。")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "学习分身、进度和原型选项" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "取消" }));
    expect(screen.queryByText("重置会清空本机进度、学习路径和分身草稿。")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "重置原型进度" }));
    await user.click(screen.getByRole("button", { name: "确认重置" }));

    expect(screen.getByRole("heading", { name: "输入你想看懂的真实讨论" })).toBeInTheDocument();
  });

  it("clears the rendered bundle when resetting progress", async () => {
    const user = userEvent.setup();
    render(<App />);

    await completeOnboarding(user);
    await user.click(screen.getByRole("button", { name: "设置" }));
    await user.click(screen.getByRole("button", { name: "重置原型进度" }));
    await user.click(screen.getByRole("button", { name: "确认重置" }));

    expect(screen.getByRole("heading", { name: "输入你想看懂的真实讨论" })).toBeInTheDocument();
    expect(screen.queryByText(/Fintech 入门/)).not.toBeInTheDocument();
  });

  it("debounces localStorage writes after state changes", async () => {
    const user = userEvent.setup();
    render(<App />);

    await completeOnboarding(user);
    await user.click(screen.getByRole("button", { name: "直接开始" }));
    await user.type(screen.getByPlaceholderText("写一句你自己的理解"), "这个概念能帮我看懂评论区在吵什么。");
    await user.click(screen.getByRole("button", { name: "完成并回评论区" }));
    await user.click(screen.getByRole("button", { name: "设置" }));

    await waitFor(() => {
      const saved = JSON.parse(window.localStorage.getItem("knowfeed.prototype.state.v1") ?? "{}");
      expect(saved.shadowDrafts?.length).toBeGreaterThan(0);
    });
    const before = JSON.parse(window.localStorage.getItem("knowfeed.prototype.state.v1") ?? "{}");

    await user.click(screen.getByRole("button", { name: "拒绝草稿" }));
    const immediatelyAfter = JSON.parse(window.localStorage.getItem("knowfeed.prototype.state.v1") ?? "{}");
    expect(immediatelyAfter.shadowDrafts).toEqual(before.shadowDrafts);

    await new Promise((resolve) => setTimeout(resolve, 350));
    const afterDebounce = JSON.parse(window.localStorage.getItem("knowfeed.prototype.state.v1") ?? "{}");
    expect(afterDebounce.shadowDrafts).toHaveLength(0);
  });

  it("shows community authors without exposing stance metadata", async () => {
    const user = userEvent.setup();
    render(<App />);

    await completeOnboarding(user);
    await user.click(screen.getByRole("button", { name: "看懂这条讨论" }));

    expect(screen.getByLabelText("评论区")).toBeInTheDocument();
    expect(screen.getAllByText(/视角 · /).length).toBeGreaterThan(0);
    expect(screen.queryByText(/赞成 ·|反对 ·|补充 ·|挑刺 ·/)).not.toBeInTheDocument();
    expect(screen.queryByText(/AI 热点号|AI 建设派|AI 挑刺号|AI 热评员/)).not.toBeInTheDocument();
  });

  it("shows nested community replies from the generated bundle", async () => {
    const user = userEvent.setup();
    const state = savePsychologyState();
    const conceptId = state.curriculum?.concepts[0].id ?? "";
    const bundle = buildFallbackBundle(state, conceptId);
    saveGeneratedBundle(state.curriculum?.curriculumId ?? "", conceptId, {
      ...bundle,
      source: "research-llm",
      comments: [
        {
          ...bundle.comments[0],
          replies: [
            {
              id: `reply-${bundle.comments[0].id}-1`,
              author: {
                id: "reply-author",
                displayName: "证据追问者",
                handle: "@evidence-reply",
                role: "心理学研究视角",
                stance: "反对派"
              },
              body: "追问：这个心理学判断有没有研究样本和边界？",
              heat: 51,
              replyToCommentId: bundle.comments[0].id,
              relation: "追问",
              quote: "万能解释"
            }
          ]
        },
        ...bundle.comments.slice(1)
      ]
    });

    render(<App />);
    await user.click(screen.getByRole("button", { name: "看懂这条讨论" }));

    expect(screen.getByText("证据追问者")).toBeInTheDocument();
    expect(screen.getAllByText("回复").length).toBeGreaterThan(0);
    expect(screen.queryByText(/追问 · 回复|补充 · 回复|反驳 · 回复/)).not.toBeInTheDocument();
    expect(screen.getByText(/有没有研究样本和边界/)).toBeInTheDocument();
  });

  it("lets learners switch comment sorting to active reply threads", async () => {
    const user = userEvent.setup();
    const state = savePsychologyState();
    const conceptId = state.curriculum?.concepts[0].id ?? "";
    const bundle = buildFallbackBundle(state, conceptId);
    saveGeneratedBundle(state.curriculum?.curriculumId ?? "", conceptId, {
      ...bundle,
      source: "research-llm",
      comments: [
        {
          ...bundle.comments[0],
          id: "hot-flat",
          author: { ...bundle.comments[0].author, displayName: "高热视频" },
          body: "心理学讨论里很热的一条泛泛评论。",
          heat: 120,
          replies: []
        },
        {
          ...bundle.comments[1],
          id: "active-reply",
          author: { ...bundle.comments[1].author, displayName: "活跃追问" },
          body: "心理学研究里这条评论热度不高，但有人继续追问。",
          heat: 30,
          replies: [
            {
              id: "reply-active-reply-1",
              author: {
                id: "reply-author",
                displayName: "最新回复者",
                handle: "@fresh-reply",
                role: "心理学研究视角",
                stance: "反对派"
              },
              body: "追问：这个心理学研究有没有样本边界？",
              heat: 130,
              replyToCommentId: "active-reply",
              relation: "追问"
            }
          ]
        },
        ...bundle.comments.slice(2)
      ]
    });

    render(<App />);
    await user.click(screen.getByRole("button", { name: "看懂这条讨论" }));

    const commentAuthors = () =>
      [...screen.getByLabelText("评论区").querySelectorAll(".comment-item header strong")].map((node) =>
        node.textContent?.trim()
      );

    expect(screen.getByRole("radio", { name: "热度" })).toHaveClass("active");
    expect(commentAuthors()[0]).toBe("高热视频");

    await user.click(screen.getByRole("radio", { name: "新回复" }));

    expect(screen.getByRole("radio", { name: "新回复" })).toHaveClass("active");
    expect(commentAuthors()[0]).toBe("活跃追问");
  });

  it("renders stance filters in the comment toolbar and lets learners switch them", async () => {
    const user = userEvent.setup();
    const state = savePsychologyState();
    const conceptId = state.curriculum?.concepts[0].id ?? "";
    const bundle = buildFallbackBundle(state, conceptId);
    saveGeneratedBundle(state.curriculum?.curriculumId ?? "", conceptId, {
      ...bundle,
      source: "research-llm",
      comments: [
        {
          ...bundle.comments[0],
          id: "agree-comment",
          author: { ...bundle.comments[0].author, displayName: "赞成者" },
          body: "心理学入门应该先给新手一个入口。",
          heat: 100,
          stance: "赞成",
          replies: []
        },
        {
          ...bundle.comments[1],
          id: "oppose-comment",
          author: { ...bundle.comments[1].author, displayName: "反对者" },
          body: "心理学讨论不能只看入口，还要看边界。",
          heat: 90,
          stance: "反对",
          replies: []
        },
        ...bundle.comments.slice(2)
      ]
    });

    render(<App />);
    await user.click(screen.getByRole("button", { name: "看懂这条讨论" }));

    expect(screen.getByRole("tab", { name: /全部\s*4/ })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /赞成\s*1/ })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /反对\s*1/ })).toBeInTheDocument();

    const commentAuthors = () =>
      [...screen.getByLabelText("评论区").querySelectorAll(".comment-item header strong")].map((node) =>
        node.textContent?.trim()
      );

    expect(commentAuthors()).toContain("赞成者");
    expect(commentAuthors()).toContain("反对者");

    await user.click(screen.getByRole("tab", { name: /赞成\s*1/ }));

    expect(commentAuthors()).toContain("赞成者");
    expect(commentAuthors()).not.toContain("反对者");
  });

  it("lets learners write a local reply in the discussion", async () => {
    const user = userEvent.setup();
    render(<App />);

    await completeOnboarding(user);
    await user.click(screen.getByRole("button", { name: "看懂这条讨论" }));
    await user.click(screen.getByRole("button", { name: "写下你的追问或理解..." }));

    const reply = "我理解这点要先看证据边界，再判断评论区的观点是否站得住。";
    await user.type(screen.getByRole("textbox", { name: "你的回复" }), reply);
    await user.click(screen.getByRole("button", { name: "发布回复" }));

    expect(screen.getByText(reply)).toBeInTheDocument();
    expect(screen.getByText("刚刚 · 本地草稿")).toBeInTheDocument();
  });

  it("lets learners reply to a specific generated comment with visible context", async () => {
    const user = userEvent.setup();
    render(<App />);

    await completeOnboarding(user);
    await user.click(screen.getByRole("button", { name: "看懂这条讨论" }));

    const [firstComment] = screen.getByLabelText("评论区").querySelectorAll(".comment-item");
    expect(firstComment).toBeTruthy();
    await user.click(within(firstComment as HTMLElement).getAllByRole("button", { name: "回复" })[0]);

    expect(screen.getByLabelText("回复目标")).toBeInTheDocument();

    const reply = "我想接着追问这个观点的证据边界。";
    await user.type(screen.getByRole("textbox", { name: "你的回复" }), reply);
    await user.click(screen.getByRole("button", { name: "发布回复" }));

    expect(screen.getByText(reply)).toBeInTheDocument();
    expect(screen.getByText(/回复 .+/, { selector: ".local-reply-context span" })).toBeInTheDocument();
  });

  it("persists learner replies across navigation", async () => {
    const user = userEvent.setup();
    render(<App />);

    await completeOnboarding(user);
    await user.click(screen.getByRole("button", { name: "看懂这条讨论" }));
    await user.click(screen.getByRole("button", { name: "写下你的追问或理解..." }));

    const reply = "这条回复应该在离开帖子后仍然保留。";
    await user.type(screen.getByRole("textbox", { name: "你的回复" }), reply);
    await user.click(screen.getByRole("button", { name: "发布回复" }));

    expect(screen.getByText(reply)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "← 返回社区" }));
    await user.click(screen.getByRole("button", { name: "看懂这条讨论" }));

    expect(screen.getByText(reply)).toBeInTheDocument();

    await waitFor(() => {
      const saved = JSON.parse(window.localStorage.getItem("knowfeed.prototype.state.v1") ?? "{}");
      expect(Object.values(saved.postReplies ?? {}).flat()).toContainEqual(
        expect.objectContaining({ body: reply })
      );
    });
  });

  it("does not request a fresh bundle just because the learner opens the lesson screen", async () => {
    const user = userEvent.setup();
    render(<App />);

    await completeOnboarding(user);
    const callsAfterOnboarding = vi.mocked(fetch).mock.calls.filter(([url]) => String(url).includes("/api/generate"))
      .length;
    await user.click(screen.getByRole("button", { name: "直接开始" }));
    await screen.findByText(/快速判断/);
    await new Promise((resolve) => setTimeout(resolve, 0));

    const callsAfterOpeningLesson = vi.mocked(fetch).mock.calls.filter(([url]) => String(url).includes("/api/generate"))
      .length;
    expect(callsAfterOpeningLesson).toBe(callsAfterOnboarding);
  });

  it("does not start a duplicate initial content request when onboarding completes", async () => {
    const user = userEvent.setup();
    render(<App />);

    await completeOnboarding(user);

    const contentGenerationCalls = vi.mocked(fetch).mock.calls.filter(([url, init]) => {
      const body = (init as { body?: unknown } | undefined)?.body;
      return String(url).includes("/api/generate") && String(body).includes("内容生成引擎");
    });
    const bodyCounts = contentGenerationCalls.reduce<Map<string, number>>((counts, [, init]) => {
      const body = String((init as { body?: unknown } | undefined)?.body ?? "");
      counts.set(body, (counts.get(body) ?? 0) + 1);
      return counts;
    }, new Map());

    // Fallback research uses the hands-on LLM-only path: surface + comments, each retried by the proxy client.
    expect(contentGenerationCalls).toHaveLength(4);
    expect([...bodyCounts.values()].sort()).toEqual([2, 2]);
  });

  it("does not replace the current bundle just because the learner completes a lesson", async () => {
    const user = userEvent.setup();
    render(<App />);

    await completeOnboarding(user);
    let saved: Record<string, unknown> = {};
    await waitFor(() => {
      saved = JSON.parse(window.localStorage.getItem("knowfeed.prototype.state.v1") ?? "{}");
      expect(saved.curriculum).toBeDefined();
    });
    const firstConceptTitle = (saved.curriculum as { concepts: Array<{ title: string }> }).concepts[0].title;
    const secondConceptTitle = (saved.curriculum as { concepts: Array<{ title: string }> }).concepts[1].title;
    await user.click(screen.getByRole("button", { name: "直接开始" }));
    await user.type(screen.getByPlaceholderText("写一句你自己的理解"), "这个概念能帮我看懂评论区在吵什么。");
    await user.click(screen.getByRole("button", { name: "完成并回评论区" }));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(screen.getAllByText(new RegExp(firstConceptTitle)).length).toBeGreaterThan(0);
    expect(screen.queryByText(new RegExp(secondConceptTitle))).not.toBeInTheDocument();
  });
});
