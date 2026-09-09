import { describe, expect, it } from "vitest";
import { validateCurriculumDraft } from "./curriculumValidator";
import { buildProfiles } from "./profileBuilder";
import { buildFallbackResearchBrief } from "./researchEngine";
import { buildFallbackDraft } from "./topicPlanner";
import type { OnboardingInput } from "./types";

function buildValidated(input: OnboardingInput) {
  const { topicProfile, learnerProfile } = buildProfiles(input);
  const research = buildFallbackResearchBrief(topicProfile, learnerProfile);
  const draft = buildFallbackDraft(topicProfile, learnerProfile, research);
  return validateCurriculumDraft(draft, topicProfile, learnerProfile, research);
}

describe("curriculum pipeline", () => {
  it("builds seven-day validated curricula for non-Web3 topics", () => {
    const topics = ["AI 入门", "Fintech 入门", "心理学入门"];

    for (const topicTitle of topics) {
      const curriculum = buildValidated({
        topicTitle,
        background: "我是普通兴趣用户，想低压力看懂讨论。",
        goal: "看懂行业讨论",
        dailyMinutes: 5,
        targetDepth: "conversational",
        preferredTone: "debate-heavy"
      });

      expect(curriculum.source).toBe("planner");
      expect(curriculum.concepts).toHaveLength(7);
      expect(curriculum.lessons).toHaveLength(7);
      expect(new Set(curriculum.concepts.map((concept) => concept.id)).size).toBe(7);
      expect(curriculum.lessons.every((lesson) => lesson.id.startsWith("lesson-"))).toBe(true);
    }
  });

  it("changes the curriculum promise for the same topic when background changes", () => {
    const engineer = buildValidated({
      topicTitle: "Fintech 入门",
      background: "我是 AI 工程师，想了解 Fintech。",
      goal: "看懂行业讨论",
      dailyMinutes: 5,
      targetDepth: "conversational",
      preferredTone: "debate-heavy"
    });
    const product = buildValidated({
      topicTitle: "Fintech 入门",
      background: "我是产品经理，想判断 Fintech 产品机会。",
      goal: "看懂产品和行业讨论",
      dailyMinutes: 5,
      targetDepth: "strategic",
      preferredTone: "professional"
    });

    expect(engineer.promise).not.toEqual(product.promise);
  });
});
