import { describe, expect, it } from "vitest";
import { buildPlannerPrompt } from "./plannerContracts";
import { buildProfiles } from "./profileBuilder";
import { buildFallbackResearchBrief } from "./researchEngine";
import { generateCurriculumDraft } from "./topicPlanner";

describe("topicPlanner", () => {
  it("passes avoided learner styles into the planner prompt as hard negative preferences", () => {
    const { topicProfile, learnerProfile } = buildProfiles({
      topicTitle: "古典音乐",
      background: "我是普通兴趣用户，听过一些曲子但不懂乐理。",
      avoidedStyles: "乐理黑话、学院派长文",
      goal: "能看懂乐评和评论区在说结构、情绪还是演奏",
      dailyMinutes: 5,
      targetDepth: "casual",
      preferredTone: "light"
    });
    const researchBrief = buildFallbackResearchBrief(topicProfile, learnerProfile);
    const prompt = buildPlannerPrompt({ topicProfile, learnerProfile, researchBrief });
    const combined = prompt.messages.map((message) => message.content).join("\n");

    expect(learnerProfile.avoidedStyles).toEqual(
      expect.arrayContaining(["乐理黑话", "学院派长文", "长篇术语堆砌", "考试式讲解"])
    );
    expect(combined).toContain("learnerProfile.avoidedStyles 是硬性负偏好");
    expect(combined).toContain("不要输出用户明确不想看的口吻、难度或表达套路");
    expect(combined).toContain("乐理黑话");
    expect(combined).toContain("学院派长文");
  });

  it("retries invalid planner output before using the deterministic fallback", async () => {
    const { topicProfile, learnerProfile } = buildProfiles({
      topicTitle: "日本战国史",
      background: "我是内容编辑，想看懂人物关系、制度和影视改编争论。",
      goal: "能分清历史叙事、史料和影视化改编",
      dailyMinutes: 5,
      targetDepth: "conversational",
      preferredTone: "debate-heavy"
    });
    const researchBrief = {
      ...buildFallbackResearchBrief(topicProfile, learnerProfile),
      source: "web" as const,
      sources: [
        {
          title: "日本战国史入门资料",
          url: "https://example.org/sengoku",
          publisher: "Example History",
          retrievedAt: "2026-06-18T00:00:00.000Z",
          summary: "日本战国史入门资料强调人物关系、制度变化和影视改编边界。",
          reliabilityNote: "用于测试 planner web research retry。",
          qualityScore: 8,
          qualitySignals: ["topic-match"],
          factReviewStatus: "planning-only" as const
        }
      ]
    };
    const responses = [
      "不是 JSON",
      JSON.stringify({
        title: "日本战国史入门：7 天讨论路径",
        promise: "每天 5 分钟，用内容编辑视角看懂人物、史料和影视改编争论。",
        days: [1, 2, 3].map((day) => ({
          day,
          title: `第 ${day} 天`,
          whyNow: "先把争论放回史料和叙事边界。",
          concepts: [
            {
              temporaryName: `战国史概念 ${day}`,
              plainLanguageGoal: "用自己的话分清史料、人物关系和影视化改编。",
              prerequisiteNames: day === 1 ? [] : [`战国史概念 ${day - 1}`],
              misconceptionToFix: "影视剧情等于史实",
              feedHook: "评论区为什么总把戏剧化当史实？",
              sourceUrls: []
            }
          ]
        }))
      })
    ];
    const seenPrompts: string[] = [];

    const result = await generateCurriculumDraft(topicProfile, learnerProfile, researchBrief, async (request) => {
      seenPrompts.push(request.messages.map((message) => message.content).join("\n"));
      return responses.shift() ?? responses[0];
    });

    expect(result.usedFallback).toBe(false);
    expect(result.draft.title).toContain("日本战国史");
    expect(seenPrompts).toHaveLength(2);
    expect(seenPrompts[1]).toContain("上一次课程草案没有通过 KnowFeed planner schema");
  });

  it("uses deterministic draft immediately when research falls back", async () => {
    const { topicProfile, learnerProfile } = buildProfiles({
      topicTitle: "建筑史",
      background: "我是城市更新从业者，想看懂不同建筑风格、材料和历史语境。",
      goal: "能判断建筑作品背后的时代、功能和审美争论",
      dailyMinutes: 5,
      targetDepth: "conversational",
      preferredTone: "debate-heavy"
    });
    const researchBrief = buildFallbackResearchBrief(topicProfile, learnerProfile);
    const client = async () => {
      throw new Error("planner should not be called for fallback research");
    };

    const result = await generateCurriculumDraft(topicProfile, learnerProfile, researchBrief, client);

    expect(result.usedFallback).toBe(true);
    expect(result.draft.days).toHaveLength(7);
    expect(result.draft.title).toContain("建筑史");
  });
});
