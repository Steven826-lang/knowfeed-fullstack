import { describe, expect, it } from "vitest";
import { buildGenerationPrompt, diagnoseGeneratedPayload, parseGeneratedPayload } from "./llmContracts";
import { defaultAppState } from "./storage";

describe("llmContracts", () => {
  it("prompts the community agent to create learning-focused stance diversity", () => {
    const prompt = buildGenerationPrompt({ state: defaultAppState, conceptId: "wallet" });
    const combined = prompt.messages.map((message) => message.content).join("\n");

    expect(combined).toContain("社区体验编排器");
    expect(combined).toContain("都要贴合 learnerProfile");
    expect(combined).toContain("不要写成可套用到任何人的通用科普");
    expect(combined).toContain("learnerProfile.avoidedStyles 是硬性负偏好");
    expect(combined).toContain("不要把用户明确不想看的口吻换个名字继续输出");
    expect(combined).toContain("lesson、post、shadowDraft 都必须显式包含当前 topic、concept 或 learnerProfile 的具体锚点");
    expect(combined).toContain("lesson、post、shadowDraft 还必须各自自然复用至少一个来自 researchBrief.keyIdeas");
    expect(combined).toContain("这些锚点必须出现在 lesson 文本、post.body/post.learnCta 和 shadowDraft.body 里");
    expect(combined).toContain("groundingChecklist");
    expect(combined).toContain("post.body 或 post.learnCta 必须逐字包含 groundingChecklist.requiredContextAnchors");
    expect(combined).toContain("shadowDraft.body 必须逐字包含 groundingChecklist.requiredContextAnchors");
    expect(combined).toContain("不要只让评论区具体");
    expect(combined).toContain("微课解释、主帖切入点和学习分身草稿也必须像真实 LLM 为这个学习者现写出来的内容");
    expect(combined).toContain("必须使用 learnerProfile 中的背景或目标视角");
    expect(combined).toContain("必须遵守 learnerProfile.avoidedStyles");
    expect(combined).toContain("支持");
    expect(combined).toContain("反对");
    expect(combined).toContain("补充");
    expect(combined).toContain("挑刺");
    expect(combined).toContain("exactly 8 条主评论");
    expect(combined).toContain("8 个不同 author");
    expect(combined).toContain("post.body 120-220 个中文字符");
    expect(combined).toContain("参考真实 Reddit 式讨论结构");
    expect(combined).toContain("社区评论必须由你动态编排");
    expect(combined).toContain("先判断这条讨论里会自然出现哪些人");
    expect(combined).toContain("comment.stance 是给系统使用的内部分类字段，不显示给用户");
    expect(combined).toContain("先写真实评论，再给它选择最接近的内部分类");
    expect(combined).toContain("displayName 由你自由设计");
    expect(combined).not.toContain("comments 的前四条必须按顺序使用 exact stance 字符串");
    expect(combined).toContain("exactly 3 条 model-generated replies");
    expect(combined).toContain("relation 必须使用 exact 字符串：追问、补充、反驳");
    expect(combined).toContain("不要留给本地修复补回复");
    expect(combined).toContain("三条回复必须覆盖 追问、补充、反驳 三种 relation");
    expect(combined).toContain("回复作者不能和被回复评论作者同名");
    expect(combined).toContain("reply author.displayName 不能和被回复 comment author.displayName 相同");
    expect(combined).toContain("comments 可以包含 replies");
    expect(combined).toContain("顶层 commentReplies");
    expect(combined).toContain("每条评论正文都必须至少复用一个来自 topicTitle");
    expect(combined).toContain("每条评论正文必须显式包含 topic、concept 或 learnerProfile 中的具体词");
    expect(combined).toContain("lesson、post、shadowDraft 都必须显式复用 topic、concept 或 learnerProfile 的具体词");
    expect(combined).toContain("主帖 post.author 也必须是贴合 topic、concept 或 learnerProfile 的社区角色");
    expect(combined).toContain("post.author 不能是 AI 热评员、@knowfeed-ai 或 AI 生成角色");
    expect(combined).toContain("post.author、每条 comment.author、每条 reply.author 和 shadowDraft.body 都必须由你直接生成");
    expect(combined).toContain("不算真实 LLM 内容");
    expect(combined).toContain("不同社区 agent");
    expect(combined).toContain("不要使用 AI 热评员");
    expect(combined).toContain("author 对象整体必须通过 handle、role 或正文贴合 topic、concept 或 learnerProfile");
    expect(combined).toContain("displayName 优先像真实社区昵称、网名或临时 ID");
    expect(combined).toContain("不能以“赞成：”“反对：”“补充：”“挑刺：”“追问：”“反驳：”开头");
    expect(combined).toContain("不要把它写成职业名、立场名、资料名或概念校验标签");
    expect(combined).toContain("communityPersonaRules");
    expect(combined).toContain("你自己决定这串讨论需要哪些人出现");
    expect(combined).toContain("不同 author 需要有不同知识位置和说话动机；不要复用固定模板");
    expect(combined).not.toContain("communityAgentRoles");
    expect(combined).toContain("不要使用张三、李四、小王、用户A这类占位名");
    expect(combined).toContain("不要把 author 固定成运营、产品或商业角色");
    expect(combined).not.toContain("风险派运营");
    expect(combined).toContain("每条评论都必须帮助学习者看懂争论");
    expect(combined).toContain("每条主评论必须包含至少一个显式学习信号");
    expect(combined).toContain("证据/史料/数据/边界/误解/判断/分清/对比/查证/比如/例如");
    expect(combined).toContain("不要凭空编造精确数字、百分比、年份、公司案例、报告名或机构名");
    expect(combined).toContain("只有 researchBrief.sources/keyIdeas 明确支持时才可写成确定事实");
    expect(combined).toContain("不要只写 topic 名称或通用学习建议");
    expect(combined).toContain("不能把 planning-only research 摘要包装成事实审稿");
    expect(combined).toContain("医疗、法律、金融等高风险主题只能生成学习框架、查证问题、风险边界和求助专业人士的提醒");
    expect(combined).toContain("不能输出确诊、用药、买卖、贷款、投资、诉讼、合规等确定性行动建议");
    expect(combined).toContain("不能改变 conceptId、lessonId、pathOrder");
  });

  it("normalizes English community stances and object-form shadow drafts from real responses", () => {
    const payload = parseGeneratedPayload(
      JSON.stringify({
        lesson: {
          title: "心理学 vs 大众心理学",
          hook: "先分清研究和传播。",
          explanation: "心理学研究讲究证据和方法，大众心理学通俗但可能失真。",
          analogy: "像菜谱和短视频。",
          recallPrompt: "这个说法来自哪里？",
          completionFeedback: "你已经能追问来源。"
        },
        post: {
          content: "为什么人人都在说创伤，但研究者反而更谨慎？"
        },
        comments: [
          { content: "支持传播能降低门槛。", stance: "support" },
          { content: "反对过度简化科学结论。", stance: "oppose" },
          { content: "补充一点，临床和研究不是一回事。", stance: "supplement" },
          { content: "挑刺：不要把个案当规律。", stance: "critic" }
        ],
        shadowDraft: {
          content: {
            mySummary: "心理学研究讲究证据和方法，大众心理学可能失真。",
            myQuestion: "为什么不同博主解读相反？",
            myOpinion: "大众心理学可以当入口，不能当真理。"
          }
        }
      }),
      "psychology"
    );

    expect(payload?.comments.map((comment) => comment.stance)).toEqual(["赞成", "反对", "补充", "挑刺"]);
    expect(payload?.shadowDraft.body).toContain("大众心理学可以当入口");
  });

  it("parses the first complete generated object when prompt-only JSON has trailing prose", () => {
    const raw = `${JSON.stringify({
      lesson: {
        title: "心理学证据边界",
        hook: "先问证据和方法。",
        explanation: "心理学讨论要看证据和方法，也要注意边界。",
        analogy: "像读地图前先看图例。",
        recallPrompt: "这个说法怎么查证？",
        completionFeedback: "你能先问证据边界了。"
      },
      post: {
        body: "心理学热帖为什么要先问证据边界？"
      },
      comments: [
        { body: "赞成：心理学讨论要先看证据和方法。", stance: "赞成" },
        { body: "反对：不能把个人经验当成研究结论。", stance: "反对" },
        { body: "补充：比如可以对比样本、方法和来源。", stance: "补充" },
        { body: "挑刺：这里要分清科普表达和可验证证据。", stance: "挑刺" }
      ],
      shadowDraft: {
        body: "我会先问心理学观点的证据和边界。",
        status: "draft"
      }
    })}\n\n说明：以上为 JSON。`;

    const payload = parseGeneratedPayload(raw, "psychology-evidence");

    expect(payload?.lesson.title).toBe("心理学证据边界");
    expect(payload?.comments.map((comment) => comment.stance)).toEqual(["赞成", "反对", "补充", "挑刺"]);
  });

  it("fills missing community authors with netlike personas", () => {
    const payload = parseGeneratedPayload(
      JSON.stringify({
        lesson: {
          title: "心理学的科学性",
          hook: "先问可重复证据。",
          explanation: "科学心理学需要可验证的数据。",
          analogy: "像用仪表盘修车，而不是凭感觉。",
          recallPrompt: "这个观点能被检验吗？",
          completionFeedback: "你能先问证据了。"
        },
        post: {
          body: "心理学到底是不是科学？"
        },
        comments: [
          { body: "支持用实验和统计来判断。", stance: "赞成" },
          { body: "反对把复制危机轻轻带过。", stance: "反对" },
          { body: "补充：还要看样本和方法。", stance: "补充" },
          { body: "挑刺：别把态度开放等同于科学。", stance: "挑刺" }
        ],
        shadowDraft: {
          body: "我会先问证据。",
          status: "draft"
        }
      }),
      "psychology-science"
    );

    expect(payload?.comments.map((comment) => comment.author.displayName)).toEqual([
      "先别劝退我",
      "这坑我踩过",
      "半夜补资料",
      "别急着下结论"
    ]);
  });

  it("replaces placeholder post authors with topic-fit community personas", () => {
    const payload = parseGeneratedPayload(
      JSON.stringify({
        lesson: {
          title: "认知失调",
          hook: "先看自洽需求。",
          explanation: "认知失调解释言行不一致时人如何调整信念。",
          analogy: "像给已经做出的选择补理由。",
          recallPrompt: "这是偏好还是自洽？",
          completionFeedback: "你能先问边界了。"
        },
        post: {
          body: "买贵东西后拼命说它好，是心理学里的认知失调吗？",
          author: {
            displayName: "AI 热评员",
            handle: "@knowfeed-ai",
            role: "AI 生成角色"
          }
        },
        comments: [
          { body: "赞成，用认知失调能解释买贵后的自洽。", stance: "赞成" },
          { body: "反对，不能忽略营销和社会认同的边界。", stance: "反对" },
          { body: "补充：费斯廷格实验提供了早期证据。", stance: "补充" },
          { body: "挑刺：这里要分清沉没成本和认知失调。", stance: "挑刺" }
        ],
        shadowDraft: {
          body: "我会先问这个例子是不是认知失调。",
          status: "draft"
        }
      }),
      "cognitive-dissonance",
      {
        topicTitle: "心理学入门",
        learnerBackground: "我是普通兴趣用户，想看懂心理学讨论。",
        learnerGoal: "能看懂心理学研究和社交平台争论",
        conceptTitle: "认知失调",
        conceptPlainName: "认知失调"
      }
    );

    expect(payload?.post.author).toMatchObject({
      displayName: "刚刷到就懵",
      handle: "@kf-scroll-心理学",
      role: "心理学讨论发帖人"
    });
  });

  it("accepts model-owned split author fields in strict scaffold mode", () => {
    const raw = JSON.stringify({
      lesson: {
        title: "Web3钱包的新手边界",
        hook: "先看 Web3钱包 的第一次签名例子。",
        explanation: "Web3钱包学习不能只背概念，要分清托管账户、自托管钱包和助记词边界，再查证每一步操作风险。",
        analogy: "像把家门钥匙拿回自己手里。",
        recallPrompt: "Web3钱包 和平台账户的区别是什么？",
        completionFeedback: "你能把 Web3钱包 放回私钥控制和备份边界里判断。"
      },
      post: {
        body: "Web3钱包到底是新手入口，还是把私钥和助记词风险提前丢给学习者？先看证据、边界和一个具体例子再判断。",
        author: "刚刷到就懵",
        handle: "@wallet-first-scroll",
        role: "Web3钱包讨论观察者"
      },
      comments: [
        {
          body: "我比较站这个入口，先看一个 Web3钱包 具体例子，再判断它解决什么问题和证据边界。",
          stance: "赞成",
          author: { displayName: "先别劝退我", role: "Web3钱包实践视角" },
          replies: [
            {
              relation: "追问",
              body: "我想多问一句：这个例子背后的 Web3钱包 证据和操作边界要一起看。",
              author: { displayName: "证据先别急", role: "Web3钱包学习者视角" }
            }
          ]
        },
        {
          body: "我不太买直接推广的说法，Web3钱包 这个例子需要说明证据、边界和新手失败成本。",
          stance: "反对",
          author: { displayName: "这坑我踩过", role: "Web3钱包边界视角" },
          replies: [
            {
              relation: "反驳",
              body: "这点我反着看：有边界也不代表 Web3钱包 不能作为学习入口。",
              author: { displayName: "入口还得留", role: "Web3钱包概念视角" }
            }
          ]
        },
        {
          body: "先补一个上下文：把 Web3钱包 概念和学习目标对比，会更容易分清适用场景。",
          stance: "补充",
          author: { displayName: "半夜补资料", role: "Web3钱包上下文视角" },
          replies: [
            {
              relation: "补充",
              body: "我再垫一层：还要把 Web3钱包 和第一次签名风险放在一起看。",
              author: { displayName: "签名前看一眼", role: "Web3钱包学习目标视角" }
            }
          ]
        },
        {
          body: "别急着下结论，这里容易偷换 Web3钱包 前提，需要查证它为什么成立和适用边界。",
          stance: "挑刺",
          author: { displayName: "别急着下结论", role: "Web3钱包概念校验视角" }
        },
        {
          body: "从钱包安全视角看，还要让用户先查证 Web3钱包 助记词备份方法和误操作边界。",
          stance: "补充",
          author: { displayName: "备份别手滑", role: "Web3钱包安全实践视角" }
        },
        {
          body: "我卡在失败成本这里：只谈 Web3钱包 入口价值，会忽略普通用户第一次转账时的风险边界。",
          stance: "反对",
          author: { displayName: "第一次转账慌过", role: "Web3钱包新手体验视角" }
        },
        {
          body: "从社区版规看，Web3钱包 经验帖最好分清个人经历、资料来源和可复现步骤。",
          stance: "补充",
          author: { displayName: "版规先放这", role: "Web3钱包社区版规视角" }
        },
        {
          body: "还有个前提别漏：OP 没说清托管钱包还是自托管钱包，很多 Web3钱包 建议都会套错场景。",
          stance: "挑刺",
          author: { displayName: "先问OP场景", role: "Web3钱包发帖语境视角" }
        }
      ],
      shadowDraft: {
        body: "我会先把 Web3钱包和平台账户分开，分清助记词来源、签名方法和风险边界，再判断是否适合新手。",
        status: "draft"
      }
    });
    const communityContext = {
      topicTitle: "Web3入门",
      learnerBackground: "我是普通兴趣用户，想看懂钱包和链上讨论。",
      learnerGoal: "能判断 Web3钱包 和平台账户的边界",
      conceptTitle: "Web3钱包的新手边界",
      conceptPlainName: "Web3钱包"
    };

    const payload = parseGeneratedPayload(raw, "wallet", communityContext, {
      minCommentAuthors: 8,
      rejectLocalScaffoldedContent: true,
      rejectRepairedReplies: true,
      rejectLowReplyRelationCoverage: true,
      rejectLowCommunityAuthorQuality: true,
      rejectLowGeneratedContentAnchoring: true
    });

    expect(payload?.post.author).toMatchObject({
      displayName: "刚刷到就懵",
      handle: "@wallet-first-scroll",
      role: "Web3钱包讨论观察者"
    });
  });

  it("rejects generic community author labels in strict generation quality mode", () => {
    const raw = JSON.stringify({
      lesson: {
        title: "认知失调",
        hook: "先看自洽需求。",
        explanation: "认知失调解释言行不一致时人如何调整信念。",
        analogy: "像给已经做出的选择补理由。",
        recallPrompt: "这是偏好还是自洽？",
        completionFeedback: "你能先问边界了。"
      },
      post: {
        body: "买贵东西后拼命说它好，是心理学里的认知失调吗？",
        author: { displayName: "乐观实践者", role: "建设派用户" }
      },
      comments: [
        {
          body: "赞成：用认知失调能解释买贵后的自洽，也要看研究证据。",
          stance: "赞成",
          author: { displayName: "乐观实践者", role: "建设派用户" }
        },
        {
          body: "反对：不能忽略营销和社会认同的边界。",
          stance: "反对",
          author: { displayName: "反方观察者", role: "边界提醒者" }
        },
        {
          body: "补充：比如先对比沉没成本和认知失调。",
          stance: "补充",
          author: { displayName: "科普者小严", role: "资料补充员" }
        },
        {
          body: "挑刺：这里要分清购买理由和事后合理化。",
          stance: "挑刺",
          author: { displayName: "逻辑挑刺员", role: "概念警察" }
        }
      ],
      shadowDraft: {
        body: "我会先问这个例子是不是认知失调。",
        status: "draft"
      }
    });
    const communityContext = {
      topicTitle: "心理学入门",
      learnerBackground: "我是普通兴趣用户，想看懂心理学讨论。",
      learnerGoal: "能看懂心理学研究和社交平台争论",
      conceptTitle: "认知失调",
      conceptPlainName: "认知失调"
    };

    const defaultPayload = parseGeneratedPayload(raw, "cognitive-dissonance", communityContext);
    const strictPayload = parseGeneratedPayload(raw, "cognitive-dissonance", communityContext, {
      rejectLowCommunityAuthorQuality: true
    });

    expect(defaultPayload?.comments.map((comment) => comment.author.displayName)).toEqual([
      "先别劝退我",
      "这坑我踩过",
      "科普者小严",
      "别急着下结论"
    ]);
    expect(strictPayload).toBeNull();
  });

  it("repairs bare generic display names when author metadata is already topic anchored", () => {
    const payload = parseGeneratedPayload(
      JSON.stringify({
        lesson: {
          title: "战国时代的基本坐标",
          hook: "先抓时间和地域。",
          explanation: "日本战国史要先分清时间、地域和地方势力。",
          analogy: "像编辑稿件先搭时间线。",
          recallPrompt: "战国时代的起止和争议是什么？",
          completionFeedback: "你能先看史料和边界了。"
        },
        post: {
          body: "为什么说应仁之乱是日本战国的起点？",
          author: { displayName: "战国坐标实践者", role: "日本战国史实践派" }
        },
        comments: [
          {
            body: "赞成：1467 年是主流叙事，但要查证地方史料。",
            stance: "赞成",
            author: { displayName: "坐标建设者", role: "日本战国史坐标建设者" }
          },
          {
            body: "反对：只盯京都会忽略关东和九州的地方势力边界。",
            stance: "反对",
            author: { displayName: "边界提醒者", role: "战国时代的基本坐标边界派" }
          },
          {
            body: "补充：可以对比应仁之乱、享德之乱和北条早云。",
            stance: "补充",
            author: { displayName: "资料党小熊", role: "日本战国史资料党" }
          },
          {
            body: "挑刺：不要把日本战国和中国战国混成一个叙事模型。",
            stance: "挑刺",
            author: { displayName: "概念警察", role: "战国时代的基本坐标概念校验者" }
          }
        ],
        shadowDraft: {
          body: "我会先区分年份、人物和制度边界。",
          status: "draft"
        }
      }),
      "sengoku-coordinates",
      {
        topicTitle: "日本战国史入门",
        learnerBackground: "我是内容编辑，想看懂人物关系、制度和影视改编争论。",
        learnerGoal: "能分清历史叙事、史料和影视化改编",
        conceptTitle: "战国时代的基本坐标",
        conceptPlainName: "战国时代的基本坐标"
      }
    );

    expect(payload?.comments.map((comment) => comment.author.displayName)).toEqual([
      "先别劝退我",
      "这坑我踩过",
      "资料党小熊",
      "别急着下结论"
    ]);
  });

  it("accepts short concept anchors derived from longer generated concept titles", () => {
    const payload = parseGeneratedPayload(
      JSON.stringify({
        lesson: {
          title: "三分法实操与争议",
          hook: "先看工具什么时候有用。",
          explanation: "三分法是构图工具，不是万能规则。",
          analogy: "像商品文案模板，只是起点。",
          recallPrompt: "什么时候该用三分法？",
          completionFeedback: "你能先问构图边界了。"
        },
        post: {
          body: "三分法到底是商品图捷径还是陷阱？",
          author: { displayName: "刚拍完图", role: "摄影构图讨论者" }
        },
        comments: [
          {
            body: "我会先拿三分法当入口，比如商品图留白，但后面必须回到商品场景和判断边界。",
            stance: "赞成",
            author: { displayName: "先别劝退我", role: "摄影入门教程推荐者" }
          },
          {
            body: "我不太买万能模板的说法，三分法会让很多商品图同质化，边界要说清楚。",
            stance: "反对",
            author: { displayName: "这坑我踩过", role: "独立摄影师" }
          },
          {
            body: "先补个场景：还要看商品品类、背景和点击场景，不能只看构图线落在哪里。",
            stance: "补充",
            author: { displayName: "半夜补资料", role: "摄影史爱好者" }
          },
          {
            body: "别急着下结论，这里容易把三分法和黄金分割混为一谈，先把概念分清。",
            stance: "挑刺",
            author: { displayName: "别急着下结论", role: "视觉方法论评论员" }
          }
        ],
        shadowDraft: {
          body: "我会先看商品图场景和构图边界。",
          status: "draft"
        }
      }),
      "rule-of-thirds",
      {
        topicTitle: "摄影构图入门",
        learnerBackground: "我是电商运营，想让商品图更会讲故事。",
        learnerGoal: "能判断构图选择和视觉叙事",
        conceptTitle: "三分法实操与争议",
        conceptPlainName: "三分法实操与争议"
      },
      { rejectLowCommunityAuthorQuality: true }
    );

    expect(payload?.comments.map((comment) => comment.author.displayName)).toContain("这坑我踩过");
  });

  it("rejects generic author labels that only match broad domain words", () => {
    const payload = parseGeneratedPayload(
      JSON.stringify({
        lesson: {
          title: "反中心构图",
          hook: "先看偏离中心解决什么商品图问题。",
          explanation: "反中心构图要服务视觉叙事和商品卖点。",
          analogy: "像给商品照安排视线入口。",
          recallPrompt: "这张商品图为什么不居中？",
          completionFeedback: "你能把构图放回商品图目标里。"
        },
        post: {
          body: "反中心构图真的更适合电商商品图吗？",
          author: { displayName: "电商构图实战派", role: "电商摄影师" }
        },
        comments: [
          {
            body: "赞成：反中心构图能给商品图更多视觉动线。",
            stance: "赞成",
            author: { displayName: "反中心构图拥护者", role: "电商视觉实践者" }
          },
          {
            body: "反对：珠宝这类商品可能更需要中心构图展示细节。",
            stance: "反对",
            author: { displayName: "中心构图坚持者", role: "电商运营老手" }
          },
          {
            body: "补充：三分法历史可以参考，但不等于当前商品图目标。",
            stance: "补充",
            author: { displayName: "三分法资料补充者", role: "摄影历史爱好者" }
          },
          {
            body: "挑刺：要区分构图技巧和营销话术。",
            stance: "挑刺",
            author: { displayName: "反中心构图挑刺者", role: "电商视觉校验者" }
          }
        ],
        shadowDraft: {
          body: "我会先问构图是否服务商品卖点。",
          status: "draft"
        }
      }),
      "off-center-composition",
      {
        topicTitle: "摄影构图入门",
        learnerBackground: "我是电商运营，想让商品图更会讲故事。",
        learnerGoal: "能判断构图选择和视觉叙事",
        conceptTitle: "反中心构图",
        conceptPlainName: "反中心构图"
      },
      { rejectLowCommunityAuthorQuality: true }
    );

    expect(payload).toBeNull();
  });

  it("accepts reply authors anchored by education domain roles in strict generation quality mode", () => {
    const payload = parseGeneratedPayload(
      JSON.stringify({
        lesson: {
          title: "教育学是什么",
          hook: "先看教学问题背后的证据边界。",
          explanation: "教育学会把课堂经验、学习动机和研究证据放在一起判断。",
          analogy: "像课程设计前先问学生为什么参与。",
          recallPrompt: "这个教学判断需要什么证据？",
          completionFeedback: "你能把教学方法放回证据边界。"
        },
        post: {
          body: "课程设计师看教育学，应该先信教学经验还是研究证据？",
          author: { displayName: "刚改完课件", role: "课程设计讨论者" }
        },
        comments: [
          {
            id: "c1",
            body: "我会把教育学当成入口，它能帮课程设计师把课堂经验变成可查证问题。",
            stance: "赞成",
            author: { displayName: "先看学生为啥动", role: "课程设计动机方向研究者" },
            replies: [
              {
                relation: "补充",
                body: "我再垫一层：教学证据要先说清样本和课堂边界。",
                author: { displayName: "样本先说清", role: "教学证据方法论研究者" }
              }
            ]
          },
          {
            id: "c2",
            body: "我不太买只看概念的路线，教育学讨论会忽略真实课堂约束。",
            stance: "反对",
            author: { displayName: "这课真带过", role: "课堂实践研究者" }
          },
          {
            id: "c3",
            body: "先补个对比：课程设计还要一起看学习动机和任务难度。",
            stance: "补充",
            author: { displayName: "半夜补文献", role: "学习动机研究者" }
          },
          {
            id: "c4",
            body: "别急着下结论，不要把参与度直接等同于理解效果。",
            stance: "挑刺",
            author: { displayName: "别把热闹当懂", role: "课堂讨论挑刺者" }
          }
        ],
        shadowDraft: {
          body: "我会先问教学证据和课程目标的关系。",
          status: "draft"
        }
      }),
      "education-basics",
      {
        topicTitle: "教育学入门",
        learnerBackground: "我是新手课程设计师，想理解学习动机和课堂讨论。",
        learnerGoal: "能看懂教学方法背后的证据和争议",
        conceptTitle: "教育学是什么",
        conceptPlainName: "教育学是什么"
      },
      { rejectLowCommunityAuthorQuality: true }
    );

    const replyAuthors = payload?.comments.flatMap((comment) => comment.replies ?? []).map((reply) => reply.author.role);
    expect(replyAuthors).toContain("教学证据方法论研究者");
  });

  it("rejects generic lesson post and shadow text in strict generation quality mode", () => {
    const communityContext = {
      topicTitle: "心理学入门",
      learnerBackground: "我是普通兴趣用户，想看懂心理学讨论。",
      learnerGoal: "能看懂心理学研究和社交平台争论",
      conceptTitle: "认知失调",
      conceptPlainName: "认知失调"
    };
    const raw = JSON.stringify({
      lesson: {
        title: "今天的微课",
        hook: "先看一个核心概念。",
        explanation: "这个概念能帮助你理解讨论。",
        analogy: "像把复杂问题拆开。",
        recallPrompt: "用一句话复述。",
        completionFeedback: "你已经完成今天的学习。"
      },
      post: {
        body: "这个概念为什么重要？",
        author: { displayName: "心理学观察员", role: "心理学讨论观察者" }
      },
      comments: [
        {
          id: "c1",
          body: "赞成：认知失调能解释买贵后找理由的例子，但要看研究证据。",
          stance: "赞成",
          author: { displayName: "认知失调实践者", role: "心理学学习者视角" },
          replies: [
            {
              relation: "追问",
              body: "追问：这个例子背后的心理学证据是什么？",
              author: { displayName: "心理学证据追问者", role: "认知失调研究视角" }
            }
          ]
        },
        {
          id: "c2",
          body: "反对：不能把所有事后找理由都归因到认知失调，要说明边界。",
          stance: "反对",
          author: { displayName: "认知失调边界派", role: "心理学边界提醒者" },
          replies: [
            {
              relation: "反驳",
              body: "反驳：有边界也不代表认知失调不能作为学习入口。",
              author: { displayName: "心理学入口反驳者", role: "认知失调概念视角" }
            }
          ]
        },
        {
          id: "c3",
          body: "补充：比如先对比沉没成本和认知失调，再查证不同研究方法。",
          stance: "补充",
          author: { displayName: "认知失调资料补充者", role: "心理学方法视角" },
          replies: [
            {
              relation: "补充",
              body: "补充：还要看样本和实验方法，不能只看社交平台案例。",
              author: { displayName: "心理学样本补充者", role: "认知失调证据视角" }
            }
          ]
        },
        {
          id: "c4",
          body: "挑刺：这里要分清购买理由、社会认同和认知失调三个前提。",
          stance: "挑刺",
          author: { displayName: "认知失调挑刺员", role: "心理学概念校验视角" }
        },
        {
          id: "c5",
          body: "补充：从普通兴趣用户视角看，下一步应该查证这个说法来自哪类研究。",
          stance: "补充",
          author: { displayName: "心理学兴趣学习者", role: "普通兴趣用户视角" }
        },
        {
          id: "c6",
          body: "反对：只用网购例子会忽略行为后的情绪调节边界。",
          stance: "反对",
          author: { displayName: "认知失调反例观察者", role: "心理学案例边界视角" }
        },
        {
          id: "c7",
          body: "补充：可以把研究证据、社交平台解释和个人经验三类来源分开。",
          stance: "补充",
          author: { displayName: "心理学来源整理者", role: "认知失调证据边界视角" }
        },
        {
          id: "c8",
          body: "挑刺：如果 OP 没说清购买前后的信念变化，就很难判断是不是认知失调。",
          stance: "挑刺",
          author: { displayName: "认知失调OP追问者", role: "心理学讨论语境视角" }
        }
      ],
      shadowDraft: {
        body: "我学到了一个重要概念，下次会继续观察。",
        status: "draft"
      }
    });

    const defaultPayload = parseGeneratedPayload(raw, "cognitive-dissonance", communityContext);
    const strictPayload = parseGeneratedPayload(raw, "cognitive-dissonance", communityContext, {
      minCommentAuthors: 8,
      rejectLowGeneratedContentAnchoring: true,
      rejectLowReplyRelationCoverage: true,
      rejectLowCommentLearningSignals: true,
      rejectLowCommunityAuthorQuality: true
    });

    expect(defaultPayload).not.toBeNull();
    expect(strictPayload).toBeNull();
  });

  it("requires generated lesson post and shadow to use research anchors for web research", () => {
    const communityContext = {
      topicTitle: "心理学入门",
      learnerBackground: "我是普通兴趣用户，想看懂心理学讨论。",
      learnerGoal: "能看懂心理学研究和社交平台争论",
      conceptTitle: "心理学证据边界",
      conceptPlainName: "证据边界",
      researchSource: "web" as const,
      researchAnchors: ["实验发现", "临床实践", "大众心理学"]
    };
    const basePayload = {
      lesson: {
        title: "心理学证据边界",
        hook: "先问证据和方法。",
        explanation: "心理学讨论要看证据和方法，也要注意边界。",
        analogy: "像读地图前先看图例。",
        recallPrompt: "这个说法怎么查证？",
        completionFeedback: "你能先问证据边界了。"
      },
      post: {
        body: "心理学热帖为什么要先问证据边界？"
      },
      comments: [
        { body: "赞成：心理学讨论要先看证据和方法。", stance: "赞成" },
        { body: "反对：不能把个人经验当成研究结论。", stance: "反对" },
        { body: "补充：比如可以对比样本、方法和来源。", stance: "补充" },
        { body: "挑刺：这里要分清科普表达和可验证证据。", stance: "挑刺" }
      ],
      shadowDraft: {
        body: "我会先问心理学观点的证据和边界。",
        status: "draft"
      }
    };
    const groundedPayload = {
      ...basePayload,
      lesson: {
        ...basePayload.lesson,
        explanation: "心理学讨论要看实验发现如何得出，也要注意样本和方法边界。"
      },
      post: {
        body: "心理学热帖为什么不能把临床实践和普通科普直接混在一起？"
      },
      shadowDraft: {
        body: "我会把大众心理学当入口，但先追问证据、样本和边界。",
        status: "draft"
      }
    };

    expect(
      parseGeneratedPayload(JSON.stringify(basePayload), "psychology-evidence", communityContext, {
        rejectLowGeneratedContentAnchoring: true
      })
    ).toBeNull();
    expect(
      parseGeneratedPayload(JSON.stringify(groundedPayload), "psychology-evidence", communityContext, {
        rejectLowGeneratedContentAnchoring: true
      })
    ).not.toBeNull();
  });

  it("diagnoses which generated surfaces miss research anchors", () => {
    const communityContext = {
      topicTitle: "心理学入门",
      learnerBackground: "我是普通兴趣用户，想看懂心理学讨论。",
      learnerGoal: "能看懂心理学研究和社交平台争论",
      conceptTitle: "心理学证据边界",
      conceptPlainName: "证据边界",
      researchSource: "web" as const,
      researchAnchors: ["实验发现", "临床实践", "大众心理学"]
    };
    const raw = JSON.stringify({
      lesson: {
        title: "心理学证据边界",
        hook: "先问证据和方法。",
        explanation: "心理学讨论要看证据和方法，也要注意边界。",
        analogy: "像读地图前先看图例。",
        recallPrompt: "这个说法怎么查证？",
        completionFeedback: "你能先问证据边界了。"
      },
      post: {
        body: "心理学热帖为什么要先问证据边界？"
      },
      comments: [
        { body: "赞成：心理学讨论要先看证据和方法。", stance: "赞成" },
        { body: "反对：不能把个人经验当成研究结论。", stance: "反对" },
        { body: "补充：比如可以对比样本、方法和来源。", stance: "补充" },
        { body: "挑刺：这里要分清科普表达和可验证证据。", stance: "挑刺" }
      ],
      shadowDraft: {
        body: "我会先问心理学观点的证据和边界。",
        status: "draft"
      }
    });

    expect(
      diagnoseGeneratedPayload(raw, "psychology-evidence", communityContext, {
        rejectLowGeneratedContentAnchoring: true
      }).issues
    ).toEqual([
      "low generated content anchoring: lesson missing research anchor, post missing research anchor, shadowDraft missing research anchor"
    ]);
  });

  it("rejects topic and research keyword stuffing without a concrete learner action", () => {
    const communityContext = {
      topicTitle: "心理学入门",
      learnerBackground: "我是普通兴趣用户，想看懂心理学讨论。",
      learnerGoal: "能看懂心理学研究和社交平台争论",
      conceptTitle: "心理学证据边界",
      conceptPlainName: "证据边界",
      researchSource: "web" as const,
      researchAnchors: ["实验发现", "临床实践", "大众心理学"]
    };
    const shallowPayload = {
      lesson: {
        title: "心理学证据边界",
        hook: "心理学证据边界很重要。",
        explanation: "心理学讨论有实验发现、临床实践和大众心理学，这些都涉及证据、研究、来源和边界。",
        analogy: "像看地图。",
        recallPrompt: "记住心理学证据边界。",
        completionFeedback: "你知道证据边界很重要。"
      },
      post: {
        body: "心理学热帖里的实验发现、临床实践和大众心理学都说明证据边界很重要。"
      },
      comments: [
        { body: "赞成：心理学讨论要有证据和边界。", stance: "赞成" },
        { body: "反对：不能只看大众心理学。", stance: "反对" },
        { body: "补充：实验发现和临床实践不同。", stance: "补充" },
        { body: "挑刺：这里有证据边界。", stance: "挑刺" }
      ],
      shadowDraft: {
        body: "心理学证据边界涉及实验发现、临床实践、大众心理学、证据、来源和研究。",
        status: "draft"
      }
    };
    const actionPayload = {
      ...shallowPayload,
      lesson: {
        ...shallowPayload.lesson,
        explanation: "先分清实验发现和临床实践，再对比样本方法，判断它能不能解释大众心理学热帖。"
      },
      post: {
        body: "看到心理学热帖时，先查证它引用的是实验发现还是临床实践，再判断大众心理学说法的适用边界。"
      },
      shadowDraft: {
        body: "我会先分清实验发现、临床实践和大众心理学，再查证来源并判断这个说法适不适合当前讨论。",
        status: "draft"
      }
    };

    expect(
      parseGeneratedPayload(JSON.stringify(shallowPayload), "psychology-evidence", communityContext, {
        rejectLowGeneratedContentAnchoring: true
      })
    ).toBeNull();
    expect(
      parseGeneratedPayload(JSON.stringify(actionPayload), "psychology-evidence", communityContext, {
        rejectLowGeneratedContentAnchoring: true
      })
    ).not.toBeNull();
  });

  it("rejects unsupported precise claims in strict generation quality mode", () => {
    const communityContext = {
      topicTitle: "教育学入门",
      learnerBackground: "我是新手课程设计师，想理解学习动机和课堂讨论。",
      learnerGoal: "能看懂教学方法背后的证据和争议",
      conceptTitle: "学习动机证据边界",
      conceptPlainName: "证据边界",
      researchSource: "web" as const,
      researchAnchors: ["课堂动机", "证据边界", "样本方法"]
    };
    const raw = JSON.stringify({
      lesson: {
        title: "学习动机证据边界",
        hook: "先问课堂动机证据来自哪里。",
        explanation: "2024 年《全球学习动机报告》显示 73% 的学生都会因为游戏化奖励提高成绩。",
        analogy: "像课程设计先看样本方法。",
        recallPrompt: "这个说法怎么查证？",
        completionFeedback: "你能先问证据边界了。"
      },
      post: {
        body: "课程设计热帖里说 73% 的学生都适合游戏化奖励，这个学习动机结论可靠吗？"
      },
      comments: [
        { body: "赞成：课堂动机讨论要先看证据和样本方法。", stance: "赞成" },
        { body: "反对：不能把没有来源的 2024 年百分比当事实。", stance: "反对" },
        { body: "补充：比如先查证报告来源和课堂样本。", stance: "补充" },
        { body: "挑刺：这里要分清课程设计经验和研究证据。", stance: "挑刺" }
      ],
      shadowDraft: {
        body: "我会先查证 2024 年报告和 73% 这个数字是否真的来自课堂研究。",
        status: "draft"
      }
    });

    expect(
      parseGeneratedPayload(raw, "education-motivation", communityContext, {
        rejectUnsupportedPreciseClaims: true
      })
    ).toBeNull();
    expect(
      diagnoseGeneratedPayload(raw, "education-motivation", communityContext, {
        rejectUnsupportedPreciseClaims: true
      }).issues[0]
    ).toContain("73%");
  });

  it("accepts precise claims when the current research anchors explicitly support them", () => {
    const communityContext = {
      topicTitle: "教育学入门",
      learnerBackground: "我是新手课程设计师，想理解学习动机和课堂讨论。",
      learnerGoal: "能看懂教学方法背后的证据和争议",
      conceptTitle: "学习动机证据边界",
      conceptPlainName: "证据边界",
      researchSource: "web" as const,
      researchAnchors: ["课堂动机", "样本方法", "2024 年", "73%", "全球学习动机报告"]
    };
    const raw = JSON.stringify({
      lesson: {
        title: "学习动机证据边界",
        hook: "先问课堂动机证据来自哪里。",
        explanation: "2024 年《全球学习动机报告》里的 73% 需要回到样本方法看，而不是直接当成所有课堂的结论。",
        analogy: "像课程设计先看样本方法。",
        recallPrompt: "这个说法怎么查证？",
        completionFeedback: "你能先问证据边界了。"
      },
      post: {
        body: "课程设计热帖提到 73% 的学习动机数据，应该先看报告样本而不是直接套进课堂。"
      },
      comments: [
        { body: "赞成：课堂动机讨论要先看证据和样本方法。", stance: "赞成" },
        { body: "反对：即使有 2024 年报告，也不能忽略课堂边界。", stance: "反对" },
        { body: "补充：比如先查证报告来源和课堂样本。", stance: "补充" },
        { body: "挑刺：这里要分清课程设计经验和研究证据。", stance: "挑刺" }
      ],
      shadowDraft: {
        body: "我会先查证 2024 年报告和 73% 的样本方法，再判断它是否适合我的课程设计。",
        status: "draft"
      }
    });

    expect(
      parseGeneratedPayload(raw, "education-motivation", communityContext, {
        rejectUnsupportedPreciseClaims: true
      })
    ).not.toBeNull();
  });

  it("does not treat author role labels as unsupported precise factual claims", () => {
    const communityContext = {
      topicTitle: "建筑史入门",
      learnerBackground: "我是城市更新从业者，想看懂不同建筑风格、材料和历史语境。",
      learnerGoal: "能判断建筑作品背后的时代、功能和审美争论",
      conceptTitle: "建筑史核心问题",
      conceptPlainName: "建筑史核心问题",
      researchSource: "fallback" as const,
      researchAnchors: ["建筑史入门", "城市更新", "功能材料"]
    };
    const raw = JSON.stringify({
      lesson: {
        title: "建筑史核心问题",
        hook: "先看建筑史讨论里的功能和材料。",
        explanation: "建筑史入门先从城市更新场景看功能、材料和社会语境，再查证它是否适合当前项目。",
        analogy: "像看老小区改造，先分清原始功能和材料，再谈审美。",
        recallPrompt: "列出一个项目里的功能、材料和语境判断。",
        completionFeedback: "你能先用功能材料拆解建筑史讨论。"
      },
      post: {
        body: "城市更新项目里，先查证建筑功能和材料，再判断风格争论是不是适合当前场景。"
      },
      comments: [
        {
          body: "赞成：做项目时先看功能和材料，再判断建筑史讨论适不适合当前场景。",
          stance: "赞成",
          author: { displayName: "赵磊", role: "区属城投公司项目主管" }
        },
        {
          body: "反对：只看功能材料也会漏掉审美传统，要补一层史料查证。",
          stance: "反对",
          author: { displayName: "陈砚", role: "建筑史方向研究生" }
        },
        {
          body: "补充：可以先查档案来源，再对比同期建筑的材料和用途。",
          stance: "补充",
          author: { displayName: "吴桐", role: "文物建筑修复从业者" }
        },
        {
          body: "挑刺：别把一个项目经验直接推成所有建筑史讨论的结论。",
          stance: "挑刺",
          author: { displayName: "苏晓", role: "建筑评论作者" }
        }
      ],
      shadowDraft: {
        body: "我会先查证建筑功能、材料和语境，再判断这条建筑史讨论能不能用于当前城市更新项目。",
        status: "draft"
      }
    });

    expect(
      parseGeneratedPayload(raw, "architecture-history", communityContext, {
        rejectUnsupportedPreciseClaims: true
      })
    ).not.toBeNull();
  });

  it("normalizes nested community replies and keeps reply ownership in the adapter", () => {
    const payload = parseGeneratedPayload(
      JSON.stringify({
        lesson: {
          title: "气候政策工具",
          hook: "先分清政策改变了谁的成本。",
          explanation: "气候政策工具会改变企业、市民和政府的约束。",
          analogy: "像交通管理里的收费和限行。",
          recallPrompt: "这个政策工具让谁承担了成本？",
          completionFeedback: "你能追问政策边界了。"
        },
        post: {
          body: "碳税、碳交易和能效标准到底哪个更适合城市规划？"
        },
        comments: [
          {
            id: "model-owned-comment-1",
            body: "支持碳税，因为城市规划需要清楚的价格信号。",
            stance: "赞成",
            replies: [
              {
                id: "model-owned-reply",
                replyToCommentId: "wrong-parent",
                relation: "question",
                quote: "价格信号",
                body: "追问：价格信号怎么照顾低收入通勤者？",
                author: { displayName: "公平追问者", role: "交通公平视角" }
              },
              {
                relation: "add",
                body: "补充：还要把建筑能效标准放进同一张政策地图。",
                author: { displayName: "建筑政策补充员", role: "城市建筑视角" }
              },
              {
                relation: "refute",
                body: "反驳：只说价格信号会低估执行成本。",
                author: { displayName: "执行成本派", role: "政策执行视角" }
              }
            ]
          },
          { body: "反对只看碳税，城市规划还要考虑公平。", stance: "反对" },
          { body: "补充：碳交易适合总量控制，不等于每个城市都好用。", stance: "补充" },
          { body: "挑刺：这里把减排效率和政策可执行性混在一起了。", stance: "挑刺" }
        ],
        shadowDraft: {
          body: "我会先问政策工具改变了谁的成本。",
          status: "draft"
        }
      }),
      "climate-policy"
    );

    const firstComment = payload?.comments[0];

    expect(firstComment?.replies).toHaveLength(2);
    expect(firstComment?.replies?.map((reply) => reply.relation)).toEqual(["追问", "补充"]);
    expect(firstComment?.replies?.[0]).toMatchObject({
      id: `reply-${firstComment?.id}-1`,
      replyToCommentId: firstComment?.id,
      source: "llm",
      quote: "价格信号"
    });
    expect(firstComment?.replies?.[0].id).not.toBe("model-owned-reply");
  });

  it("attaches top-level commentReplies to valid normalized comments", () => {
    const payload = parseGeneratedPayload(
      JSON.stringify({
        lesson: {
          title: "古典音乐版本比较",
          hook: "先分清作品和演奏。",
          explanation: "同一首作品会因乐团、指挥和录音时代产生不同听感。",
          analogy: "像同一个剧本被不同演员演出。",
          recallPrompt: "这次争论是在谈作品还是演奏？",
          completionFeedback: "你能把听感放回版本差异里。"
        },
        post: {
          body: "为什么同一首古典音乐换个指挥就像另一首？"
        },
        comments: [
          { id: "c1", body: "支持从版本差异入门，通勤听音乐也能马上感到区别。", stance: "赞成" },
          { id: "c2", body: "反对只谈听感，不看作品结构会误导。", stance: "反对" },
          { id: "c3", body: "补充：可以先听同一段主题在不同录音里的处理。", stance: "补充" },
          { id: "c4", body: "挑刺：不要把录音音色差异全归因于指挥理解。", stance: "挑刺" }
        ],
        commentReplies: [
          {
            replyToCommentId: "c2",
            relation: "refute",
            quote: "不看作品结构",
            body: "反驳：新手可以先从听感进入，再补作品结构。",
            author: { displayName: "通勤听友", role: "普通听众视角" }
          },
          {
            commentIndex: 3,
            relation: "question",
            body: "追问：怎么判断这是录音音色，不是乐团处理？",
            author: { displayName: "版本追问者", role: "版本比较视角" }
          }
        ],
        shadowDraft: {
          body: "我会先问作品、演奏和录音分别影响了什么。",
          status: "draft"
        }
      }),
      "classical-version"
    );

    expect(payload?.comments[1].replies?.[0]).toMatchObject({
      relation: "反驳",
      replyToCommentId: "c2",
      quote: "不看作品结构"
    });
    expect(payload?.comments[3].replies?.[0]).toMatchObject({
      relation: "追问",
      replyToCommentId: "c4"
    });
  });

  it("reassigns self-replies to a different topic-fit community persona", () => {
    const payload = parseGeneratedPayload(
      JSON.stringify({
        lesson: {
          title: "古典音乐版本比较",
          hook: "先分清作品和演奏。",
          explanation: "同一首作品会因乐团、指挥和录音时代产生不同听感。",
          analogy: "像同一个剧本被不同演员演出。",
          recallPrompt: "这次争论是在谈作品还是演奏？",
          completionFeedback: "你能把听感放回版本差异里。"
        },
        post: {
          body: "为什么同一首古典音乐换个指挥就像另一首？"
        },
        comments: [
          {
            id: "c1",
            body: "支持从版本差异入门，通勤听音乐也能马上感到区别。",
            stance: "赞成",
            author: { displayName: "古典音乐实践派", role: "通勤听友视角" },
            replies: [
              {
                relation: "question",
                body: "追问：通勤时应该先对比同一首作品的哪些演奏？",
                author: { displayName: "古典音乐实践派", role: "通勤听友视角" }
              }
            ]
          },
          { id: "c2", body: "反对只谈听感，不看作品结构会误导。", stance: "反对" },
          { id: "c3", body: "补充：可以先听同一段主题在不同录音里的处理。", stance: "补充" },
          { id: "c4", body: "挑刺：不要把录音音色差异全归因于指挥理解。", stance: "挑刺" }
        ],
        shadowDraft: {
          body: "我会先问作品、演奏和录音分别影响了什么。",
          status: "draft"
        }
      }),
      "classical-version",
      {
        topicTitle: "古典音乐入门",
        learnerBackground: "我是通勤时听音乐的普通兴趣用户，不懂乐理。",
        learnerGoal: "能看懂作品、演奏和审美争论",
        conceptTitle: "古典音乐版本比较",
        conceptPlainName: "版本比较"
      }
    );

    const parent = payload?.comments[0];
    const reply = parent?.replies?.[0];

    expect(reply?.source).toBe("llm");
    expect(reply?.body).toContain("通勤");
    expect(reply?.author.displayName).not.toBe(parent?.author.displayName);
    expect(reply?.author.displayName).toBe("别急着下结论");
  });

  it("repairs missing community replies with varied expression-layer relations", () => {
    const payload = parseGeneratedPayload(
      JSON.stringify({
        lesson: {
          title: "古典音乐版本比较",
          hook: "先分清作品和演奏。",
          explanation: "版本比较能帮助新手听出同一作品的不同处理。",
          analogy: "像同一个剧本被不同演员演出。",
          recallPrompt: "这次争论是在谈作品还是演奏？",
          completionFeedback: "你能把听感放回版本差异里。"
        },
        post: {
          body: "为什么同一首古典音乐换个指挥就像另一首？"
        },
        comments: [
          { id: "c1", body: "支持从版本差异入门，通勤听音乐也能马上感到区别。", stance: "赞成" },
          { id: "c2", body: "反对只谈听感，不看作品结构会误导。", stance: "反对" },
          { id: "c3", body: "补充：可以先听同一段主题在不同录音里的处理。", stance: "补充" },
          { id: "c4", body: "挑刺：不要把录音音色差异全归因于指挥理解。", stance: "挑刺" }
        ],
        shadowDraft: {
          body: "我会先问作品、演奏和录音分别影响了什么。",
          status: "draft"
        }
      }),
      "classical-version",
      {
        topicTitle: "古典音乐入门",
        learnerBackground: "我是通勤时听音乐的普通兴趣用户，不懂乐理。",
        learnerGoal: "能看懂作品、演奏和审美争论",
        conceptTitle: "古典音乐版本比较",
        conceptPlainName: "版本比较"
      }
    );

    const replies = payload?.comments.flatMap((comment) => comment.replies ?? []) ?? [];

    expect(replies).toHaveLength(3);
    expect(new Set(replies.map((reply) => reply.relation))).toEqual(new Set(["追问", "补充", "反驳"]));
    expect(replies.map((reply) => reply.id)).toEqual(["reply-c1-1", "reply-c1-2", "reply-c2-1"]);
    expect(replies.map((reply) => reply.replyToCommentId)).toEqual(["c1", "c1", "c2"]);
    expect(replies.map((reply) => reply.source)).toEqual(["repair", "repair", "repair"]);
    expect(replies.map((reply) => reply.body).join("\n")).toContain("古典音乐");
  });

  it("rejects locally repaired replies in strict generation quality mode", () => {
    const raw = JSON.stringify({
      lesson: {
        title: "古典音乐版本比较",
        hook: "先分清作品和演奏。",
        explanation: "版本比较能帮助新手听出同一作品的不同处理。",
        analogy: "像同一个剧本被不同演员演出。",
        recallPrompt: "这次争论是在谈作品还是演奏？",
        completionFeedback: "你能把听感放回版本差异里。"
      },
      post: {
        body: "为什么同一首古典音乐换个指挥就像另一首？"
      },
      comments: [
        { id: "c1", body: "支持从版本差异入门，通勤听音乐也能马上感到区别。", stance: "赞成" },
        { id: "c2", body: "反对只谈听感，不看作品结构会误导。", stance: "反对" },
        { id: "c3", body: "补充：可以先听同一段主题在不同录音里的处理。", stance: "补充" },
        {
          id: "c4",
          body: "挑刺：不要把录音音色差异全归因于指挥理解。",
          stance: "挑刺",
          replies: [
            {
              relation: "question",
              body: "追问：怎么判断这是录音音色，不是乐团处理？",
              author: { displayName: "版本追问者", role: "版本比较视角" }
            }
          ]
        }
      ],
      shadowDraft: {
        body: "我会先问作品、演奏和录音分别影响了什么。",
        status: "draft"
      }
    });
    const communityContext = {
      topicTitle: "古典音乐入门",
      learnerBackground: "我是通勤时听音乐的普通兴趣用户，不懂乐理。",
      learnerGoal: "能看懂作品、演奏和审美争论",
      conceptTitle: "古典音乐版本比较",
      conceptPlainName: "版本比较"
    };

    const defaultPayload = parseGeneratedPayload(raw, "classical-version", communityContext);
    const strictPayload = parseGeneratedPayload(raw, "classical-version", communityContext, {
      rejectRepairedReplies: true
    });

    expect(defaultPayload?.comments.flatMap((comment) => comment.replies ?? []).map((reply) => reply.source).sort()).toEqual([
      "llm",
      "repair",
      "repair"
    ]);
    expect(strictPayload).toBeNull();
  });

  it("rejects repair-like model reply copy in strict generation quality mode", () => {
    const raw = JSON.stringify({
      lesson: {
        title: "摄影构图三分法",
        hook: "先判断规则服务什么画面目的。",
        explanation: "三分法可以帮助电商运营安排商品和留白，但不能变成万能答案。",
        analogy: "像给商品图安排一个看图路线。",
        recallPrompt: "三分法在这张商品图里解决了什么问题？",
        completionFeedback: "你能把构图规则放回商品卖点里。"
      },
      post: {
        body: "三分法构图真的是新手救星吗？"
      },
      comments: [
        {
          id: "c1",
          body: "赞成，摄影构图新手先用三分法能减少随机摆放。",
          stance: "赞成",
          replies: [
            {
              relation: "追问",
              body: "追问：电商运营如果只拍一件商品，应该先看什么证据或例子？",
              author: { displayName: "电商构图追问者", role: "商品图学习者" }
            }
          ]
        },
        {
          id: "c2",
          body: "反对，把三分法当万能解释会掩盖商品品类和质感差异。",
          stance: "反对",
          replies: [
            {
              relation: "反驳",
              body: "反驳：如果连主体居中都能被解释成隐性的三分法，那三分法就成了一个怎么都能圆的万能解释。",
              author: { displayName: "构图边界反驳者", role: "电商视觉方法论观察者" }
            }
          ]
        },
        {
          id: "c3",
          body: "补充，可以对比主图点击率和详情页停留时间。",
          stance: "补充",
          replies: [
            {
              relation: "补充",
              body: "补充：摄影构图还要看商品卖点，比如材质、尺度和使用场景。",
              author: { displayName: "商品图证据补充者", role: "电商视觉复盘者" }
            }
          ]
        },
        {
          id: "c4",
          body: "挑刺，需要先定义爆款是点击率还是转化率。",
          stance: "挑刺"
        }
      ],
      shadowDraft: {
        body: "我会先问三分法服务了哪个商品卖点，而不是直接套规则。",
        status: "draft"
      }
    });
    const communityContext = {
      topicTitle: "摄影构图入门",
      learnerBackground: "我是电商运营，想让商品图更会讲故事。",
      learnerGoal: "能判断构图选择和视觉叙事",
      conceptTitle: "三分法构图",
      conceptPlainName: "三分法"
    };

    const defaultPayload = parseGeneratedPayload(raw, "photo-thirds", communityContext);
    const strictPayload = parseGeneratedPayload(raw, "photo-thirds", communityContext, {
      rejectRepairedReplies: true
    });

    expect(defaultPayload?.comments.flatMap((comment) => comment.replies ?? [])).toHaveLength(3);
    expect(strictPayload).toBeNull();
  });

  it("rejects three model replies without full relation coverage in strict generation quality mode", () => {
    const raw = JSON.stringify({
      lesson: {
        title: "商品摄影构图",
        hook: "先看画面服务什么目的。",
        explanation: "商品摄影构图需要让视线进入卖点和转化目标。",
        analogy: "像给商品安排一条看图路径。",
        recallPrompt: "这张图先让人看到什么？",
        completionFeedback: "你能把构图放回转化目标里。"
      },
      post: {
        body: "为什么同一件商品换个构图点击率就不一样？"
      },
      comments: [
        {
          id: "c1",
          body: "赞成，摄影构图要先服务商品卖点。",
          stance: "赞成",
          replies: [
            {
              relation: "追问",
              body: "追问：电商运营新手应该先看什么卖点？",
              author: { displayName: "构图追问者", role: "摄影构图学习者" }
            }
          ]
        },
        {
          id: "c2",
          body: "反对，只谈构图会忽略价格和详情页。",
          stance: "反对",
          replies: [
            {
              relation: "反驳",
              body: "反驳：价格重要，但首图构图决定用户要不要点进详情页。",
              author: { displayName: "首图反驳者", role: "电商摄影视角" }
            }
          ]
        },
        {
          id: "c3",
          body: "补充：可以对比主图和详情页里的视觉层级。",
          stance: "补充",
          replies: [
            {
              relation: "追问",
              body: "追问：怎么判断构图问题不是商品本身不吸引人？",
              author: { displayName: "转化追问者", role: "运营学习者" }
            }
          ]
        },
        { id: "c4", body: "挑刺：这里不能把点击率变化直接归因于构图。", stance: "挑刺" }
      ],
      shadowDraft: {
        body: "我会先问构图、卖点和转化目标的关系。",
        status: "draft"
      }
    });
    const communityContext = {
      topicTitle: "商品摄影入门",
      learnerBackground: "我是电商运营，想看懂商品图片为什么影响转化。",
      learnerGoal: "能判断主图构图和卖点表达",
      conceptTitle: "商品摄影构图",
      conceptPlainName: "构图"
    };

    const defaultPayload = parseGeneratedPayload(raw, "product-photo-composition", communityContext);
    const strictPayload = parseGeneratedPayload(raw, "product-photo-composition", communityContext, {
      rejectRepairedReplies: true,
      rejectLowReplyRelationCoverage: true
    });

    expect(defaultPayload?.comments.flatMap((comment) => comment.replies ?? []).map((reply) => reply.relation)).toEqual([
      "追问",
      "反驳",
      "补充",
      "追问"
    ]);
    expect(strictPayload).toBeNull();
  });

  it("rejects non-exact model reply counts in strict generation quality mode", () => {
    const basePayload = {
      lesson: {
        title: "商品摄影构图",
        hook: "先看画面服务什么目的。",
        explanation: "商品摄影构图需要让视线进入卖点和转化目标。",
        analogy: "像给商品安排一条看图路径。",
        recallPrompt: "这张图先让人看到什么？",
        completionFeedback: "你能把构图放回转化目标里。"
      },
      post: {
        body: "为什么同一件商品换个构图点击率就不一样？"
      },
      comments: [
        {
          id: "c1",
          body: "赞成：摄影构图要先服务商品卖点。",
          stance: "赞成",
          replies: [
            {
              relation: "追问",
              body: "追问：电商运营新手应该先看什么卖点？",
              author: { displayName: "构图追问者", role: "摄影构图学习者" }
            }
          ]
        },
        {
          id: "c2",
          body: "反对：只谈构图会忽略价格和详情页边界。",
          stance: "反对",
          replies: [
            {
              relation: "反驳",
              body: "反驳：价格重要，但首图构图决定用户要不要点进详情页。",
              author: { displayName: "首图反驳者", role: "电商摄影视角" }
            }
          ]
        },
        { id: "c3", body: "补充：可以对比主图和详情页里的视觉层级。", stance: "补充" },
        { id: "c4", body: "挑刺：这里不能把点击率变化直接归因于构图。", stance: "挑刺" }
      ],
      shadowDraft: {
        body: "我会先问构图、卖点和转化目标的关系。",
        status: "draft"
      }
    };
    const context = {
      topicTitle: "商品摄影入门",
      learnerBackground: "我是电商运营，想看懂商品图片为什么影响转化。",
      learnerGoal: "能判断主图构图和卖点表达",
      conceptTitle: "商品摄影构图",
      conceptPlainName: "构图"
    };
    const fourReplyPayload = {
      ...basePayload,
      comments: basePayload.comments.map((comment) =>
        comment.id === "c3"
          ? {
              ...comment,
              replies: [
                {
                  relation: "补充",
                  body: "补充：还要看商品材质和使用场景。",
                  author: { displayName: "材质补充者", role: "商品摄影复盘者" }
                },
                {
                  relation: "追问",
                  body: "追问：怎么排除详情页文案的影响？",
                  author: { displayName: "详情页追问者", role: "电商转化视角" }
                }
              ]
            }
          : comment
      )
    };

    expect(
      parseGeneratedPayload(JSON.stringify(basePayload), "product-photo-composition", context, {
        rejectLowReplyRelationCoverage: true
      })
    ).toBeNull();
    expect(
      parseGeneratedPayload(JSON.stringify(fourReplyPayload), "product-photo-composition", context, {
        rejectLowReplyRelationCoverage: true
      })
    ).toBeNull();
  });

  it("rejects visible comments that are mostly stance-only in strict generation quality mode", () => {
    const lowSignalRaw = JSON.stringify({
      lesson: {
        title: "战国叙事分期",
        hook: "先分清故事起点和史学分期。",
        explanation: "内容编辑需要区分年份、人物登场和制度变化。",
        analogy: "像同一部剧可以从不同季开始讲。",
        recallPrompt: "这个说法在谈年份、人物还是制度？",
        completionFeedback: "你能把争论放回分期边界。"
      },
      post: {
        body: "战国到底从哪一年开始？"
      },
      comments: [
        {
          id: "c1",
          body: "赞成，这个说法很有意思。",
          stance: "赞成",
          replies: [
            {
              relation: "追问",
              body: "追问：内容编辑应该查证哪个年份？",
              author: { displayName: "年份追问者", role: "战国史学习者" }
            }
          ]
        },
        {
          id: "c2",
          body: "反对，我觉得不太对。",
          stance: "反对",
          replies: [
            {
              relation: "反驳",
              body: "反驳：不对也要说明史料或制度边界。",
              author: { displayName: "制度反驳者", role: "史料视角" }
            }
          ]
        },
        {
          id: "c3",
          body: "补充一下，大家可以看看。",
          stance: "补充",
          replies: [
            {
              relation: "补充",
              body: "补充：可以对比人物登场和史学分期。",
              author: { displayName: "分期补充者", role: "内容编辑视角" }
            }
          ]
        },
        { id: "c4", body: "挑刺，这里有点怪。", stance: "挑刺" }
      ],
      shadowDraft: {
        body: "我会先问年份、人物和制度。",
        status: "draft"
      }
    });
    const context = {
      topicTitle: "日本战国史入门",
      learnerBackground: "我是内容编辑，想看懂人物关系、制度和影视改编争论。",
      learnerGoal: "能分清历史叙事、史料和影视化改编",
      conceptTitle: "战国起止的三种说法",
      conceptPlainName: "战国起止"
    };

    const loosePayload = parseGeneratedPayload(lowSignalRaw, "sengoku-periodization", context);
    const strictPayload = parseGeneratedPayload(lowSignalRaw, "sengoku-periodization", context, {
      rejectRepairedReplies: true,
      rejectLowReplyRelationCoverage: true,
      rejectLowCommentLearningSignals: true
    });

    expect(loosePayload?.comments).toHaveLength(4);
    expect(strictPayload).toBeNull();
  });

  it("accepts history comments with explicit learning signals in strict generation quality mode", () => {
    const raw = JSON.stringify({
      lesson: {
        title: "战国起止的三种说法",
        hook: "先分清故事起点和史学分期。",
        explanation: "内容编辑需要区分年份、人物登场和制度变化。",
        analogy: "像同一部剧可以从不同季开始讲。",
        recallPrompt: "这个说法在谈年份、人物还是制度？",
        completionFeedback: "你能把争论放回分期边界。"
      },
      post: {
        body: "战国到底从哪一年开始？"
      },
      comments: [
        {
          id: "c1",
          body: "赞成：内容编辑先抓 1467、1573、1615 三个年份，才能判断影视叙事为什么从人物登场切入。",
          stance: "赞成",
          replies: [
            {
              relation: "追问",
              body: "追问：如果从人物登场切入，应该查证哪段史料？",
              author: { displayName: "史料追问者", role: "内容编辑视角" }
            }
          ]
        },
        {
          id: "c2",
          body: "反对：只讲三英杰会误导读者，以为战国不是长期制度崩坏，而是几个人的英雄故事。",
          stance: "反对",
          replies: [
            {
              relation: "反驳",
              body: "反驳：人物故事能当入口，但要说明它不是史学分期本身。",
              author: { displayName: "分期反驳者", role: "史学边界视角" }
            }
          ]
        },
        {
          id: "c3",
          body: "补充一点：《太阁立志传》从 1560 年开始，不是战国起点，而是人物登场和叙事节奏的选择。",
          stance: "补充",
          replies: [
            {
              relation: "补充",
              body: "补充：这能帮内容编辑分清史学分期和影视改编。",
              author: { displayName: "改编资料党", role: "影视史料视角" }
            }
          ]
        },
        {
          id: "c4",
          body: "挑刺：这三种说法过于中央视角，如果忽略关东和九州的地域差异，会造成以偏概全。",
          stance: "挑刺"
        }
      ],
      shadowDraft: {
        body: "我会先区分年份、人物和制度边界。",
        status: "draft"
      }
    });
    const context = {
      topicTitle: "日本战国史入门",
      learnerBackground: "我是内容编辑，想看懂人物关系、制度和影视改编争论。",
      learnerGoal: "能分清历史叙事、史料和影视化改编",
      conceptTitle: "战国起止的三种说法",
      conceptPlainName: "战国起止"
    };

    const strictPayload = parseGeneratedPayload(raw, "sengoku-periodization", context, {
      rejectRepairedReplies: true,
      rejectLowReplyRelationCoverage: true,
      rejectLowCommentLearningSignals: true
    });

    expect(strictPayload?.comments.map((comment) => comment.stance)).toEqual(["赞成", "反对", "补充", "挑刺"]);
  });

  it("replaces placeholder community names with netlike personas", () => {
    const payload = parseGeneratedPayload(
      JSON.stringify({
        lesson: {
          title: "摄影构图三分法",
          hook: "商品图不能只套模板。",
          explanation: "三分法是工具，不是万能规则。",
          analogy: "像详情页模板。",
          recallPrompt: "这个构图让用户先看哪里？",
          completionFeedback: "你能追问构图目的了。"
        },
        post: {
          body: "三分法是商品图捷径还是套路？"
        },
        comments: [
          { body: "支持先用三分法保证基本质量。", stance: "赞成", author: { displayName: "张三" } },
          { body: "反对把它当成所有商品的固定公式。", stance: "反对", author: { displayName: "李四" } },
          { body: "补充：还要看品类、媒介和转化目标。", stance: "补充", author: { displayName: "用户A" } },
          { body: "挑刺：点击率变化不能直接证明构图因果。", stance: "挑刺", author: "小王" }
        ],
        shadowDraft: {
          body: "我会先问构图目的。",
          status: "draft"
        }
      }),
      "photo-rule"
    );

    expect(payload?.comments.map((comment) => comment.author.displayName)).toEqual([
      "先别劝退我",
      "这坑我踩过",
      "半夜补资料",
      "别急着下结论"
    ]);
  });

  it("uses topic-derived fallback personas when real LLM comments omit useful authors", () => {
    const payload = parseGeneratedPayload(
      JSON.stringify({
        lesson: {
          title: "古典音乐版本比较",
          hook: "先分清作品和演奏。",
          explanation: "同一首作品会因乐团、指挥和录音时代产生不同听感。",
          analogy: "像同一个剧本被不同演员演出。",
          recallPrompt: "这次争论是在谈作品还是演奏？",
          completionFeedback: "你能把听感放回版本差异里。"
        },
        post: {
          body: "为什么同一首古典音乐换个指挥就像另一首？"
        },
        comments: [
          { id: "c1", body: "支持从版本差异入门，通勤听音乐也能马上感到区别。", stance: "赞成" },
          {
            id: "c2",
            body: "反对只谈听感，不看作品结构会误导。",
            stance: "反对",
            author: { displayName: "AI 热评员" }
          },
          { id: "c3", body: "补充：可以先听同一段主题在不同录音里的处理。", stance: "补充", author: "用户A" },
          { id: "c4", body: "挑刺：不要把录音音色差异全归因于指挥理解。", stance: "挑刺" }
        ],
        shadowDraft: {
          body: "我会先问作品、演奏和录音分别影响了什么。",
          status: "draft"
        }
      }),
      "classical-version",
      {
        topicTitle: "古典音乐入门",
        learnerBackground: "我是通勤时听音乐的普通兴趣用户，不懂乐理。",
        learnerGoal: "能看懂作品、演奏和审美争论",
        conceptTitle: "古典音乐版本比较",
        conceptPlainName: "版本比较"
      }
    );

    expect(payload?.comments.map((comment) => comment.author.displayName)).toEqual([
      "先别劝退我",
      "这坑我踩过",
      "半夜补资料",
      "别急着下结论"
    ]);
    expect(payload?.comments.map((comment) => comment.author.role).join("\n")).toContain("通勤时听音乐的普通兴趣用户视角");
    expect(payload?.comments.map((comment) => comment.author.displayName).join("\n")).not.toContain("建设派用户");
    expect(payload?.comments.map((comment) => comment.author.displayName).join("\n")).not.toContain("AI 热评员");
  });

  it("derives a conservative shadow draft when the model returns only shadow metadata", () => {
    const payload = parseGeneratedPayload(
      JSON.stringify({
        lesson: {
          title: "心理学的科学底色",
          hook: "别把一个实验当成全部真理。",
          explanation: "心理学结论需要看证据、样本和边界。",
          analogy: "像天气预报，基于数据但保留不确定性。",
          recallPrompt: "这个结论证据是什么？",
          completionFeedback: "你开始追问证据。"
        },
        post: {
          text: "人人都在说心理学研究，但你确定看的是研究不是二手解读吗？"
        },
        comments: [
          { text: "支持先问证据来源。", stance: "支持" },
          { text: "反对把研究都说成不可靠。", stance: "反对" },
          { text: "补充：还要看样本和方法。", stance: "补充" }
        ],
        shadowDraft: {
          status: "draft",
          timestamp: "2025-04-10T12:00:00Z"
        }
      }),
      "psychology"
    );

    expect(payload?.shadowDraft.body).toContain("心理学的科学底色");
    expect(payload?.shadowDraft.status).toBe("draft");
  });

  it("rejects payloads that need local author reply or shadow scaffolding in strict generation quality mode", () => {
    const communityContext = {
      topicTitle: "心理学入门",
      learnerBackground: "我是普通兴趣用户，想看懂心理学讨论。",
      learnerGoal: "能看懂心理学研究和社交平台争论",
      conceptTitle: "认知失调",
      conceptPlainName: "认知失调"
    };
    const raw = JSON.stringify({
      lesson: {
        title: "认知失调的证据边界",
        hook: "先看心理学研究怎么解释自洽需求。",
        explanation: "认知失调要结合研究证据、行为前后变化和解释边界来判断。",
        analogy: "像买贵东西后给自己补理由，但要查证是不是社会认同或沉没成本。",
        recallPrompt: "这个例子里，认知失调的证据和边界是什么？",
        completionFeedback: "你能把心理学讨论放回证据和边界。"
      },
      post: {
        body: "心理学里的认知失调，能解释买贵东西后拼命说它好吗？先看证据和边界。"
      },
      comments: [
        { id: "c1", body: "赞成：认知失调能作为入口，但要看研究证据。", stance: "赞成" },
        { id: "c2", body: "反对：不能把所有事后找理由都归因到认知失调。", stance: "反对" },
        { id: "c3", body: "补充：比如先对比沉没成本、社会认同和认知失调。", stance: "补充" },
        { id: "c4", body: "挑刺：如果没有购买前后的信念变化，就很难判断。", stance: "挑刺" }
      ],
      shadowDraft: {
        status: "draft"
      }
    });

    const loosePayload = parseGeneratedPayload(raw, "cognitive-dissonance", communityContext);
    const strictPayload = parseGeneratedPayload(raw, "cognitive-dissonance", communityContext, {
      rejectLocalScaffoldedContent: true
    });

    expect(loosePayload?.post.author.displayName).toBe("刚刷到就懵");
    expect(loosePayload?.comments.flatMap((comment) => comment.replies ?? [])).toHaveLength(3);
    expect(loosePayload?.shadowDraft.body).toContain("认知失调的证据边界");
    expect(strictPayload).toBeNull();
  });

  it("repairs low-diversity comment stances without replacing the generated lesson or post", () => {
    const raw = JSON.stringify({
      lesson: {
        title: "Fintech 风控",
        hook: "先看风险从哪里被转移。",
        explanation: "金融科技产品常把体验、效率和风险控制放在同一个设计里权衡。",
        analogy: "像机场安检，速度和安全都重要。",
        recallPrompt: "这个产品把风险交给了谁？",
        completionFeedback: "你能追问风险边界了。"
      },
      post: {
        body: "这款信贷产品把审批做到秒级，是创新还是风险后移？"
      },
      comments: [
        { body: "支持，审批快确实解决了体验问题。", stance: "support" },
        { body: "支持，自动化能降低运营成本。", stance: "support" },
        { body: "支持，新用户更容易获得服务。", stance: "support" }
      ],
      shadowDraft: {
        body: "我会先问风险被谁承担。",
        status: "draft"
      }
    });
    const payload = parseGeneratedPayload(raw, "fintech-risk");

    const stances = new Set(payload?.comments.map((comment) => comment.stance));
    expect(payload?.lesson.title).toBe("Fintech 风控");
    expect(payload?.post.body).toContain("信贷产品");
    expect(stances.size).toBeGreaterThanOrEqual(3);
    expect(payload?.comments.some((comment) => comment.body.includes("支持，审批快"))).toBe(true);
    expect(parseGeneratedPayload(raw, "fintech-risk", undefined, { rejectRepairedComments: true })).toBeNull();
  });

  it("relabels obviously mislabelled community stances before adding local repair comments", () => {
    const payload = parseGeneratedPayload(
      JSON.stringify({
        lesson: {
          title: "认知偏差：大脑的快捷方式还是陷阱？",
          hook: "为什么你总是觉得自己的观点是对的？",
          explanation: "认知偏差是大脑为了快速处理信息而走捷径。",
          analogy: "像一个爱偷懒的图书管理员。",
          recallPrompt: "今天你有没有只关注支持自己观点的信息？",
          completionFeedback: "你抓住了核心。"
        },
        post: {
          body: "为什么聪明人也会被认知偏差带偏？"
        },
        comments: [
          {
            body: "没错！我就是因为想看懂心理学争论才发现的认知偏差。",
            stance: "补充",
            author: { displayName: "乐观实践者", role: "建设派用户" }
          },
          {
            body: "认知偏差这个概念现在被滥用了，需要先区分真正的偏差和个人选择。",
            stance: "补充",
            author: { displayName: "反方观察者", role: "边界提醒者" }
          },
          {
            body: "补充一点：认知偏差有很多种，比如锚定效应、损失厌恶。",
            stance: "补充",
            author: { displayName: "科普者小严", role: "资料补充者" }
          }
        ],
        shadowDraft: {
          body: "我会先问证据和边界。",
          status: "draft"
        }
      }),
      "psychology-bias",
      {
        topicTitle: "心理学入门",
        learnerBackground: "我是普通兴趣用户，想看懂心理学讨论，每天 5 分钟。",
        learnerGoal: "能看懂心理学研究和社交平台争论",
        conceptTitle: "认知偏差",
        conceptPlainName: "认知偏差"
      }
    );

    expect(payload?.comments.map((comment) => comment.stance)).toEqual(["赞成", "反对", "补充", "挑刺"]);
    expect(payload?.comments[0].body).toContain("没错");
    expect(payload?.comments[1].body).toContain("被滥用");
    expect(payload?.comments.filter((comment) => comment.body.includes("先学这个点") || comment.body.includes("把结论说满"))).toHaveLength(0);
  });

  it("fills a missing visible stance so every comment tab has content", () => {
    const payload = parseGeneratedPayload(
      JSON.stringify({
        lesson: {
          title: "气候政策工具",
          hook: "先分清碳税、碳交易和能效标准。",
          explanation: "不同政策工具解决的问题和副作用不同。",
          analogy: "像交通管理里收费、限行和道路设计的区别。",
          recallPrompt: "这个政策工具改变了谁的成本？",
          completionFeedback: "你能分清工具边界了。"
        },
        post: {
          body: "碳税、碳交易、能效标准到底哪个更适合城市规划？"
        },
        comments: [
          { body: "支持碳税，因为价格信号最直接。", stance: "赞成" },
          { body: "反对只看碳税，低收入群体承压更大。", stance: "反对" },
          { body: "补充：能效标准常常更容易落到建筑规范里。", stance: "补充" }
        ],
        shadowDraft: {
          body: "我会先分清政策工具。",
          status: "draft"
        }
      }),
      "climate-policy"
    );

    expect(payload?.comments.map((comment) => comment.stance)).toEqual(["赞成", "反对", "补充", "挑刺"]);
    expect(payload?.comments.find((comment) => comment.stance === "挑刺")?.body).toContain("偷换");
  });

  it("adds learner-topic context to comments that are otherwise too generic", () => {
    const payload = parseGeneratedPayload(
      JSON.stringify({
        lesson: {
          title: "学习动机",
          hook: "先看学生为什么愿意参与。",
          explanation: "学习动机会影响课堂讨论和任务投入。",
          analogy: "像课程里的引导问题。",
          recallPrompt: "这节课在解决哪个学习动机问题？",
          completionFeedback: "你能把方法放回课堂场景。"
        },
        post: {
          body: "这节课怎么让学生真的参与讨论？"
        },
        comments: [
          { body: "赞成，这个角度能降低理解门槛。", stance: "赞成" },
          { body: "反对，风险是把方法当万能药。", stance: "反对" },
          { body: "补充：还要看实际任务设计。", stance: "补充" },
          { body: "挑刺：这里把参与和理解混在一起了。", stance: "挑刺" }
        ],
        shadowDraft: {
          body: "我会先看课堂目标。",
          status: "draft"
        }
      }),
      "education-motivation",
      {
        topicTitle: "教育学入门",
        learnerBackground: "我是新手课程设计师，想理解学习动机和课堂讨论。",
        learnerGoal: "能看懂教学方法背后的证据和争议",
        conceptTitle: "学习动机",
        conceptPlainName: "学习动机"
      }
    );

    const contextualComments = payload?.comments.filter((comment) =>
      ["课程", "课堂", "学习动机"].some((term) => comment.body.includes(term) || comment.author.role.includes(term))
    );

    expect(contextualComments?.length).toBeGreaterThanOrEqual(4);
  });

  it("does not truncate learner labels when repairing low-context arts comments", () => {
    const payload = parseGeneratedPayload(
      JSON.stringify({
        lesson: {
          title: "古典音乐的定义",
          hook: "先把听感和传统分开。",
          explanation: "古典音乐常围绕书面传统、演奏和作品版本展开争论。",
          analogy: "像同一个剧本被不同演员演出。",
          recallPrompt: "这首曲子争论的是作品、演奏还是审美？",
          completionFeedback: "你能把听感放回争论里。"
        },
        post: {
          body: "古典音乐到底是不是只指很古老的音乐？"
        },
        comments: [
          { body: "赞成，这个解释很清楚。", stance: "赞成" },
          { body: "反对，这样说太宽。", stance: "反对" },
          { body: "补充：还要看具体版本。", stance: "补充" },
          { body: "挑刺：这里把风格和传统混了。", stance: "挑刺" }
        ],
        shadowDraft: {
          body: "我会先问作品和演奏。",
          status: "draft"
        }
      }),
      "classical-definition",
      {
        topicTitle: "古典音乐入门",
        learnerBackground: "我是通勤时听音乐的普通兴趣用户，不懂乐理。",
        learnerGoal: "能看懂作品、演奏和审美争论",
        conceptTitle: "古典音乐的定义",
        conceptPlainName: "古典音乐定义"
      }
    );

    const repairedText = payload?.comments.map((comment) => comment.body).join("\n") ?? "";

    expect(repairedText).toContain("通勤时听音乐的普通兴趣用户");
    expect(repairedText).not.toContain("普通兴趣用视角");
  });

  it("rejects high-risk deterministic advice in generated comments", () => {
    const payload = parseGeneratedPayload(
      JSON.stringify({
        lesson: {
          title: "AI 金融助手的边界",
          hook: "先分清工具和建议。",
          explanation: "AI 金融助手可以帮助整理信息，但不能替代合规和适当性判断。",
          analogy: "像一个资料索引，不是持牌顾问。",
          recallPrompt: "这个回答是在解释概念，还是在替你做决定？",
          completionFeedback: "你能先看风险边界了。"
        },
        post: {
          body: "AI 理财助手为什么总被提醒不能直接给投资建议？"
        },
        comments: [
          { body: "赞成先看适当性边界和风险承受能力。", stance: "赞成" },
          { body: "反对把聊天回答当成建议，你应该直接买入这只基金。", stance: "反对" },
          { body: "补充：需要查证产品说明和监管要求。", stance: "补充" },
          { body: "挑刺：这里把信息整理和投资建议混在一起了。", stance: "挑刺" }
        ],
        shadowDraft: {
          body: "我会先问这是解释还是建议。",
          status: "draft"
        }
      }),
      "fintech-advice"
    );

    expect(payload).toBeNull();
  });

  it("rejects high-risk deterministic advice across lesson, post and shadow fields", () => {
    const safePayload = () => ({
      lesson: {
        title: "AI 金融助手的边界",
        hook: "先分清工具和建议。",
        explanation: "AI 金融助手可以帮助整理信息，但不能替代合规和适当性判断。",
        analogy: "像一个资料索引，不是持牌顾问。",
        recallPrompt: "这个回答是在解释概念，还是在替你做决定？",
        completionFeedback: "你能先看风险边界了。"
      },
      post: {
        body: "AI 理财助手为什么总被提醒不能直接给投资建议？"
      },
      comments: [
        { body: "赞成先看适当性边界和风险承受能力。", stance: "赞成" },
        { body: "反对把聊天回答当成建议，要先看监管边界。", stance: "反对" },
        { body: "补充：需要查证产品说明和监管要求。", stance: "补充" },
        { body: "挑刺：这里把信息整理和投资建议混在一起了。", stance: "挑刺" }
      ],
      shadowDraft: {
        body: "我会先问这是解释还是建议。",
        status: "draft"
      }
    });

    expect(
      parseGeneratedPayload(
        JSON.stringify({
          ...safePayload(),
          lesson: {
            ...safePayload().lesson,
            explanation: "AI 金融助手会建议你买入这只基金。"
          }
        }),
        "fintech-advice"
      )
    ).toBeNull();
    expect(
      parseGeneratedPayload(
        JSON.stringify({
          ...safePayload(),
          post: {
            body: "如果市场下跌，用户需要卖出这只基金吗？"
          }
        }),
        "fintech-advice"
      )
    ).toBeNull();
    expect(
      parseGeneratedPayload(
        JSON.stringify({
          ...safePayload(),
          shadowDraft: {
            body: "我觉得这个纠纷适合起诉平台。",
            status: "draft"
          }
        }),
        "fintech-advice"
      )
    ).toBeNull();
  });

  it("rejects high-risk deterministic advice in generated replies", () => {
    const payload = parseGeneratedPayload(
      JSON.stringify({
        lesson: {
          title: "心理学讨论的边界",
          hook: "先问证据和专业边界。",
          explanation: "心理学讨论可以帮助理解概念，但不能替代诊断。",
          analogy: "像读地图，不是医生面诊。",
          recallPrompt: "这是概念解释还是诊断建议？",
          completionFeedback: "你能先分清边界了。"
        },
        post: {
          body: "社交平台上的心理学解释什么时候会越界？"
        },
        comments: [
          {
            id: "comment-1",
            body: "赞成先把心理学概念当学习入口。",
            stance: "赞成",
            replies: [
              {
                body: "追问：如果符合这些描述，就可以确诊焦虑症，不用看医生吗？",
                relation: "追问"
              }
            ]
          },
          { id: "comment-2", body: "反对乱贴诊断标签，要看样本和专业评估。", stance: "反对" },
          { id: "comment-3", body: "补充：可以查证研究边界和量表用途。", stance: "补充" },
          { id: "comment-4", body: "挑刺：这里把自我观察和临床诊断混在一起了。", stance: "挑刺" }
        ],
        shadowDraft: {
          body: "我会先问是不是诊断建议。",
          status: "draft"
        }
      }),
      "psychology-safety"
    );

    expect(payload).toBeNull();
  });
});
