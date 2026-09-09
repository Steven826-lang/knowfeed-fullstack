# KnowFeed Project Logic

This document describes the current prototype implementation. It is not the highest product authority. Future product work must follow the v2 product track and preserve the agent-style boundary: arbitrary topic -> learner profile -> research -> planner -> validator -> generated feed/lesson/shadow.

## Source Of Truth

This local document must stay aligned with the upstream product documents in the parent repository:

1. `../docs/superpowers/specs/2026-06-09-knowfeed-alignment-guardrails.md`
2. `../docs/superpowers/specs/2026-06-09-ai-knowledge-feed-learning-app-design.md`
3. `../docs/superpowers/plans/2026-06-09-ai-knowledge-feed-prototype.md`

And with the local v2 product track:

1. `docs/product/PRD_V2.md`
2. `docs/engineering/SYSTEM_CONTRACT.md`
3. `docs/product/UX_FLOW.md`
4. `docs/engineering/LLM_CONTRACTS.md`
5. `docs/delivery/IMPLEMENTATION_PLAN_V2.md`
6. `docs/delivery/ACCEPTANCE_CHECKLIST.md`

Authority order:

1. Alignment guardrails
2. PRD v2
3. System contract
4. UX flow and LLM contracts
5. Implementation plan v2
6. Acceptance checklist
7. Long product design spec
8. Historical implementation plan
9. This local project logic document
10. Current code

If any Web3 example appears to narrow the product into a fixed Web3 learning app, treat that as a demo detail. The product direction remains arbitrary learning goals, learner background, LLM-generated curriculum planning, and social-feed learning.

The old implementation plan is no longer the next execution path. It remains useful as history for the existing prototype, but future implementation should start from `docs/delivery/IMPLEMENTATION_PLAN_V2.md`.

## Product Intent

KnowFeed is a learning app for people who want to understand an unfamiliar domain without reading a traditional course upfront. The product should take a long-term learning goal, break it into small daily tasks, and present those tasks through a feed that feels closer to browsing discussions than studying a syllabus.

The core promise is:

- The learner always sees one clear next task.
- The task is short enough to finish in a few minutes.
- The surrounding feed gives context, disagreement, and motivation.
- Progress changes what the feed shows next.
- The AI can help the learner express what they understood, but the learner approves anything that represents them.

## Current Prototype

The current app proves the learning loop with dynamic onboarding and a deterministic fallback safety net:

- Topic input: user-provided topic, learner background, learning goal, daily time, and tone
- Planning path: `TopicProfile` + `LearnerProfile` -> `ResearchBrief` -> planner draft -> curriculum validator
- Stable state: validator-owned concept IDs, lesson IDs, path order, quiz choices, progress, mastery, and persisted state
- Surface: a phone-shaped React app with feed, post detail, micro lesson, map, and shadow profile screens
- Persistence: browser `localStorage`
- Generation: local LLM proxy when configured; deterministic fallback otherwise
- Fallback sample: Web3 remains available only as the default/sample curriculum when no generated curriculum exists

The current prototype should be treated as a product sketch, not a finished general learning platform.

## Main Objects

`AppState` is the persisted learner state:

- `progress.activeTopic`: current validated topic key
- `progress.streak`: simple completion counter
- `progress.xp`: accumulated experience
- `progress.completedLessonIds`: completed stable lesson IDs
- `progress.conceptMastery`: mastery by concept ID
- `progress.lastCompletedConceptId`: last completed concept
- `progress.reviewQueue`: concepts to revisit
- `shadowDrafts`: AI drafts waiting for learner approval
- `approvedShadowPosts`: learner-approved drafts

`Concept` defines the curriculum graph:

- `id`, `title`, `plainName`
- `order`
- `unlockHint`
- `prerequisiteIds`
- `mastery`

`StableLesson` defines the trusted learning boundary:

- `id`
- `conceptId`
- `estimatedMinutes`
- `promptGoal`
- fixed multiple-choice answers and feedback

`GeneratedKnowledgeBundle` is the presentation bundle for one concept:

- `source`: `research-llm`, `llm`, or `fallback`
- `conceptId`
- generated lesson copy
- feed post
- comments
- shadow draft

## Core Data Flow

1. `App` loads state from `localStorage` through `loadAppState`.
2. Onboarding builds `TopicProfile` and `LearnerProfile`.
3. `fetchResearchBrief` collects a research brief when possible; the proxy dedupes sources, ranks them by topic relevance, filters low-signal results, and falls back when the network path is unavailable.
4. `generateCurriculumDraft` asks the planner LLM for a curriculum draft, or uses a deterministic draft fallback.
5. `validateCurriculumDraft` converts the draft into stable concepts, lessons, choices, IDs, and path order.
6. `initializeStateForCurriculum` creates the persisted app state.
7. `getDailyMission` selects the first concept whose mastery is below 70.
8. `activeConceptId` drives content generation.
9. `generateKnowledgeBundle` asks the LLM proxy for presentation content, retries invalid output, then falls back deterministically.
10. Generated bundles are cached separately from `AppState` by curriculum/concept, so reloads can rehydrate the last Research + LLM presentation without granting generated content ownership over progress or stable IDs.
11. `HomeFeed` shows the daily mission and the current generated feed post.
12. `MicroLesson` presents the stable quiz plus generated explanatory copy.
13. `completeLesson` updates mastery, XP, streak, completed lesson IDs, and review queue.
14. Completing a lesson adds the current bundle's shadow draft into `shadowDrafts`.
15. `ShadowProfile` lets the learner approve a draft; approval moves it into `approvedShadowPosts`.

## Screen Logic

`feed`

- Shows the daily mission.
- Shows a primary feed post for the current concept.
- Links to the post detail, map, or daily lesson.

`post`

- Shows the generated post and comments.
- Lets the learner filter comments.
- Can start the lesson for the current bundle's concept.

`lesson`

- Shows generated lesson copy from the current bundle.
- Uses stable multiple-choice data from the curriculum.
- Requires a free-response recall sentence.
- Submits a `LessonResult`.

`map`

- Shows all concepts.
- Unlocks a concept only when all prerequisites have mastery >= 60.
- Starts a concept task when the concept is unlocked.

`shadow`

- Shows pending AI learning-shadow drafts.
- Allows manual approval.
- Shows approved count and reset control.

## LLM Boundary

The LLM is not the curriculum authority in this prototype.

Allowed LLM output:

- lesson title, hook, explanation, analogy, recall prompt, completion feedback
- feed post body and metadata
- comments and lightweight comment replies
- shadow draft copy

Not allowed from the LLM:

- creating new concept IDs
- changing lesson IDs
- changing the learning path
- changing allowed choice IDs
- publishing on behalf of the learner

`parseGeneratedPayload` enforces the response shape. It normalizes common real-model variants, rejects unsafe comments/replies, requires useful community stance diversity, normalizes lightweight replies onto existing comments, and derives a conservative shadow draft when the model returns metadata-only shadow output. Invalid output retries once, then falls back to deterministic content.

## Local API

`server/llm-proxy.mjs` exposes:

- `POST /api/generate`

It reads `.env.local` or `.env`, then forwards requests to a chat-completions-compatible API.

Important configuration detail:

- `LLM_PROXY_PORT` defaults to `8787`.
- `LLM_PROXY_RESEARCH_TIMEOUT_MS` defaults to `12000`.
- `LLM_PROXY_GENERATE_TIMEOUT_MS` defaults to `55000`.
- `LLM_PROXY_FETCH_TIMEOUT_MS` can provide a shared fallback timeout when the route-specific timeout vars are unset.
- `vite.config.ts` currently proxies `/api` to `http://127.0.0.1:8787`.
- If the proxy port changes, Vite config must change too; it does not currently read `LLM_PROXY_PORT`.

## Product Invariants

- There is always a fallback path when LLM generation fails.
- Stable curriculum data owns progression and correctness.
- Generated content is presentation, not source of truth.
- The learner approves shadow drafts before they become approved posts.
- Progress must be explainable through mastery, XP, streak, completed lessons, and review queue.
- The app should remain demoable without external API credentials.

## Known Gaps And Mismatches

1. Planner quality is prototype-grade.

   The pipeline accepts arbitrary topics, but fallback planning still uses lightweight templates for generic topics. `plannerResearchEval` now gives the prototype a structural gate for research fit, source-quality metadata, topic fit, learner fit, state-boundary leaks, and sample leakage. Production quality still needs real planner samples, stronger retrieval, citation-grade factual review, and semantic quality rubrics.

2. Comment ranking is prototype-grade.

   `rankComments` now filters by exact `stance` with tabs for `全部`, `赞成`, `反对`, `补充`, and `挑刺`. The comment UI supports lightweight nested replies, optional quotes, and deterministic sort modes for `热度`, `新回复`, and `相关`. The adapter owns reply IDs, parent attachment, reply source metadata, and self-reply author repair. Production-quality community loops still need timestamp-aware hot/new scoring and learner-specific relevance beyond the current generated-bundle context terms.

3. Real-model community output can be uneven.

   The prompt now requires exact first-four stance order, 2-4 lightweight replies, cross-persona reply authors, and rejects placeholder community names. The local adapter repairs missing or low-diversity stance sets, normalizes replies, replaces placeholder authors, reassigns self-reply authors, and marks reply `source` so E2E can report local repair usage. The generation engine rejects any repaired-reply output and retries with explicit feedback before accepting or falling back. Better prompt/eval work should reduce how often repair is needed.

4. LLM provider settings are minimal.

   `.env.example` includes provider fields, but the proxy currently only uses `LLM_BASE_URL`, `LLM_API_KEY`, `LLM_MODEL`, `LLM_PROXY_PORT`, and the timeout vars documented above.

## Near-Term Alignment Questions

These are the decisions that need owner confirmation before expanding the prototype:

1. Should KnowFeed first support one user-provided topic at a time, or multiple parallel learning goals?
2. Should the first real planner generate the whole concept graph upfront, or generate the next few concepts progressively?
3. Should the feed imitate debate-heavy social posts, or mix debate, explainers, examples, and exercises?
4. Should the shadow profile only draft private reflections, or eventually publish/share approved posts?
5. Is mastery threshold `70` for "daily mission complete enough" and `60` for "unlock prerequisite" acceptable for the prototype?

## Verification Commands

Run these after logic or documentation changes that claim the project still matches current behavior:

```sh
npm test
npm run typecheck
npm run build
npm run e2e:real-llm
```

The real LLM E2E command writes a structured `summary.json` into its output directory on both success and failure. Treat that file, plus scenario screenshots and any `*-failure.json` diagnostics, as the audit trail for real-user-path regressions. The summary includes a top-level `matrix` for subject-area / learner-persona coverage and `communityQuality` so community-agent quality can be reviewed from visible role text, reply count/relation kinds, comment sort modes, generated-bundle role fields, score/signals, low-learning-value top-level comments, and repair/self-reply counts, not only from screenshots or hard failures.
