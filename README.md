# KnowFeed Prototype

KnowFeed is a prototype for turning an arbitrary learning goal into a short daily knowledge feed. The current implementation proves the agent-style loop:

1. Collect topic, learner background, goal, and daily time.
2. Build `TopicProfile` and `LearnerProfile`.
3. Fetch a `ResearchBrief`, then ask the planner LLM for a curriculum draft.
4. Let the curriculum validator own stable concept IDs, lesson IDs, path order, quizzes, progress, and persisted state.
5. Generate dynamic feed, micro-lesson, comments, and AI "learning shadow" drafts around the active concept.
6. Track mastery, XP, streak, review queue, and unlock order.

Start here:

- [docs/README.md](docs/README.md) for the full documentation index, grouped by product, engineering, delivery, and business.
- [docs/product/INTRODUCTION.md](docs/product/INTRODUCTION.md) for the product introduction, architecture boundary, and directory map.
- [docs/engineering/GETTING_STARTED.md](docs/engineering/GETTING_STARTED.md) for clone/install/API-key setup, local startup, and verification.
- [docs/engineering/PROJECT_LOGIC.md](docs/engineering/PROJECT_LOGIC.md) for the deeper implementation walkthrough.
- [docs/product/CORE_DESIGN_REFACTOR.md](docs/product/CORE_DESIGN_REFACTOR.md) for the distilled idea, core design, and refactor boundary.

The detailed product and implementation logic is documented in [docs/engineering/PROJECT_LOGIC.md](docs/engineering/PROJECT_LOGIC.md).

The current product track is locked by:

1. [docs/product/PRD_V3.md](docs/product/PRD_V3.md) (current requirements; amendment on top of V2)
2. [docs/product/PRD_V2.md](docs/product/PRD_V2.md)
3. [docs/engineering/SYSTEM_CONTRACT.md](docs/engineering/SYSTEM_CONTRACT.md)
4. [docs/product/UX_FLOW.md](docs/product/UX_FLOW.md)
5. [docs/engineering/LLM_CONTRACTS.md](docs/engineering/LLM_CONTRACTS.md)
6. [docs/delivery/DELIVERY_REQUIREMENTS.md](docs/delivery/DELIVERY_REQUIREMENTS.md)
7. [docs/delivery/IMPLEMENTATION_PLAN_V2.md](docs/delivery/IMPLEMENTATION_PLAN_V2.md)
8. [docs/delivery/ACCEPTANCE_CHECKLIST.md](docs/delivery/ACCEPTANCE_CHECKLIST.md)
9. [docs/engineering/E2E_RUNBOOK.md](docs/engineering/E2E_RUNBOOK.md)
10. [docs/delivery/RELEASE_REVIEW_MAP.md](docs/delivery/RELEASE_REVIEW_MAP.md)
11. [docs/delivery/RELEASE_READINESS.md](docs/delivery/RELEASE_READINESS.md)
12. [docs/delivery/DOCUMENTATION_GOVERNANCE.md](docs/delivery/DOCUMENTATION_GOVERNANCE.md)

The standalone presentation artifact is [docs/product/knowfeed-project-intro.html](docs/product/knowfeed-project-intro.html). Treat it as a shareable project brief for demos or reviews, not as a canonical requirements source.

Upstream alignment sources live one directory above this prototype:

1. `../docs/superpowers/specs/2026-06-09-knowfeed-alignment-guardrails.md`
2. `../docs/superpowers/specs/2026-06-09-ai-knowledge-feed-learning-app-design.md`
3. `../docs/superpowers/plans/2026-06-09-ai-knowledge-feed-prototype.md`

The guardrails file is authoritative when examples conflict. Web3 is only a demo seed, not the product boundary. The latest local alignment review is in [docs/delivery/ALIGNMENT_AUDIT.md](docs/delivery/ALIGNMENT_AUDIT.md).

Use [docs/engineering/E2E_RUNBOOK.md](docs/engineering/E2E_RUNBOOK.md) for the repeatable real LLM, CuaDriver/visible Chrome, and matrix verification path. Use [docs/delivery/RELEASE_REVIEW_MAP.md](docs/delivery/RELEASE_REVIEW_MAP.md) to split the current broad worktree into reviewable change groups, then use [docs/delivery/RELEASE_READINESS.md](docs/delivery/RELEASE_READINESS.md) as the final product-readiness gate.

## Current Scope

This is an agent-style prototype, not a production-grade course generator. The app accepts non-Web3 topics through onboarding and runs topic -> learner profile -> research -> planner -> validator -> generated feed/lesson/shadow. Web3 remains only the sample fallback curriculum when there is no saved/generated curriculum.

The LLM is allowed to draft curriculum and presentation content, but validator/engine code owns permanent IDs, path order, choices, progress, mastery, and persisted state. Local adapters can keep loose/demo rendering resilient, but delivery validation rejects local author/reply/shadow scaffolding; real handoff evidence must show the LLM itself generated the lesson, post, community replies, and shadow draft for the current learner.

The next implementation phase must follow [docs/delivery/IMPLEMENTATION_PLAN_V2.md](docs/delivery/IMPLEMENTATION_PLAN_V2.md), not the older Web3-heavy plan.

## Using Your Own API Key

The browser never receives the API key. A local Node proxy reads the key from `.env.local`, calls an OpenAI-compatible chat completions endpoint, and the Vite dev server forwards browser requests from `/api` to that proxy.

1. Copy the example environment file:

   ```sh
   cp .env.example .env.local
   ```

2. Edit `.env.local` with your provider settings:

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

   The checked-in example targets StepFun Global because that is the currently verified provider for this repo. `LLM_BASE_URL` can still point to any OpenAI-compatible `/v1` endpoint, but update `LLM_PROVIDER`, `LLM_MODEL`, and `LLM_RESPONSE_FORMAT` together when switching providers. Keep provider settings as server-side `LLM_*` variables. Do not rename them to `VITE_*`, because `VITE_*` variables are exposed to the frontend bundle.
   `LLM_RESPONSE_FORMAT=none` is required for the current StepFun example because the model returns prompt-shaped JSON instead of OpenAI-style JSON response formatting. Providers that support OpenAI `response_format` can use `LLM_RESPONSE_FORMAT=json_object`, then must rerun the provider probe and real-LLM gates.
   `LLM_RESEARCH_MODE` defaults to `web`. Set `LLM_RESEARCH_MODE=off` for local development on networks where DuckDuckGo/Wikipedia are blocked; this skips live search and returns a local planning brief quickly. It is useful for app iteration, but it is not release-grade research evidence.
   `VITE_LLM_CLIENT_TIMEOUT_MS` is not a secret; it only keeps the browser from aborting slow local-proxy generation before the provider responds.

3. Start both processes:

   ```sh
   npm run dev:api
   npm run dev
   ```

   `npm run dev:api` starts `server/llm-proxy.mjs` on port `8787`. `npm run dev` starts Vite and proxies `/api` to `http://127.0.0.1:8787`.

   On macOS, command-line Node processes may not automatically inherit the system VPN/proxy. If live research should go through a local proxy such as `127.0.0.1:7892`, start the proxy process explicitly with environment proxy support:

   ```sh
   HTTPS_PROXY=http://127.0.0.1:7892 HTTP_PROXY=http://127.0.0.1:7892 NODE_USE_ENV_PROXY=1 npm run dev:api
   ```

If `LLM_API_KEY` is missing or the provider fails, the app falls back to deterministic local content so the prototype remains demoable. That fallback is not delivery evidence; the release gate requires real LLM-generated lesson, feed, community replies, and shadow content.

## Development

```sh
npm run dev:api
npm run dev
```

Without `LLM_API_KEY`, the app intentionally falls back to deterministic local content for demo continuity only.

Useful checks:

```sh
npm run verify:docs
npm run verify:contracts
npm run verify:local
npm test
npm run typecheck
npm run build
```

`npm run verify:docs` is the documentation anti-rot guard. It checks required docs, relative Markdown links, documented npm scripts, and runtime engine declaration before release claims drift away from the repository.

`npm run verify:contracts` is the fast guard for the agent-style boundaries: proxy timeout/fallback behavior, client retry behavior, LLM payload parsing, community-agent quality, safety rejection, planner contracts, and research-source evaluation. `npm run verify:local` is the local release-smoke gate: full unit suite, typecheck, and production build.

`npm test` includes `plannerResearchEval` fixtures that guard arbitrary-topic planning against off-topic research, missing source-quality metadata, Web3 sample leakage, and LLM-owned state fields.

With `npm run dev:api` and `npm run dev` already running, the real LLM browser path can be checked with:

```sh
npm run e2e:real-llm
```

The E2E path verifies onboarding, generated feed, visible source provenance with research anchor/source chips, four stance-specific comment tabs, lightweight community replies, comment sort modes, non-placeholder community authors, visible and generated-bundle community roles, low repair-filler reliance, lesson completion, shadow draft creation, reload persistence, daily mission entry, map-to-lesson integrity, and viewport layout overflow.

Each run writes screenshots plus `summary.json` under the printed output directory. The summary is written on both pass and fail; it includes a top-level `matrix` for covered subject areas, learner personas, viewports, pass/fail counts, and community-quality score ranges. Passing scenarios include `communityQuality.score`, reply count/relation signals, comment sort mode signals, `communityQuality.signals`, and any issue list for auditing community-agent behavior. A failing scenario also writes `<scenario>-<viewport>-failure.json` and a failure screenshot when Chrome can still capture the page.

For a focused arbitrary-topic check outside the original AI/Fintech/psychology samples:

```sh
KNOWFEED_E2E_SCENARIOS=climate-policy-planner npm run e2e:real-llm
```

Additional non-technical subject checks are available for learner-background adaptation:

```sh
KNOWFEED_E2E_SCENARIOS=photography-operator npm run e2e:real-llm
KNOWFEED_E2E_SCENARIOS=education-course-designer npm run e2e:real-llm
KNOWFEED_E2E_SCENARIOS=classical-music-listener npm run e2e:real-llm
KNOWFEED_E2E_SCENARIOS=sengoku-history-editor npm run e2e:real-llm
KNOWFEED_E2E_SCENARIOS=architecture-city-renewal npm run e2e:real-llm
```

The architecture scenario is also available as a named smoke because it mirrors the latest CuaDriver visible-desktop path:

```sh
npm run e2e:real-llm:architecture
```

The final broad release gate covers five non-technical subjects, five learner backgrounds, and mobile/laptop/desktop:

```sh
npm run e2e:real-llm:matrix:expanded:full
```

For final handoff, prefer the archive variant so screenshots and `summary.json` land under `.omx/evidence/knowfeed/...` instead of volatile `/tmp`:

```sh
npm run e2e:real-llm:matrix:expanded:full:archive
```

For a focused cross-viewport check, select one scenario and all supported viewports:

```sh
KNOWFEED_E2E_SCENARIOS=psychology-casual KNOWFEED_E2E_VIEWPORTS=mobile,laptop,desktop npm run e2e:real-llm
```

The photography scenario is also useful for cross-viewport validation because it asserts that generated content uses the learner's ecommerce/product-image context:

```sh
KNOWFEED_E2E_SCENARIOS=photography-operator KNOWFEED_E2E_VIEWPORTS=mobile,laptop,desktop npm run e2e:real-llm
```
