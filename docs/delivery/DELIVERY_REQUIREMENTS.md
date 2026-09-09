# KnowFeed Delivery Requirements

Date: 2026-06-20

This document defines what "delivery grade" means for the current KnowFeed workstream. It is the planning bridge between the V2 product documents and the final release gate.

## Delivery Target

KnowFeed should ship first as a delivery-grade agent-style prototype, not as a production SaaS course platform.

The delivery-grade prototype must prove this loop with fresh, reproducible evidence:

`arbitrary topic -> learner profile -> research -> LLM planner -> validator -> generated feed / lesson / comments / shadow draft`

The production-grade product remains a later milestone because account sync, durable server persistence, observability, billing, privacy controls, and production browser/device coverage are outside the current prototype boundary.

## Current Requirement Findings

Evidence from the current repository shows that the product shape is mostly implemented:

- `src/App.tsx` runs onboarding through research, planner, validator, initialized state, and generated bundle creation.
- `src/components/Onboarding.tsx` shows stage-specific first-run generation progress for profile, web research, AI planning, and discussion generation; generation errors keep the user's inputs and expose an immediate retry action.
- `src/components/PathPreview.tsx` shows the generated 7-day path before the first feed visit, with direct entry to Day 1 or the feed.
- `src/components/HomeFeed.tsx` keeps the first feed card as the generated community discussion with visible provenance; today's task and the current-path shortcut sit below it instead of pushing real generated content out of the first screen.
- `src/components/PhoneShell.tsx` no longer exposes a dead search button in the top bar; the shell keeps only working navigation/actions.
- `src/components/SourceProvenance.tsx` uses a compact disclosure for source provenance; web-research paths now show a visible research/source chip before expansion, then explain the source chain in Chinese while preserving exact evidence strings such as `Research brief + LLM`, `Research: web`, and `Path: planner` for release verification.
- `src/components/PostDetail.tsx` lets learners write a local reply or question in the discussion instead of showing a dead composer stub; the expanded reply composer is not sticky, so it does not cover the comment being answered.
- `src/components/PostDetail.tsx` also shows a short micro-lesson completion handoff when the learner returns to the thread.
- `src/components/SettingsPanel.tsx` exposes editable, rejectable, approvable shadow drafts, labels generated shadow content before and after approval, shows the learning basis before the user edits or approves a pending draft, and requires confirmation before resetting local progress.
- `index.html`, `public/site.webmanifest`, and `src/styles.css` now provide a baseline iPhone web-app shell: `viewport-fit=cover`, PWA manifest metadata, SVG app icon, dynamic viewport height, and safe-area padding.
- `docs/delivery/ACCEPTANCE_CHECKLIST.md` records broad LLM, research, community, safety, and E2E coverage.
- `docs/delivery/RELEASE_READINESS.md` already separates prototype readiness from production limitations.

The current blockers are evidence and governance gaps, not missing core architecture:

1. Runtime version must stay inside `package.json` engines: `^20.19.0 || ^22.12.0 || >=24.0.0`. A Node `v22.0.0` tool path can fail in the jsdom/html-encoding dependency chain; the project shell verified successfully on Node `v25.9.0`.
2. Historical real-LLM evidence is documented, but the cited `/tmp/.../summary.json` artifacts are not durable enough to be the only proof for a final handoff.
3. The iPhone/PWA baseline still needs a fresh visible-browser pass before it can be called device-ready.
4. `docs/product/knowfeed-project-intro.html` is a tracked presentation deliverable for project demos and reviews. It is intentionally not a canonical requirements source; changes to product requirements still start in `docs/product/PRD_V2.md`, `docs/product/UX_FLOW.md`, and this file.
5. Current real-LLM release gating is no longer blocked at the provider probe level after switching `.env.local` to StepFun Global `step-3.5-flash-2603` with `LLM_RESPONSE_FORMAT=none`; `npm run probe:llm-provider` returned HTTP 200 with prompt-only JSON content. One-shot full generation was too brittle for the cheaper model, so expression generation now splits into a `lesson` / `post` / `shadowDraft` request followed by a `comments` request, then validates the combined payload with the same strict content gates. A fixed web-shaped research fixture passed this segmented strict path. The live research blocker is now environment-specific: command-line DuckDuckGo/Wikipedia access times out without explicit proxy environment, while `NODE_USE_ENV_PROXY=1` plus the local VPN proxy can return `source: "web"`. `LLM_RESEARCH_MODE=off` keeps local preview usable with a local planning brief, but final delivery remains blocked until live web research with `LLM_RESEARCH_MODE=web`, expanded-full archive evidence, and visible-browser real-LLM evidence pass.
6. The real-LLM waiting and failure UX has local product coverage through stage progress, preserved onboarding input, and retry. It still needs a fresh visible-browser real-LLM pass to prove the same behavior under slow overseas provider latency.

## Acceptance Criteria

### Prototype Delivery Gate

All of the following must pass before the prototype is called delivery complete:

- `npm run verify:docs`
- `npm run verify:contracts`
- `npm run verify:local`
- `npm run verify:evidence-archive`
- `npm run probe:llm-provider`
- `npm run e2e:real-llm:matrix:expanded:full:archive`
- One visible-browser path using Kimi WebBridge, CuaDriver CLI, external Chrome/CDP, or Computer Use/Chrome MCP when transport is stable.

Fallback output is not delivery evidence. It only proves the app remains demoable when provider, research, or generation fails. The delivery gate must prove real LLM-generated lesson, post, comments, replies, and shadow draft content, with expandable visible source provenance attached to the feed, post detail, micro-lesson, and shadow draft surfaces. It must also prove lesson/post/shadow phases contain concrete learner actions, learner `avoidedStyles` are respected, and unsupported precise claims are rejected rather than passed as facts.

`npm run verify:evidence-archive` is intentionally strict: it must fail until at least one durable expanded-full real-LLM summary reports `status: passed`, `evidenceGate.passed: true`, `matrixGate.passed: true`, at least 15 passed runs, clean checkout metadata, zero initial real-LLM fallback retries, real `researchSource: web` + `curriculumSource: planner`, visible `Research brief + LLM` / `Research: web` / `Path: planner` provenance, generated-content quality signals for lesson, post, and shadow, per-phase research grounding against the active `researchBrief`, per-phase concrete learner-action signals, per-phase avoided-style compliance, per-phase unsupported-precision compliance, and screenshots for the full onboarding -> feed -> comments -> lesson -> shadow -> reload -> map path.

Release archive scripts must set `KNOWFEED_E2E_RETRY_LLM_FALLBACKS=0`; a first-attempt LLM fallback is a delivery failure, not a transient success condition.

The E2E run must produce durable evidence that survives shell cleanup:

- `summary.json`
- failure JSON when a scenario fails
- desktop and mobile screenshots for every passing scenario, including onboarding, feed, comments, lesson, return-to-comments, settings, approved/rejected shadow states, reload, map, and map lesson
- the exact command, environment variables, Node version, and timestamp used for the run

### Product Requirements

- Non-Web3 topics generate complete learning paths.
- Learner background changes curriculum, examples, comments, and shadow framing.
- Learner `avoidedStyles` changes planner/generator behavior and is enforced as a negative preference in strict LLM quality gates.
- Precise years, percentages, report names, institutions, and company examples in generated user-facing text are accepted only when supported by current topic/profile/research anchors; otherwise the generation engine retries.
- Research and planner output are real paths when credentials/network are available.
- `LLM_RESEARCH_MODE=off` is allowed for local preview only; release evidence must use `LLM_RESEARCH_MODE=web` and real `researchSource: web`.
- Real Research + LLM lesson, post, and shadow content each reuse concrete research brief anchors and give a concrete learner action, instead of only repeating the topic name or generic learning advice.
- Fallback remains demoable and clearly labeled.
- Validator/engine code owns stable IDs, path order, quiz shape, progress, mastery, and persisted state.
- Feed, comments, lesson, map, daily mission, and shadow draft all derive from the active validated curriculum.
- First-time users see the generated 7-day path before entering the feed.
- Feed first screen prioritizes the generated community discussion over path/task scaffolding.
- First-time users see stage-specific generation progress while research, planning, and discussion content are being prepared.
- First-run generation errors preserve the user's onboarding input and provide a clear retry action.
- Learners can write a local reply in the post thread, including a targeted reply to a specific generated comment, so the social loop is not read-only.
- Micro-lesson completion gives an explicit feedback beat before the learner continues reading comments.
- Shadow content is clearly labeled as AI generated before approval.
- Resetting local progress requires a confirmation step.
- Path preview, map, feed, post detail, micro-lesson, and shadow draft surfaces expose visible source provenance for real generated content, including concrete research anchor/source chips and user-readable source labels when `researchSource: web`.
- The mobile web shell handles iPhone safe areas and has a baseline installable PWA manifest.
- Long-running real LLM generation shows stage-specific progress and a recoverable timeout/error state for research, planner, and expression generation.

### Engineering Requirements

- Runtime support is documented and enforced through `package.json` engines.
- Local verification does not rely on stale `/tmp` evidence.
- API keys remain server-side only through `.env.local` or deployment environment variables.
- Any new delivery claim is backed by either a passing command or a durable artifact path.

## Requirement Backlog

1. Keep runtime pinned to the supported engine range and use the project shell, not a stale embedded Node path, for release verification.
2. Promote final E2E evidence into `.omx/evidence/knowfeed/...` with the archive E2E scripts or document an equivalent durable artifact location.
3. Refresh the visible mobile browser path with real Research + LLM output if final delivery needs real-model UX parity; the current Kimi WebBridge path validates fallback UX and the iPhone/PWA shell.
4. Keep the live research source retrieval path explicit: use `LLM_RESEARCH_MODE=web` plus `NODE_USE_ENV_PROXY=1` / `HTTPS_PROXY` / `HTTP_PROXY` when the machine depends on a local VPN proxy, then rerun the full prototype delivery gate with the StepFun provider and record the fresh result in `docs/delivery/RELEASE_READINESS.md`.
5. Capture product-facing retry/error states for slow real-LLM generation in the next real-LLM visible-browser pass before using the app in a live demo with overseas providers.
