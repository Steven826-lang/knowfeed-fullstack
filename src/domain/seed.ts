import type { Concept, FeedAuthor, LearnerProfile, StableLesson, TopicProfile, ValidatedCurriculum } from "./types";

// Sample fallback topic for the current prototype. Product logic must not assume
// Web3 is the only supported domain; future work should replace this with
// user-selected topics and LLM-planned curricula.
export const topicTitle = "Web3 入门：看懂链上世界的争论";

export const sampleTopicProfile: TopicProfile = {
  topicId: "web3-sample",
  title: topicTitle,
  userRawGoal: "想看懂 Web3 相关讨论",
  targetDepth: "conversational",
  language: "zh-CN",
  dayCount: 7
};

export const sampleLearnerProfile: LearnerProfile = {
  background: "我是产品经理，想了解 Web3 但不懂技术。",
  knownAreas: ["产品体验", "互联网应用"],
  avoidedStyles: ["过度技术细节"],
  dailyMinutes: 5,
  motivation: "能看懂行业讨论",
  preferredTone: "debate-heavy"
};

export const concepts: Concept[] = [
  {
    id: "wallet",
    title: "钱包不是账户",
    plainName: "Web3 钱包",
    order: 1,
    unlockHint: "下一步会解释为什么“登录”在 Web3 里经常变成“签名”。",
    prerequisiteIds: [],
    mastery: 0
  },
  {
    id: "gas",
    title: "Gas 费到底在买什么",
    plainName: "Gas 费",
    order: 2,
    unlockHint: "学完它之后，评论区里关于“链上操作贵不贵”的吵架会更好懂。",
    prerequisiteIds: ["wallet"],
    mastery: 0
  },
  {
    id: "defi-risk",
    title: "DeFi 收益和风险不是一回事",
    plainName: "DeFi 风险",
    order: 3,
    unlockHint: "下一阶段会看到为什么高收益帖子最容易误导新手。",
    prerequisiteIds: ["wallet", "gas"],
    mastery: 0
  },
  {
    id: "governance",
    title: "DAO 投票不等于民主",
    plainName: "DAO 治理",
    order: 4,
    unlockHint: "它会解释为什么很多“社区共识”其实被少数地址左右。",
    prerequisiteIds: ["defi-risk"],
    mastery: 0
  }
];

export const stableLessons: StableLesson[] = [
  {
    id: "lesson-wallet-001",
    conceptId: "wallet",
    day: 1,
    estimatedMinutes: 4,
    promptGoal: "让普通兴趣学习者理解 Web3 钱包不是平台账户，而是私钥控制权的入口。",
    choices: [
      {
        id: "wallet-choice-a",
        label: "钱包更像一把能证明“我是我”的钥匙",
        correct: true,
        feedback: "对。钱包不是某个平台给你的账号，而是你用来证明控制权的钥匙。"
      },
      {
        id: "wallet-choice-b",
        label: "钱包就是交易所里的用户名",
        correct: false,
        feedback: "不太对。交易所账号是平台托管，Web3 钱包强调你自己控制签名和资产。"
      },
      {
        id: "wallet-choice-c",
        label: "钱包只是存币余额的页面",
        correct: false,
        feedback: "它会显示余额，但核心不是页面，而是私钥和签名能力。"
      }
    ]
  },
  {
    id: "lesson-gas-001",
    conceptId: "gas",
    day: 2,
    estimatedMinutes: 5,
    promptGoal: "解释 Gas 费是给网络资源和交易打包优先级付费，不是平台随便收的手续费。",
    choices: [
      {
        id: "gas-choice-a",
        label: "Gas 是链上计算和写入空间的竞价成本",
        correct: true,
        feedback: "对。链上资源有限，Gas 把计算、存储和优先级变成价格信号。"
      },
      {
        id: "gas-choice-b",
        label: "Gas 是 App 公司收的会员费",
        correct: false,
        feedback: "不对。Gas 通常和底层网络资源相关，不是某个 App 的会员费。"
      },
      {
        id: "gas-choice-c",
        label: "Gas 越高代表项目越安全",
        correct: false,
        feedback: "不对。Gas 高只能说明资源竞争激烈，不能直接说明项目安全。"
      }
    ]
  },
  {
    id: "lesson-defi-risk-001",
    conceptId: "defi-risk",
    day: 3,
    estimatedMinutes: 5,
    promptGoal: "解释 DeFi 高收益必须拆成收益来源、智能合约风险、流动性风险和对手方风险。",
    choices: [
      {
        id: "defi-risk-choice-a",
        label: "先问收益从哪里来，再问风险由谁承担",
        correct: true,
        feedback: "对。收益和风险要拆开看，不能只看年化数字。"
      },
      {
        id: "defi-risk-choice-b",
        label: "年化越高说明协议越强",
        correct: false,
        feedback: "不对。高年化经常意味着补贴、杠杆、流动性或合约风险更高。"
      },
      {
        id: "defi-risk-choice-c",
        label: "只要很多人用就没有智能合约风险",
        correct: false,
        feedback: "不对。使用人数不能替代审计、代码质量和风险隔离。"
      }
    ]
  },
  {
    id: "lesson-governance-001",
    conceptId: "governance",
    day: 4,
    estimatedMinutes: 4,
    promptGoal: "让学习者理解 DAO 治理可能受到代币集中、投票冷漠和提案信息差影响。",
    choices: [
      {
        id: "governance-choice-a",
        label: "看投票权分布，比只看投票口号更重要",
        correct: true,
        feedback: "对。DAO 是否公平，关键要看权力结构和参与机制。"
      },
      {
        id: "governance-choice-b",
        label: "DAO 有投票就一定民主",
        correct: false,
        feedback: "不对。投票机制不等于真实权力平均分配。"
      },
      {
        id: "governance-choice-c",
        label: "治理和普通用户完全无关",
        correct: false,
        feedback: "不对。治理结果会影响费率、激励、风险参数和产品方向。"
      }
    ]
  }
];

export const sampleCurriculum: ValidatedCurriculum = {
  curriculumId: "sample-web3-curriculum",
  source: "sample-seed",
  topic: sampleTopicProfile,
  learner: sampleLearnerProfile,
  title: topicTitle,
  promise: "7 天内用低压力任务看懂 Web3 评论区里最常见的争论。",
  concepts,
  lessons: stableLessons
};

export const authors: FeedAuthor[] = [
  {
    id: "hot-take-ai",
    displayName: "链上热评机",
    handle: "@hotchain",
    role: "AI 热点号",
    stance: "看热闹"
  },
  {
    id: "skeptic-ai",
    displayName: "不买账研究员",
    handle: "@skeptic",
    role: "AI 挑刺号",
    stance: "反对派"
  },
  {
    id: "builder-ai",
    displayName: "产品工地人",
    handle: "@builder",
    role: "AI 建设派",
    stance: "支持派"
  },
  {
    id: "shadow",
    displayName: "你的学习分身",
    handle: "@my-shadow",
    role: "AI 分身",
    stance: "学习分身"
  }
];

export function getConcept(conceptId: string): Concept {
  const concept = concepts.find((item) => item.id === conceptId);
  if (!concept) throw new Error(`Unknown concept: ${conceptId}`);
  return concept;
}

export function getLesson(lessonId: string): StableLesson {
  const lesson = stableLessons.find((item) => item.id === lessonId);
  if (!lesson) throw new Error(`Unknown lesson: ${lessonId}`);
  return lesson;
}

export function getLessonByConcept(conceptId: string): StableLesson {
  const lesson = stableLessons.find((item) => item.conceptId === conceptId);
  if (!lesson) throw new Error(`Unknown lesson for concept: ${conceptId}`);
  return lesson;
}
