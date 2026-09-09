# KnowFeed LLM And Research Contracts

日期：2026-06-10

## 1. 原则

LLM 是产品核心，但不是永久状态的最终权威。

LLM 可以生成：

- 课程路径草案。
- 每日微课表达。
- 选择题草案和反馈。
- Feed 主帖。
- 评论、反驳、争议。
- 学习分身草稿。

LLM 不可以直接决定：

- 永久 conceptId。
- 永久 lessonId。
- pathOrder。
- 用户是否已掌握。
- 是否公开代表用户发言。

## 2. ResearchBrief

联网资料检索输出：

```ts
interface ResearchBrief {
  topic: string;
  querySet: string[];
  sources: Array<{
    title: string;
    url: string;
    publisher?: string;
    publishedAt?: string;
    retrievedAt: string;
    summary: string;
    reliabilityNote: string;
    qualityScore?: number;
    qualitySignals?: string[];
    factReviewStatus?: "planning-only" | "needs-review";
  }>;
  keyIdeas: string[];
  disputedIdeas: string[];
  beginnerPitfalls: string[];
}
```

第一版 research 仍是轻量公开网页检索，但 proxy 必须对来源做 canonical URL 去重、主题相关性排序、低信号过滤，并写入 `reliabilityNote`、`qualityScore`、`qualitySignals` 和 `factReviewStatus`。这些字段只说明规划参考价值，不能把摘要包装成事实审稿。

Expected source quality signals include:

- `topic-match`
- `goal-match`
- `learner-background-match`
- `summary-depth`
- `reference-or-institutional`
- `planning-only`
- `fallback`

`plannerResearchEval` must fail web research fixtures that omit explicit quality metadata, lack topic-match signals, or do not mark public web summaries as planning-only.

`LearnerProfile.avoidedStyles` is not cosmetic UI copy. Planner and generation prompts must treat it as a hard negative preference: path concepts, micro-lessons, OP posts, comments, replies, and shadow drafts must avoid the styles the learner explicitly rejected instead of renaming the same tone.

## 3. TopicProfile

```ts
interface TopicProfile {
  topicId: string;
  title: string;
  userRawGoal: string;
  targetDepth: "casual" | "conversational" | "practical" | "strategic";
  language: "zh-CN";
  dayCount: 7;
}
```

## 4. LearnerProfile

```ts
interface LearnerProfile {
  background: string;
  knownAreas: string[];
  avoidedStyles: string[];
  dailyMinutes: 3 | 5 | 10 | 15;
  motivation: string;
  preferredTone: "default" | "light" | "professional" | "debate-heavy";
}
```

## 5. GeneratedCurriculumDraft

Planner LLM 输出草案：

```ts
interface GeneratedCurriculumDraft {
  title: string;
  promise: string;
  days: Array<{
    day: number;
    title: string;
    whyNow: string;
    concepts: Array<{
      temporaryName: string;
      plainLanguageGoal: string;
      prerequisiteNames: string[];
      misconceptionToFix: string;
      feedHook: string;
      sourceUrls: string[];
    }>;
  }>;
}
```

## 6. ValidatedCurriculum

Validator 输出稳定结构：

```ts
interface ValidatedCurriculum {
  curriculumId: string;
  topic: TopicProfile;
  learner: LearnerProfile;
  concepts: Array<{
    conceptId: string;
    title: string;
    plainName: string;
    order: number;
    prerequisiteIds: string[];
    sourceUrls: string[];
  }>;
  lessons: Array<{
    lessonId: string;
    conceptId: string;
    day: number;
    estimatedMinutes: number;
    objective: string;
    requiredRecallType: "choice" | "one_sentence" | "choice_plus_sentence";
  }>;
}
```

只有这个结构可以进入 Progress/Learning Engine。

## 7. DailyGeneratedBundle

Lesson + Feed 生成输出：

```ts
interface DailyGeneratedBundle {
  lesson: {
    title: string;
    hook: string;
    explanation: string;
    analogy: string;
    quiz: Array<{
      choiceId: string;
      label: string;
      correct: boolean;
      feedback: string;
    }>;
    recallPrompt: string;
    completionFeedback: string;
  };
  feed: {
    post: GeneratedPost;
    comments: GeneratedComment[];
    nextHooks: string[];
  };
  shadowDraft: {
    body: string;
    confidence: number;
    basis: string[];
  };
}
```

`choiceId` 可以来自 validator 或由 local adapter 固化，不能让 UI 依赖临时自然语言字符串。

## 8. Safety Rules

评论可以：

- 质疑观点。
- 挑刺逻辑。
- 批评产品叙事。
- 批评行业现象。

评论不能：

- 攻击真实个人。
- 攻击身份群体。
- 鼓励伤害。
- 给医疗、法律、金融等高风险确定性建议。

Adapter safety gate must reject obvious deterministic high-risk actions in generated comments or replies, including diagnosis, medication changes, buy/sell/loan instructions, guaranteed returns, litigation instructions, and similar medical/legal/financial directives. High-risk topics may still discuss concepts, evidence, risk boundaries, verification actions, and professional-help reminders.
- 冒充真实用户。

## 9. Local Adapter And Validation

LLM output is a draft, not trusted app state. The local contract adapter must:

- Accept common real-model JSON variants such as nested `feed.post` / `feed.comments`.
- Normalize comment stance labels into `赞成` / `反对` / `补充` / `挑刺`.
- Accept lightweight replies either as nested `comment.replies` or top-level `commentReplies`, then normalize reply IDs and parent attachment onto existing comments.
- Stamp normalized replies with expression-layer `source: "llm" | "repair"` so quality gates can distinguish model-generated community interaction from local repair filler.
- Generation may split the expression layer into two LLM calls: first `lesson` / `post` / `shadowDraft`, then `comments`. The combined payload must pass the same strict adapter and quality gates as a one-shot response; splitting is an execution strategy, not a weaker delivery contract.
- Require strict `Research brief + LLM` community threads to contain exactly 8 top-level comments in the prompt path, with at least 8 distinct topic/concept/learner anchored authors in the adapter quality gate. The model chooses the people; validators only enforce count, anchoring, stance coverage, safety, and state boundaries.
- Prompt community shape should resemble real Reddit-style discussion dynamics: OP-like framing, context/source additions, premise challenges, boundary questions, adjacent experience, counterexamples, and evidence/moderation caveats. These are interaction patterns, not fixed role names.
- Require real-model community replies to be exactly 3 in strict generation quality mode, all generated by the model, with relation coverage across `追问` / `补充` / `反驳`; otherwise the generation engine retries rather than accepting a flatter or over-generated community loop.
- Require top-level community comments to carry explicit learning signals, not only stance labels. At least three of the visible comments should show evidence/source cues, boundary or misconception cues, examples, learner actions, counterpoints, or questions before the generation engine accepts the bundle as `Research brief + LLM`.
- Keep evidence cues honest: community agents must not invent precise numbers, percentages, dates, company examples, report names, or institutions unless the current `researchBrief.sources` / `keyIdeas` explicitly support them. Unsupported specifics should be framed as trends, example types, or questions to verify.
- Treat `planning-only` research as planning context, not fact review. If comments use data, history, or reports, the copy should expose the source boundary or a learner check action instead of presenting unsupported precision as settled fact.
- In strict generation quality mode, reject generated lesson, post, comment, reply, or shadow text that introduces precise years, percentages, report names, institutions, or company examples unless those markers are present in the current topic/profile/research anchors. The generation engine should retry so a passing bundle proves unsupported precision did not slip through.
- Do not let adapter-added learner/topic context mask weak model output in strict generation quality. Strict validation checks model comment text after removing local context-repair sentences, then retries if the model mostly produced stance-only comments.
- Require reply authors to be different from the parent comment author. If the model self-replies, the adapter may swap the reply author to a topic-fit cross-perspective persona while preserving the reply text as expression data.
- Keep community comments as distinct agent personas with different author names, handles, roles, and internal stance. See `docs/product/COMMUNITY_EXPERIENCE_GUIDE.md` for the current voice and identity rules.
- Keep community personas domain-fit; do not reuse business/product/operator personas for unrelated arts, history, psychology, or casual-interest topics.
- Require generated lesson, post, and shadow draft text to be anchored to the current topic, concept, or learner profile, with at least one learning signal and one concrete learner action such as checking a source, comparing samples/methods, separating concepts/boundaries, or judging whether a claim applies to the current scenario. When `researchBrief.source === "web"`, each of those three phases must also naturally reuse a concrete research anchor from `keyIdeas`, `disputedIdeas`, `beginnerPitfalls`, or source summaries. A structurally valid community thread is not enough if the micro-lesson, OP post, or learner shadow still reads like reusable generic copy, only repeats the topic name, or only says "look at evidence" without a usable judgment step.
- Strict generation quality rejects user-facing LLM text that echoes `LearnerProfile.avoidedStyles` markers, so a passing bundle proves the model avoided the learner's explicit negative preferences instead of only receiving them in the prompt.
- Reject generic or formulaic community identities in strict generation quality mode. `建设派用户`、`风险派用户`、`资料补充员`、`逻辑挑刺员`、`乐观实践者`、`反方观察者`、`科普者` are not acceptable visible identities, and anchored role-template display names such as `Web3实践派`、`钱包边界派`、`认知失调挑刺员`、`资料党`、`观察员`、`校验者` are also rejected. The author object as a whole must remain anchored through `handle`, `role`, body text, or learner/topic context, while `displayName` should read like a natural community nickname.
- Reject scripted community voice in strict generation quality mode. `stance` and reply `relation` are JSON metadata only; visible comment or reply bodies must not start with `赞成：`、`反对：`、`补充：`、`挑刺：`、`追问：`、`反驳：`, and top-level comments must not mostly be direct question slots.
- Apply the same anchored-author quality rule to community reply authors, not only the main post and top-level comments.
- When the model omits author details or returns placeholder names, loose/demo rendering may derive topic/concept-specific personas, but this is not the primary quality path; strict generation should make the model own the community identities.
- Accept real-provider author variants where the model emits `author` as a string and places `handle` / `role` beside it. The adapter may normalize that shape into the canonical author object only when the metadata is model-owned and anchored; strict mode still rejects omitted author metadata, placeholders, or locally scaffolded identities.
- In strict generation quality mode, reject payloads that require local scaffolding for `post.author`, `comment.author`, `reply.author`, exactly 3 model replies, or `shadowDraft.body`. A passing delivery gate must prove the LLM itself generated the visible lesson/post/community/shadow content rather than relying on adapter defaults.
- Preserve generated lesson/post content when valid, but keep internal comment stance coverage available for ranking and quality checks.
- Ensure visible comments keep learner-topic context; a repaired comment may add a short learner/topic/concept anchor sentence, but must not become generic filler.
- Replace placeholder community author names such as `张三`, `李四`, `小王`, or `用户A` with netlike personas in loose adapter mode.
- Keep generic local repair comments rare; real LLM E2E fails when the visible thread mostly depends on repair filler instead of model-generated community agents.
- Treat any local reply repair as a generation-quality failure before accepting LLM output. The generation engine should retry when a visible reply would come from local repair instead of the model.
- Keep real LLM E2E quality gates sensitive to learning value, not only structure: visible/generated community items should show varied signals such as examples, counterpoints, questions, boundaries, evidence/method cues, or learner actions.
- Reject unsafe lesson, post, comment, reply, or shadow text that attacks real people, targets identity groups, encourages harm, or gives deterministic medical/legal/financial action advice.
- Derive a conservative shadow draft when the model returns only shadow metadata but the lesson/post are valid in loose/demo mode; strict delivery validation rejects this path because the user-facing shadow body was not generated by the model.
- Return `null` for invalid structure so the generation engine can retry, then fall back deterministically.

The adapter may repair expression-layer gaps. Comment replies remain expression data only: the adapter may create normalized reply IDs, `replyToCommentId` links, and `source` audit metadata inside the generated bundle, but it must not create or mutate permanent `conceptId`, `lessonId`, `pathOrder`, mastery, unlock order, or approved/public shadow state.

Planner drafts follow the same boundary. The planner may retry invalid real-model output and tolerate common draft-shape variants such as fenced JSON, string day numbers, or omitted `sourceUrls`, but `curriculumValidator` remains the only layer that mints stable concept IDs, lesson IDs, path order, mastery initialization, and persisted curriculum state.

## 10. Failure Handling

任何 LLM/research 步骤失败时：

1. 记录失败原因。
2. 服务端代理必须用 bounded timeout 终止慢上游，并返回可审计的 504/错误 payload。
3. UI 显示 fallback source。
4. 可以使用 sample/fallback 内容完成演示，但这只是容错和 demoability，不能作为交付级证明。
5. 不把不合格输出写入稳定 curriculum。

## 11. Required Tests

每个 contract 至少要有：

- valid payload passes。
- invalid JSON falls back。
- missing required field falls back。
- wrong concept/lesson id rejected。
- research sources carry planning-only quality metadata。
- LLM/research proxy timeout converts slow upstream fetches into bounded errors instead of hanging user-path E2E。
- unsafe comment rejected or sanitized。
- placeholder community authors normalized。
- low-context community comments get learner/topic/concept anchors without changing state。
- real LLM E2E community thread covers `赞成` / `反对` / `补充` / `挑刺` without relying on generic repair filler。
- generation retries repaired-reply outputs and non-exact reply counts before accepting or falling back, so a passing `Research brief + LLM` run proves exactly 3 model-generated replies rather than local filler。
- real LLM E2E reports `selfReplyCount` and fails when community agents appear to reply to themselves instead of interacting with another persona。
- real LLM E2E records community learning-signal variety and fails attitude-only visible comments before accepting a thread as useful。
- real LLM E2E fails visible reply threads that have enough replies but only one relation kind, and fails 3+ reply threads that do not cover all three relation kinds。
- generation retries low top-level-comment learning-signal outputs before accepting or falling back, so a passing `Research brief + LLM` run proves the model produced useful community discussion rather than local context repair。
- generation retries unanchored generic community author identities before accepting or falling back, and real LLM E2E reports `genericCommunityAuthorCount` so passing runs prove topic-fit community agents rather than generic stance labels。
- generation retries role-template display names and scripted-prefix comments before accepting or falling back, and real LLM E2E reports `roleLabelAuthorCount`、`scriptedPrefixCommentCount`、`questionSlotCommentCount` so passing runs prove natural community voice rather than labeled agent slots。
- strict community author validation includes reply authors, while accepting short concept/domain anchors such as `三分法` derived from longer concept titles and education-domain anchors such as `教学` / `课程设计` from learner goals or roles。
- strict generation validation rejects generic lesson/post/shadow copy, missing concrete learner actions, missing web-research grounding, and local author/reply/shadow scaffolding even when the community structure is valid, so a passing `Research brief + LLM` run proves the whole user-facing bundle was generated from the current research brief for this topic and learner。
- strict generation validation rejects unsupported precise years, percentages, reports, institutions, and company examples before accepting real LLM output; real LLM E2E reports `hasNoUnsupportedPreciseClaims` for lesson/post/shadow phases。
- planner parser accepts fenced JSON and normalizes optional draft fields without accepting stable IDs, progress, mastery, or path order from the model。
