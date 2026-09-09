import type { LlmProxyRequest } from "./generationPrompt";
import { requestGeneratedContent } from "./llmClient";
import { buildPlannerPrompt, parsePlannerDraft } from "./plannerContracts";
import type { GeneratedCurriculumDraft, LearnerProfile, ResearchBrief, TopicProfile } from "./types";

export async function generateCurriculumDraft(
  topicProfile: TopicProfile,
  learnerProfile: LearnerProfile,
  researchBrief: ResearchBrief,
  client: (request: LlmProxyRequest) => Promise<string> = requestGeneratedContent
): Promise<{ draft: GeneratedCurriculumDraft; usedFallback: boolean }> {
  if (researchBrief.source === "fallback") {
    return {
      draft: buildFallbackDraft(topicProfile, learnerProfile, researchBrief),
      usedFallback: true
    };
  }

  const generationAttempts = 3;
  const basePrompt = buildPlannerPrompt({ topicProfile, learnerProfile, researchBrief });

  for (let attempt = 0; attempt < generationAttempts; attempt += 1) {
    try {
      const request =
        attempt === 0
          ? basePrompt
          : {
              ...basePrompt,
              messages: [
                ...basePrompt.messages,
                {
                  role: "user" as const,
                  content: buildPlannerRetryFeedback(attempt, generationAttempts)
                }
              ]
            };
      const raw = await client(request);
      const draft = parsePlannerDraft(raw);
      if (draft) return { draft, usedFallback: false };
    } catch {
      // Retry below; fallback remains deterministic if every planner attempt fails.
    }
  }

  return {
    draft: buildFallbackDraft(topicProfile, learnerProfile, researchBrief),
    usedFallback: true
  };
}

function buildPlannerRetryFeedback(attempt: number, generationAttempts: number): string {
  const base =
    "上一次课程草案没有通过 KnowFeed planner schema。请只返回 JSON，不要 Markdown；顶层必须是 title、promise、days；days 至少 7 项，每天 1 个 concepts[0]；每个 concept 必须有 temporaryName、plainLanguageGoal、prerequisiteNames、misconceptionToFix、feedHook、sourceUrls。不要输出 conceptId、lessonId、progress、mastery 或 pathOrder。";
  if (attempt < generationAttempts - 1) return base;
  return `${base} 这是最后一次重试；如果不确定 sourceUrls，就返回空数组；如果没有前置概念，就返回空数组。`;
}

export function buildFallbackDraft(
  topic: TopicProfile,
  learner: LearnerProfile,
  research: ResearchBrief
): GeneratedCurriculumDraft {
  const profileLens = buildProfileLens(learner.background);
  const topicKind = classifyTopic(topic.title);
  const templates = topicTemplates(topic.title, profileLens, research);
  const selected = templates[topicKind].map(tupleToItem);

  return {
    title: `${topic.title}：7 天核心知识与技能突破`,
    promise: `每天 ${learner.dailyMinutes} 分钟，用${profileLens}的视角掌握 ${topic.title} 的核心基础与实战应用。`,

    days: selected.map((item, index) => ({
      day: index + 1,
      title: item.title,
      whyNow: item.hook,
      concepts: [
        {
          temporaryName: item.concept,
          plainLanguageGoal: item.goal,
          prerequisiteNames: index === 0 ? [] : [selected[index - 1].concept],
          misconceptionToFix: item.misconception,
          feedHook: item.hook,
          sourceUrls: research.sources.map((source) => source.url).slice(0, 3)
        }
      ]
    }))
  };
}

function classifyTopic(title: string): "ai" | "fintech" | "psychology" | "web3" | "generic" {
  const lower = title.toLowerCase();
  if (lower.includes("fintech") || title.includes("金融科技")) return "fintech";
  if (title.includes("心理")) return "psychology";
  if (lower.includes("web3") || title.includes("区块链")) return "web3";
  if (lower.includes("ai") || title.includes("人工智能") || title.includes("大模型")) return "ai";
  return "generic";
}

function buildProfileLens(background: string): string {
  if (/工程师|算法|开发|ai/i.test(background)) return "技术人看业务系统";
  if (/产品经理|pm/i.test(background)) return "产品经理看用户场景";
  if (/运营|增长/i.test(background)) return `${extractBackgroundLabel(background)}看用户场景`;
  if (/普通|兴趣|小白|不懂/i.test(background)) return "普通用户看社交讨论";
  return `${extractBackgroundLabel(background)}看讨论`;
}

function extractBackgroundLabel(background: string): string {
  return background
    .replace(/^我是/, "")
    .replace(/[，。,.].*$/g, "")
    .replace(/\s+/g, "")
    .slice(0, 12) || "你的背景";
}

function topicTemplates(topicTitle: string, lens: string, research: ResearchBrief) {
  const sources = research.keyIdeas.join("；") || `${topicTitle} 的入门资料`;
  return {
    fintech: [
      ["Fintech 到底解决什么问题", "分清支付、信贷、风控、合规各自服务谁", "Fintech 不是把金融 App 做得更炫", "为什么金融科技公司总说自己不是银行？"],
      ["支付网络和钱包", "看懂资金流、清结算和用户体验的关系", "支付快不等于金融系统简单", "一个支付按钮背后到底有多少参与方？"],
      ["信贷和风控", "理解为什么数据、模型和监管会绑在一起", "AI 风控不是越黑箱越先进", "AI 批贷款到底是在普惠还是在贴标签？"],
      ["监管科技", "看懂合规为什么是产品约束而不是事后补丁", "监管不是创新的纯敌人", "为什么 Fintech 热帖总绕不开牌照？"],
      ["开放银行和 API", "理解数据授权如何改变金融服务分发", "开放不等于随便拿数据", "你的银行数据能不能像登录 App 一样流动？"],
      ["AI 金融助手", "判断聊天式金融产品哪里有价值、哪里危险", "会聊天不等于能给建议", "AI 理财助手是效率工具还是责任黑洞？"],
      ["行业讨论地图", `用${lens}视角串起商业模式、风控和信任`, "只看概念会错过真实约束", "看懂下一条 Fintech 热帖先问哪个问题？"]
    ],
    psychology: [
      ["心理学和大众心理学", "区分研究、临床和社交媒体观点", "热词不等于科学结论", "为什么人人都在说创伤，却越说越乱？"],
      ["认知偏差", "看懂人为什么会系统性判断失误", "偏差不是骂人笨", "确认偏误是不是互联网吵架的底层燃料？"],
      ["情绪调节", "理解情绪不是压下去，而是识别和处理", "情绪稳定不等于没情绪", "情绪价值到底是不是伪概念？"],
      ["依恋关系", "看懂亲密关系讨论里的高频标签", "依恋类型不是给人判刑", "回避型是不是被短视频玩坏了？"],
      ["动机和习惯", "理解行为改变为什么需要反馈和环境", "自律不是唯一解释", "为什么打卡产品比鸡汤更有用？"],
      ["心理测评", "判断测评什么时候有用，什么时候是包装", "四字母标签不能解释全部人格", "MBTI 是社交货币还是心理学？"],
      ["讨论安全边界", `用${lens}视角参与讨论但不乱贴诊断`, "心理学不能替代专业帮助", "普通人聊心理学最该避开什么坑？"]
    ],
    ai: [
      ["AI 能力边界", "分清模型会生成、会检索、会执行的差别", "AI 不是万能大脑", "大模型到底是在理解还是高级补全？"],
      ["数据和训练", "理解数据如何塑造模型表现和偏见", "参数大不自动等于可靠", "为什么 AI 会一本正经胡说？"],
      ["Prompt 和工作流", "看懂 prompt 为什么只是入口，不是全部产品", "会写提示词不等于会落地 AI", "Prompt 工程是不是被高估了？"],
      ["评估和幻觉", "理解为什么上线 AI 必须做评测和兜底", "demo 顺滑不等于生产可靠", "AI 产品最容易骗过谁？"],
      ["Agent 和工具调用", "分清聊天助手和能执行任务的系统", "Agent 不是越自主越好", "AI Agent 为什么看起来聪明、用起来不稳？"],
      ["成本和权限", "理解模型成本、隐私和企业系统接入", "便宜 token 不代表低成本", "AI 公司为什么总卡在数据权限？"],
      ["AI 产品判断", `用${lens}视角判断一个 AI 产品是否真有价值`, "只看模型名会错过场景", "下次看到 AI 热帖先问哪三个问题？"]
    ],
    web3: [
      ["钱包不是账号", "理解签名、控制权和平台账号的差别", "钱包不只是登录按钮", "把钱包讲成账号是不是在误导新手？"],
      ["Gas 费", "看懂交易成本、拥堵和激励", "Gas 不是单纯手续费", "Gas 费到底是不是体验灾难？"],
      ["DeFi 收益", "识别收益、风险和合约漏洞", "高 APY 不等于稳赚", "DeFi 高收益帖子哪里最会骗人？"],
      ["DAO 治理", "理解投票权、利益和组织效率", "投票不等于民主自动实现", "DAO 为什么常被大户带节奏？"],
      ["NFT 和所有权", "区分链上记录、版权和社群价值", "买 NFT 不等于买走一切权利", "NFT 是文化资产还是截图泡沫？"],
      ["监管和合规", "看懂去中心化和现实规则的冲突", "去中心化不是免监管", "Web3 公司为什么总说自己只是协议？"],
      ["Web3 讨论地图", `用${lens}视角看懂控制权、风险和叙事`, "别被术语遮住真实利益", "下一条 Web3 热帖先看哪里？"]
    ],
    generic: [
      [`${topicTitle} 核心基础`, `用${lens}视角掌握最基石的概念与规则：${sources}`, "基础不等于简单", `什么是 ${topicTitle} 的底层逻辑？`],
      ["结构与逻辑", "看懂基础概念如何组合与运转", "孤立的知识没有意义", "这些概念是如何串联起来的？"],
      ["关键难点与易错点", "识别新手最容易踩坑的地方", "知道易错点才能少走弯路", "为什么很多人在这里卡住？"],
      ["实战应用", "把概念放回真实场景中去使用", "理论必须结合实际", "这个知识在真实场景中怎么用？"],
      ["进阶技巧", "掌握更高效的方法与最佳实践", "好方法能事半功倍", `高手是如何运用 ${topicTitle} 的？`],
      ["核心心法", "理解背后的思维方式与本质", "心法比招式更重要", "掌握这门技能的关键思维是什么？"],
      ["拓展与演进", `用${lens}视角看懂未来的发展与边界`, "学完基础只是开始", "下一步应该向哪里拓展？"]
    ]
  } as const;
}

type TemplateTuple = readonly [string, string, string, string];

function tupleToItem(tuple: TemplateTuple) {
  return {
    title: tuple[0],
    concept: tuple[0],
    goal: tuple[1],
    misconception: tuple[2],
    hook: tuple[3]
  };
}
