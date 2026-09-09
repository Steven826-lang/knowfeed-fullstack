import { describe, expect, it, vi } from "vitest";
import { generateKnowledgeBundle, selectRenderableBundle } from "./generationEngine";
import { buildFallbackResearchBrief } from "./researchEngine";
import { sampleCurriculum } from "./seed";
import { defaultAppState } from "./storage";

describe("generationEngine", () => {
  it("returns LLM content when the payload is valid", async () => {
    const client = async () => JSON.stringify(validGeneratedPayload({ title: "LLM 生成标题" }));

    const bundle = await generateKnowledgeBundle(defaultAppState, "wallet", client);

    expect(bundle.source).toBe("llm");
    expect(bundle.lesson.title).toBe("LLM 生成标题");
  });

  it("combines segmented LLM surface and comments before strict validation", async () => {
    const payload = validGeneratedPayload({ title: "Segmented title" });
    const surfaceOnly = {
      lesson: payload.lesson,
      post: payload.post,
      shadowDraft: payload.shadowDraft
    };
    const commentsOnly = {
      comments: payload.comments
    };
    const client = vi.fn().mockResolvedValueOnce(JSON.stringify(surfaceOnly)).mockResolvedValueOnce(JSON.stringify(commentsOnly));

    const bundle = await generateKnowledgeBundle(defaultAppState, "wallet", client);

    expect(client).toHaveBeenCalledTimes(2);
    expect(client.mock.calls[0][0].messages.map((message: { content: string }) => message.content).join("\n")).toContain(
      "本阶段只生成 lesson 和 post"
    );
    expect(client.mock.calls[1][0].messages.map((message: { content: string }) => message.content).join("\n")).toContain(
      "本阶段只生成 comments"
    );
    expect(bundle.source).toBe("llm");
    expect(bundle.lesson.title).toBe("Segmented title");
    expect(bundle.comments).toHaveLength(8);
  });

  it("accepts segmented comments as a top-level array from real providers", async () => {
    const payload = validGeneratedPayload({ title: "Array comments title" });
    const surfaceOnly = {
      lesson: payload.lesson,
      post: payload.post,
      shadowDraft: payload.shadowDraft
    };
    const client = vi.fn().mockResolvedValueOnce(JSON.stringify(surfaceOnly)).mockResolvedValueOnce(JSON.stringify(payload.comments));

    const bundle = await generateKnowledgeBundle(defaultAppState, "wallet", client);

    expect(bundle.source).toBe("llm");
    expect(bundle.lesson.title).toBe("Array comments title");
    expect(bundle.comments).toHaveLength(8);
  });

  it("accepts a top-level shadow draft object from split providers", async () => {
    const payload = validGeneratedPayload({ title: "Top-level shadow title" });
    const lessonPostOnly = {
      lesson: payload.lesson,
      post: payload.post
    };
    const client = vi
      .fn()
      .mockResolvedValueOnce(JSON.stringify(lessonPostOnly))
      .mockResolvedValueOnce(JSON.stringify(payload.shadowDraft))
      .mockResolvedValueOnce(JSON.stringify({ comments: payload.comments }));

    const bundle = await generateKnowledgeBundle(defaultAppState, "wallet", client);

    expect(client).toHaveBeenCalledTimes(3);
    expect(bundle.source).toBe("llm");
    expect(bundle.lesson.title).toBe("Top-level shadow title");
    expect(bundle.shadowDraft.body).toBe(payload.shadowDraft.body);
    expect(bundle.comments).toHaveLength(8);
  });

  it("falls back when the client fails or returns invalid JSON", async () => {
    const failingClient = async () => {
      throw new Error("offline");
    };
    const invalidClient = async () => "{}";

    const networkFallback = await generateKnowledgeBundle(defaultAppState, "wallet", failingClient);
    const schemaFallback = await generateKnowledgeBundle(defaultAppState, "wallet", invalidClient);

    expect(networkFallback.source).toBe("fallback");
    expect(schemaFallback.source).toBe("fallback");
  });

  it("retries once when the first generated payload fails validation", async () => {
    const client = vi
      .fn()
      .mockResolvedValueOnce("{}")
      .mockResolvedValueOnce(JSON.stringify(validGeneratedPayload({ title: "Retry title" })));

    const bundle = await generateKnowledgeBundle(defaultAppState, "wallet", client);

    expect(client).toHaveBeenCalledTimes(2);
    expect(bundle.source).toBe("llm");
    expect(bundle.lesson.title).toBe("Retry title");
  });

  it("uses a final structured retry before falling back", async () => {
    const client = vi
      .fn()
      .mockResolvedValueOnce("{}")
      .mockResolvedValueOnce(JSON.stringify({ lesson: { title: "Still invalid" } }))
      .mockResolvedValueOnce(JSON.stringify({ comments: [] }))
      .mockResolvedValueOnce(JSON.stringify(validGeneratedPayload({ title: "Final retry title" })));

    const bundle = await generateKnowledgeBundle(defaultAppState, "wallet", client);

    expect(client).toHaveBeenCalledTimes(4);
    expect(client.mock.calls[3][0].messages.map((message: { content: string }) => message.content).join("\n")).toContain(
      "这是最后一次重试"
    );
    expect(bundle.source).toBe("llm");
    expect(bundle.lesson.title).toBe("Final retry title");
  });

  it("uses deterministic fallback only after all strict generation attempts fail", async () => {
    const client = vi.fn().mockResolvedValue("{}");

    const bundle = await generateKnowledgeBundle(defaultAppState, "wallet", client);

    expect(client).toHaveBeenCalledTimes(4);
    expect(bundle.source).toBe("fallback");
  });

  it("uses a shorter LLM-only policy when web research has fallen back", async () => {
    const researchBrief = buildFallbackResearchBrief(sampleCurriculum.topic, sampleCurriculum.learner);
    const state = {
      ...defaultAppState,
      researchBrief,
      curriculum: {
        ...sampleCurriculum,
        researchBrief
      }
    };
    const client = vi.fn().mockResolvedValue("{}");

    const bundle = await generateKnowledgeBundle(state, "wallet", client);

    expect(client).toHaveBeenCalledTimes(2);
    expect(bundle.source).toBe("fallback");
  });

  it("retries when community author personas are generic stance labels", async () => {
    const genericAuthorPayload = validGeneratedPayload({ title: "Generic author title" });
    genericAuthorPayload.post.author = { displayName: "乐观实践者", handle: "@generic-builder", role: "建设派用户" };
    genericAuthorPayload.comments = genericAuthorPayload.comments.map((comment, index) => ({
      ...comment,
      author:
        [
          { displayName: "乐观实践者", handle: "@generic-builder", role: "建设派用户" },
          { displayName: "反方观察者", handle: "@generic-con", role: "边界提醒者" },
          { displayName: "科普者小严", handle: "@generic-source", role: "资料补充员" },
          { displayName: "逻辑挑刺员", handle: "@generic-critic", role: "概念警察" }
        ][index] ?? comment.author
    }));
    const client = vi
      .fn()
      .mockResolvedValueOnce(JSON.stringify(genericAuthorPayload))
      .mockResolvedValueOnce(JSON.stringify(validGeneratedPayload({ title: "Topic-fit author title" })));

    const bundle = await generateKnowledgeBundle(defaultAppState, "wallet", client);

    expect(client).toHaveBeenCalledTimes(2);
    expect(client.mock.calls[1][0].messages.map((message: { content: string }) => message.content).join("\n")).toContain(
      "displayName 还是角色/立场/职业标签"
    );
    expect(bundle.source).toBe("llm");
    expect(bundle.lesson.title).toBe("Topic-fit author title");
  });

  it("retries when generated community replies depend on local repair", async () => {
    const repairHeavyPayload = {
      lesson: {
        title: "Repair-heavy title",
        hook: "Repair-heavy hook",
        explanation: "Repair-heavy explanation",
        analogy: "Repair-heavy analogy",
        recallPrompt: "Repair-heavy recall",
        completionFeedback: "Repair-heavy feedback"
      },
      post: {
        body: "Repair-heavy post"
      },
      comments: [
        { body: "支持方解释：先看例子，再判断它解决什么问题。", heat: 90, stance: "赞成" },
        { body: "反对方指出边界：不能把一个场景直接推成通用结论。", heat: 80, stance: "反对" },
        { body: "补充方给上下文：比如把概念和学习目标对比。", heat: 70, stance: "补充" },
        { body: "挑刺方指出偷换：需要分清前提和结论。", heat: 65, stance: "挑刺" }
      ],
      shadowDraft: {
        body: "Repair-heavy shadow draft",
        confidence: 72
      }
    };
    const modelReplyPayload = validGeneratedPayload({ title: "Model reply title" });
    const client = vi.fn().mockResolvedValueOnce(JSON.stringify(repairHeavyPayload)).mockResolvedValueOnce(JSON.stringify(modelReplyPayload));

    const bundle = await generateKnowledgeBundle(defaultAppState, "wallet", client);

    expect(client).toHaveBeenCalledTimes(2);
    expect(client.mock.calls[1][0].messages.map((message: { content: string }) => message.content).join("\n")).toContain(
      "model-generated 社区回复数量不是 exactly 3"
    );
    expect(bundle.source).toBe("llm");
    expect(bundle.lesson.title).toBe("Model reply title");
    expect(bundle.comments.flatMap((comment) => comment.replies ?? []).map((reply) => reply.source)).toEqual(["llm", "llm", "llm"]);
  });

  it("retries when three model replies do not cover all relation kinds", async () => {
    const lowRelationPayload = {
      lesson: {
        title: "Low relation title",
        hook: "Low relation hook",
        explanation: "Low relation explanation",
        analogy: "Low relation analogy",
        recallPrompt: "Low relation recall",
        completionFeedback: "Low relation feedback"
      },
      post: {
        body: "Low relation post"
      },
      comments: [
        {
          body: "支持方解释：先看例子，再判断它解决什么问题。",
          heat: 90,
          stance: "赞成",
          replies: [
            {
              relation: "追问",
              body: "追问：支持方下一步应该看什么证据？",
              author: { displayName: "Web3证据追问者", role: "Web3钱包学习者视角" }
            }
          ]
        },
        {
          body: "反对方指出边界：不能把一个场景直接推成通用结论。",
          heat: 80,
          stance: "反对",
          replies: [
            {
              relation: "反驳",
              body: "反驳：有边界也不代表这个概念不能作为入口。",
              author: { displayName: "Web3入口反驳者", role: "Web3钱包概念视角" }
            }
          ]
        },
        {
          body: "补充方给上下文：比如把当前概念和学习目标放在一起看。",
          heat: 70,
          stance: "补充",
          replies: [
            {
              relation: "追问",
              body: "追问：补充上下文后学习者应该怎么判断？",
              author: { displayName: "Web3判断追问者", role: "Web3钱包学习者视角" }
            }
          ]
        },
        { body: "挑刺方指出偷换", heat: 65, stance: "挑刺" }
      ],
      shadowDraft: {
        body: "Low relation shadow draft",
        confidence: 72
      }
    };
    const fullRelationPayload = validGeneratedPayload({ title: "Full relation title" });
    const client = vi.fn().mockResolvedValueOnce(JSON.stringify(lowRelationPayload)).mockResolvedValueOnce(JSON.stringify(fullRelationPayload));

    const bundle = await generateKnowledgeBundle(defaultAppState, "wallet", client);

    expect(client).toHaveBeenCalledTimes(2);
    expect(client.mock.calls[1][0].messages.map((message: { content: string }) => message.content).join("\n")).toContain(
      "reply relation 没有覆盖 追问/补充/反驳"
    );
    expect(bundle.source).toBe("llm");
    expect(bundle.lesson.title).toBe("Full relation title");
    expect(new Set(bundle.comments.flatMap((comment) => comment.replies ?? []).map((reply) => reply.relation))).toEqual(
      new Set(["追问", "反驳", "补充"])
    );
  });

  it("retries when visible comments are mostly stance-only", async () => {
    const lowSignalPayload = {
      lesson: {
        title: "Low comment signal title",
        hook: "Low comment signal hook",
        explanation: "Low comment signal explanation",
        analogy: "Low comment signal analogy",
        recallPrompt: "Low comment signal recall",
        completionFeedback: "Low comment signal feedback"
      },
      post: {
        body: "Low comment signal post"
      },
      comments: [
        {
          body: "赞成，这个说法挺好。",
          heat: 90,
          stance: "赞成",
          replies: [
            {
              relation: "追问",
              body: "追问：学习者应该查证什么证据？",
              author: { displayName: "Web3证据追问者", role: "Web3钱包学习者视角" }
            }
          ]
        },
        {
          body: "反对，我觉得不对。",
          heat: 80,
          stance: "反对",
          replies: [
            {
              relation: "反驳",
              body: "反驳：不对也要说明边界。",
              author: { displayName: "Web3边界反驳者", role: "Web3钱包概念视角" }
            }
          ]
        },
        {
          body: "补充一下，大家看看。",
          heat: 70,
          stance: "补充",
          replies: [
            {
              relation: "补充",
              body: "补充：可以对比概念和目标。",
              author: { displayName: "Web3目标补充者", role: "Web3钱包学习目标视角" }
            }
          ]
        },
        { body: "挑刺，有点怪。", heat: 65, stance: "挑刺" }
      ],
      shadowDraft: {
        body: "Low comment signal shadow draft",
        confidence: 72
      }
    };
    const learningSignalPayload = validGeneratedPayload({ title: "Learning signal title" });
    const client = vi.fn().mockResolvedValueOnce(JSON.stringify(lowSignalPayload)).mockResolvedValueOnce(JSON.stringify(learningSignalPayload));

    const bundle = await generateKnowledgeBundle(defaultAppState, "wallet", client);

    expect(client).toHaveBeenCalledTimes(2);
    expect(client.mock.calls[1][0].messages.map((message: { content: string }) => message.content).join("\n")).toContain(
      "每条主评论必须包含至少一个学习信号"
    );
    expect(bundle.source).toBe("llm");
    expect(bundle.lesson.title).toBe("Learning signal title");
  });

  it("retries when lesson post and shadow draft are generic even if community structure passes", async () => {
    const genericContentPayload = validGeneratedPayload({ title: "Generic lesson title" });
    genericContentPayload.lesson = {
      title: "今天的微课",
      hook: "先看一个核心概念。",
      explanation: "这个概念能帮助你理解讨论。",
      analogy: "像把复杂问题拆开。",
      recallPrompt: "用一句话复述。",
      completionFeedback: "你已经完成今天的学习。"
    };
    genericContentPayload.post = {
      ...genericContentPayload.post,
      body: "这个概念为什么重要？"
    };
    genericContentPayload.shadowDraft = {
      body: "我学到了一个重要概念，下次会继续观察。",
      confidence: 72
    };
    const anchoredContentPayload = validGeneratedPayload({ title: "Anchored lesson title" });
    const client = vi
      .fn()
      .mockResolvedValueOnce(JSON.stringify(genericContentPayload))
      .mockResolvedValueOnce(JSON.stringify(anchoredContentPayload));

    const bundle = await generateKnowledgeBundle(defaultAppState, "wallet", client);

    expect(client).toHaveBeenCalledTimes(2);
    expect(client.mock.calls[1][0].messages.map((message: { content: string }) => message.content).join("\n")).toContain(
      "微课/主帖/学习分身缺少 topic、concept 或 learnerProfile 锚点"
    );
    expect(bundle.source).toBe("llm");
    expect(bundle.lesson.title).toBe("Anchored lesson title");
  });

  it("retries when generated content echoes learner avoided styles", async () => {
    const state = {
      ...defaultAppState,
      learnerProfile: { ...sampleCurriculum.learner, avoidedStyles: ["考试式讲解"] },
      curriculum: {
        ...sampleCurriculum,
        learner: { ...sampleCurriculum.learner, avoidedStyles: ["考试式讲解"] }
      }
    };
    const avoidedStylePayload = validGeneratedPayload({ title: "Avoided style title" });
    avoidedStylePayload.lesson = {
      ...avoidedStylePayload.lesson,
      explanation: "Web3钱包这里用考试式讲解来记住私钥控制权、助记词边界和查证动作。"
    };
    const correctedPayload = validGeneratedPayload({ title: "Avoided style corrected title" });
    const client = vi
      .fn()
      .mockResolvedValueOnce(JSON.stringify(avoidedStylePayload))
      .mockResolvedValueOnce(JSON.stringify(correctedPayload));

    const bundle = await generateKnowledgeBundle(state, "wallet", client);

    expect(client).toHaveBeenCalledTimes(2);
    expect(client.mock.calls[1][0].messages.map((message: { content: string }) => message.content).join("\n")).toContain(
      "没有遵守 learnerProfile.avoidedStyles"
    );
    expect(bundle.source).toBe("llm");
    expect(bundle.lesson.title).toBe("Avoided style corrected title");
  });

  it("retries when generated content depends on local author reply or shadow scaffolding", async () => {
    const scaffoldedPayload = JSON.parse(JSON.stringify(validGeneratedPayload({ title: "Scaffolded title" })));
    delete scaffoldedPayload.post.author;
    delete scaffoldedPayload.shadowDraft.body;
    scaffoldedPayload.comments = scaffoldedPayload.comments.map((comment: Record<string, unknown>) => ({
      ...comment,
      author: undefined,
      replies: undefined
    }));
    const completePayload = validGeneratedPayload({ title: "Model-owned content title" });
    const client = vi
      .fn()
      .mockResolvedValueOnce(JSON.stringify(scaffoldedPayload))
      .mockResolvedValueOnce(JSON.stringify(completePayload));

    const bundle = await generateKnowledgeBundle(defaultAppState, "wallet", client);

    expect(client).toHaveBeenCalledTimes(2);
    expect(client.mock.calls[1][0].messages.map((message: { content: string }) => message.content).join("\n")).toContain(
      "post/comment/reply author 或 shadowDraft 依赖本地补齐"
    );
    expect(bundle.source).toBe("llm");
    expect(bundle.lesson.title).toBe("Model-owned content title");
  });

  it("accepts the documented nested feed shape from real LLM responses", async () => {
    const client = async () =>
      JSON.stringify({
        lesson: {
          title: "Web3钱包的新手边界",
          hook: "先从 Web3钱包 的第一次签名例子看，为什么入口价值和私钥风险必须一起判断。",
          explanation: "Web3钱包不是普通平台账户；学习者要分清私钥控制权、助记词备份和交易签名证据边界。",
          analogy: "像把家门钥匙拿回自己手里：更自由，也要查证每一步操作风险。",
          recallPrompt: "用一句话解释 Web3钱包 和平台账户的区别，并指出一个需要查证的风险。",
          completionFeedback: "你现在能把 Web3钱包 争论放回私钥控制、备份边界和新手操作证据里判断。"
        },
        feed: {
          post: {
            body: "Web3钱包到底是新手入口，还是把私钥和助记词风险提前丢给学习者？先看一个签名例子、证据边界和备份动作再判断。",
            author: { displayName: "刚刷到就懵", role: "Web3钱包新手讨论发起者" }
          },
          comments: [
            {
              body: "我比较站这个入口，先看一个 Web3钱包 具体例子，再判断它解决什么问题和证据边界。",
              heat: 90,
              stance: "赞成",
              author: { displayName: "先别劝退我", role: "Web3钱包使用场景视角" },
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
              heat: 82,
              stance: "反对",
              author: { displayName: "这坑我踩过", role: "Web3钱包风险边界视角" },
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
              heat: 76,
              stance: "补充",
              author: { displayName: "半夜补资料", role: "Web3钱包学习材料视角" },
              replies: [
                {
                  relation: "补充",
                  body: "我再垫一层：还要把 Web3钱包 和第一次签名风险放在一起看。",
                  author: { displayName: "签名前看一眼", role: "Web3钱包新手体验视角" }
                }
              ]
            },
            {
              body: "别急着下结论，这里容易偷换 Web3钱包 前提，需要查证它为什么成立和适用边界。",
              heat: 70,
              stance: "挑刺",
              author: { displayName: "别急着下结论", role: "Web3钱包证据校验视角" }
            },
            {
              body: "从钱包安全视角看，还要让用户先查证 Web3钱包 助记词备份方法和误操作边界。",
              heat: 68,
              stance: "补充",
              author: { displayName: "助记词别乱存", role: "Web3钱包新手学习视角" }
            },
            {
              body: "我卡在失败成本这里：只谈 Web3钱包 入口价值，会忽略普通用户第一次转账时的风险边界。",
              heat: 64,
              stance: "反对",
              author: { displayName: "转账前先停", role: "Web3钱包安全视角" }
            },
            {
              body: "从社区版规看，Web3钱包 经验帖最好分清个人经历、资料来源和可复现步骤。",
              heat: 60,
              stance: "补充",
              author: { displayName: "版规先看完", role: "Web3钱包社区证据边界视角" }
            },
            {
              body: "还有个前提别漏：OP 没说清托管钱包还是自托管钱包，很多 Web3钱包 建议都会套错场景。",
              heat: 56,
              stance: "挑刺",
              author: { displayName: "OP先说场景", role: "Web3钱包发帖语境视角" }
            }
          ],
          nextHooks: ["继续刷会遇到下一层争议"]
        },
        shadowDraft: {
          body: "我会先把 Web3钱包 和平台账户分开，分清助记词来源、签名方法和风险边界，再判断是否适合新手。",
          confidence: 72
        }
      });

    const bundle = await generateKnowledgeBundle(defaultAppState, "wallet", client);

    expect(bundle.source).toBe("llm");
    expect(bundle.post.body).toContain("Web3钱包");
    expect(bundle.post.body).toContain("证据边界");
    expect(bundle.comments.map((comment) => comment.stance).slice(0, 4)).toEqual(["赞成", "反对", "补充", "挑刺"]);
    expect(new Set(bundle.comments.map((comment) => comment.author.displayName)).size).toBeGreaterThanOrEqual(8);
  });

  it("falls back when generated comments violate discussion safety rules", async () => {
    const unsafeClient = async () =>
      JSON.stringify({
        lesson: {
          title: "LLM 生成标题",
          hook: "LLM hook",
          explanation: "LLM explanation",
          analogy: "LLM analogy",
          recallPrompt: "LLM recall",
          completionFeedback: "LLM feedback"
        },
        post: {
          body: "LLM post"
        },
        comments: [
          { body: "这个真实个人就是骗子，应该被网暴。", heat: 90, stance: "反对" },
          { body: "讨论产品逻辑可以，但不要攻击个人。", heat: 80, stance: "补充" },
          { body: "先回到概念边界再判断。", heat: 70, stance: "赞成" }
        ],
        shadowDraft: {
          body: "我的分身草稿",
          confidence: 77,
          status: "draft"
        }
      });

    const bundle = await generateKnowledgeBundle(defaultAppState, "wallet", unsafeClient);

    expect(bundle.source).toBe("fallback");
  });

  it("uses a current-concept fallback while generated content is stale", async () => {
    const staleBundle = await generateKnowledgeBundle(defaultAppState, "wallet", async () => {
      throw new Error("offline");
    });

    const renderable = selectRenderableBundle(defaultAppState, "gas", staleBundle);

    expect(renderable.source).toBe("fallback");
    expect(renderable.conceptId).toBe("gas");
    expect(renderable.post.conceptId).toBe("gas");
  });
});

function validGeneratedPayload({ title }: { title: string }) {
  return {
    lesson: {
      title,
      hook: "Web3钱包先看一个真实例子，再判断私钥控制权解决什么问题。",
      explanation: "Web3钱包学习不能只背概念，要分清托管账户、自托管钱包和助记词边界，再查证每一步操作风险。",
      analogy: "它像把家门钥匙交回自己手里：自由更高，但备份和误操作的证据边界也更重要。",
      recallPrompt: "用一句话说明 Web3钱包和平台账户的关键区别，并指出一个需要查证的风险。",
      completionFeedback: "你现在能把 Web3钱包放回私钥控制、备份边界和新手操作风险里判断。"
    },
    post: {
      body: "Web3钱包到底是新手入口，还是把私钥和助记词风险提前丢给学习者？先看证据、边界和一个具体例子再判断。",
      author: {
        displayName: "刚刷到就懵",
        handle: "@wallet-first-scroll",
        role: "Web3钱包讨论观察者"
      }
    },
    comments: [
      {
        body: "我比较站这个入口，先看一个 Web3钱包 具体例子，再判断它解决什么问题和证据边界。",
        heat: 90,
        stance: "赞成",
        author: {
          displayName: "先别劝退我",
          handle: "@wallet-entry",
          role: "Web3钱包实践视角"
        },
        replies: [
          {
            relation: "追问",
            body: "我想多问一句：这个例子背后的 Web3钱包 证据和操作边界要一起看。",
            author: { displayName: "证据先别急", handle: "@wallet-evidence", role: "Web3钱包学习者视角" }
          }
        ]
      },
      {
        body: "我不太买直接推广的说法，Web3钱包 这个例子需要说明证据、边界和新手失败成本。",
        heat: 80,
        stance: "反对",
        author: {
          displayName: "这坑我踩过",
          handle: "@wallet-hard-lesson",
          role: "Web3钱包边界视角"
        },
        replies: [
          {
            relation: "反驳",
            body: "这点我反着看：有边界也不代表 Web3钱包 不能作为学习入口。",
            author: { displayName: "入口还得留", handle: "@wallet-entry-back", role: "Web3钱包概念视角" }
          }
        ]
      },
      {
        body: "先补一个上下文：把 Web3钱包 概念和学习目标对比，会更容易分清适用场景。",
        heat: 70,
        stance: "补充",
        author: {
          displayName: "半夜补资料",
          handle: "@wallet-late-notes",
          role: "Web3钱包上下文视角"
        },
        replies: [
          {
            relation: "补充",
            body: "我再垫一层：还要把 Web3钱包 和第一次签名风险放在一起看。",
            author: { displayName: "签名前看一眼", handle: "@wallet-signing", role: "Web3钱包学习目标视角" }
          }
        ]
      },
      {
        body: "别急着下结论，这里容易偷换 Web3钱包 前提，需要查证它为什么成立和适用边界。",
        heat: 65,
        stance: "挑刺",
        author: {
          displayName: "别急着下结论",
          handle: "@wallet-slow-down",
          role: "Web3钱包概念校验视角"
        }
      },
      {
        body: "从钱包安全视角看，还要让用户先查证 Web3钱包 助记词备份方法和误操作边界。",
        heat: 62,
        stance: "补充",
        author: {
          displayName: "备份别手滑",
          handle: "@wallet-backup",
          role: "Web3钱包安全实践视角"
        }
      },
      {
        body: "我卡在失败成本这里：只谈 Web3钱包 入口价值，会忽略普通用户第一次转账时的风险边界。",
        heat: 58,
        stance: "反对",
        author: {
          displayName: "第一次转账慌过",
          handle: "@wallet-first-tx",
          role: "Web3钱包新手体验视角"
        }
      },
      {
        body: "从社区版规看，Web3钱包 经验帖最好分清个人经历、资料来源和可复现步骤。",
        heat: 54,
        stance: "补充",
        author: {
          displayName: "版规先放这",
          handle: "@wallet-rules",
          role: "Web3钱包社区版规视角"
        }
      },
      {
        body: "还有个前提别漏：OP 没说清托管钱包还是自托管钱包，很多 Web3钱包 建议都会套错场景。",
        heat: 51,
        stance: "挑刺",
        author: {
          displayName: "先问OP场景",
          handle: "@wallet-op-scene",
          role: "Web3钱包发帖语境视角"
        }
      }
    ],
    shadowDraft: {
      body: "我会先把 Web3钱包和平台账户分开，分清助记词来源、签名方法和风险边界，再判断是否适合新手。",
      confidence: 72
    }
  };
}
