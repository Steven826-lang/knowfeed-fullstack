# KnowFeed Release Review Map

日期：2026-06-12

当前 worktree 改动较大，进入发布或提交前按下面分组 review，不要一次性混成一个不可读提交。

最终是否已经达到“可以真实使用”的判断，以 `docs/delivery/RELEASE_READINESS.md` 为总闸门；本文件只负责拆分 review 面。

## 1. 配置和验证入口

相关文件：

- `../.gitignore`
- `.env.example`
- `package.json`
- `README.md`
- `docs/engineering/E2E_RUNBOOK.md`
- `docs/delivery/ACCEPTANCE_CHECKLIST.md`

检查重点：

- `.env.local` 仍被忽略。
- `.env.example` 只有 placeholder。
- `npm run verify:contracts` 可运行。
- `npm run verify:local` 可运行。
- 两个 verify 脚本保留 Vitest `--pool=threads --maxWorkers=1 --no-file-parallelism`，避免真实浏览器 E2E 后 fork worker 或反复 worker 调度在进程压力下触发 `EAGAIN` / startup timeout。

## 2. LLM / Research Proxy

相关文件：

- `server/llm-proxy.mjs`
- `server/llm-proxy.test.mjs`
- `src/domain/llmClient.ts`
- `src/domain/llmClient.test.ts`
- `src/domain/researchEngine.ts`

检查重点：

- 慢上游有 bounded timeout。
- 504/错误 payload 可被客户端回退。
- research source 有 quality metadata 和 planning-only 标记。
- API key 不进入前端 bundle。

## 3. Planner / Validator 边界

相关文件：

- `src/domain/topicPlanner.ts`
- `src/domain/plannerContracts.ts`
- `src/domain/plannerContracts.test.ts`
- `src/domain/plannerResearchEval.ts`
- `src/domain/plannerResearchEval.test.ts`
- `src/domain/types.ts`

检查重点：

- LLM planner 只能给 draft。
- `curriculumValidator` 拥有 stable concept IDs、lesson IDs、path order、quiz choices。
- 任意主题不能回落成 Web3 state machine。
- 非 Web3 场景不能泄漏 Web3/Gas/链上 fallback。

## 4. Community Agent Quality

相关文件：

- `src/domain/llmContracts.ts`
- `src/domain/llmContracts.test.ts`
- `src/domain/generationEngine.ts`
- `src/domain/generationEngine.test.ts`
- `src/domain/fallbackGenerator.ts`
- `src/domain/fallbackGenerator.test.ts`

检查重点：

- 评论覆盖 `赞成` / `反对` / `补充` / `挑刺`。
- 回复覆盖 `追问` / `补充` / `反驳`。
- reply author 不和 parent comment author 同名。
- community author 贴合 topic/concept/learner，不退回通用 stance 标签。
- repair reply 不能伪装成合格 `Research + LLM`。
- 高风险医疗/法律/金融建议被 parser 拒绝。

## 5. App UX / State

相关文件：

- `src/App.tsx`
- `src/App.test.tsx`
- `src/components/PostDetail.tsx`
- `src/components/ShadowProfile.tsx`
- `src/domain/feedEngine.ts`
- `src/domain/feedEngine.test.ts`
- `src/domain/storage.ts`
- `src/styles.css`

检查重点：

- onboarding -> feed -> post -> lesson -> comments -> shadow -> map 能跑通。
- lesson completion 更新 XP、streak、mastery、review queue。
- Shadow 只生成草稿，必须手动批准才进入历史。
- reload 后不闪回 fallback。
- mobile bottom nav 不遮挡长内容。

## 6. Real E2E Evidence

相关文件：

- `scripts/real-llm-e2e.mjs`
- `docs/delivery/ALIGNMENT_AUDIT.md`
- `docs/engineering/E2E_RUNBOOK.md`

检查重点：

- `summary.json` 含 matrix、matrixGate、communityQuality。
- 失败也写 failure JSON 和截图。
- CuaDriver/visible Chrome 路径有截图和 state artifacts。
- 最新证据路径记录在 `docs/delivery/ALIGNMENT_AUDIT.md` 和 `docs/delivery/ACCEPTANCE_CHECKLIST.md`。
