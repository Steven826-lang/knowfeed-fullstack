import type { LearnerProfile, ResearchBrief, TopicProfile } from "./types";

export interface ResearchRequest {
  topicProfile: TopicProfile;
  learnerProfile: LearnerProfile;
}

export async function fetchResearchBrief(request: ResearchRequest): Promise<ResearchBrief> {
  try {
    const response = await fetch("/api/research", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        topic: request.topicProfile.title,
        goal: request.topicProfile.userRawGoal,
        background: request.learnerProfile.background
      })
    });

    if (!response.ok) throw new Error(`Research proxy returned ${response.status}`);
    const brief = (await response.json()) as ResearchBrief;
    if (!isResearchBrief(brief)) throw new Error("Research brief schema mismatch");
    return brief;
  } catch {
    return buildFallbackResearchBrief(request.topicProfile, request.learnerProfile);
  }
}

export function buildFallbackResearchBrief(topic: TopicProfile, learner: LearnerProfile): ResearchBrief {
  const lowerTopic = topic.title.toLowerCase();
  const topicKind = lowerTopic.includes("fintech")
    ? "fintech"
    : topic.title.includes("心理")
      ? "psychology"
      : lowerTopic.includes("ai") || topic.title.includes("人工智能")
        ? "ai"
        : "generic";

  const presets = {
    fintech: {
      ideas: ["支付、风控、信贷和监管科技是 Fintech 入门的四个抓手", "技术能力必须落到信任、合规和业务效率上"],
      disputes: ["创新速度和监管边界经常冲突", "AI 风控到底是普惠还是黑箱"],
      pitfalls: ["把 Fintech 等同于炒币", "只看技术名词，不看金融业务约束"]
    },
    psychology: {
      ideas: ["心理学入门要区分实验发现、临床实践和大众心理学", "认知偏差、情绪调节和依恋关系是高频讨论入口"],
      disputes: ["流行心理学经常过度简化研究结论", "人格标签容易变成自我合理化"],
      pitfalls: ["把单个实验当成普遍真理", "用诊断词随便评价别人"]
    },
    ai: {
      ideas: ["AI 入门要同时理解模型能力、数据边界和产品落地", "生成式 AI 的价值来自工作流重组，不只是聊天"],
      disputes: ["大模型是否真的推理仍有争议", "AI 产品经常高估 demo、低估交付"],
      pitfalls: ["把 prompt 当成全部能力", "忽略评估、成本和数据权限"]
    },
    generic: {
      ideas: [`${topic.title} 可以先拆成核心概念、真实场景和常见争议`, "先学能解释讨论的概念，再追求系统完整性"],
      disputes: ["入门内容容易被过度包装", "热点讨论常把不同层次的问题混在一起"],
      pitfalls: ["先背术语而不是理解问题", "把单一观点当成领域共识"]
    }
  }[topicKind];

  return {
    topic: topic.title,
    querySet: [`${topic.title} beginner guide`, `${topic.title} 常见争议`, `${topic.title} 入门`],
    sources: [
      {
        title: `${topic.title} fallback brief`,
        url: "local:fallback-research-brief",
        retrievedAt: new Date(0).toISOString(),
        summary: `离线兜底 brief：面向${learner.background}，围绕“${topic.userRawGoal}”组织 7 天入门路径。`,
        reliabilityNote: "Fallback 内容用于无网络或测试场景；仅作为 planning-only 演示，不是事实审稿。",
        qualityScore: 0,
        qualitySignals: ["fallback", "planning-only"],
        factReviewStatus: "planning-only"
      }
    ],
    keyIdeas: presets.ideas,
    disputedIdeas: presets.disputes,
    beginnerPitfalls: presets.pitfalls,
    source: "fallback"
  };
}

function isResearchBrief(value: unknown): value is ResearchBrief {
  const brief = value as ResearchBrief;
  return Boolean(
    brief &&
      typeof brief.topic === "string" &&
      Array.isArray(brief.querySet) &&
      Array.isArray(brief.sources) &&
      brief.sources.every((source) => typeof source.url === "string" && typeof source.retrievedAt === "string") &&
      Array.isArray(brief.keyIdeas) &&
      Array.isArray(brief.disputedIdeas) &&
      Array.isArray(brief.beginnerPitfalls) &&
      ["web", "fallback"].includes(brief.source)
  );
}
