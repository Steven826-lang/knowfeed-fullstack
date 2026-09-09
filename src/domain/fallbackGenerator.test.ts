import { describe, expect, it } from "vitest";
import { validateCurriculumDraft } from "./curriculumValidator";
import { buildFallbackBundle } from "./fallbackGenerator";
import { buildProfiles } from "./profileBuilder";
import { buildFallbackResearchBrief } from "./researchEngine";
import { defaultAppState } from "./storage";
import { buildFallbackDraft } from "./topicPlanner";
import type { OnboardingInput } from "./types";

function buildState(input: OnboardingInput) {
  const { topicProfile, learnerProfile } = buildProfiles(input);
  const research = buildFallbackResearchBrief(topicProfile, learnerProfile);
  const draft = buildFallbackDraft(topicProfile, learnerProfile, research);
  const curriculum = validateCurriculumDraft(draft, topicProfile, learnerProfile, research, "deterministic-fallback");
  return {
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
}

describe("fallbackGenerator", () => {
  it("does not leak the Web3 sample persona into arbitrary-topic fallback content", () => {
    const state = buildState({
      topicTitle: "Fintech 入门",
      background: "我是 AI 工程师，想了解金融科技。",
      goal: "看懂行业讨论",
      dailyMinutes: 5,
      targetDepth: "conversational",
      preferredTone: "debate-heavy"
    });
    const conceptId = state.curriculum.concepts[0].id;

    const bundle = buildFallbackBundle(state, conceptId);
    const authorText = [
      bundle.post.author.displayName,
      bundle.post.author.handle,
      ...bundle.comments.flatMap((comment) => [comment.author.displayName, comment.author.handle])
    ].join(" ");

    expect(authorText).not.toMatch(/链上|hotchain/i);
  });

  it("keeps fallback community agents topic-fit instead of generic AI personas", () => {
    const state = buildState({
      topicTitle: "心理学入门",
      background: "我是普通兴趣用户，想看懂心理学讨论。",
      goal: "看懂研究和社交平台争论",
      dailyMinutes: 5,
      targetDepth: "conversational",
      preferredTone: "debate-heavy"
    });
    const conceptId = state.curriculum.concepts[0].id;

    const bundle = buildFallbackBundle(state, conceptId);
    const authorText = [
      bundle.post.author.displayName,
      bundle.post.author.role,
      ...bundle.comments.flatMap((comment) => [comment.author.displayName, comment.author.role])
    ].join("\n");

    expect(bundle.comments.map((comment) => comment.stance)).toEqual(["赞成", "反对", "补充", "挑刺"]);
    expect(new Set(bundle.comments.map((comment) => comment.author.displayName)).size).toBe(4);
    expect(authorText).toContain("心理学");
    expect(authorText).not.toMatch(/AI 热点号|AI 建设派|AI 挑刺号|AI 热评员/);
    expect(bundle.comments[2].body).toContain("查证");
    expect(bundle.comments[2].body).toContain("来源");
  });
});
