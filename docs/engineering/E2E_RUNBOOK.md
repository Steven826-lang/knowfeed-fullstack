# KnowFeed E2E Runbook

日期：2026-06-20

这份 runbook 用来验证 KnowFeed 是否仍然保持目标产品形态：

`任意主题 -> 学习者画像 -> research -> LLM planner -> validator -> 动态 feed / lesson / shadow`

## 1. 本地快速验证

先跑不依赖真实浏览器和真实 LLM 的本地质量闸门：

```sh
npm run verify:contracts
npm run verify:local
```

`verify:contracts` 覆盖代理超时、客户端重试、LLM payload adapter、社区 agent 质量、安全拒绝、planner contract 和 research-source eval。

`verify:local` 覆盖全量单测、TypeScript build 和生产构建。

这两个脚本显式使用 Vitest `--pool=threads --maxWorkers=1 --no-file-parallelism`。不要轻易改回默认 fork pool 或并行文件调度；在长时间真实 LLM / Chrome / CuaDriver 验证后，本机进程数可能接近上限，fork worker 或反复 worker 调度容易出现 `EAGAIN` / worker startup timeout。

## 2. 启动真实 LLM 环境

`.env.example` 是可提交模板；真实 key 只放在 `.env.local` 或服务器环境变量里。

```sh
npm run dev:api
npm run dev
```

默认地址：

- App: `http://127.0.0.1:5173`
- API: `http://127.0.0.1:8787`

本地预览和 release 运行要区分 research mode：

- `LLM_RESEARCH_MODE=off`：跳过 DuckDuckGo/Wikipedia，`/api/research` 立即返回本地 planning brief。适合国内网络下看 UI 和真实 LLM 生成效果，不是 release evidence。
- `LLM_RESEARCH_MODE=web`：真实 web research 模式。所有 release-grade E2E 和 archive evidence 都必须使用这个模式。

macOS 系统代理/VPN 不一定会自动进入命令行 Node 进程。如果 DuckDuckGo/Wikipedia 在终端里超时，但浏览器/VPN 已经打开，用显式代理环境启动 API proxy：

```sh
HTTPS_PROXY=http://127.0.0.1:7892 HTTP_PROXY=http://127.0.0.1:7892 NODE_USE_ENV_PROXY=1 npm run dev:api
```

当前机器上这条路径可以让 `/api/research` 返回 `source: "web"`；不加显式环境时，命令行搜索仍可能超时。

## 3. 真实 LLM smoke

跑单条 mobile smoke：

```sh
npm run e2e:real-llm
```

指定一个非 Web3 主题：

```sh
KNOWFEED_E2E_SCENARIOS=climate-policy-planner npm run e2e:real-llm
npm run e2e:real-llm:architecture
```

输出目录会打印到终端，并包含：

- `summary.json`
- flow screenshots
- 失败时的 `<scenario>-<viewport>-failure.json`

交付前推荐使用 archive 版本，把证据固定写入 `.omx/evidence/knowfeed/...`：

```sh
npm run e2e:real-llm:architecture:archive
```

如果真实 LLM 路径连续落到 `离线演示内容`，先不要盲目重跑矩阵。用最小生成探针确认 provider 是否健康：

```sh
npm run probe:llm-provider
```

失败输出会包含 `diagnosis` 和 `nextActions`。例如 `billing-or-quota` 表示要先恢复 provider 余额/额度，再跑真实 LLM archive 或 Kimi 可见浏览器证明。

需要同时验证本地 proxy/CORS 时，再用代理探针：

```sh
curl -sS -o /tmp/kf-generate-probe.json -w 'http=%{http_code} time=%{time_total}\n' \
  -H 'content-type: application/json' \
  -H 'origin: http://127.0.0.1:5175' \
  --data '{"temperature":0,"messages":[{"role":"system","content":"Return JSON only."},{"role":"user","content":"Return {\"ok\":true,\"label\":\"probe\"}."}]}' \
  http://127.0.0.1:8787/api/generate
```

HTTP `402`, `429`, or repeated `5xx` means release gate is provider/credential/ quota blocked, not proven product-ready. Fix `.env.local` provider settings or balance before rerunning `matrix:expanded:full:archive`.

## 4. 跨主题和跨背景矩阵

核心矩阵：

```sh
npm run e2e:real-llm:matrix
npm run e2e:real-llm:matrix:full
```

非技术/非商业宽矩阵：

```sh
npm run e2e:real-llm:matrix:wide
npm run e2e:real-llm:matrix:wide:full
npm run e2e:real-llm:matrix:expanded
npm run e2e:real-llm:matrix:expanded:full
npm run e2e:real-llm:matrix:expanded:full:archive
npm run verify:evidence-archive
```

这些矩阵必须验证：

- 所有 run 使用 `Research brief + LLM 生成内容`
- `researchSource: web`
- `LLM_RESEARCH_MODE=off` 没有参与 release archive；local planning brief 只能用于本地预览
- `curriculumSource: planner`
- feed / post / lesson / shadow 页面采集到可见 `sourceProvenance`，包含 `Research brief + LLM`、`Research: web`、`Path: planner`
- feed / post / lesson / shadow 页面采集到可见 research anchor/source chips，能把用户看到的内容连回 active `researchBrief`
- 非 Web3 场景没有 Web3/Gas/链上 fallback 泄漏
- 至少覆盖 4 类 stance：`赞成` / `反对` / `补充` / `挑刺`
- 正好 3 条 model-generated replies，且 reply relation 覆盖 `追问` / `补充` / `反驳`
- `repairReplyCount: 0`
- `communityQuality.signals.generatedContentQuality` 显示 lesson / post / shadow 三个 phase 都有 topic/learner anchor、web research anchor 和 learning signal
- `communityQuality.signals.generatedContentQuality.phases[*].avoidsRejectedStyles` 全部为 `true`，证明 onboarding 的 `avoidedStyles` 没有被真实 LLM 输出踩中
- `communityQuality.signals.generatedContentQuality.phases[*].hasNoUnsupportedPreciseClaims` 全部为 `true`，证明真实 LLM 没有把缺少当前 research/profile 支撑的精确年份、百分比、报告、机构或公司案例写成事实
- `genericCommunityAuthorCount: 0`
- `selfReplyCount: 0`
- map lesson 与 active concept 一致
- mobile bottom nav 不遮挡长内容

`matrix:expanded` 在 `wide` 的摄影、教育、古典音乐、日本战国史基础上增加 `architecture-city-renewal`，用于覆盖建筑史主题和城市更新从业者背景。`matrix:expanded:full` 是 release gate 版本，同一 5 主题 / 5 学习者矩阵覆盖 mobile、laptop、desktop，至少 15 条真实 LLM 路径必须全部通过。

The non-archive E2E harness can retry a scenario once for transient CDP `Runtime.evaluate` timeouts or an initial real-LLM bundle fallback while debugging. A retry does not lower the release bar: the final `summary.json` must still report `status: passed`, `matrixGate.passed: true`, and 15 passed runs.

For release-grade archive evidence, an initial real-LLM fallback retry is not acceptable even when the second attempt passes. Archive scripts set `KNOWFEED_E2E_RETRY_LLM_FALLBACKS=0`, so fallback is a hard delivery failure. CDP timeout retries can remain a transport warning only when the final archive has a clean checkout, complete screenshots, and no failed scenario.

## 5. 可见 Chrome / CuaDriver 路径

当 Computer Use 或 Chrome MCP transport 不稳定时，用 CuaDriver CLI 作为可见桌面交互面。不要反复重试已经关闭的 MCP transport。

推荐路径：

1. 用 CuaDriver 启动一个真实 Chrome 窗口，打开 `http://127.0.0.1:5173`。
2. 完成 onboarding，使用任意新主题，例如：
   - 领域：`建筑史入门`
   - 背景：`我是城市更新从业者，想看懂不同建筑风格、材料和历史语境。`
   - 目标：`能判断建筑作品背后的时代、功能和审美争论`
3. 验证 feed 显示 `Research brief + LLM 生成内容`。
4. 打开帖子和评论。
5. 验证至少 8 个 topic-fit 社区 author、4 类 stance、3 类 reply relation、社区 agent role 和 Reddit-style 讨论层次。
6. 从帖子开始 lesson，完成 quiz 和 one-sentence recall。
7. 回到评论区。
8. 打开 Shadow，编辑/拒绝/批准草稿。
9. 打开 Map，从当前节点进入 lesson，确认 lesson title 与节点一致。
10. 保存截图、AX state、localStorage summary。

历史 CuaDriver 证据只说明这条路径曾经可用；最终交付不能引用 volatile `/tmp` 目录。交付前必须把可见浏览器证据固定到 `.omx/evidence/knowfeed/<timestamp>-visible-browser/`，并包含截图、state/localStorage 摘要和所用浏览器表面。

对应的自动 E2E 场景 slug 是 `architecture-city-renewal`，可用 `npm run e2e:real-llm:architecture` 复跑 mobile smoke。

## 6. 完成判定

一次可发布前验证至少需要：

```sh
npm run verify:docs
npm run verify:contracts
npm run verify:local
npm run probe:llm-provider
npm run e2e:real-llm:matrix:expanded:full:archive
npm run verify:evidence-archive
```

再补一条可见桌面路径：

- CuaDriver CLI 手动路径，或
- `npm run e2e:real-llm:external-chrome` 连接 CuaDriver/真实 Chrome 暴露的 CDP 端口

不能只看单元测试通过就判断完成。完成必须同时证明真实 LLM、跨主题/背景、社区体验、lesson、map、shadow 和移动端布局都保持可用。
