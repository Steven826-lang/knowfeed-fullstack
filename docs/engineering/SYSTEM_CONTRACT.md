# KnowFeed System Contract

日期：2026-06-10

这份文件定义模块边界。任何实现都必须符合这里的职责划分，防止项目滑向“固定课程 App”、“普通聊天机器人”或“泛娱乐社区”。

## 1. 总体数据流

```text
Onboarding
-> TopicProfile + LearnerProfile
-> Research Engine
-> Topic Planner LLM
-> Curriculum Validator
-> Learning Engine
-> Lesson Generator LLM
-> Feed Generator LLM
-> Shadow Engine
-> Progress Engine
```

## 2. Onboarding

职责：

- 收集用户想学的领域。
- 收集用户背景。
- 收集学习目标。
- 收集每日可用时间。
- 给 Research/Planner 提供输入。

第一版字段：

- `topic`: 用户想学的领域或问题。
- `background`: 用户已有背景。
- `avoidedStyles`: 用户明确不想看到的表达风格或难度，例如太数学、太技术、太学术、太鸡汤。
- `goal`: 想达到的理解程度。
- `dailyMinutes`: 每日可用时间，范围 3-15。
- `tonePreference`: 默认、轻松、专业、争议导向。

Onboarding 不能：

- 直接生成课程。
- 直接写入永久 concept graph。

## 3. Research Engine

职责：

- 根据 topic 和 goal 联网检索资料。
- 优先收集可解释、可引用、相对可靠的来源。
- 把资料压缩为 LLM 可用的 research brief。

第一版允许：

- 使用搜索结果摘要。
- 收集 3-6 个来源。
- 标注来源 URL。
- 对热点/新闻类内容使用更新日期。

Research Engine 不能：

- 把未经整理的网页内容直接塞进 UI。
- 把单一来源当成事实真理。
- 为高风险领域提供确定性建议。

## 4. Topic Planner LLM

职责：

- 根据 `TopicProfile`、`LearnerProfile` 和 `ResearchBrief` 生成 7 天课程路径草案。
- 每天拆成 1-3 个概念。
- 给每个概念提供解释目标、前置关系、可生成 Feed 的争议/应用点。
- 遵守 `LearnerProfile.avoidedStyles`，不要把用户明确不想看的口吻、难度或表达套路写入路径。

Planner 输出是草案，不能直接成为永久状态。

## 5. Curriculum Validator

职责：

- 校验 Planner 输出结构。
- 生成稳定 `conceptId`、`lessonId`、`pathOrder`。
- 限制路径长度、难度、前置依赖。
- 删除重复、过宽、过难或不适合 3-10 分钟学习的概念。

Validator 输出才是 app 内的稳定课程图谱。

Validator 是课程结构权威，不是 LLM。

## 6. Learning Engine

职责：

- 决定今日任务。
- 判断何时复习。
- 更新掌握度、XP、streak、review queue。
- 控制解锁顺序。

Learning Engine 不能：

- 根据 Feed 热度随意跳过关键前置概念。
- 让 LLM 直接决定用户已掌握。

## 7. Lesson Generator LLM

职责：

- 为当前 lesson 生成解释、类比、小测、主动回忆 prompt、反馈。
- 根据用户背景调整表达方式。
- 根据 dailyMinutes 控制长度。

它可以生成表达层，但不能改变 lessonId、conceptId、pathOrder。

## 8. Feed Generator LLM

职责：

- 生成围绕当前概念的主帖。
- 生成评论区争议、反驳、补充、挑刺。
- 严格 Research brief + LLM 路径的 prompt 要求 exactly 8 条顶层评论，adapter 质量门要求至少 8 个 topic-fit 社区 author；LLM 决定有哪些人，validator 只管数量、锚定、安全和状态边界。
- 评论区应像真实社区讨论，有 OP 语境、source/context 补充、前提挑战、边界追问、相邻经验或证据/版规提醒等互动层次。
- 生成轻量回复，让社区 agent 追问、补充或反驳已有评论。
- 让每条顶层评论贡献证据、边界、例子、判断动作、反方推理或问题之一，不能只提供 stance 态度。
- 生成下一阶段钩子。
- 把复习点伪装成自然信息流内容。

Feed 必须服务学习，不能变成泛娱乐。

评论可以尖锐，但只能攻击观点、逻辑、产品或行业现象。

回复只属于表达层。LLM 可以起草回复文本，但本地 adapter 必须归一化 reply id、replyToCommentId 和 `source` 审计字段，并避免回复作者与被回复评论作者同名。回复不能影响 lesson、progress、mastery 或 path 状态。

## 9. Shadow Engine

职责：

- 根据用户学习记录生成评论、提问、总结草稿。
- 标注这是 AI 学习分身。
- 要求用户手动批准。

Shadow Engine 不能：

- 自动代表用户公开发言。
- 冒充用户本人。
- 使用用户没有学过或没有表达过的观点包装成用户观点。

## 10. LLM Proxy

职责：

- 保护 API key，不让浏览器直接接触 key。
- 提供 OpenAI-compatible `/api/generate`。
- 统一错误处理、服务端硬超时、JSON output、fallback 信号。
- 对 research 和 LLM 上游请求设置 bounded timeout；慢上游必须返回可审计错误，不能让客户端或 E2E 无期限等待。

不允许：

- 将 API key 写入 `VITE_*`。
- 将 `.env.local` 提交到 git。

## 11. Fallback

Fallback 是演示和测试安全网，不是产品主路径。

Fallback 用于：

- 本地无 API key。
- LLM 请求失败。
- 联网检索失败。
- JSON schema 不合格。
- 测试稳定断言。

UI 必须清楚显示内容来源：`LLM`、`Research brief + LLM` 或 `Fallback`。`Research brief + LLM` 只表示检索摘要参与了规划/生成上下文，不表示事实审稿完成。
