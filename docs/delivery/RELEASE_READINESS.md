# KnowFeed Release Readiness

日期：2026-06-20

当前状态：local product gates are green, and the live LLM provider is configured for StepFun Global `step-3.5-flash-2603` with `LLM_RESPONSE_FORMAT=none`. The provider probe returns HTTP 200, local `/api/generate` returns real model output, and segmented expression generation has passed strict content validation with a fixed web-shaped research fixture. For local preview on domestic networks, `.env.local` may set `LLM_RESEARCH_MODE=off` so `/api/research` returns a local planning brief immediately instead of waiting for blocked DuckDuckGo/Wikipedia requests. That mode is demo-only. Do not mark the project complete until live web research with `LLM_RESEARCH_MODE=web`, the expanded-full archive gate, and one visible-browser real-LLM path pass with durable artifacts.

Freshness note, 2026-06-20: older passing evidence remains historical context, not a current delivery pass. Current delivery completion must follow [DELIVERY_REQUIREMENTS.md](DELIVERY_REQUIREMENTS.md), including provider-free local verification, `npm run probe:llm-provider`, durable real-LLM E2E artifacts, and one visible-browser path.

<!-- knowfeed-current-status:start -->
```json
{
  "status": "blocked",
  "localGates": "passed",
  "liveProvider": "passed: StepFun Global step-3.5-flash-2603 provider probe returned 200 with LLM_RESPONSE_FORMAT=none; local /api/generate returned real model output; segmented generation fixture passed strict content validation",
  "researchMode": "local preview currently uses LLM_RESEARCH_MODE=off; release evidence must use LLM_RESEARCH_MODE=web",
  "liveResearch": "partially unblocked: direct DuckDuckGo/Wikipedia command-line requests still time out without explicit proxy environment; /api/research returned source=web when the Node proxy was started with HTTPS_PROXY/HTTP_PROXY=127.0.0.1:7892 and NODE_USE_ENV_PROXY=1",
  "evidenceArchive": "blocked: no release-grade expanded-full real-LLM summary with concrete learner-action, avoided-style, and unsupported-precision compliance",
  "visibleBrowser": "blocked for final proof until live web research and fresh real-LLM visible-browser evidence are captured"
}
```
<!-- knowfeed-current-status:end -->

Current local refresh, 2026-06-20:

- `node -v && npm -v`: Node `v25.9.0`, npm `11.12.1`.
- `npm run verify:docs`: passed for 17 Markdown files with release-readiness checks rejecting volatile evidence paths in this document, checking current local provider/research-mode documentation, and requiring visible research anchor/source chips, concrete learner-action compliance, avoided-style compliance, and unsupported-precision compliance in release evidence.
- `npm run verify:contracts`: passed with 14 test files / 102 tests after adding `LLM_RESEARCH_MODE=off` coverage for the local planning-brief research fallback.
- `npm run verify:local`: passed with 16 test files / 128 tests, TypeScript build, and production Vite build. The local test environment pins `jsdom` to `26.1.0` so Vitest does not trip the Node 25 CJS/ESM incompatibility in `html-encoding-sniffer@6` / `@exodus/bytes`.
- `npm test -- src/App.test.tsx src/components/Onboarding.test.tsx --pool=threads --maxWorkers=1 --no-file-parallelism`: passed with 2 test files / 26 tests after adding stage-specific first-run generation progress, retry with preserved onboarding input, first-run 7-day path preview, map provenance, targeted local replies, micro-lesson completion handoff, explicit AI-generated labels for pending/approved shadow content, compact expandable source provenance, visible research/source chips for cached real-LLM content, generated discussion first-screen ordering, and reset confirmation.
- Local preview smoke with `.env.local` `LLM_RESEARCH_MODE=off`: `/api/research` returned HTTP 200 with `source: "fallback"` and one local planning source in about 0.003s; `/api/generate` returned real StepFun output from `step-3.5-flash-2603`. This proves local app iteration no longer blocks on domestic search access, but it is not release evidence.
- Kimi WebBridge visible-browser fallback UX path passed for `建筑史入门`: path preview, feed, local reply, micro-lesson completion handoff, and Settings AI-generated label. Evidence artifacts are under `.omx/evidence/knowfeed/2026-06-17-kimi-mobile`; this is fallback UX evidence, not final real-LLM delivery proof.
- Kimi WebBridge visible-browser UX progress check captured first-run generation progress for the photography onboarding scenario under `.omx/evidence/knowfeed/20260618T-ux-progress-kimi/`. It proves the stage UI renders in a real browser, but it is intentionally marked `status: partial` and is not final real-LLM delivery proof.
- Not refreshed yet: `npm run e2e:real-llm:matrix:expanded:full` and a real Research + LLM visible-browser path.

Current real-LLM gate refresh, 2026-06-20:

- `npm run verify:docs`: passed for 17 Markdown files after enforcing that this document cannot cite volatile temp evidence paths and must stay current with local LLM provider/research-mode configuration.
- `npm run verify:contracts`: passed with 14 test files / 102 tests after adding provider rejection summary coverage, learner avoided-style strict checks, concrete learner-action checks, unsupported-precision checks, real-LLM generation-contract checks, prompt-only JSON extraction, segmented expression generation, split author metadata coverage, and configurable research-off behavior.
- `npm run verify:local`: passed with 16 test files / 128 tests, TypeScript build, and production Vite build after the compact provenance disclosure, learner avoided-style gate, concrete learner-action gate, unsupported-precision gate, web+planner content-fallback guard, release-archive fallback-retry hardening, generated discussion first-screen ordering, first-run generation UX polish, segmented expression-generation flow, and local research-mode fallback.
- `npm run verify:evidence-archive`: now intentionally fails until a durable expanded-full real-LLM summary is release-grade (`status: passed`, `evidenceGate.passed: true`, `matrixGate.passed: true`, 15/15 runs, clean checkout metadata, zero initial real-LLM fallback retries, real web research + planner source, visible source provenance plus research anchor/source chips on feed/post/lesson/shadow, generated lesson/post/shadow topic + research grounding signals, concrete learner-action signals, avoided-style compliance, unsupported-precision compliance, and complete flow screenshots). Current archive has structured historical evidence but no final release-grade expanded-full pass.
- Release archive scripts set `KNOWFEED_E2E_RETRY_LLM_FALLBACKS=0`, so a first-attempt real-LLM fallback is a hard delivery failure instead of a retryable path.
- `npm run probe:llm-provider`: passed against StepFun Global `step-3.5-flash-2603` with HTTP 200, `responseFormat: none`, and prompt-only JSON content. `.env.local` sets `LLM_PROVIDER_PROBE_TIMEOUT_MS=60000` because the provider can take more than the old 20s default.
- Segmented generation diagnostic: the first request generated `lesson` / `post` / `shadowDraft`, the second generated `comments`, and the combined fixed-research fixture passed strict validation with exactly 8 comments, exactly 3 replies, 8 distinct authors, and relation coverage across `追问` / `补充` / `反驳`. The run took about 80s total. This is provider/content-contract evidence, not release evidence, because live web research was stubbed for isolation.
- Live `/api/research` has two distinct local modes. Without explicit proxy environment, direct DuckDuckGo/Wikipedia command-line probes still time out from this shell. With the macOS VPN exposing a local proxy at `127.0.0.1:7892`, starting Node with `HTTPS_PROXY=http://127.0.0.1:7892 HTTP_PROXY=http://127.0.0.1:7892 NODE_USE_ENV_PROXY=1 npm run dev:api` let `/api/research` return HTTP 200, `source: "web"`, and 6 sources for the architecture scenario in about 6.4s. For everyday local preview, `.env.local` can use `LLM_RESEARCH_MODE=off`; that returns `source: "fallback"` immediately and is not release evidence.
- Timeout check: `.env.local` now sets `LLM_PROXY_GENERATE_TIMEOUT_MS=180000` and `VITE_LLM_CLIENT_TIMEOUT_MS=180000` so the browser does not abort slow StepFun overseas generation before the local proxy finishes.
- `~/.kimi-webbridge/bin/kimi-webbridge status`: Kimi WebBridge is running with `extension_connected: true`; browser transport is available, but final proof still needs a fresh real-LLM visible-browser run.
- Durable architecture mobile smoke passed with real Research + LLM output: `.omx/evidence/knowfeed/20260617T150959Z-architecture/summary.json`, `status: passed`, `evidenceGate.passed: true`, `communityQuality.averageScore: 100`.
- Expanded full archive attempt `.omx/evidence/knowfeed/20260617T163511Z-expanded-full/summary.json` reached 13/15 passing runs across 5 subject areas, 5 learner personas, and 3 viewports before failing on a Chrome/CDP `Runtime.evaluate` timeout for `architecture-city-renewal-laptop`.
- Expanded full archive attempt `.omx/evidence/knowfeed/20260618T063220Z-expanded-full/summary.json` passed the photography 3-viewport set, then failed because `education-course-designer-mobile` fell back to `离线演示内容`.
- Expanded full archive attempt `.omx/evidence/knowfeed/20260618T063914Z-expanded-full/summary.json` confirmed the fallback condition persisted even after a scenario retry; under the stricter archive verifier this is historical failure evidence, not a pass.
- StepFun Global provider probe on 2026-06-20 returned HTTP 200 after selecting `step-3.5-flash-2603` with prompt-only JSON mode. The current blockers for the full real-LLM release gate are a fresh archive run with `LLM_RESEARCH_MODE=web` plus explicit proxy environment when needed, missing release-grade expanded-full archive evidence, and missing visible-browser real-LLM evidence.

这份审计页只回答一个问题：KnowFeed 是否已经接近“可以真实使用”的阶段，而不是只证明某个 demo 或单测通过。

## Product Target

KnowFeed 必须保持 agent-style prototype：

`任意主题 -> 学习者画像 -> research -> LLM planner -> validator -> 动态 feed / lesson / shadow`

不能退化成 Web3 示例、固定 curriculum、固定评论模板或硬编码状态机。LLM 可以起草 curriculum、lesson、community 和 shadow 内容；稳定 ID、路径顺序、quiz shape、progress、mastery、review queue 和 persisted state 必须由 validator/engine/app state 拥有。

## Current Evidence

| Requirement | Current Evidence | Status |
| --- | --- | --- |
| 任意主题 onboarding | Historical real-LLM scenarios cover architecture, education, history, music, visual arts, photography, climate policy, psychology, fintech, and AI product contexts. Fresh expanded-full proof still needs to be rerun with StepFun. | Historical strong / fresh archive pending |
| 学习者画像适配 | Historical expanded matrix covers city-renewal practitioner, course designer, casual listener, content editor, ecommerce operator. Fresh 5-persona, 3-viewport proof still needs to be rerun with StepFun. | Historical strong / fresh archive pending |
| Web research | Durable architecture smoke reports real Research + LLM output; full expanded matrix still needs a fresh pass. | Partial current |
| LLM planner | Durable architecture smoke reports generated planner content; full expanded matrix still needs a fresh pass. | Partial current |
| Validator owns state | Contracts and tests cover planner draft parsing, stable IDs, path order, and rejection of LLM-owned state fields. | Current strong |
| Dynamic feed / lesson / map / shadow | App tests and fallback browser artifacts cover feed, generated discussion first-screen ordering, targeted comment replies, comments, lesson completion, return to comments, map provenance, shadow draft approval/rejection, daily mission, and map-to-lesson navigation. Real-LLM visible-browser parity remains unrefreshed. | Current local / browser parity pending |
| First-run generation UX | App and component tests cover stage-specific progress, disabled in-flight CTA, preserved onboarding input, retry from the error state, and reset confirmation. Real provider slow-path screenshots remain unrefreshed. | Current local / browser parity pending |
| Community experience | Community contracts require LLM-designed community agents, anchored visible authors, Reddit-style discussion dynamics, stance diversity, exactly 3 model replies with relation coverage, no generic filler authors, and low repair reliance. Fresh real-LLM expanded proof is still blocked. | Current contracts / real-LLM blocked |
| Learner negative preferences | Onboarding captures `avoidedStyles`; planner/generator prompts treat it as a hard negative preference; strict generation quality and real-LLM E2E summary signals reject generated lesson/post/shadow text that echoes avoided-style markers. Fresh expanded proof is still blocked. | Current contracts / real-LLM blocked |
| Unsupported precise facts | Strict generation quality rejects real LLM lesson/post/comment/reply/shadow text that introduces precise years, percentages, reports, institutions, or company examples unless those markers appear in the current topic/profile/research anchors. Fresh expanded proof is still blocked. | Current contracts / real-LLM blocked |
| Safety | LLM parsing rejects deterministic high-risk medical/legal/financial advice and keeps high-risk topics in learning-framework mode. | Current strong |
| Mobile / desktop usability | iPhone/PWA shell is implemented and fallback mobile path was checked; fresh real-LLM mobile/laptop/desktop evidence is still blocked. | Current implementation / final evidence pending |
| Repeatable local gates | `verify:contracts` now runs the server proxy contract plus all `src/domain/*.test.ts` domain contracts, including arbitrary-topic pipeline, fallback leakage, planner retry/research fit, community quality, feed sorting, and stable learning state. `verify:local` keeps the full local suite plus typecheck/build on the same stable sequential Vitest thread-pool configuration. | Current strong |

Durable evidence paths from the current cycle:

- `.omx/evidence/knowfeed/20260617T150959Z-architecture/summary.json`
- `.omx/evidence/knowfeed/20260617T163511Z-expanded-full/summary.json`
- `.omx/evidence/knowfeed/20260618T063220Z-expanded-full/summary.json`
- `.omx/evidence/knowfeed/20260618T063914Z-expanded-full/summary.json`
- `.omx/evidence/knowfeed/2026-06-17-kimi-mobile`
- `.omx/evidence/knowfeed/20260618T-ux-progress-kimi`

Older volatile evidence paths are intentionally kept only in [ACCEPTANCE_CHECKLIST.md](ACCEPTANCE_CHECKLIST.md) as historical regression context.

## Anti-Hardcoded-State-Machine Gate

Before release, reviewers should specifically check these invariants:

1. Non-Web3 topics do not inherit Web3/Gas/链上 fallback terms.
2. `sampleCurriculum` remains fallback-only when there is no generated or saved curriculum.
3. Planner output is treated as a draft; validator owns IDs, order, quiz normalization, and safe defaults.
4. App state advances by concept/lesson IDs, not by static array positions that only match the demo curriculum.
5. Lesson completion derives the completed concept from the stable lesson, not from an external result payload.
6. Feed, lesson, comments, daily mission, map, and shadow all derive from the active generated curriculum.
7. Source labels distinguish `Research brief + LLM`, `LLM`, and `Fallback` without masking repair/fallback content as fact-reviewed generation.
8. Tests and E2E scenarios include non-technical topics and learner backgrounds, not only AI, fintech, or Web3-like domains.
9. Research brief + LLM community roles are dynamically designed by the LLM; local code validates count, distinctness, anchoring, exactly 3 model replies, stance/reply coverage, learning value, and safety, but does not prescribe a fixed role list.
10. Real Research + LLM lesson, post, and shadow text must each carry topic/learner anchors, learning signals, concrete learner actions, and concrete research-brief anchors. Topic name repetition alone is not enough for delivery evidence.
11. Visible source provenance must show concrete research anchor/source chips for web research, so the learner and release archive can connect generated content back to the active `researchBrief`.
12. Learner `avoidedStyles` must flow from onboarding into planner/generator prompts and release evidence; generated lesson/post/shadow phases must report `avoidsRejectedStyles: true`.
13. Generated lesson/post/shadow phases must report `hasConcreteLearnerAction: true` and `hasNoUnsupportedPreciseClaims: true`; precise years, percentages, reports, institutions, or company examples need current topic/profile/research support or must be framed as verification questions/trends.

`npm run verify:contracts` is the local regression gate for these invariants; do not narrow it back to only LLM parsing tests.

## Remaining Prototype Gaps

These remain before the current project can be called delivery-grade:

1. Fresh expanded-full real-LLM archive evidence has not yet been regenerated after switching to StepFun and adding the `LLM_RESEARCH_MODE` local-preview switch.
2. Computer Use / Chrome MCP transport has been flaky. Kimi WebBridge, CuaDriver CLI, and external Chrome/CDP are acceptable prototype parity evidence, but final reports must say which browser surface was used.
3. Persistence is still prototype-grade local storage; this is acceptable for the prototype, but it is not production account sync.
4. The LLM is intentionally free to design community roles. Validators and E2E checks should keep enforcing count, distinctness, anchoring, stance/reply coverage, safety, and source labeling without reintroducing fixed role lists or overly broad domain blacklists.
5. The iPhone web-app shell now has `viewport-fit=cover`, PWA manifest metadata, an SVG app icon, `100dvh`, and safe-area padding. Kimi WebBridge validated the mobile shell in fallback mode; real Research + LLM visual parity remains unrefreshed.
6. `LLM_RESEARCH_MODE=off` is intentionally allowed only for local preview on blocked domestic networks. Delivery evidence must use `LLM_RESEARCH_MODE=web` and must not count local planning briefs as real web research.

## Required Final Gate

Do not mark the project complete until this current-state evidence exists:

```sh
npm run verify:docs
npm run verify:contracts
npm run verify:local
npm run verify:evidence-archive
npm run probe:llm-provider
npm run e2e:real-llm:matrix:expanded:full:archive
```

If the machine relies on a local VPN/proxy for DuckDuckGo/Wikipedia, start the API proxy for release runs with:

```sh
HTTPS_PROXY=http://127.0.0.1:7892 HTTP_PROXY=http://127.0.0.1:7892 NODE_USE_ENV_PROXY=1 npm run dev:api
```

and keep `LLM_RESEARCH_MODE=web`.

Plus one visible-browser path:

- Kimi WebBridge with screenshots/state/localStorage summary, or
- CuaDriver CLI with screenshots/state/localStorage summary, or
- Computer Use / Chrome MCP path if transport is stable.

The final evidence must show:

- all selected runs pass;
- checkout metadata is clean and identifies the exact git SHA/build;
- no initial real-LLM fallback retry event is needed to get a passing run;
- archive scripts run with `KNOWFEED_E2E_RETRY_LLM_FALLBACKS=0`;
- `Research brief + LLM` appears only when research and planner content are actually present;
- feed first screen puts the generated community discussion before task/path scaffolding;
- visible source provenance includes research anchor/source chips for web research on feed, post, lesson, and shadow surfaces;
- `repairReplyCount: 0` or any repair reliance is explicitly treated as a release risk;
- community stance and reply relation coverage is complete;
- generated lesson, post, and shadow draft all carry topic/learner anchoring, learning signals, concrete learner actions, and concrete research-brief grounding, not generic reusable copy;
- generated lesson, post, and shadow draft all report unsupported-precision compliance; unsupported exact years, percentages, report names, institutions, or company examples must not pass as facts;
- screenshots exist for each passing run from onboarding through map lesson;
- map-to-lesson navigation matches the active generated concept;
- mobile bottom navigation does not cover long content;
- shadow drafts require user approval before becoming history.
- shadow drafts are explicitly labeled as AI generated before approval and after approval.
- first-run onboarding shows the generated 7-day path before the learner enters the feed.
- post detail lets the learner write a local reply or question instead of ending at a placeholder composer.
- micro-lesson completion shows a short feedback card before the learner continues the comment thread.
