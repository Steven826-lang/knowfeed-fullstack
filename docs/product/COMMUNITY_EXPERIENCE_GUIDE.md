# KnowFeed Community Experience Guide

日期：2026-06-20

## 1. 这轮打磨要解决什么

用户看到评论区时，应该感觉这是同一条真实讨论下面的不同网友在各自表达，而不是一组被系统标成“赞成派 / 反对派 / 资料党 / 挑刺员”的 agent 槽位。

这不是单纯前端样式问题。当前体验的根因在生成契约：prompt 把 agent 约束成固定岗位，要求 `displayName` 自己包含 topic/concept 锚点，又把 `stance` 当成显性结构来组织评论。模型于是会产出 `Web3实践派`、`钱包资料党`、`认知失调挑刺员` 这类不像网名的身份，正文也容易变成“赞成：/反对：/追问：”的槽位回答。

本轮重点不是 fallback。fallback 只保持 demo continuity 和故障降级可用；真实体验优先打磨 LLM prompt、严格生成质量门和前端可见层。

## 2. Subagent 研究结论

### 后端 / 契约视角

- `stance` 和 reply `relation` 只能是结构化 metadata，不能作为正文开头。
- `displayName` 应该像社区昵称、网名或临时 ID；topic/concept/learner 锚点由 `role`、`handle`、正文和评论学习信号共同承担。
- prompt 应该先让模型判断“这条讨论里自然会出现哪些人、他们为什么要回应”，再写 author 和评论；`stance` 是写完后的内部分类，不是写作大纲。
- strict validator 只拦明显破坏体验的输出：角色模板 displayName、`赞成：`/`追问：` 这类脚本前缀，以及大部分主评论只是直接提问的输出。

### 前端 / UX 视角

- Feed 和 Post detail 要把网名/handle 放在第一层，role 只作为很轻的“视角”说明。
- 评论正文要承担观点，不靠角色 badge 解释“这个人是谁”。
- 来源说明仍要保留，但 feed/detail 的第一层应该是短摘要，详细证据链放在展开层。
- 不要用假在线人数、假打字状态或假头像活动来制造社区感；真正有效的是身份层级、评论语气和阅读顺序。

### 测试视角

- 测试不能继续绑定固定角色名，比如 `Fintech概念校验者`。
- 需要新增回归：拒绝角色模板 displayName、拒绝脚本前缀、拒绝问题清单式评论，同时接受自然网名 + topic-fit role 的组合。

## 3. 前后端分工

### 后端 / Domain 必做

- `generationPrompt.ts`：把“displayName 必须包含 topic/concept”改成“author 对象整体必须锚定；displayName 优先像网名”。
- `llmContracts.ts`：新增自然社区声线校验，拒绝角色后缀模板和脚本前缀。
- `fallbackGenerator.ts`：不是本轮重点，只保持不会遮挡真实 LLM 路径和已有 demo。
- `generationEngine.ts`：重试反馈要指出脚本前缀、问题清单、角色模板名都是失败原因。

### 前端 / Components 必做

- `HomeFeed.tsx`：评论预览显示昵称 + handle，弱化 role。
- `PostDetail.tsx`：把 role 展示为轻量“视角”信息，不做主身份标签。
- `SourceProvenance.tsx`：后续应把 compact 视图压成一行摘要，详细证据链放到 disclosure。
- `PhoneShell.tsx` / `SettingsPanel.tsx`：后续文案应减少“AI 控制台”感，把机器 provenance 放在次要层。

### 可以分开做吗

可以分开，但优先级不能颠倒。后端 prompt/contract 先改，前端再降噪。只改前端会遮住一部分问题，但真实 LLM 仍会继续生成“角色标签人”，体验会在下一次生成时反弹。

## 4. Prompt 方向

- 给 agent 放权：先读 topic、concept、learnerProfile 和 researchBrief，自己判断这条帖子下面会出现哪些人、每个人为什么会说话。
- 不要让 prompt 规定“第 1 条赞成、第 2 条反对、第 3 条补充、第 4 条挑刺”。`stance` 只在评论写完后选最接近的内部分类。
- 不要求 `displayName` 承担锚点。锚点可以在 `handle`、`role`、正文、学习信号里出现；`displayName` 优先像自然网名。
- 可以有问题，但问题必须嵌在一个人的反应、经验、证据边界或行动建议里，不能直接把评论写成提问清单。
- 仍保留最小结构约束：严格 LLM 路径需要 8 条主评论、8 个不同作者、3 条模型回复；这是为了防止截断和本地补齐，不是为了规定谁该说什么。

displayName 正例：`半夜补资料`、`先别劝退我`、`这坑我踩过`、`@oldhouse_42`、`小林别急着下结论`。

displayName 反例：`建筑史资料党`、`Web3实践派`、`钱包边界派`、`认知失调挑刺员`、`课程设计观察员`。

## 5. 验收口径

- 严格 LLM 路径：8 条主评论、8 个不同作者、3 条模型回复。
- `roleLabelAuthorCount = 0`：可见 displayName 不应是 `anchor + 角色后缀`。
- `scriptedPrefixCommentCount = 0`：评论和回复不应以 stance/relation 标签开头。
- `questionSlotCommentCount <= 1`：不能让评论区主要由直接提问组成。
- `stance` / `relation` 不显示在 UI 上；前端最多展示昵称、handle、轻量“视角”和正文。
- UI 验收至少看 375px / 390px 移动宽度下的 feed、post detail、展开来源和长用户名。
