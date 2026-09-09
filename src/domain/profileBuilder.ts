import type { LearnerProfile, OnboardingInput, TopicProfile } from "./types";

export function buildProfiles(input: OnboardingInput): { topicProfile: TopicProfile; learnerProfile: LearnerProfile } {
  const topicTitle = normalizeTitle(input.topicTitle);
  const topicId = slugifyTopic(topicTitle);

  return {
    topicProfile: {
      topicId,
      title: topicTitle,
      userRawGoal: input.goal.trim() || `轻松看懂 ${topicTitle} 的讨论`,
      targetDepth: input.targetDepth,
      language: "zh-CN",
      dayCount: 7
    },
    learnerProfile: {
      background: input.background.trim() || "普通兴趣学习者",
      knownAreas: inferKnownAreas(input.background),
      avoidedStyles: normalizeAvoidedStyles(input.avoidedStyles),
      dailyMinutes: input.dailyMinutes,
      motivation: input.goal.trim() || "低压力探索新知识",
      preferredTone: input.preferredTone
    }
  };
}

function normalizeTitle(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "AI 入门";
  return trimmed.includes("入门") ? trimmed : `${trimmed} 入门`;
}

function slugifyTopic(value: string): string {
  const ascii = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  if (ascii) return ascii.slice(0, 48);

  let hash = 0;
  for (const char of value) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return `topic-${hash.toString(36)}`;
}

function inferKnownAreas(background: string): string[] {
  const areas: string[] = [];
  if (/ai|人工智能|机器学习|工程师|算法/i.test(background)) areas.push("AI/技术背景");
  if (/产品|pm|增长|运营/i.test(background)) areas.push("产品和用户体验");
  if (/金融|投资|fintech|银行|支付/i.test(background)) areas.push("金融常识");
  if (/心理|咨询|教育/i.test(background)) areas.push("心理学兴趣");
  return areas.length ? areas : ["普通兴趣学习者"];
}

function normalizeAvoidedStyles(value: string | undefined): string[] {
  const defaults = ["长篇术语堆砌", "考试式讲解"];
  const custom = (value ?? "")
    .split(/[,，、;；\n]/)
    .map((item) => item.trim())
    .filter(Boolean);
  return Array.from(new Set([...custom, ...defaults])).slice(0, 6);
}
