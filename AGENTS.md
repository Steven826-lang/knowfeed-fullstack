# KnowFeed — Agent 指南

> AI 学习社区原型：7 天个性化学习路径 + 微课堂 + 分身社区（Shadow Community）。本文件是给 coding agent 的项目 quickstart。

## 启动与测试

- 启动（两个进程）：`npm run dev:api`（Node LLM proxy，终端 1）+ `npm run dev`（Vite，终端 2）
- 前端测试：`npm test`（vitest）—— 基线 18 文件 **170 全绿**
- 后端测试：`cd server/colearning && uv run python -m pytest` —— 基线 **204 passed + 2 历史失败**（`test_llm.py` 两个 429 用例缺 asyncio mark，非功能回归）
- proxy 契约测试：`npx vitest run server/llm-proxy.test.mjs`
- 构建：`npm run build`；全量本地门禁：`npm run verify:local`（vitest + tsc + vite build）
- 改文档后必跑：`npm run verify:docs`
- 改 LLM provider / response format 后必跑：`npm run probe:llm-provider` + 真实 LLM E2E
- **verify 门禁必须保持绿**：改动让基线变红就停下来修，不带病交付

## 目录地图

| 路径 | 内容 |
|---|---|
| `src/App.tsx` | 单页主控：screen 状态机 + 全局 AppState |
| `src/domain/` | 纯函数域逻辑；`curriculumValidator` 拥有课程 ID/进度/mastery；`communityApi` 是社区 API client |
| `src/components/` | 屏幕组件（Onboarding / HomeFeed / MicroLesson / PostDetail / AgentProfile / NewPost / KnowledgeMap / SettingsPanel） |
| `server/llm-proxy.mjs` | Node LLM 代理；浏览器永不接触 API key |
| `server/colearning/` | FastAPI 社区引擎 + SQLite（world_init / tick / mini-tick / catchup / belief / recommender / quality） |
| `docs/` | 文档库（结构见下） |
| `wiki/` | 项目级知识库（**先读 `wiki/index.md`**） |

## Wiki 使用

- 接手任务先读 `wiki/index.md`，按类型找页：entities（项目总览）/ concepts（模型、引擎、推荐、战略、功能健康度）/ decisions（ADR）/ research（调研蒸馏）
- 写规则见 `wiki/AGENTS.md` 与 `wiki/SCHEMA.md`：YAML frontmatter、`[[wikilinks]]`（每页 ≥2 条出链）、新页登记 `index.md`、变更追加 `log.md`
- wiki 是蒸馏层；完整论证按页面 `sources` 字段回读 `docs/` 原文

## 文档治理

- `docs/` 结构：**product**（PRD_V3 / 战略 / 功能矩阵 / playbook）· **engineering**（入门 / 契约 / 走读 / E2E）· **delivery**（门禁 / 验收 / 治理）· **business**（参赛计划）· **superpowers**（specs + plans 原稿）
- canonical 文档表与防腐规则：`docs/delivery/DOCUMENTATION_GOVERNANCE.md`；总索引：`docs/README.md`
- 产品需求以 `docs/product/PRD_V3.md` 为准（PRD_V2 的追加修订，冲突处以 V3 为准）

## 当前阶段

- **P0 sprint 待开工**（FEATURE_MATRIX 的 7 张 P0 卡）：L5 quiz 修复、L6 真 streak、L7 复习队列、L9 费曼输出闭环（旗舰）、C5 三级互动信号、C9+C10 两张皮修复、C1 feed 收尾 + 推荐 v2
- 产品模型已拍板（2026-07-16）：**分身社区**（社区主体是用户 AI 分身，NPC 降级催化层）+ **海外首发**（英文第一语言）；决策详情见 `wiki/decisions/`

## 禁忌

- **禁止任何 git 变更操作**（commit / push / reset / rebase 等）；确有需要先请示
- 不要把密钥写进 `VITE_*` 变量（会进浏览器 bundle）
- 不要绕过 validator 直接改课程 ID / 进度 / mastery——它是这些状态的唯一所有者
- 不要加"隐藏 AI 身份"的开关（EU AI Act 红线）
- 批量评论树只用于历史填充（init / 补时），禁止回应用户实时评论
- 不做 downvote、不做 guilt-trip 文案、不做无限滚动进学习流（PRD §5.2 伦理红线）
