# KnowFeed Research Notes

日期：2026-06-10

这份笔记记录产品设计时参考的外部方向。它不是事实库，也不是课程资料来源；真正课程生成仍需要运行时 ResearchBrief。

## 1. AI 生成课程方向

Oboe 等产品说明“输入主题，让 AI 生成课程/学习材料”已经是一个存在的方向。KnowFeed 不能只做课程生成，否则差异化不足。

KnowFeed 的差异化应当是：

```text
AI 课程规划
+ 每日短任务
+ 社交信息流学习场景
+ 评论区应用
+ AI 学习分身表达
```

## 2. 多邻国式学习机制

Duolingo 的关键不是表层游戏化，而是：

- 连续 streak。
- 低摩擦每日任务。
- 即时反馈。
- 小步推进。
- 复习和习惯形成。

KnowFeed 应借鉴这些机制，但不要把界面做成重游戏仪表盘。它的主体验仍应更像社交媒体 Feed。

## 3. RAG / 联网检索

对于任意领域课程生成，联网检索是核心能力：

- 降低 LLM 凭空编课程的风险。
- 让新兴领域和热点更贴近现实。
- 给专业领域提供可追踪来源。

第一版不需要复杂知识库，但需要最小 ResearchBrief：

- 查询词。
- 来源 URL。
- 摘要。
- 关键概念。
- 争议点。
- 新手误区。

## 4. 社交信息流学习

KnowFeed 的 Feed 不应只是奖励流。它承担三个学习任务：

1. 课前制造好奇。
2. 课中提供上下文。
3. 课后提供应用场景。

如果 Feed 不能帮助用户理解当前概念，它就是噪音。

## 5. 风险

- AI 生成课程质量不稳定。
- 热门/争议内容可能压过学习路径。
- 评论区可能变成人身攻击。
- 分身可能让用户误以为系统在冒充自己。
- 任意领域容易触达高风险内容。

对应控制：

- Validator 固化课程图谱。
- Feed 必须绑定 conceptId。
- 评论安全规则。
- 分身必须用户批准。
- 高风险领域加免责声明和来源要求。

## External References

- [Oboe AI learning platform coverage](https://www.techradar.com/ai-platforms-assistants/gemini/oboe-just-launched-its-an-ai-powered-platform-that-helps-you-learn-anything)
- [Duolingo streak and habit discussion](https://blog.duolingo.com/how-duolingo-streak-builds-habit/)
- [SchoolAI personalized learning plans](https://schoolai.com/blog/ai-powered-personalized-learning-plans-every-student)
- [DeepSeek API documentation](https://api-docs.deepseek.com/)
