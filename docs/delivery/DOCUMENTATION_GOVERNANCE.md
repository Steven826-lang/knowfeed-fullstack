# Documentation Governance

Date: 2026-06-20

KnowFeed documentation should describe the current product state, not become a second implementation that slowly diverges from code.

## Source Of Truth

| Area | Canonical File | Rule |
| --- | --- | --- |
| Product intent | `docs/product/PRD_V2.md` | Update when the product promise or target user changes. |
| Delivery criteria | `docs/delivery/DELIVERY_REQUIREMENTS.md` | Update when the definition of delivery-grade changes. |
| System invariants | `docs/engineering/SYSTEM_CONTRACT.md` | Update with code changes that alter ownership of IDs, progress, research, LLM output, or persistence. |
| LLM schema and safety | `docs/engineering/LLM_CONTRACTS.md` | Update with prompt, parser, adapter, or safety-contract changes. |
| UX flow | `docs/product/UX_FLOW.md` | Update with navigation, screen, or interaction changes. |
| Verification evidence | `docs/delivery/RELEASE_READINESS.md` | Update only with fresh command output or durable artifact paths. |
| Local setup | `docs/engineering/GETTING_STARTED.md` | Update with runtime, API key, or startup changes. |
| Presentation artifact | `docs/product/knowfeed-project-intro.html` | Keep as a shareable project brief only; do not treat it as the source of requirements. |

## Anti-Rot Rules

1. Every documented npm script command must exist in `package.json`.
2. Every relative Markdown link must point to an existing file.
3. `docs/delivery/RELEASE_READINESS.md` must not cite volatile `/tmp/knowfeed-*` paths; final handoff evidence belongs under `.omx/evidence/knowfeed/...` or another durable artifact location.
4. A dated release claim must name the exact command or artifact that proves it.
5. Acceptance checklist items should only be checked after the relevant code path and verification evidence exist.
6. When implementation changes the product loop, update the canonical docs in the same branch.
7. iPhone, PWA, or visible-browser readiness claims must name both the implemented app-shell artifact and the browser/device path used to verify it.
8. When no release-grade expanded-full summary exists under `.omx/evidence/knowfeed`, `docs/delivery/RELEASE_READINESS.md` must explicitly say the project is not complete, older evidence is historical, and `verify:evidence-archive` still fails.
9. Real-LLM release evidence must require visible research anchor/source chips, not just generic source labels.
10. Real-LLM release evidence must require generated-content unsupported-precision compliance, not just prompt text that asks the model to avoid unsupported specifics.
11. Provider or local-runtime changes must update `.env.example`, `README.md`, `docs/engineering/GETTING_STARTED.md`, `docs/engineering/E2E_RUNBOOK.md`, and `docs/delivery/RELEASE_READINESS.md` in the same branch. This includes `LLM_MODEL`, `LLM_RESPONSE_FORMAT`, `LLM_RESEARCH_MODE`, proxy timeouts, and command-line proxy requirements.
12. `LLM_RESEARCH_MODE=off` must be documented as local-preview-only. Release readiness and delivery requirements must continue to require `LLM_RESEARCH_MODE=web` plus real `researchSource: web` evidence.

## Required Checks

Run this before handoff and after any documentation-heavy change:

```sh
npm run verify:docs
npm run verify:evidence-archive
```

For delivery handoff, run the full gate from `docs/delivery/DELIVERY_REQUIREMENTS.md`.

## Evidence Archiving

Real LLM and visible-browser runs may write raw output under `/tmp` during development. Before final handoff, rerun with an archive script or copy the summary and selected screenshots into a durable evidence directory before citing them in `docs/delivery/RELEASE_READINESS.md`.

Do not claim a final delivery pass from a vanished `/tmp` path. `npm run verify:docs` rejects volatile release-readiness references, and `npm run verify:evidence-archive` checks that durable evidence paths parse and exist.

Use the archive E2E scripts when possible:

```sh
npm run e2e:real-llm:architecture:archive
npm run e2e:real-llm:matrix:expanded:full:archive
```
