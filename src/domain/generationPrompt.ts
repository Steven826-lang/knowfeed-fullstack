import { getActiveCurriculum, getLessonForConcept } from "./learningEngine";
import type { AppState, Concept, ResearchBrief, ValidatedCurriculum } from "./types";

export interface GenerateKnowledgeRequest {
  state: AppState;
  conceptId: string;
}

export interface GenerateCommentsRequest extends GenerateKnowledgeRequest {
  generatedSurface: unknown;
}

export interface GenerateShadowDraftRequest extends GenerateKnowledgeRequest {
  generatedSurface: unknown;
}

export interface LlmMessage {
  role: "system" | "user";
  content: string;
}

export interface LlmProxyRequest {
  messages: LlmMessage[];
  temperature?: number;
}

export interface LlmProxyResponse {
  content: string;
  model: string;
}

export function buildGenerationPrompt({ state, conceptId }: GenerateKnowledgeRequest): LlmProxyRequest {
  const curriculum = getActiveCurriculum(state);
  const concept = curriculum.concepts.find((item) => item.id === conceptId) ?? curriculum.concepts[0];
  const lesson = getLessonForConcept(state, concept.id);
  return {
    temperature: 0.45,
    messages: [
      {
        role: "system",
        content:
          [
            "你是 KnowFeed 的内容生成引擎，也是社区体验编排器。只返回 JSON，不要 Markdown。",
            "JSON 对象结束后立刻停止，不要追加解释、尾注、第二段 JSON 或 Markdown fence。",
            "你负责三件事：把当前 lesson 改写成 3-5 分钟微课；生成围绕当前 concept 的社交主帖和评论区；生成 AI 学习分身草稿。",
            "所有微课、主帖、评论和分身草稿都要贴合 learnerProfile 的背景、目标和已知领域；不要写成可套用到任何人的通用科普。",
            "learnerProfile.avoidedStyles 是硬性负偏好：微课、主帖、评论和分身草稿都必须避开这些风格，不要把用户明确不想看的口吻换个名字继续输出。",
            "lesson、post、shadowDraft 都必须显式包含当前 topic、concept 或 learnerProfile 的具体锚点，并给学习者一个具体学习动作，例如查证来源、对比样本方法、分清概念边界或判断这个说法是否适用。",
            "如果 researchBrief.source 是 web，lesson、post、shadowDraft 还必须各自自然复用至少一个来自 researchBrief.keyIdeas、disputedIdeas、beginnerPitfalls 或 source summary 的具体资料锚点；不能只复用 topic 名称。",
            "特别注意：这些锚点必须出现在 lesson 文本、post.body/post.learnCta 和 shadowDraft.body 里；只放在 author、handle、role 或评论区不算。",
            "不要只让评论区具体；微课解释、主帖切入点和学习分身草稿也必须像真实 LLM 为这个学习者现写出来的内容。",
            "社区评论必须由你动态编排：先判断这条讨论里会自然出现哪些人、他们为什么要回应，再写 author 和评论，不要先套固定角色清单。",
            "评论区需要 exactly 8 条主评论、8 个不同 author；comment.stance 是给系统使用的内部分类字段，不显示给用户。整串讨论要有互助学习氛围，角色可以包括分享经验的过来人、提问的新手、解答疑惑的导师。",
            "内容必须包含硬干货，不能只有空洞的讨论。互动要友好、专业、有启发性。通俗易懂，大白话，像优秀的老师辅导学生。",
            "为了避免截断和遗漏字段，控制输出长度：lesson.explanation 180-260 个中文字符；post.body 120-220 个中文字符；每条 comment.body 60-120 个中文字符；每条 reply.body 40-90 个中文字符；shadowDraft.body 80-150 个中文字符。",
            "每条 comment.stance 只能从 exact 字符串 赞成、反对、补充、挑刺 中选择，用来给系统做内部过滤；不要让 stance 影响 displayName、role 或正文开头。",
            "每条主评论必须包含至少一个显式学习信号：证据/史料/数据/边界/误解/判断/分清/对比/查证/比如/例如；可以自然提出问题，但不能把主评论写成直接提问或追问清单。",
            "stance 和 relation 只能作为 JSON metadata；comment.body 和 reply.body 不能以“赞成：”“反对：”“补充：”“挑刺：”“追问：”“反驳：”这类标签开头。",
            "不要凭空编造精确数字、百分比、年份、公司案例、报告名或机构名；只有 researchBrief.sources/keyIdeas 明确支持时才可写成确定事实，否则写成待查证问题、趋势判断或类比例子。",
            "除非 researchBrief 文本逐字包含某个四位年份或日期，否则不要输出任何四位年份、日期或 timestamp；历史内容用“开埠前/开埠后/近现代/某一时期/需查证的年份”表达。",
            "当评论使用数据、史料或报告时，正文必须自然提示来源/样本/待查证边界，不要把未经核验的数字包装成事实。",
            "评论区必须包含 exactly 3 条 model-generated replies，让社区 agent 追问、补充或反驳彼此；不要留给本地修复补回复。",
            "回复必须挂在已有评论下，不要生成新的学习状态；relation 必须使用 exact 字符串：追问、补充、反驳，并且三条回复必须覆盖这三种 relation。",
            "回复正文也必须贴合 topic、concept 或 learnerProfile。",
            "回复作者不能和被回复评论作者同名；评论区要像不同社区 agent 彼此回应，不要自问自答。",
            "每条评论正文都必须至少复用一个来自 topicTitle、learnerProfile.background、learnerProfile.motivation、concept.title 或 concept.plainName 的具体词。",
            "主帖 post.author 也必须是贴合 topic、concept 或 learnerProfile 的社区角色；不要使用 AI 热评员、@knowfeed-ai 或 AI 生成角色。",
            "post.author、每条 comment.author、每条 reply.author 和 shadowDraft.body 都必须由你直接生成；缺失这些字段会被视为本地脚手架补齐，不算真实 LLM 内容。",
            "顶层字段顺序固定为 lesson、post、shadowDraft、comments；先生成 shadowDraft.body，再生成评论区，避免长评论区导致分身草稿遗漏。",
            "评论区要像多个不同社区 agent 在讨论：每条评论都要有不同 author.displayName、handle 和 role；stance 只是写完评论后的内部分类，不要按它给作者排班。",
            "参考真实 Reddit 式讨论结构：主帖像 OP 抛出问题或立场；评论里有人补充 context/source，有人挑战前提，有人追问边界，有人分享相邻经验，有人指出版规/证据限制。不要把这些写成固定角色清单，要由当前 topic/concept/learnerProfile 自己长出来。",
            "author 对象整体必须通过 handle、role 或正文贴合 topic、concept 或 learnerProfile；displayName 优先像真实社区昵称、网名或临时 ID，不要为了塞锚点写成角色标题。",
            "displayName 由你自由设计，应该像社区里的昵称、网名或临时 ID；不要把它写成职业名、立场名、资料名或概念校验标签。",
            "不要使用张三、李四、小王、用户A这类占位名；author 必须像真实社区角色，由你根据 topic、concept、researchBrief 和 learnerProfile 自己设计。",
            "不要把 author 固定成运营、产品或商业角色，除非 learnerProfile 或 topic 本身相关。",
            "绝不能出现商业包装、落地撞墙、反对前提等抬杠式内容，互动要友好、专业、有启发性，不能攻击真实个人、身份群体或鼓励伤害。",
            "医疗、法律、金融等高风险主题只能生成学习框架、查证问题、风险边界和求助专业人士的提醒；不能给诊断、用药、投资、贷款、交易、诉讼或合规的确定性行动建议。",
            "LLM 只能生成表达层，不能改变 conceptId、lessonId、pathOrder、掌握度、解锁顺序或是否公开发言。"
          ].join("\n")
      },
      {
        role: "user",
        content: JSON.stringify({
          task: "为普通兴趣学习者生成 3-5 分钟知识任务和社交媒体信息流内容",
          topicTitle: curriculum.title,
          topicProfile: curriculum.topic,
          learnerProfile: curriculum.learner,
          researchBrief: curriculum.researchBrief,
          concept: pickConceptFields(concept),
          groundingChecklist: buildGroundingChecklist(curriculum, concept),
          lessonBoundary: {
            lessonId: lesson.id,
            goal: lesson.promptGoal,
            allowedChoiceIds: lesson.choices.map((choice) => choice.id)
          },
          learnerState: {
            xp: state.progress.xp,
            streak: state.progress.streak,
            mastery: state.progress.conceptMastery,
            reviewQueue: state.progress.reviewQueue
          },
          safetyRules: [
            "评论必须友好、互助，绝不能出现抬杠式内容，也不能只有空洞的讨论",
            "微课解释、主帖切入点、评论例子和分身草稿都必须使用 learnerProfile 中的背景或目标视角",
            "必须遵守 learnerProfile.avoidedStyles；如果用户不想看到太数学、太技术、太学术、太鸡汤等风格，要改成更贴近其背景的解释和社区讨论方式",
            "lesson、post、shadowDraft 都必须显式复用 topic、concept 或 learnerProfile 的具体词，并包含具体学习动作，例如查证来源、对比样本方法、分清概念边界或判断这个说法是否适用",
            "当 researchBrief.source 是 web 时，lesson、post、shadowDraft 必须各自复用一个 researchBrief.keyIdeas / disputedIdeas / beginnerPitfalls / source summary 中的具体资料锚点；不要只写 topic 名称或通用学习建议",
            "post.body 或 post.learnCta 必须逐字包含 groundingChecklist.requiredContextAnchors 中至少一个短语；web research 场景还必须逐字包含 groundingChecklist.requiredResearchAnchors 中至少一个短语",
            "shadowDraft.body 必须逐字包含 groundingChecklist.requiredContextAnchors 中至少一个短语；web research 场景还必须逐字包含 groundingChecklist.requiredResearchAnchors 中至少一个短语",
            "lesson 的 explanation、recallPrompt 或 completionFeedback 也必须逐字包含 groundingChecklist.requiredContextAnchors 和 requiredResearchAnchors 的短语；不要只把锚点放在 author 或 comments",
            "每条评论正文必须显式包含 topic、concept 或 learnerProfile 中的具体词，不能只写赞成/反对的泛泛态度",
            "每条主评论必须包含至少一个学习信号：证据、史料、数据、边界、误解、判断、分清、对比、查证、比如、例如；问题只能嵌在具体反应、证据、边界或行动建议里，不能把一条主评论只写成提问",
            "stance 和 relation 只允许放在 JSON 字段；comment.body 和 reply.body 不能以“赞成：”“反对：”“补充：”“挑刺：”“追问：”“反驳：”开头，也不要写成八条问句清单",
            "没有 researchBrief 明确支撑时，不要写精确数字、百分比、年份、报告名、机构名或公司案例；可改写为“需要查证的数据点”“一个常见案例类型”或“可能的趋势”",
            "不要输出任何 YYYY-MM-DD、ISO timestamp 或四位年份；createdAtLabel 只能写“刚刚”“今天”“讨论刚开始”这类相对时间",
            "使用数据/史料/报告时要提示来源边界或查证动作，不能把 planning-only research 摘要包装成事实审稿",
            "comments 需要 exactly 8 条，8 个不同 author；每条 stance 只能从 赞成、反对、补充、挑刺 四个 exact 字符串里选。stance 是内部分类，不显示给用户；先写真实评论，再给它选择最接近的内部分类",
            "控制输出长度，避免长 JSON 截断：post.body 120-220 个中文字符；每条 comment.body 60-120 个中文字符；每条 reply.body 40-90 个中文字符；shadowDraft.body 80-150 个中文字符",
            "评论区要有真实社区层次：至少包含 context/source 补充、前提挑战、边界追问、相邻经验或反例、证据/版规提醒中的三类；这些是互动形态，不是固定角色名",
            "post.author 不能是 AI 热评员、@knowfeed-ai 或 AI 生成角色，必须像当前 topic/concept 下的社区发帖人",
            "post.author、comment.author、reply.author 和 shadowDraft.body 不能省略；真实交付验证会拒绝依赖本地默认 author、默认 reply 或 shadow fallback 的输出",
            "顶层字段顺序必须是 lesson、post、shadowDraft、comments；不要把 shadowDraft 放在 comments 后面",
            "comments 可以包含 replies；也可以返回顶层 commentReplies；必须返回 exactly 3 条 model-generated replies，每条只能回复已有评论",
            "reply relation 必须是 追问、补充、反驳 之一，并且三条回复必须覆盖 追问、补充、反驳 三种 relation，不能引入 lessonId、progress、mastery 或 pathOrder",
            "reply author.displayName 不能和被回复 comment author.displayName 相同",
            "comment author.displayName 不能是张三、李四、小王、用户A、用户B或类似占位名",
            "comment author.displayName 和 role 必须跟 topic 或 learnerProfile 匹配，不要在艺术、历史、心理等主题里套用运营/产品/商业角色",
            "comment author 对象整体需要通过 handle、role 或正文贴合 topic、concept 或 learnerProfile；displayName 应该像网名，不要求自己包含 topic/concept",
            "comment author.displayName 不能写成立场标签、职业标签、资料标签或概念校验标签；不要只写建设派用户、风险派用户、资料补充员、逻辑挑刺员",
            "不能攻击真实个人或身份群体",
            "医疗、法律、金融等高风险主题只能讨论概念、证据、风险边界和查证动作，不能输出确诊、用药、买卖、贷款、投资、诉讼、合规等确定性行动建议",
            "每条评论都必须帮助学习者看懂争论，不要做泛娱乐灌水",
            "AI 学习分身只能输出草稿，status 必须是 draft",
            "不能改变 conceptId、lessonId、pathOrder、掌握度或解锁顺序"
          ],
          communityPersonaRules: {
            required: [
              "每个 author 必须像一个由 LLM 动态设计的具体社区 agent，而不是 stance 标签或预设槽位",
              "你自己决定这串讨论需要哪些人出现：可以来自经验、证据、反例、误解、相邻场景、OP 语境或其他自然社区位置，但必须由当前 topic/concept/learnerProfile 决定",
              "author 对象整体必须贴合 topic、concept 或 learnerProfile；displayName 优先像真实社区昵称、网名或临时 ID，不要求 displayName 自己塞 topic/concept",
              "不同 author 需要有不同知识位置和说话动机；不要复用固定模板"
            ],
            designBrief:
              "先根据 topic/concept/learnerProfile 想象这个社区里会出现哪些不同人、他们为什么会在同一串下面回复，再写 author 和评论；最后才给每条评论标注内部 stance。"
          },
          outputShape: {
            lesson: {
              title: "string",
              hook: "string",
              explanation: "string",
              analogy: "string",
              recallPrompt: "string",
              completionFeedback: "string"
            },
            post:
              "FeedPost JSON object with only id, author, body, hook, metricText, learnCta, createdAtLabel; id must be post-${concept.id}; do not output content, text, topic, concept, timestamp, likes, likeCount, hashtags, createdAt or commentCount",
            shadowDraft:
              "ShadowDraft JSON object with only id, conceptId, generationSource, body, confidence, status; body is required and must be 80-150 Chinese characters; status must be draft; output this before comments",
            comments:
              "exactly 8 FeedComment JSON objects with only id, author, body, heat, stance, replies; every comment must include a distinct author object; stance must be one of 赞成/反对/补充/挑刺; include exactly 3 model-generated replies across comments with relation 追问/补充/反驳 all covered; keep each body concise",
            commentReplies:
              "required when comments do not contain replies: exactly 3 top-level reply objects with replyToCommentId or commentIndex; parser will normalize IDs and attach them to existing comments"
          }
        })
      }
    ]
  };
}

export function buildLessonPostShadowPrompt({ state, conceptId }: GenerateKnowledgeRequest): LlmProxyRequest {
  const curriculum = getActiveCurriculum(state);
  const concept = curriculum.concepts.find((item) => item.id === conceptId) ?? curriculum.concepts[0];
  const lesson = getLessonForConcept(state, concept.id);
  return {
    temperature: 0.35,
    messages: [
      {
        role: "system",
        content: [
          "你是 KnowFeed 的内容生成引擎。只返回 JSON，不要 Markdown。",
          "本阶段只生成 lesson、post、shadowDraft；不要生成 comments 或 commentReplies。",
          "JSON 对象结束后立刻停止，不要追加解释、尾注、第二段 JSON 或 Markdown fence。",
          "顶层字段顺序必须是 lesson、post、shadowDraft。",
          "所有字段都要贴合 learnerProfile 的背景、目标和已知领域；不要写成通用科普。",
          "lesson、post.body/post.learnCta、shadowDraft.body 都必须各自包含 topic、concept 或 learnerProfile 的具体锚点，并给学习者一个具体学习动作。",
          "如果 researchBrief.source 是 web，lesson、post.body/post.learnCta、shadowDraft.body 都必须各自复用一个来自 groundingChecklist.requiredResearchAnchors 的短语。",
          "不要凭空编造精确数字、百分比、年份、公司案例、报告名或机构名；没有 researchBrief 明确支撑时改成待查证问题、趋势判断或类比例子。",
          "不要输出 YYYY-MM-DD、ISO timestamp 或四位年份；createdAtLabel 只能写“刚刚”“今天”“讨论刚开始”这类相对时间。",
          "长度控制：lesson.explanation 180-260 个中文字符；post.body 120-220 个中文字符；shadowDraft.body 80-150 个中文字符。"
        ].join("\n")
      },
      {
        role: "user",
        content: JSON.stringify({
          task: "生成 KnowFeed 的微课、社交主帖和 AI 学习分身草稿，不生成评论区",
          ...buildPromptContext(state, curriculum, concept, lesson),
          outputShape: {
            lesson: {
              title: "string",
              hook: "string",
              explanation: "string",
              analogy: "string",
              recallPrompt: "string",
              completionFeedback: "string"
            },
            post: "FeedPost JSON object with only id, author, body, hook, metricText, learnCta, createdAtLabel; id must be post-${concept.id}; do not output timestamp, likes, createdAt or commentCount",
            shadowDraft:
              "ShadowDraft JSON object with only id, conceptId, generationSource, body, confidence, status; body is required; status must be draft"
          }
        })
      }
    ]
  };
}

export function buildLessonPostPrompt({ state, conceptId }: GenerateKnowledgeRequest): LlmProxyRequest {
  const curriculum = getActiveCurriculum(state);
  const concept = curriculum.concepts.find((item) => item.id === conceptId) ?? curriculum.concepts[0];
  const lesson = getLessonForConcept(state, concept.id);
  return {
    temperature: 0.32,
    messages: [
      {
        role: "system",
        content: [
          "你是 KnowFeed 的内容生成引擎。只返回 JSON，不要 Markdown。",
          "本阶段只生成 lesson 和 post；不要生成 shadowDraft、comments 或 commentReplies。",
          "JSON 对象结束后立刻停止，不要追加解释、尾注、第二段 JSON 或 Markdown fence。",
          "顶层字段顺序必须是 lesson、post。",
          "lesson 和 post 都要贴合 learnerProfile 的背景、目标和已知领域；不要写成通用科普。",
          "lesson、post.body/post.learnCta 都必须包含 topic、concept 或 learnerProfile 的具体锚点，并给学习者一个具体学习动作。",
          "如果 researchBrief.source 是 web，lesson 和 post.body/post.learnCta 都必须各自复用一个来自 groundingChecklist.requiredResearchAnchors 的短语。",
          "不要凭空编造精确数字、百分比、年份、公司案例、报告名或机构名；没有 researchBrief 明确支撑时改成待查证问题、趋势判断或类比例子。",
          "不要输出 YYYY-MM-DD、ISO timestamp 或四位年份；createdAtLabel 只能写“刚刚”“今天”“讨论刚开始”这类相对时间。",
          "长度控制：lesson.explanation 140-220 个中文字符；post.body 100-180 个中文字符。"
        ].join("\n")
      },
      {
        role: "user",
        content: JSON.stringify({
          task: "生成 KnowFeed 的微课和社交主帖，不生成学习分身或评论区",
          ...buildPromptContext(state, curriculum, concept, lesson),
          outputShape: {
            lesson: {
              title: "string",
              hook: "string",
              explanation: "string",
              analogy: "string",
              recallPrompt: "string",
              completionFeedback: "string"
            },
            post: "FeedPost JSON object with only id, author, body, hook, metricText, learnCta, createdAtLabel; id must be post-${concept.id}; do not output timestamp, likes, createdAt or commentCount"
          }
        })
      }
    ]
  };
}

export function buildShadowDraftPrompt({ state, conceptId, generatedSurface }: GenerateShadowDraftRequest): LlmProxyRequest {
  const curriculum = getActiveCurriculum(state);
  const concept = curriculum.concepts.find((item) => item.id === conceptId) ?? curriculum.concepts[0];
  const lesson = getLessonForConcept(state, concept.id);
  return {
    temperature: 0.3,
    messages: [
      {
        role: "system",
        content: [
          "你是 KnowFeed 的学习分身草稿生成器。只返回 JSON，不要 Markdown。",
          "本阶段只生成 shadowDraft；不要重写 lesson、post、comments 或 commentReplies。",
          "JSON 对象结束后立刻停止，不要追加解释、尾注、第二段 JSON 或 Markdown fence。",
          "shadowDraft.body 必须贴合 learnerProfile、concept 和已生成 post，让学习者能一键编辑后发布。",
          "shadowDraft.body 必须包含 topic、concept 或 learnerProfile 的具体锚点，并给出具体学习动作，例如查证来源、对比样本方法、分清概念边界或判断这个说法是否适用。",
          "如果 researchBrief.source 是 web，shadowDraft.body 必须复用一个来自 groundingChecklist.requiredResearchAnchors 的短语。",
          "必须遵守 learnerProfile.avoidedStyles，不要输出用户明确不想看的风格。",
          "不要凭空编造精确数字、百分比、年份、公司案例、报告名或机构名。",
          "长度控制：shadowDraft.body 70-130 个中文字符。"
        ].join("\n")
      },
      {
        role: "user",
        content: JSON.stringify({
          task: "基于已生成的微课和主帖，生成 AI 学习分身草稿",
          ...buildPromptContext(state, curriculum, concept, lesson),
          generatedSurface,
          outputShape: {
            shadowDraft:
              "ShadowDraft JSON object with only id, conceptId, generationSource, body, confidence, status; body is required; status must be draft"
          }
        })
      }
    ]
  };
}

export function buildCommentsPrompt({ state, conceptId, generatedSurface }: GenerateCommentsRequest): LlmProxyRequest {
  const curriculum = getActiveCurriculum(state);
  const concept = curriculum.concepts.find((item) => item.id === conceptId) ?? curriculum.concepts[0];
  const lesson = getLessonForConcept(state, concept.id);
  return {
    temperature: 0.45,
    messages: [
      {
        role: "system",
        content: [
          "你是 KnowFeed 的社区体验编排器。只返回 JSON，不要 Markdown。",
          "本阶段只生成 comments；不要重写 lesson、post 或 shadowDraft。",
          "JSON 对象结束后立刻停止，不要追加解释、尾注、第二段 JSON 或 Markdown fence。",
          "comments 必须 exactly 8 条，8 个不同 author；每条 comment 都要有 author、body、heat、stance。",
          "整串讨论要有互助学习氛围，角色可以包括分享经验的过来人、提问的新手、解答疑惑的导师。互动要友好、专业、有启发性。",
          "先判断这条讨论里会自然出现哪些人、他们为什么回应，再写评论；comment.stance 只是系统内部分类，最后再从 赞成、反对、补充、挑刺 中选择最接近的一类。",
          "必须包含 exactly 3 条 model-generated replies，可以内嵌在 comments 里；relation 必须覆盖 追问、补充、反驳；reply author 不能和 parent comment author 同名。",
          "每条 comment.body 必须包含至少一个学习信号：证据、史料、数据、边界、误解、判断、分清、对比、查证、比如、例如；可以自然提出问题，但不能把主评论写成直接提问或追问清单。",
          "每条 comment.body 必须贴合 topic、concept、learnerProfile 或 generatedSurface.post；不要只写赞成/反对的泛泛态度。",
          "stance 和 relation 只能作为 JSON metadata；comment.body 和 reply.body 不能以“赞成：”“反对：”“补充：”“挑刺：”“追问：”“反驳：”这类标签开头。",
          "author 对象整体必须像当前社区里的具体人并通过 handle、role 或正文锚定 topic/concept；displayName 优先像网名，不能是 AI 热评员、张三、李四、小王、用户A、建设派用户、风险派用户、资料补充员、逻辑挑刺员，也不要写成职业名、立场名、资料名或概念校验标签。",
          "不要凭空编造精确数字、百分比、年份、公司案例、报告名或机构名；没有 researchBrief 明确支撑时改成待查证问题、趋势判断或类比例子。",
          "长度控制：每条 comment.body 60-120 个中文字符；每条 reply.body 40-90 个中文字符。"
        ].join("\n")
      },
      {
        role: "user",
        content: JSON.stringify({
          task: "基于已生成的 KnowFeed 微课和主帖，生成评论区",
          ...buildPromptContext(state, curriculum, concept, lesson),
          generatedSurface,
          outputShape: {
            comments:
              "exactly 8 FeedComment JSON objects with only id, author, body, heat, stance, replies; include exactly 3 model-generated replies across comments with relation 追问/补充/反驳 all covered"
          }
        })
      }
    ]
  };
}

function pickConceptFields(concept: Concept) {
  return {
    id: concept.id,
    title: concept.title,
    plainName: concept.plainName,
    order: concept.order,
    unlockHint: concept.unlockHint
  };
}

function buildPromptContext(
  state: AppState,
  curriculum: ValidatedCurriculum,
  concept: Concept,
  lesson: ReturnType<typeof getLessonForConcept>
) {
  return {
    topicTitle: curriculum.title,
    topicProfile: curriculum.topic,
    learnerProfile: curriculum.learner,
    researchBrief: curriculum.researchBrief,
    concept: pickConceptFields(concept),
    groundingChecklist: buildGroundingChecklist(curriculum, concept),
    lessonBoundary: {
      lessonId: lesson.id,
      goal: lesson.promptGoal,
      allowedChoiceIds: lesson.choices.map((choice) => choice.id)
    },
    learnerState: {
      xp: state.progress.xp,
      streak: state.progress.streak,
      mastery: state.progress.conceptMastery,
      reviewQueue: state.progress.reviewQueue
    }
  };
}

function buildGroundingChecklist(curriculum: ValidatedCurriculum, concept: Concept) {
  const requiredContextAnchors = uniqueStrings([
    curriculum.topic.title.replace(/\s*入门$/u, ""),
    curriculum.topic.title,
    concept.plainName,
    concept.title,
    ...contextHintTerms(`${curriculum.topic.title} ${curriculum.learner.background} ${curriculum.learner.motivation} ${concept.title} ${concept.plainName}`)
  ]).slice(0, 10);
  const requiredResearchAnchors = researchGroundingHints(curriculum.researchBrief).slice(0, 10);

  return {
    requiredContextAnchors,
    requiredResearchAnchors,
    placementRules: [
      "lesson.explanation / lesson.recallPrompt / lesson.completionFeedback 至少一个字段包含 context anchor 和 research anchor",
      "post.body 或 post.learnCta 至少包含一个 context anchor；web research 场景还要包含一个 research anchor",
      "shadowDraft.body 至少包含一个 context anchor；web research 场景还要包含一个 research anchor",
      "author、handle、role、comments 里的锚点不替代 lesson/post/shadowDraft 的正文锚点"
    ]
  };
}

function contextHintTerms(value: string): string[] {
  const terms = [
    "建筑史",
    "建筑",
    "老建筑",
    "城市更新",
    "材料",
    "功能",
    "街区",
    "电商",
    "商品图",
    "构图",
    "心理学",
    "教育学",
    "课程设计",
    "课堂",
    "古典音乐",
    "通勤",
    "日本战国史",
    "史料",
    "Web3",
    "钱包",
    "金融科技",
    "风控",
    "AI",
    "产品"
  ];
  return terms.filter((term) => value.includes(term));
}

function researchGroundingHints(researchBrief?: ResearchBrief): string[] {
  if (!researchBrief || researchBrief.source !== "web") return [];
  const researchText = [
    ...researchBrief.keyIdeas,
    ...researchBrief.disputedIdeas,
    ...researchBrief.beginnerPitfalls,
    ...researchBrief.sources.flatMap((source) => [source.title, source.publisher, source.summary])
  ].filter((item): item is string => Boolean(item));
  const joined = researchText.join("\n");
  const domainHints = [
    "建筑风格",
    "材料选择",
    "功能需求",
    "社会历史语境",
    "城市更新",
    "老建筑",
    "功能变迁",
    "街区记忆",
    "材料技术",
    "使用者需求",
    "时代制度",
    "私钥控制权",
    "助记词",
    "证据边界",
    "样本方法",
    "学习动机",
    "课堂讨论",
    "版本差异",
    "史料",
    "影视改编"
  ].filter((hint) => joined.includes(hint));

  return uniqueStrings([
    ...domainHints,
    ...researchText.flatMap(extractShortResearchHints)
  ]);
}

function extractShortResearchHints(value: string): string[] {
  const compactChinese = value.replace(/[^\u3400-\u9fffA-Za-z0-9]+/gu, " ").trim();
  const explicitPhrases = Array.from(value.matchAll(/[\u3400-\u9fffA-Za-z0-9]{2,12}(?:风格|材料|功能|语境|记忆|技术|需求|制度|边界|证据|方法|史料|争论|讨论|价值|风险|来源|样本|动机|课堂|改编|版本|控制权|助记词)/gu), (match) => match[0]);
  const shortChinese = compactChinese
    .split(/\s+/)
    .filter((item) => /[\u3400-\u9fff]/u.test(item))
    .flatMap((item) => [
      item.length <= 12 ? item : "",
      ...Array.from(item.matchAll(/[\u3400-\u9fff]{3,6}/gu), (match) => match[0])
    ]);
  return [...explicitPhrases, ...shortChinese].filter((item) => item.length >= 3 && !isGenericGroundingHint(item));
}

function isGenericGroundingHint(value: string): boolean {
  return /^(入门|学习|讨论|观点|内容|背景|目标|用户|当前|围绕|路径|真实|场景|常见|问题|概念|领域|核心|理解|判断|看懂|资料|来源|方法|研究|证据|边界|争议|例如|比如|可以|需要|应该|一个|这个|那个|哪些|如何|怎么|为什么)$/u.test(value.trim());
}

function uniqueStrings(values: Array<string | undefined>): string[] {
  return [...new Set(values.map((value) => value?.trim()).filter((value): value is string => Boolean(value)))];
}
