# KnowFeed Acceptance Checklist

日期：2026-06-12

Freshness note, 2026-06-20: this checklist contains historical acceptance evidence from prior real-LLM runs. Current delivery completion is not proven until the current-state gate in [RELEASE_READINESS.md](RELEASE_READINESS.md) passes with durable artifacts. The current provider is StepFun Global `step-3.5-flash-2603` with `LLM_RESPONSE_FORMAT=none`; provider probing, local `/api/generate`, and segmented generation diagnostics pass. Live web research is environment-dependent: command-line DuckDuckGo/Wikipedia still need explicit proxy environment, while `LLM_RESEARCH_MODE=off` is available for local preview only. Fresh expanded-full archive evidence and visible-browser real-LLM evidence remain blocked.

每次功能完成前必须检查这份清单。

## Product Alignment

- [x] 这个功能是否支持非 Web3 领域？
- [x] 这个功能是否使用了用户背景？
- [x] 这个功能是否仍然保留每日任务入口？
- [x] 这个功能是否仍然保留 Feed 帖子入口？
- [x] Feed 是否服务学习，而不是泛娱乐？
- [x] 评论区是否像社交媒体评论区，而不是群聊/论坛？
- [x] AI 分身是否只是草稿/辅助表达，没有自动公开发言？
- [x] AI 分身草稿是否显示自信度和依据的学习记录？
- [x] AI 分身草稿是否支持编辑、拒绝、手动批准，并把已批准内容放入历史？

## LLM And Research

- [x] 是否真实调用 LLM，而不是只用静态内容？
- [x] 是否有联网资料或 ResearchBrief？
- [x] 是否显示来源或生成来源？
- [x] web research sources 是否带有 `qualityScore`、`qualitySignals` 和 `planning-only` 标记？
- [x] LLM/research proxy 是否有服务端硬超时，慢上游是否会返回 504/可回退错误而不是让真实 E2E 无产物挂死？
- [x] LLM 输出是否经过 schema validation？
- [x] 用户在 onboarding 填写的负偏好 `avoidedStyles` 是否进入 learner profile，并作为 planner/generator 的硬性负约束影响真实 LLM 输出？
- [x] LLM 是否不能直接写入永久 conceptId/lessonId/pathOrder？
- [x] planner/research eval 是否仍能抓住离题 source、缺失 source-quality metadata、Web3 样例泄漏、LLM 越权 state 字段？
- [x] 评论区是否覆盖 4 类 stance（赞成/反对/补充/挑刺）？
- [x] Research + LLM 评论区是否至少有 8 个由 LLM 动态设计的 topic/concept/learner-fit 社区 author，而不是固定角色槽？
- [x] 评论区是否呈现真实社区讨论层次，例如 OP 语境、context/source 补充、前提挑战、边界追问、相邻经验或证据/版规提醒？
- [x] 评论区是否 exactly 3 条可见嵌套回复，并且回复 relation 覆盖 `追问` / `补充` / `反驳`？
- [x] 回复作者是否不同于被回复评论作者，避免社区 agent 自问自答？
- [x] 评论区是否提供 `热度` / `新回复` / `相关` 排序，并且切换排序不会丢失 stance 或 reply 结构？
- [x] 评论区是否能直接看到社区 agent role，而不是只看到匿名评论？
- [x] LLM 生成的 reply 是否只作为表达层，由 adapter 归一化 `id` / `replyToCommentId`，没有写入 lesson/progress/mastery/path 状态？
- [x] LLM 生成和 adapter repair 的 reply 是否用表达层 `source: "llm" | "repair"` 区分，并由 E2E `repairReplyCount` 检查本地 repair filler 是否过多？
- [x] 评论正文是否至少有多条明确使用 topic、concept、用户背景或学习目标，而不是泛泛表态？
- [x] 每条顶层评论是否包含明确学习信号（证据/史料/数据、边界/误解、例子、判断动作、反方推理或问题），而不是只写 `赞成` / `反对` / `补充` / `挑刺` 的态度？
- [x] 社区 agent 是否没有凭空编造精确数字、百分比、年份、公司案例、报告名或机构名；没有 `researchBrief` 支撑时是否改成待查证问题、趋势判断或类比例子？
- [x] 评论作者是否像具体社区 agent，而不是 `张三`、`李四`、`小王`、`用户A` 这类占位名？
- [x] LLM 缺失或返回占位作者时，adapter 是否按 topic/concept/learner profile 派生兜底 persona，而不是退回通用 stance 标签？严格 Research + LLM 路径是否会要求 LLM 自己给出至少 8 个合格社区 agent？
- [x] 严格生成路径是否会拒绝 author displayName / handle / role 整体都未锚定 topic/concept/learner 的通用社区身份，例如 `建设派用户`、`风险派用户`、`资料补充员`、`逻辑挑刺员`、`乐观实践者`、`反方观察者`、`科普者`？
- [x] 严格生成路径是否同样检查 reply author 质量，而不是只检查主帖和顶层评论作者？
- [x] 艺术/历史等非商业主题的 community author name / handle / role 是否没有套用运营、产品、商业角色？正文可以讨论领域内的商业化或商业包装，但不能把讨论者身份套成商业模板。
- [x] generated bundle 内部的 comment author role / handle / body 是否也贴合主题和学习者，而不是只让 DOM 可见文本看起来正确？
- [x] 主帖 `post.author` 是否也是 topic/concept/learner-fit 社区角色，而不是 `AI 热评员`、`@knowfeed-ai` 或 `AI 生成角色`？
- [x] 评论区是否没有主要依赖本地 repair filler 来凑 stance？
- [x] 如果 LLM 首次输出需要任何本地 reply repair，generation engine 是否会带反馈 retry，而不是直接接受含 repair reply 的 `Research + LLM` 社区？
- [x] 如果 LLM 首次输出的顶层评论多数缺少学习信号，generation engine 是否会带反馈 retry，而不是用 adapter context repair 把弱评论伪装成合格社区？
- [x] 如果 LLM 首次输出的微课、主帖或学习分身仍是泛泛文案，generation engine 是否会带反馈 retry，而不是只因为评论结构合格就接受？
- [x] 社区质量信号是否覆盖 examples / counterpoints / questions / boundaries / evidence / learner actions，而不是只凑齐 stance 和数量？
- [x] 非 Web3 场景是否仍然禁止 `Web3`、`Gas`、`链上` 泄漏？注意 fintech 场景可以合法讨论支付/数字钱包，不应把所有 `钱包` 都当成 Web3 泄漏。
- [x] fallback 是否仍然可用？
- [x] fallback 是否只作为容错/demoability，不被当作当前交付证据？
- [x] API key 是否只存在 `.env.local` 或服务器环境变量？

## Learning

- [x] 今日任务是否明确？
- [x] 微课是否能在 3-10 分钟内完成？
- [x] 是否有主动回忆或小测？
- [x] 微课完成后是否有回到评论区前的短反馈？
- [x] 是否更新 mastery、XP、streak、review queue？
- [x] 是否能解释为什么下一步该学这个？

## UX

- [x] 首屏是否像社交媒体/学习 Feed，而不是课程后台？
- [x] 首次生成后是否先展示 7 天路径预览，并提供开始 Day 1 / 进入 Feed 的入口？
- [x] 用户是否能从帖子进入学习？
- [x] 用户是否能在评论区写下一句本地回复或追问？
- [x] 用户是否能从今日任务直接学习？
- [x] 学完是否回到 Feed/评论区看到应用场景？
- [x] 刷新页面后是否保留 Research + LLM feed、进度和分身草稿，而不是闪回 fallback 内容？
- [x] 从知识地图进入 lesson 时，concept、lessonId 和 quiz choices 是否一致？
- [x] 移动端是否无明显遮挡、溢出、重叠？
- [x] 长文本是否不会撑破按钮或卡片？

## Safety

- [x] 评论是否只攻击观点/逻辑/行业现象？
- [x] 是否避免真实个人攻击？
- [x] 是否避免身份群体攻击？
- [x] 是否避免医疗/法律/金融确定性建议？
- [x] 分身内容是否明确标注 AI 生成？

## Verification

### Historical Accepted Evidence

The checked evidence in this subsection records prior passing cycles. It remains useful regression context, but it does not prove the current worktree is ready for delivery until the StepFun-backed expanded-full archive and visible-browser evidence are regenerated.

- Latest verified on 2026-06-12:
  - `/tmp/knowfeed-expanded-full-domain-tuned-final` passed with the final release-gate expanded real LLM matrix after dynamic-community tuning: 15/15 runs across architecture, education, history, music, and visual arts; 5 learner personas; mobile, laptop, and desktop viewports; `matrixGate.passed: true`; `failure: null`; all detailed runs stayed on `Research + LLM 生成内容` with `researchSource: web` and `curriculumSource: planner`; community-quality min/avg/max 100; each run had 6 visible comments, 6 generated comments, exactly 3 generated replies, full stance coverage (`赞成` / `反对` / `补充` / `挑刺`), full reply-relation coverage (`追问` / `补充` / `反驳`), zero repair replies, zero generic community authors, zero self-replies, zero low-learning-value comments, and daily/map lesson integrity true.
  - `/tmp/knowfeed-architecture-three-viewports-domain-tuned` passed with 3/3 real LLM architecture runs after the E2E domain check stopped treating architecture-adjacent roles like real-estate/product/design-management participants as off-topic by default; community-quality min/avg/max 100, three viewports covered, and the stricter 6-comment / 3-reply / three-relation community contract remained enforced.
  - `/tmp/knowfeed-expanded-full-current` passed with the release-gate expanded real LLM matrix: 15/15 runs across architecture, education, history, music, and visual arts; 5 learner personas; mobile, laptop, and desktop viewports; `matrixGate.passed: true`; all detailed scenarios report `researchSource: web` and `curriculumSource: planner`; community-quality min/avg/max 100; every run has full stance coverage (`赞成` / `反对` / `补充` / `挑刺`), reply-relation coverage (`追问` / `补充` / `反驳`), zero repair replies, zero generic community authors, zero self-replies, zero low-learning-value comments, and daily/map lesson integrity true.
  - Lesson completion state-boundary hardening passed: `completeLesson` now derives the completed concept from the stable lesson record instead of trusting `LessonResult.conceptId`; `src/domain/learningEngine.test.ts` covers mismatched payload input, `npm run verify:contracts` now covers the server proxy plus all domain contracts and passed in the current cycle with 12 files / 69 tests. The full local gate's Vitest phase passed with 13 files / 84 tests, and the same cycle passed `npm run typecheck` plus `npm run build`; a later whole-script rerun was blocked before process start by OS `fork: Resource temporarily unavailable`, not by a test/type/build failure.
  - `/tmp/knowfeed-wide-full-after-teaching-anchor` passed with 12/12 real LLM runs across photography, education, classical music, and Japanese Sengoku history; 4 subject areas, 4 learner personas, 3 viewports, `matrixGate.passed: true`, all `Research + LLM 生成内容`, all `researchSource: web`, all `curriculumSource: planner`, community-quality min/avg/max 100, and max generic/placeholder/self-reply/repair-reply/low-learning/off-domain author counts all 0.
  - `/tmp/knowfeed-visible-current-classical` passed with headed visible Chrome (`KNOWFEED_E2E_HEADLESS=0`, `headed: true`) for `classical-music-listener` on mobile; 1/1 run passed, community-quality score 100, full stance and reply-relation coverage, reload persistence, daily lesson integrity, map lesson integrity, and 10 flow screenshots.
  - `/tmp/knowfeed-cua-building/cua-summary.json` passed with CuaDriver CLI visible macOS interaction against a real Chrome window for a new arbitrary topic, `建筑史入门`; it verified web research, planner curriculum, `research-llm` bundles, 7 concepts / 7 lessons, one completed lesson, XP 47, one approved shadow post, no pending draft after approval, 8 comments / 6 LLM replies, full stance and reply-relation coverage, `repairReplyCount: 0`, and map-to-lesson integrity for `风格与时代：建筑如何诉说历史`.
  - The CuaDriver `建筑史入门` scenario is now a repeatable scripted E2E scenario: `architecture-city-renewal`, exposed through `npm run e2e:real-llm:architecture` and included in `npm run e2e:real-llm:matrix:expanded`.
  - `/tmp/knowfeed-architecture-auto-current` passed with `npm run e2e:real-llm:architecture`: 1/1 real LLM mobile run for `建筑史入门` / city-renewal practitioner, `Research + LLM 生成内容`, `researchSource: web`, `curriculumSource: planner`, 7 concepts / 7 lessons, community-quality score 100, all four stance tabs visible, reply relations covering `追问` and `反驳`, `repairReplyCount: 0`, `genericCommunityAuthorCount: 0`, `selfReplyCount: 0`, reload persistence, daily lesson integrity, map lesson integrity, and 10 flow screenshots.
  - `/tmp/knowfeed-expanded-mobile-current` passed with `npm run e2e:real-llm:matrix:expanded`: 5/5 real LLM mobile runs across architecture, education, history, music, and visual arts; 5 learner personas (`city-renewal-practitioner`, `course-designer`, `content-editor`, `casual-listener`, `ecommerce-operator`); `matrixGate.passed: true`; all runs used `Research + LLM 生成内容`, `researchSource: web`, `curriculumSource: planner`; community-quality min/avg/max 100; all runs had full stance coverage, zero repair replies, zero generic community authors, zero self-replies, zero low-learning-value comments, and daily/map lesson integrity true.
  - `/tmp/knowfeed-six-agent-photography-mobile` passed after the LLM-designed community-agent change: 1/1 real LLM mobile run for photography + ecommerce operator; `Research + LLM 生成内容`; `communityQuality.score: 100`; 6 visible comments, 6 visible distinct authors, 3 generated replies, full stance coverage (`赞成` / `反对` / `补充` / `挑刺`), full reply relation coverage (`追问` / `反驳` / `补充`), zero generic authors, zero repair replies, zero low-learning-value comments, and daily/map lesson integrity true.
  - Computer Use and Chrome MCP transports returned `Transport closed` / connection errors in this session; current visible proof uses CuaDriver CLI as the computer-use parity surface, plus headed Chrome/CDP for deterministic automation.
  - `/opt/homebrew/bin/node --check scripts/real-llm-e2e.mjs` passed.
  - `/opt/homebrew/bin/node ./node_modules/vitest/vitest.mjs run --maxWorkers=1` passed with 13 files / 79 tests.
  - `/opt/homebrew/bin/node ./node_modules/typescript/bin/tsc -b` passed.
  - `/opt/homebrew/bin/node ./node_modules/vite/bin/vite.js build` passed.
  - `git diff --check` passed.
  - Community safety gate passed: `src/domain/llmContracts.test.ts` now verifies prompt-level high-risk instructions and parser rejection for deterministic financial advice in comments and deterministic medical/diagnosis advice in replies; full test suite passed with 13 files / 81 tests.
  - Local verification scripts passed with Vitest threads pool: `npm run verify:contracts` (6 files / 48 tests) and `npm run verify:local` (13 files / 81 tests, TypeScript build, production Vite build). The scripts use `--pool=threads --maxWorkers=1` because the default fork pool hit OS `EAGAIN` when process pressure was high after browser E2E runs.
  - Repeatable verification docs added: `docs/engineering/E2E_RUNBOOK.md` for real LLM/CuaDriver/browser matrix testing and `docs/delivery/RELEASE_REVIEW_MAP.md` for release review grouping.
  - Secret handling check passed: real `.env.local` remains ignored by Git, `.env.example` contains only placeholders and is no longer hidden by the repository `.gitignore`, and source search found no frontend `VITE_*` key exposure or committed `Bearer` token.
  - Mobile non-technical wide real LLM gate passed: `/tmp/knowfeed-wide-mobile-after-planner-retry`, 4/4 runs, 4 subject areas, 4 learner personas, `matrixGate.passed: true`, all `Research + LLM 生成内容`, all `researchSource: web`, all `curriculumSource: planner`, community-quality min/avg/max 100.
- [x] `npm run verify:contracts`
- [x] `npm run verify:local`
- [x] `npm test`
- [x] `npx vitest run src/domain/plannerResearchEval.test.ts`
- [x] `npm run typecheck`
- [x] `npm run build`
- [x] `npm run e2e:real-llm`（需要先启动 `npm run dev:api` 和 `npm run dev`）
- [x] `npm run e2e:real-llm:matrix`（至少覆盖 Fintech / 心理学 / 气候政策，3 类学习者，真实 LLM 生成结果必须全部通过）
- [x] `npm run e2e:real-llm:matrix:full`（同一核心矩阵覆盖 mobile / laptop / desktop，至少 9 条真实 LLM 路径全部通过）
- [x] `npm run e2e:real-llm:matrix:wide`（覆盖摄影 / 教育 / 古典音乐 / 日本战国史，4 类非技术主题和 4 类学习者，真实 LLM 生成结果必须全部通过）
- [x] `npm run e2e:real-llm:matrix:wide:full`（同一非技术矩阵覆盖 mobile / laptop / desktop，至少 12 条真实 LLM 路径全部通过）
- [x] `npm run e2e:real-llm:matrix:expanded:full`（同一 expanded 矩阵覆盖 mobile / laptop / desktop，至少 15 条真实 LLM 路径全部通过）
- [x] `npm run e2e:real-llm:external-chrome`（连接由 CuaDriver/真实 Chrome 启动的外部 CDP 端口，验证非 headless 体验；示例：`KNOWFEED_E2E_EXTERNAL_CHROME=1 KNOWFEED_E2E_KEEP_TABS=1 KNOWFEED_E2E_CDP_PORT=9234 KNOWFEED_E2E_SCENARIOS=classical-music-listener KNOWFEED_E2E_VIEWPORTS=mobile npm run e2e:real-llm:external-chrome`）
- [x] `KNOWFEED_E2E_SCENARIOS=climate-policy-planner npm run e2e:real-llm`
- [x] `KNOWFEED_E2E_SCENARIOS=photography-operator npm run e2e:real-llm`
- [x] `KNOWFEED_E2E_SCENARIOS=photography-operator KNOWFEED_E2E_VIEWPORTS=mobile,laptop,desktop npm run e2e:real-llm`
- [x] `KNOWFEED_E2E_SCENARIOS=education-course-designer npm run e2e:real-llm`
- [x] `KNOWFEED_E2E_SCENARIOS=classical-music-listener npm run e2e:real-llm`
- [x] `KNOWFEED_E2E_SCENARIOS=sengoku-history-editor npm run e2e:real-llm`
- [x] `KNOWFEED_E2E_SCENARIOS=psychology-casual KNOWFEED_E2E_VIEWPORTS=mobile,laptop,desktop npm run e2e:real-llm`
- [x] `KNOWFEED_E2E_SCENARIOS=climate-policy-planner KNOWFEED_E2E_VIEWPORTS=mobile,laptop,desktop npm run e2e:real-llm`
- [x] `KNOWFEED_E2E_SCENARIOS=fintech-engineer,psychology-casual,climate-policy-planner KNOWFEED_E2E_VIEWPORTS=mobile,laptop,desktop npm run e2e:real-llm`
- [x] Real LLM E2E output directory contains `summary.json`; failures also produce a scenario failure JSON and screenshot when capturable.
- [x] Real LLM E2E `summary.json` contains top-level `matrix.subjectAreas`, `matrix.learnerPersonas`, viewport coverage, and pass/fail counts.
- [x] Real LLM E2E `summary.json` contains `matrixGate`; when `KNOWFEED_E2E_REQUIRE_BREADTH=1`, it must fail if the run does not meet configured minimum subject/persona/viewport/pass breadth.
- [x] Real LLM E2E `summary.json` contains `communityQuality.score` and signals for stance coverage, reply count/relation kinds, comment sort modes, author diversity, self-reply count, context use, repair filler, off-domain copy, learning-signal variety, and attitude-only visible comments.
- [x] Real LLM E2E `communityQuality.signals.repairReplyCount` is sourced from reply `source` metadata when present, not only from brittle body/id text matching.
- [x] Real LLM E2E `communityQuality.signals.genericCommunityAuthorCount` is `0` for passing runs, while topic/concept anchored personas such as `认知偏差历史背景补充者` are not falsely rejected.
- [x] Browser or Playwright desktop viewport screenshot
- [x] Browser or Playwright mobile viewport screenshot
- [x] Computer Use/CuaDriver desktop path: onboarding -> generated feed -> comments -> lesson -> shadow; if Chrome AX/Apple Events blocks direct DOM operations, use CuaDriver to launch/screenshot a real Chrome window and connect the E2E runner to that window's CDP port.
- [x] End-to-end flow: onboarding -> path -> feed -> lesson -> comments -> shadow

### Current Delivery Gate

These checks are the current delivery bar. The first three are provider-free local gates; archive verification now requires a release-grade durable real-LLM summary and will remain blocked until the fresh StepFun-backed archive is generated with `LLM_RESEARCH_MODE=web`.

- [x] `npm run verify:docs`
- [x] `npm run verify:contracts`
- [x] `npm run verify:local`
- [ ] `npm run verify:evidence-archive` currently fails because no durable expanded-full real-LLM summary has `status: passed`, `evidenceGate.passed: true`, `matrixGate.passed: true`, 15/15 runs, visible source provenance plus research anchor/source chips on feed/post/lesson/shadow, and generated lesson/post/shadow topic + research grounding signals.
- [x] `npm run probe:llm-provider` returns HTTP 200 against StepFun Global `step-3.5-flash-2603` with `LLM_RESPONSE_FORMAT=none`; local `/api/generate` returns real model output; a segmented fixed-research generation diagnostic also passes strict content validation, but this is not final delivery evidence.
- [x] `LLM_RESEARCH_MODE=off` returns a local planning brief quickly for domestic-network preview; this is explicitly not release evidence.
- [ ] `npm run e2e:real-llm:matrix:expanded:full:archive`
- [ ] Fresh visible-browser path for real Research + LLM output, with screenshots/state/localStorage summary under `.omx/evidence/knowfeed/...`.
