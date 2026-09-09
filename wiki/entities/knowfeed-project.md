---
title: KnowFeed 项目总览
created: 2026-07-18
updated: 2026-07-18
type: entity
tags: [product, frontend, backend, llm]
sources: [README.md, docs/README.md, docs/engineering/GETTING_STARTED.md, package.json]
---

# KnowFeed 项目总览

## 定位

AI 学习社区（AI study community）：AI 为每个学习者生成 7 天个性化学习路径，每天 3-15 分钟微课堂；同一主题的学习者共处一个 Reddit 式社区，每个用户的 AI 分身锚定真实学习状态替用户发言、争论、回应（详见 [[shadow-community-model]]）。

- 市场决策（2026-07-16 拍板）：**海外首发**，英文为第一语言，中文资源保留（见 [[2026-07-16-overseas-first]]）
- 当前阶段：阶段 0 —— P0 sprint 待开工（7 张 P0 卡，见 [[feature-health-map]]）

## 技术栈

- 前端：Vite 7 + React 19 + TypeScript（SPA，AppState 持久化在 localStorage）
- LLM proxy：Node `server/llm-proxy.mjs` —— 浏览器永不接触 API key，转发 OpenAI-compatible chat completions，带 429 backoff
- 社区引擎：Python FastAPI `server/colearning/`（详见 [[learning-community-engine]]）
- 存储：SQLite（`server/colearning/colearning.db`）
- 当前 provider 示例：StepFun `step-3.5-flash-2603`（任何 OpenAI-compatible 端点均可）

## 目录地图

| 路径 | 内容 |
|---|---|
| `src/App.tsx` | 单页主控：screen 状态机（onboarding / feed / path-preview / lesson / post / agent-profile / new-post / settings / map）+ 全局 AppState |
| `src/domain/` | 纯函数域逻辑：curriculumValidator（课程 ID/进度/mastery 唯一所有者）、learningEngine、feedEngine、generationPrompt、llmContracts、communityApi（社区 API client） |
| `src/components/` | 屏幕组件：Onboarding / HomeFeed / PathPreview / MicroLesson / PostDetail / AgentProfile / NewPost / KnowledgeMap / SettingsPanel |
| `server/llm-proxy.mjs` | Node LLM 代理（/api/research、/api/generate） |
| `server/colearning/` | FastAPI 社区引擎 + pytest 测试套件 |
| `docs/` | 文档库：product / engineering / delivery / business / superpowers（specs+plans 原稿） |
| `scripts/` | real-llm-e2e、probe-llm-provider、verify-docs、verify-evidence-archive |
| `wiki/` | 本知识库（先读 [[knowfeed-project]] 同级 index.md） |

## 常用命令

- 前端测试：`npm test`（vitest run）
- 构建：`npm run build`（tsc -b && vite build）
- 后端测试：`cd server/colearning && uv run python -m pytest`
- proxy 契约测试：`npx vitest run server/llm-proxy.test.mjs`
- 全量本地门禁：`npm run verify:local`（vitest + tsc + vite build）
- 启动（两个进程）：`npm run dev:api`（proxy）+ `npm run dev`（vite）
- 文档防腐：`npm run verify:docs`；证据链归档：`npm run verify:evidence-archive`
- 改 LLM provider / response format 后必须：`npm run probe:llm-provider` + 真实 LLM E2E

## 测试基线（2026-07-18 实测）

- 前端：18 个文件 **170 tests 全绿**（~9s）
- 后端：**204 passed + 2 failed** —— `test_llm.py::test_generate_action_retries_on_429` 与 `test_generate_action_raises_after_three_429s`，缺 pytest-asyncio mark 的历史失败，非功能回归
- 任何改动不得让基线变红；verify 门禁保持绿是硬约束

## 关键架构不变量

- LLM 可起草课程与内容，但 validator/engine 拥有永久 ID、路径顺序、choices、进度、mastery 与持久化状态
- 密钥不得写进 `VITE_*` 变量（会进浏览器 bundle）
- 文档治理：canonical 文档表见 `docs/README.md` 与 `docs/delivery/DOCUMENTATION_GOVERNANCE.md`，改文档后跑 `npm run verify:docs`

## 关联

- [[product-strategy-summary]] — 战略、护城河与 MVP 达标线
- [[learning-community-engine]] — 社区引擎实现
- [[feature-health-map]] — 功能健康度与 P0 sprint
