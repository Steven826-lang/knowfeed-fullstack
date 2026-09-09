# KnowFeed 项目介绍

KnowFeed 是一个学习信息流原型：用户输入一个学习目标后，系统把它转成一条每天可刷、可互动、可推进进度的知识流。它不是传统课程目录，也不是简单的聊天机器人，而是一个由学习路径、信息流、微课、评论区和 AI 学习影子共同组成的学习体验。

## 它解决什么问题

很多学习产品把内容组织成章节列表，适合系统学习，但启动成本高，也很难形成每天打开的习惯。KnowFeed 的目标是把“我想学一个主题”转成更轻量的日常入口：

- 先收集用户的主题、背景、目标和每天可投入时间。
- 生成一个稳定的学习路径，包含概念、课程、测验和推进顺序。
- 把当前概念包装成类似信息流的动态内容。
- 用评论区和不同立场的社区声音帮助用户理解争议点、实践场景和常见误区。
- 让用户完成微课、答题、复习和 AI 学习影子草稿，从而推进 mastery、XP、streak 和复习队列。

## 当前原型能力

当前版本已经覆盖以下核心链路：

1. Onboarding：输入学习主题、学习背景、目标和每日时间。
2. 研究与规划：构造 `TopicProfile` / `LearnerProfile`，获取研究摘要，再请求 LLM 生成课程草稿。
3. 验证与稳定化：由本地 validator 接管稳定 ID、课程顺序、测验、进度字段和持久化状态。
4. 信息流体验：围绕当前概念生成 feed、微课、评论区和轻量社区回复。
5. 学习推进：完成课程、答题、更新 mastery / XP / streak / review queue。
6. AI 学习影子：生成可审阅的 shadow draft，但不会代替用户发布或改变核心学习状态。
7. Fallback：没有 API key 或 LLM 失败时，仍可使用确定性的本地内容演示。

## 架构原则

KnowFeed 是一个 agent-style prototype，但核心状态不是让 LLM 随意控制。

LLM 可以生成：

- 课程草稿
- 信息流展示内容
- 评论和回复
- shadow draft 的文字建议

LLM 不可以决定：

- 永久 concept ID / lesson ID
- 学习路径顺序
- choice ID 和正确答案
- mastery、XP、streak、review queue
- 持久化状态结构
- 代表用户发布内容

这些稳定字段由本地 TypeScript validator、engine 和 storage 负责。这样可以保留 LLM 的内容生成能力，同时避免项目退化成不可控的硬编码状态机或纯聊天流。

## 技术栈

- React 19
- TypeScript
- Vite
- Vitest
- 本地 Node LLM proxy
- OpenAI-compatible chat completions endpoint
- localStorage 持久化学习状态

## 关键目录

```text
src/App.tsx                    应用主状态和页面编排
src/components/                信息流、微课、知识地图、设置面板等 UI
src/domain/                    学习路径、生成、验证、存储和 LLM contract
server/llm-proxy.mjs           本地 LLM 代理，负责保护 API key
scripts/real-llm-e2e.mjs       真实 LLM 端到端验证脚本
docs/                          产品、系统、LLM contract、验收和发布文档
```

## 适合谁阅读

- 想运行 demo 的使用者：先看 [GETTING_STARTED.md](../engineering/GETTING_STARTED.md)。
- 想理解产品边界的人：看 [PRD_V2.md](PRD_V2.md) 和 [UX_FLOW.md](UX_FLOW.md)。
- 想改生成逻辑的人：看 [LLM_CONTRACTS.md](../engineering/LLM_CONTRACTS.md) 和 [SYSTEM_CONTRACT.md](../engineering/SYSTEM_CONTRACT.md)。
- 想验收或发布的人：看 [ACCEPTANCE_CHECKLIST.md](../delivery/ACCEPTANCE_CHECKLIST.md)、[E2E_RUNBOOK.md](../engineering/E2E_RUNBOOK.md) 和 [RELEASE_READINESS.md](../delivery/RELEASE_READINESS.md)。

