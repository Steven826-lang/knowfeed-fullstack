# KnowFeed Implementation Plan v2

日期：2026-06-10

这份计划取代旧的 Web3-heavy execution path。旧计划只能作为历史参考，不再作为下一阶段实现顺序。

## Goal

把 KnowFeed 推进成完整可演示原型：

- 用户能选择任意领域。
- 用户能填写背景。
- 系统能联网检索资料。
- LLM 能生成 7 天学习路径。
- Validator 固化课程图谱。
- 每天有微课和信息流。
- AI 分身生成草稿。
- Web3 只是 fallback sample。

## Phase 0: Repair Current Prototype

目的：先修当前 demo 的明显不一致，避免在坏基础上扩展。

任务：

1. 修 map-started lesson mismatch。
2. 修 comment filter semantics：`挑刺` 归入反方或独立 tab。
3. 修 bottom nav 覆盖滚动内容。
4. 给当前 Web3 seed 标记为 `sampleCurriculum`。

验收：

- `npm test`
- `npm run typecheck`
- `npm run build`
- 移动端浏览器截图。

## Phase 1: Onboarding And Profiles

任务：

1. 新增 onboarding screen。
2. 新增 `TopicProfile`。
3. 新增 `LearnerProfile`。
4. 保存 profile 到 localStorage。
5. 首页根据 profile 显示领域和背景摘要。

默认测试输入：

- Topic: Fintech 入门
- Background: 我是 AI 工程师，想了解金融科技
- Goal: 能看懂行业讨论
- Daily time: 5 分钟

验收：

- 能从空状态完成 onboarding。
- 不输入 Web3 也能进入生成流程。

## Phase 2: Research Engine

任务：

1. 增加 `/api/research` 或 proxy-side research function。
2. 对 topic 生成 3-5 个查询。
3. 收集 3-6 个资料来源。
4. 生成 `ResearchBrief`。
5. UI 显示“已参考资料”。

注意：

- Research 是核心能力，不是后置功能。
- 第一版可以轻量，但必须有来源 URL。
- 对时效性主题必须记录 retrieval time。

验收：

- Fintech/AI/心理学至少各能生成 brief。
- 无网络时 fallback 到 LLM-only + 明确标注。

## Phase 3: LLM Topic Planner

任务：

1. 增加 `plannerContracts.ts`。
2. 增加 `topicPlanner.ts`。
3. LLM 根据 TopicProfile + LearnerProfile + ResearchBrief 生成 `GeneratedCurriculumDraft`。
4. 测试 valid/invalid/fallback。

验收：

- 同一 topic 不同 background 生成不同路径。
- 非 Web3 topic 能生成 7 天路径。
- planner 输出不能直接进入 Progress Engine。

## Phase 4: Curriculum Validator

任务：

1. 增加 `curriculumValidator.ts`。
2. 将 draft 转换为 `ValidatedCurriculum`。
3. 固化 conceptId、lessonId、pathOrder。
4. 去重、限制难度、限制每天概念数量。
5. 写入 AppState。

验收：

- concept/lesson ids 稳定。
- 重复概念被合并。
- 过宽概念被拆分或拒绝。
- Progress Engine 只读取 validated curriculum。

## Phase 5: Dynamic Daily Lesson And Feed

任务：

1. 当前 `seed.ts` 降级为 fallback sample。
2. Learning Engine 改为读取 active curriculum。
3. Lesson Generator 根据当前 lesson + learner profile 生成微课。
4. Feed Generator 根据当前 concept + research + progress 生成帖子和评论。
5. Shadow Engine 根据用户记录生成草稿。

验收：

- Fintech、AI、心理学都能跑完整 Day 1。
- Feed 和微课根据背景不同而不同。
- fallback 仍可演示。

## Phase 6: Demo Hardening

任务：

1. 加载态和错误态。
2. 生成来源标注：Research brief + LLM / LLM / Fallback。
3. 生成历史可重试。
4. 成本和超时控制。
5. 浏览器自动化截图：home、path、post、lesson、shadow。

验收：

- 5-8 分钟完整 demo flow。
- API key 存在时走真实 LLM。
- API key 缺失时 fallback flow 不崩。
- browser/computer-use 不可用时 Playwright 兜底。

## Phase 7: Product Polish

任务：

1. 更像社交媒体的 Feed。
2. 评论楼中楼。
3. 复习内容自然混入 Feed。
4. 更强 streak/XP/路径反馈。
5. 分身草稿可编辑、拒绝、批准。

## Definition Of Done

完整可演示 MVP 必须满足：

- 至少 3 个非 Web3 topic 可生成。
- 至少 3 个 learner background 可改变课程。
- LLM 和 research 是真实路径。
- fallback 是兜底路径。
- 所有稳定状态来自 validator/engine，不来自 LLM 自由输出。
- UI 支持完整端到端演示。
- `npm test`、`typecheck`、`build` 通过。
- 有浏览器截图和点击流验证。
