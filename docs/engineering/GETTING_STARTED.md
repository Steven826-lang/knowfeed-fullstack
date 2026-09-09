# KnowFeed 使用教程

这份教程面向拿到 private 仓库后的使用者，目标是把项目从 clone 跑到可用 demo，并说明如何配置自己的 API key。

## 1. 环境要求

建议使用：

- Node.js 20 或更新版本
- npm
- 一个 OpenAI-compatible API key

项目没有强制要求必须配置 API key。没有 key 时，应用会自动使用本地 fallback 内容，仍然可以打开和演示基础流程。fallback 只适合本地 demo 和 UI/状态流检查，不能作为交付级证明。

## 2. 安装依赖

```sh
npm install
```

## 3. 配置自己的 API key

复制环境变量模板：

```sh
cp .env.example .env.local
```

编辑 `.env.local`：

```sh
LLM_PROVIDER=stepfun
LLM_BASE_URL=https://api.stepfun.ai/v1
LLM_API_KEY=your-real-api-key
LLM_MODEL=step-3.5-flash-2603
LLM_RESPONSE_FORMAT=none
LLM_RESEARCH_MODE=web
LLM_PROXY_PORT=8787
LLM_PROVIDER_PROBE_TIMEOUT_MS=60000
LLM_PROXY_RESEARCH_TIMEOUT_MS=12000
LLM_PROXY_GENERATE_TIMEOUT_MS=180000
VITE_LLM_CLIENT_TIMEOUT_MS=180000
```

当前示例使用 StepFun Global，因为本地已验证的 provider 是 `step-3.5-flash-2603`。如果你使用的是兼容 OpenAI Chat Completions 的其他网关，把 `LLM_PROVIDER`、`LLM_BASE_URL`、`LLM_MODEL` 和 `LLM_RESPONSE_FORMAT` 一起改成该网关要求的值。
当前 StepFun 示例使用 `LLM_RESPONSE_FORMAT=none`，表示不发送 OpenAI-style `response_format` / structured output，而是让模型按 prompt 返回 JSON，再交给本地 schema、内容质量和证据归档门禁拦截坏输出。支持 OpenAI `response_format` 的 provider 可以改成 `LLM_RESPONSE_FORMAT=json_object`。更换 provider 或 response format 后必须重新跑 `npm run probe:llm-provider` 和真实 LLM E2E。

`LLM_RESEARCH_MODE` 默认是 `web`，会让本地 Node proxy 访问 DuckDuckGo/Wikipedia 生成 web research brief。国内网络或命令行进程没有正确走 VPN 时，可以临时设置：

```sh
LLM_RESEARCH_MODE=off
```

这样 `/api/research` 会立即返回本地 planning brief，适合本地预览和 UI 调试，不会卡在搜索超时。但它不是交付证明；最终 release evidence 必须改回 `LLM_RESEARCH_MODE=web`。

不要把密钥写成 `VITE_*` 变量。Vite 会把 `VITE_*` 暴露给浏览器 bundle，而这个项目的设计是让 API key 只存在于本地 Node proxy 或服务器环境变量中。
`VITE_LLM_CLIENT_TIMEOUT_MS` 不是密钥，只控制浏览器等待本地 proxy 的时间；海外 provider 较慢时应与 `LLM_PROXY_GENERATE_TIMEOUT_MS` 一起调高。

## 4. 启动应用

需要同时启动两个进程。

终端 1：启动本地 LLM proxy。

```sh
npm run dev:api
```

如果你开了 macOS VPN/代理但命令行仍然访问 DuckDuckGo/Wikipedia 超时，说明 Node 进程没有自动继承系统代理。可用显式代理环境启动：

```sh
HTTPS_PROXY=http://127.0.0.1:7892 HTTP_PROXY=http://127.0.0.1:7892 NODE_USE_ENV_PROXY=1 npm run dev:api
```

端口 `7892` 是当前本机代理示例；换用其他 VPN/代理时按实际端口调整。

终端 2：启动 Vite 前端。

```sh
npm run dev
```

然后打开 Vite 输出的本地地址，通常是：

```text
http://127.0.0.1:5173
```

前端请求 `/api/generate`，Vite 会把请求代理到：

```text
http://127.0.0.1:8787
```

真实 API key 只会被 `server/llm-proxy.mjs` 读取，不会进入浏览器。

## 5. 体验主流程

打开应用后可以按这个路径检查：

1. 在 onboarding 输入一个学习主题，比如“产品摄影”“城市更新建筑史”或“心理学入门”。
2. 填写自己的背景、目标和每天可投入时间。
3. 生成学习路径后进入首页信息流。
4. 查看当前 feed、评论区和社区回复。
5. 进入微课，完成课程和测验。
6. 查看知识地图中的进度变化。
7. 打开 AI 学习影子草稿，确认它只是草稿，不会自动替你发布。
8. 刷新页面，确认进度可以恢复。

如果 LLM 调用失败，页面应该仍然使用 fallback 内容继续运行；这只证明降级体验可用，不证明真实 LLM 生成质量。

如果 `LLM_RESEARCH_MODE=off`，页面仍会调用真实 LLM 生成表达内容，但 research source 会显示为 fallback/local planning brief。这个模式用于快速看效果，不用于最终验收。

## 6. 常用命令

```sh
npm run dev:api        # 启动本地 LLM proxy
npm run dev            # 启动 Vite 前端
npm test               # 运行单元测试
npm run typecheck      # TypeScript 检查
npm run build          # 生产构建
npm run verify:local   # 测试、类型检查和构建
```

如果你想快速验证 LLM contract 和 proxy 行为：

```sh
npm run verify:contracts
```

## 7. 真实 LLM E2E 验证

先确保 `npm run dev:api` 和 `npm run dev` 都在运行，再执行：

```sh
npm run e2e:real-llm
```

脚本会检查 onboarding、生成 feed、评论区、微课、shadow draft、刷新恢复和移动端布局等路径。运行结果会输出截图和 `summary.json` 所在目录。

常用场景：

```sh
KNOWFEED_E2E_SCENARIOS=photography-operator npm run e2e:real-llm
KNOWFEED_E2E_SCENARIOS=architecture-city-renewal npm run e2e:real-llm
KNOWFEED_E2E_SCENARIOS=psychology-casual KNOWFEED_E2E_VIEWPORTS=mobile,laptop,desktop npm run e2e:real-llm
```

## 8. 常见问题

### 没有 API key 能不能跑？

可以。没有 `LLM_API_KEY` 时，应用会使用确定性 fallback 内容。这样适合检查 UI、状态流和基础学习体验，但不满足 delivery gate；交付证明必须使用真实 API key 跑通 real Research + planner + LLM E2E。

### 为什么要启动两个进程？

前端由 Vite 提供，本地 API proxy 由 Node 提供。这个拆分是为了让浏览器永远拿不到 API key。

### 改了 `LLM_PROXY_PORT` 后为什么请求失败？

`vite.config.ts` 当前固定把 `/api` 代理到 `http://127.0.0.1:8787`。如果你改了 `LLM_PROXY_PORT`，也要同步修改 Vite proxy 目标。

### `.env.local` 要不要提交？

不要。`.env.local` 应该只留在本机或部署环境中。仓库只提交 `.env.example`。

### 生产部署怎么做？

当前仓库是本地 prototype。生产部署时需要把 `server/llm-proxy.mjs` 或等价后端部署成真正的 server-side API，并把 `LLM_API_KEY` 配在服务器环境变量里。不要把密钥放进前端构建环境。
