import { describe, expect, it } from "vitest";
import { validateCurriculumDraft } from "./curriculumValidator";
import { buildFallbackBundle } from "./fallbackGenerator";
import { buildProfiles } from "./profileBuilder";
import { buildFallbackResearchBrief } from "./researchEngine";
import { defaultAppState } from "./storage";
import { buildFallbackDraft } from "./topicPlanner";
import type { OnboardingInput } from "./types";

const scenarios: OnboardingInput[] = [
  {
    topicTitle: "Fintech 入门",
    background: "我是 AI 工程师，想了解金融科技。",
    goal: "看懂行业讨论",
    dailyMinutes: 5,
    targetDepth: "conversational",
    preferredTone: "debate-heavy"
  },
  {
    topicTitle: "AI 入门",
    background: "我是产品经理，想判断 AI 产品机会。",
    goal: "看懂产品和行业讨论",
    dailyMinutes: 10,
    targetDepth: "strategic",
    preferredTone: "professional"
  },
  {
    topicTitle: "心理学入门",
    background: "我是普通兴趣用户，想看懂心理学讨论。",
    goal: "能安全参与讨论，不乱贴诊断",
    dailyMinutes: 5,
    targetDepth: "casual",
    preferredTone: "light"
  }
];

const arbitraryTopicScenarios: OnboardingInput[] = [
  {
    topicTitle: "气候变化政策入门",
    background: "我是城市规划从业者，想看懂减排和适应政策讨论。",
    goal: "能分清政策工具、利益相关方和常见争议",
    dailyMinutes: 10,
    targetDepth: "practical",
    preferredTone: "professional"
  },
  {
    topicTitle: "古典音乐入门",
    background: "我是通勤时听音乐的普通兴趣用户，不懂乐理。",
    goal: "能看懂作品、演奏和审美争论",
    dailyMinutes: 5,
    targetDepth: "casual",
    preferredTone: "light"
  },
  {
    topicTitle: "摄影构图入门",
    background: "我是电商运营，想让商品图更会讲故事。",
    goal: "能判断构图选择和视觉叙事",
    dailyMinutes: 5,
    targetDepth: "practical",
    preferredTone: "professional"
  },
  {
    topicTitle: "日本战国史入门",
    background: "我是历史兴趣用户，想看懂人物、制度和史料争论。",
    goal: "能分清历史叙事和影视化改编",
    dailyMinutes: 10,
    targetDepth: "conversational",
    preferredTone: "debate-heavy"
  },
  {
    topicTitle: "教育学入门",
    background: "我是新手课程设计师，想理解学习动机和课堂讨论。",
    goal: "能看懂教学方法背后的证据和争议",
    dailyMinutes: 10,
    targetDepth: "strategic",
    preferredTone: "professional"
  }
];

function buildScenario(input: OnboardingInput) {
  const { topicProfile, learnerProfile } = buildProfiles(input);
  const research = buildFallbackResearchBrief(topicProfile, learnerProfile);
  const draft = buildFallbackDraft(topicProfile, learnerProfile, research);
  const curriculum = validateCurriculumDraft(draft, topicProfile, learnerProfile, research, "deterministic-fallback");
  const state = {
    ...defaultAppState,
    topicProfile,
    learnerProfile,
    researchBrief: research,
    curriculum,
    progress: {
      ...defaultAppState.progress,
      activeTopic: topicProfile.topicId,
      conceptMastery: Object.fromEntries(curriculum.concepts.map((concept) => [concept.id, 0]))
    }
  };
  const bundle = buildFallbackBundle(state, curriculum.concepts[0].id);
  return { topicProfile, learnerProfile, research, draft, curriculum, bundle };
}

describe("experience scenarios", () => {
  it("keeps topic and learner context visible across path, feed, comments and shadow", () => {
    for (const scenario of scenarios) {
      const { curriculum, bundle } = buildScenario(scenario);
      const combinedExperienceText = [
        curriculum.title,
        curriculum.promise,
        bundle.lesson.explanation,
        bundle.post.body,
        ...bundle.comments.map((comment) => comment.body),
        bundle.shadowDraft.body
      ].join("\n");

      expect(curriculum.concepts).toHaveLength(7);
      expect(curriculum.lessons).toHaveLength(7);
      expect(combinedExperienceText).toContain(scenario.topicTitle);
      expect(combinedExperienceText).toContain(curriculum.concepts[0].plainName);
      expect(new Set(bundle.comments.map((comment) => comment.stance)).size).toBeGreaterThanOrEqual(3);
    }
  });

  it("changes the community experience when the learner background changes", () => {
    const engineer = buildScenario({
      topicTitle: "Fintech 入门",
      background: "我是 AI 工程师，想了解金融科技。",
      goal: "看懂行业讨论",
      dailyMinutes: 5,
      targetDepth: "conversational",
      preferredTone: "debate-heavy"
    });
    const product = buildScenario({
      topicTitle: "Fintech 入门",
      background: "我是产品经理，想判断 Fintech 产品机会。",
      goal: "看懂产品和行业讨论",
      dailyMinutes: 5,
      targetDepth: "strategic",
      preferredTone: "professional"
    });

    const engineerCommunity = [
      engineer.bundle.post.body,
      ...engineer.bundle.comments.map((comment) => comment.body),
      engineer.bundle.shadowDraft.body
    ].join("\n");
    const productCommunity = [
      product.bundle.post.body,
      ...product.bundle.comments.map((comment) => comment.body),
      product.bundle.shadowDraft.body
    ].join("\n");

    expect(engineerCommunity).not.toEqual(productCommunity);
    expect(engineerCommunity).toContain("技术系统");
    expect(productCommunity).toContain("用户场景");
  });

  it("keeps arbitrary non-template topics on the same agent-style generation pipeline", () => {
    for (const scenario of arbitraryTopicScenarios) {
      const { topicProfile, learnerProfile, research, draft, curriculum, bundle } = buildScenario(scenario);
      const conceptIds = curriculum.concepts.map((concept) => concept.id);
      const lessonIds = curriculum.lessons.map((lesson) => lesson.id);
      const combinedExperienceText = [
        research.sources[0]?.summary,
        draft.promise,
        curriculum.title,
        curriculum.promise,
        ...curriculum.concepts.map((concept) => `${concept.title} ${concept.unlockHint}`),
        ...curriculum.lessons.map((lesson) => lesson.promptGoal),
        bundle.lesson.explanation,
        bundle.post.body,
        ...bundle.comments.map((comment) => comment.body),
        bundle.shadowDraft.body
      ].join("\n");

      expect(topicProfile.title).toBe(scenario.topicTitle);
      expect(learnerProfile.background).toBe(scenario.background);
      expect(research.topic).toBe(scenario.topicTitle);
      expect(research.querySet.join("\n")).toContain(scenario.topicTitle);
      expect(research.sources[0]?.summary).toContain(scenario.background);
      expect(curriculum.concepts).toHaveLength(7);
      expect(curriculum.lessons).toHaveLength(7);
      expect(new Set(conceptIds).size).toBe(7);
      expect(new Set(lessonIds).size).toBe(7);
      expect(curriculum.lessons.every((lesson) => lesson.id === `lesson-${lesson.conceptId}-001`)).toBe(true);
      expect(conceptIds.join(" ")).not.toMatch(/wallet|gas|defi|dao|nft/i);
      expect(combinedExperienceText).toContain(scenario.topicTitle);
      expect(combinedExperienceText).toContain(scenario.goal);
      expect(combinedExperienceText).not.toMatch(/Web3|钱包|Gas|链上|Fintech|金融科技|心理学/);
      expect(new Set(bundle.comments.map((comment) => comment.stance)).size).toBeGreaterThanOrEqual(3);
    }
  });
});
