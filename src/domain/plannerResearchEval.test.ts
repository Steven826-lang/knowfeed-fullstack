import { describe, expect, it } from "vitest";
import { validateCurriculumDraft } from "./curriculumValidator";
import { evaluatePlannerResearchFit } from "./plannerResearchEval";
import { buildProfiles } from "./profileBuilder";
import { buildFallbackDraft } from "./topicPlanner";
import type { GeneratedCurriculumDraft, OnboardingInput, ResearchBrief, TopicProfile } from "./types";

const scenarios: Array<{ input: OnboardingInput; expectedLens: string }> = [
  {
    input: {
      topicTitle: "气候变化政策",
      background: "我是城市规划从业者，想看懂减排和适应政策讨论。",
      goal: "能分清政策工具、利益相关方和常见争议",
      dailyMinutes: 10,
      targetDepth: "practical",
      preferredTone: "professional"
    },
    expectedLens: "城市规划从业者"
  },
  {
    input: {
      topicTitle: "摄影构图",
      background: "我是电商运营，想让商品图更会讲故事。",
      goal: "能判断构图选择和视觉叙事",
      dailyMinutes: 5,
      targetDepth: "practical",
      preferredTone: "professional"
    },
    expectedLens: "电商运营"
  },
  {
    input: {
      topicTitle: "教育学",
      background: "我是新手课程设计师，想理解学习动机和课堂讨论。",
      goal: "能看懂教学方法背后的证据和争议",
      dailyMinutes: 10,
      targetDepth: "strategic",
      preferredTone: "professional"
    },
    expectedLens: "新手课程设计师"
  }
];

describe("plannerResearchEval", () => {
  it("passes arbitrary-topic planner drafts that preserve research and learner fit", () => {
    for (const scenario of scenarios) {
      const { topicProfile, learnerProfile } = buildProfiles(scenario.input);
      const researchBrief = buildWebResearchBrief(topicProfile);
      const draft = buildFallbackDraft(topicProfile, learnerProfile, researchBrief);
      const curriculum = validateCurriculumDraft(draft, topicProfile, learnerProfile, researchBrief, "planner");
      const result = evaluatePlannerResearchFit({
        topicProfile,
        learnerProfile,
        researchBrief,
        draft,
        curriculum
      });
      const combinedPathText = [
        draft.promise,
        ...draft.days.flatMap((day) => [
          day.title,
          day.whyNow,
          ...day.concepts.map((concept) => concept.plainLanguageGoal)
        ]),
        curriculum.promise,
        ...curriculum.lessons.map((lesson) => lesson.promptGoal)
      ].join("\n");

      expect(result.passed, formatFailures(result.checks)).toBe(true);
      expect(result.score).toBe(result.maxScore);
      expect(combinedPathText).toContain(scenario.input.topicTitle);
      expect(combinedPathText).toContain(scenario.expectedLens);
      expect(curriculum.concepts).toHaveLength(topicProfile.dayCount);
      expect(curriculum.lessons.every((lesson) => lesson.id === `lesson-${lesson.conceptId}-001`)).toBe(true);
    }
  });

  it("fails drafts that leak sample content or let the LLM own stable state", () => {
    const { topicProfile, learnerProfile } = buildProfiles(scenarios[0].input);
    const researchBrief = buildWebResearchBrief(topicProfile);
    const draft = buildFallbackDraft(topicProfile, learnerProfile, researchBrief) as GeneratedCurriculumDraft & {
      conceptId?: string;
      days: Array<GeneratedCurriculumDraft["days"][number] & { mastery?: number }>;
    };
    draft.title = "Web3 钱包和 Gas 费速成";
    draft.conceptId = "wallet";
    draft.days[0].mastery = 80;
    const curriculum = validateCurriculumDraft(draft, topicProfile, learnerProfile, researchBrief, "planner");
    const result = evaluatePlannerResearchFit({
      topicProfile,
      learnerProfile,
      researchBrief,
      draft,
      curriculum
    });
    const checks = Object.fromEntries(result.checks.map((check) => [check.id, check]));

    expect(result.passed).toBe(false);
    expect(checks["state-boundary"].passed).toBe(false);
    expect(checks["state-boundary"].detail).toContain("conceptId");
    expect(checks["state-boundary"].detail).toContain("mastery");
    expect(checks["forbidden-sample-leakage"].passed).toBe(false);
  });

  it("fails research briefs whose sources do not match the requested topic", () => {
    const { topicProfile, learnerProfile } = buildProfiles(scenarios[1].input);
    const researchBrief = {
      ...buildWebResearchBrief(topicProfile),
      sources: [
        offTopicSource("历史王朝更替概览"),
        offTopicSource("烹饪火候和调味入门"),
        offTopicSource("城市交通信号灯维护")
      ]
    };
    const draft = buildFallbackDraft(topicProfile, learnerProfile, researchBrief);
    const curriculum = validateCurriculumDraft(draft, topicProfile, learnerProfile, researchBrief, "planner");
    const result = evaluatePlannerResearchFit({
      topicProfile,
      learnerProfile,
      researchBrief,
      draft,
      curriculum
    });
    const researchCheck = result.checks.find((check) => check.id === "research-brief-quality");
    const sourceQualityCheck = result.checks.find((check) => check.id === "source-quality-signals");

    expect(result.passed).toBe(false);
    expect(researchCheck?.passed).toBe(false);
    expect(researchCheck?.detail).toContain("0 topic-relevant sources");
    expect(sourceQualityCheck?.passed).toBe(false);
  });
});

function buildWebResearchBrief(topicProfile: TopicProfile): ResearchBrief {
  const topic = topicProfile.title;
  return {
    topic,
    querySet: [`${topic} 入门`, `${topic} 常见争议`, `${topic} 实践案例`],
    sources: [
      sourceFor(topic, "核心概念", `这份资料解释 ${topic} 的核心概念、常见误解和讨论边界。`),
      sourceFor(topic, "现实应用", `这份资料整理 ${topic} 在真实场景里的应用、约束和证据来源。`),
      sourceFor(topic, "争议地图", `这份资料比较 ${topic} 的支持理由、反对理由和初学者常见坑。`)
    ],
    keyIdeas: [`${topic} 的核心概念`, `${topic} 的现实应用`, `${topic} 的证据边界`],
    disputedIdeas: [`${topic} 的支持理由和反对理由不同`, `${topic} 的入门内容常被过度简化`],
    beginnerPitfalls: [`把 ${topic} 的术语当成理解`, `只看单一观点而不看 ${topic} 的证据`],
    source: "web"
  };
}

function sourceFor(topic: string, title: string, summary: string): ResearchBrief["sources"][number] {
  return {
    title: `${topic} ${title}`,
    url: `https://example.test/${encodeURIComponent(topic)}/${encodeURIComponent(title)}`,
    publisher: "Example Research",
    retrievedAt: "2026-06-11T00:00:00.000Z",
    summary,
    reliabilityNote: `${topic} source, used only as a deterministic eval fixture for planning context only; not a complete fact review.`,
    qualityScore: 12,
    qualitySignals: ["topic-match", "summary-depth", "planning-only"],
    factReviewStatus: "planning-only"
  };
}

function offTopicSource(title: string): ResearchBrief["sources"][number] {
  return {
    title,
    url: `https://example.test/off-topic/${encodeURIComponent(title)}`,
    publisher: "Example Research",
    retrievedAt: "2026-06-11T00:00:00.000Z",
    summary: `${title}，不讨论当前学习主题。`,
    reliabilityNote: "Deliberately unrelated fixture for negative eval coverage."
  };
}

function formatFailures(checks: Array<{ id: string; passed: boolean; detail: string }>): string {
  return checks
    .filter((check) => !check.passed)
    .map((check) => `${check.id}: ${check.detail}`)
    .join("\n");
}
