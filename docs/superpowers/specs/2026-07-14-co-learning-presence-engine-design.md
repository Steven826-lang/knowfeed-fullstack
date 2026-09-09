# Co-Learning Presence Engine — 设计文档

**日期：** 2026-07-14  
**项目：** KnowFeed  
**状态：** 草稿，待实现计划  

## 1. 目标

为 KnowFeed 增加一种**单机共学错觉**：让用户感觉正在一个像 Reddit 一样的学习社区里浏览帖子，有一群陌生但鲜活的“网友”在围绕同一个主题发帖、回帖、点赞、争论，还会对用户的输出做出反应。

这**不是**真正的多用户社区。不需要真实关注关系、@ 提及、公开个人主页，也不需要跨用户的持久社交图。每个用户拥有自己独立的模拟世界。

## 2. 设计原则

- **氛围大于平台。** 我们只需要“有人一起学”的感觉，而不是一个通用社交网络。
- **Reddit 式学习社区。** 每个世界是一个围绕主题的匿名/半匿名讨论区，Agent 是风格各异的网友，而不是功能 NPC 或亲密朋友。
- **锚定课程。** 所有 Agent 内容必须关联当前概念/微课，并引用研究简报。
- **轻量后端。** 复用现有 Python OASIS worker 路径，增加 SQLite 持久化和一个小型调度器。
- **用户掌控。** Shadow draft 仍然需要用户手动批准后才能进入模拟世界。

## 3. 架构

```
┌─────────────────┐      ┌──────────────────┐      ┌─────────────────────────────┐
│  React 前端     │──────▶│ Node llm-proxy   │──────▶│ Python 共学陪伴引擎         │
│ (HomeFeed,      │      │ （网关/启动器）   │      │ (SQLite + LLM)              │
│  PostDetail)    │◀─────│                  │◀─────│                             │
└─────────────────┘      └──────────────────┘      └─────────────────────────────┘
```

Python worker 已经被 Node proxy 用于运行现有 OASIS 模拟。我们把它扩展成一个有状态的持久服务，而不是另建一套后端。

## 4. 数据模型（SQLite）

### `worlds`（世界）
| 字段 | 类型 | 说明 |
|------|------|------|
| world_id | TEXT PK | uuid |
| session_key | TEXT | 浏览器/localStorage 会话标识 |
| topic_id | TEXT | 对应 KnowFeed 主题 |
| topic_title | TEXT | 冗余字段，方便调试 |
| status | TEXT | `active` / `paused` / `completed` |
| current_concept_id | TEXT | 当前世界聚焦的概念 |
| created_at | DATETIME | |
| updated_at | DATETIME | |

### `agents`（Agent / 社区网友）
| 字段 | 类型 | 说明 |
|------|------|------|
| agent_id | TEXT PK | 在世界内稳定 |
| world_id | TEXT FK | |
| display_name | TEXT | UI 显示名，例如 `data_guy`、`skeptic_99` |
| handle | TEXT | 例如 `@data_guy` |
| bio | TEXT | 一句话自我介绍 |
| persona_json | TEXT | 完整人设：身份、背景、语言风格、性格、关心角度、社区习惯 |
| voice_tags | TEXT | 逗号分隔标签，例如 `long-winded, source-hound, sarcastic` |
| community_edges_json | TEXT | 社区声望/ recognizable 快照：常互动对象、被赞/被踩倾向、发帖习惯 |
| created_at | DATETIME | |

### `posts`（帖子）
| 字段 | 类型 | 说明 |
|------|------|------|
| post_id | TEXT PK | |
| world_id | TEXT FK | |
| concept_id | TEXT | |
| agent_id | TEXT FK | 用户 shadow entry 可为空 |
| shadow_entry_id | TEXT FK | 若帖子来自用户批准的 shadow draft |
| content | TEXT | |
| stance | TEXT | `support` / `oppose` / `add` / `doubt` |
| heat | INTEGER | 由 reaction 计算 |
| created_at | DATETIME | |

### `comments`（评论）
| 字段 | 类型 | 说明 |
|------|------|------|
| comment_id | TEXT PK | |
| post_id | TEXT FK | |
| parent_comment_id | TEXT FK | 可为空，用于嵌套 |
| agent_id | TEXT FK | 用户回复可为空 |
| content | TEXT | |
| stance | TEXT | |
| relation | TEXT | `question` / `add` / `refute` |
| heat | INTEGER | |
| created_at | DATETIME | |

### `reactions`（反应）
| 字段 | 类型 | 说明 |
|------|------|------|
| reaction_id | TEXT PK | |
| target_type | TEXT | `post` 或 `comment` |
| target_id | TEXT | |
| agent_id | TEXT FK | |
| reaction_type | TEXT | `like` / `dislike` |
| created_at | DATETIME | |

### `events`（事件轨迹）
用于调试和回放。
| 字段 | 类型 | 说明 |
|------|------|------|
| event_id | INTEGER PK | 自增 |
| world_id | TEXT FK | |
| round | INTEGER | 调度轮次 |
| phase | TEXT | 调度阶段 |
| agent_id | TEXT FK | 可为空 |
| action | TEXT | `create_post`、`create_comment`、`like` 等 |
| payload_json | TEXT | 动作参数 |
| created_at | DATETIME | |

### `shadow_entries`（用户影子输入）
用户批准的 shadow draft 进入模拟世界。
| 字段 | 类型 | 说明 |
|------|------|------|
| entry_id | TEXT PK | |
| world_id | TEXT FK | |
| concept_id | TEXT | |
| user_id | TEXT | 会话标识 |
| content | TEXT | |
| status | TEXT | `pending` / `live` / `responded` |
| created_at | DATETIME | |

## 5. Agent 人设（Reddit 式网友）

每个世界生成 **20–50 个活跃网友**，构成一个围绕主题的**学习社区**。社区里有老面孔、偶尔冒泡的路人、只看帖不发言的潜水员。用户不是认识所有人，而是像刷 subreddit 一样，每次看到几个熟悉 ID 和几个新 ID。

### 人设维度
每个 Agent 由以下维度生成：

| 维度 | 示例 |
|------|------|
| 基础身份 | 用户名、头像风格、自称身份（学生、从业者、爱好者、转行者） |
| 学习背景 | 对该主题的先验知识、正在学的阶段、来此的目的 |
| 语言风格 | 简短毒舌 / 长篇大论 / 爱甩链接 / 爱讲段子 / 谨小慎微 |
| 性格标签 | 乐观、悲观、怀疑、热心、杠精、段子手、资料控 |
| 关心角度 | 实际应用 / 理论原理 / 就业前景 / 常见坑 / 历史八卦 |
| 社区习惯 | 爱发投票帖、只回帖不发帖、喜欢追问、爱发“省流” |

### 社区动态
- Agent 会引用帖子里其他用户的发言（“楼上说的 X 我补充一下”）。
- 存在轻量“声望”或“ recognizable ”记录：谁经常发高质量帖、谁经常抬杠、谁是资料控。
- 允许 Agent 偶尔用 Reddit 风格互动："TL;DR"、"source?"、"this is the way"、表情包文字。
- 用户以新成员身份加入，Agent 会用社区习惯回应（“欢迎，这个问题我之前也踩过”）。

### 与朋友圈的区别
- 不是亲密关系，而是论坛熟人。
- 互动更 arms-length：可以赞成、反对、追问、嘲讽（温和版），但不会有过多的私人调侃。
- 人设 prompt 里写“你是这个学习 subreddit 的常驻用户”，而不是“你是某人的朋友”。

## 6. 讨论调度器

讨论不是按固定剧本走，而是像 Reddit 帖子一样**自然发酵**。调度器只做轻量引导，让 Agent 自由发挥：

1. **开帖** — 几个 Agent 发不同角度的帖子：有人丢问题、有人分享笔记、有人吐槽难懂。
2. **回帖** — 其他 Agent 跟帖：补充、反对、抖机灵、讲自己的踩坑经历。
3. **歪楼/热评** — 允许某个回复意外获得高赞，引发子话题；允许有人发“省流”“TL;DR”。
4. **沉淀** — 某个高赞回复总结或下一个值得讨论的问题浮现出来。

用户完成微课或刷新 feed 时，调度器推进一轮，产生新帖子和新回复。没有强制每个概念必须走完四个阶段。

### Agent 动作空间
- `create_post(concept_id, content, stance)`
- `create_comment(post_id, content, stance, relation, parent_comment_id?)`
- `like(target_type, target_id)`
- `dislike(target_type, target_id)`
- `do_nothing()`

### 观察 Prompt
每个 Agent 每轮收到：
- 自己的人设和近期历史
- 当前概念标题 + 微课片段
- 世界里最近 posts/comments 的精简 feed
- 社区里的轻量“老面孔”提示（例如“你经常反对 @data_guy 的观点”）
- 指令：像 Reddit 学习 subreddit 的网友一样轻松随意地发言，可以讲个人经验、踩坑故事、打比方、开玩笑、发“省流”，不强制引用资料，但要围绕当前知识点

## 7. 用户参与回路

1. 用户完成一节微课。
2. 现有 Shadow Draft 生成器产出一条评论/提问草稿。
3. 用户编辑并批准草稿。
4. 批准的草稿写入 `shadow_entries`，状态为 `live`。
5. 下一轮调度器安排 1–2 个 Agent 回复或点赞该 shadow entry。
6. 用户在 feed 里看到自己的帖子以及 Agent 反应。

## 8. API 接口

### `POST /api/colearning/worlds`
为主题创建一个新世界。返回 `world_id` 和初始 Agent 列表。

### `GET /api/colearning/worlds/:world_id/feed`
返回当前概念的帖子分页，附带评论数和 top reactions。

### `GET /api/colearning/posts/:post_id`
返回单条帖子及其完整评论树。

### `POST /api/colearning/worlds/:world_id/advance`
触发下一调度阶段（用户完成微课或刷新 feed 时调用）。

### `POST /api/colearning/worlds/:world_id/shadow`
提交一条批准的 shadow draft。返回 `shadow_entry_id`。

### `GET /api/colearning/worlds/:world_id/status`
返回当前概念、阶段、轮次和近期事件摘要。

## 9. 前端改动

- 创建主题时调用 `POST /api/colearning/worlds`，把返回的 `world_id` 和 `AppState` 一起存在 localStorage。
- `HomeFeed` 改从 `/api/colearning/worlds/:world_id/feed` 拉取帖子，不再本地生成 bundle。
- `PostDetail` 改从 `/api/colearning/posts/:post_id` 拉取评论树。
- 增加轻量 presence badge：“42 人正在讨论这个知识点” 或 “这个帖子里有 8 条回复”。
- Shadow draft 批准流程不变；批准后再 POST 到新的 shadow 接口，并渲染成用户帖子（像新用户第一次发帖）。
- `PostDetail` 里的用户回复也视为同一概念的新 shadow entry，再 POST 到 shadow 接口。
- 点赞/评论按钮只对用户 shadow entry 开启；Agent 内容对用户只读。

## 10. 质量门

生成内容写入 SQLite 前做轻量把关，避免 AI slop，但不过度限制真实感：

1. **Slop 过滤** — 拒绝无意义附和，如纯“我同意”“说得好”且没有附加值。
2. **重复检查** — 同一线程内拒绝完全重复的论点。
3. **观点多样性** — 每个概念下至少出现两种明显不同的态度。
4. **资料引用（宽松）** — 鼓励引用研究简报，但不强制；允许个人经验、踩坑故事、类比和段子。
5. **可控跑偏** — 允许适度跑题、玩梗、感叹，但不能完全脱离当前概念。

## 11. 降级策略

- 如果 Python worker 不可用，前端降级到现有的本地生成引擎。
- 如果某轮调度失败，世界冻结在最后有效状态并记录错误；用户仍能看到上次生成的内容。
- 如果 LLM 输出未通过质量门，最多重试 2 次，然后降级为基于该 Agent 人设的预置评论模板。

## 12. 明确不做

- 真实用户账号或认证。
- 实时通知。
- 跨用户社交图或关注关系。
- 用户世界之外的公开 feed 或内容分享。
- Polymarket 式预测市场或外部工具集成。
- 跨平台模拟（Twitter/Reddit 同步发帖）。

## 13. 验收标准

用户能够：
1. 打开主题就看到已有 Agent 帖子和评论的 feed。
2. 点进帖子阅读 Reddit 风格的嵌套讨论：赞成/反对、追问、资料补充、温和抬杠。
3. 完成微课、批准 shadow draft，并看到 Agent 对其做出反应。
4. 隔段时间再回来，发现 Agent 世界有了新的动态。
5. 不会觉得讨论是刻板的“学习资料复读”，而是像真实网友聊天。

## 14. 许可证 / 代码复用说明

- MiroShark 的 `backend/wonderwall/` 是 AGPL-3.0 许可证，**禁止**直接复制其代码到 KnowFeed。
- 只能复用接口思想：Reddit 式社区网友生成、动作空间类型、调度循环、SQLite trace 表、tool-call 生成模式。
- KnowFeed 专属逻辑（人设生成、观察 prompt、质量门、课程锚定）必须从头实现。
