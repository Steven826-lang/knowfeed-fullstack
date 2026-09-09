# KnowFeed Core Design For Refactor

日期：2026-06-30

这份文档用于重构前的设计提炼。它不替代 `docs/product/PRD_V2.md`、`docs/engineering/SYSTEM_CONTRACT.md` 或 `docs/engineering/LLM_CONTRACTS.md`，而是把 KnowFeed 当前原型里真正要保留的 idea、核心循环、模块边界和重构方向收束成一个可执行的判断框架。

## 1. 一句话 Idea

KnowFeed 把任意学习目标转成一条由稳定学习图谱驱动、由 AI 社交信息流表达的每日知识循环。

更具体地说：

```text
用户不是来“上课”的。
用户输入一个感兴趣的领域和自己的背景后，
KnowFeed 替他决定今天最该学什么，
把这个知识点包装成能刷、能争论、能立刻应用的 Feed 内容，
再用 3-10 分钟微任务和 AI 学习分身把“看懂”推进到“能说一句”。
```

这个产品的核心不是“LLM 生成课程”，也不是“AI 社区”。核心是把学习编排和社交表达绑定在同一个可验证循环里。

## 2. 产品信念

KnowFeed 的重构必须保留以下判断：

1. 学习者不缺内容，缺的是下一步。
   传统课程让用户先面对目录、章节和学习压力。KnowFeed 应该在打开时直接回答：我现在该学什么，为什么值得学，学完能看懂什么。

2. 短任务比长课程更适合兴趣学习。
   第一版面向普通兴趣学习者，不是考试、证书或企业培训。每天 3-10 分钟，一个明确任务，一个即时反馈，比完整大纲更重要。

3. 社交信息流不是奖励层，而是学习场景本身。
   Feed、主帖、评论、争议和楼中楼的作用，是让用户知道这个概念在真实讨论里怎么被使用、误解、反驳和追问。

4. LLM 是产品核心，但不是状态权威。
   LLM 负责草案和表达层：路径草案、解释、类比、帖子、评论、回复、shadow draft。本地 validator、engine 和 storage 负责稳定结构、进度、掌握度和授权边界。

5. Fallback 是安全网，不是产品主体验。
   fallback 只服务无 key、网络失败、schema 不合格、测试稳定断言和 demo continuity。交付证据必须证明真实 `Research brief + LLM` 链路成立。

## 3. 核心用户循环

KnowFeed 的体验循环应该始终保持下面这条链路：

```text
Onboarding
-> TopicProfile + LearnerProfile
-> ResearchBrief
-> GeneratedCurriculumDraft
-> ValidatedCurriculum
-> DailyMission
-> GeneratedKnowledgeBundle
-> MicroLesson completion
-> ProgressState update
-> ShadowDraft
-> Feed / Post return
-> Next DailyMission
```

这条链路里有两个入口：

- 今日任务入口：低决策、低压力，像多邻国，负责习惯和主线推进。
- 信息流入口：用好奇、争议和评论触发学习，负责兴趣和沉浸。

两个入口必须共享同一个课程图谱、同一个 progress 状态和同一个 concept 边界。不能做成两套互不相干的课程页和 Feed 页。

## 4. 核心模型

### 4.1 TopicProfile: 学什么

`TopicProfile` 是用户选择的领域和目标的标准化表达。

它回答：

- 用户想学什么领域？
- 用户想达到什么理解深度？
- 这条路径默认覆盖几天？
- 语言和表达环境是什么？

重构时不要让 UI 输入直接穿透到所有模块。任何 planner、research、generator 都应该消费标准化后的 `TopicProfile`。

### 4.2 LearnerProfile: 为谁学

`LearnerProfile` 是 KnowFeed 区别于普通课程生成器的关键。

它回答：

- 用户已有背景是什么？
- 用户知道哪些相关领域？
- 用户明确不想看到哪些表达风格？
- 用户每天有多少时间？
- 用户更想轻松看懂、专业判断，还是争议导向？

`avoidedStyles` 不是 UI 文案。它必须进入 planner 和 generator 的硬约束，避免模型把用户不想要的口吻换个名字又写回来。

### 4.3 ResearchBrief: 规划证据层

`ResearchBrief` 是学习路径和表达内容的资料锚点。

它不等于事实审稿，也不应该被包装成权威结论。它的作用是给 planner 和 generator 提供公开资料、争议点、初学者坑点和来源质量信号。

重构时要保留三个边界：

- `source: "web"` 表示接入网页资料。
- `factReviewStatus: "planning-only"` 表示只作为学习规划参考。
- 来源、锚点和质量信号必须能在 UI 里被用户看到。

### 4.4 GeneratedCurriculumDraft: LLM 路径草案

Planner LLM 生成的是草案，不是 app 状态。

草案可以包含：

- 7 天标题。
- 每天为什么现在学。
- 临时概念名。
- 概念解释目标。
- 常见误解。
- 可生成 Feed 的 hook。
- 相关 source URLs。

草案不可以包含或控制：

- 永久 concept ID。
- 永久 lesson ID。
- path order。
- mastery。
- progress。
- unlock state。

### 4.5 ValidatedCurriculum: 稳定学习图谱

`ValidatedCurriculum` 是 KnowFeed 的课程结构权威。

它由本地 validator 从 planner 草案转换出来，负责：

- 铸造稳定 `conceptId` 和 `lessonId`。
- 限制路径长度。
- 去重和补足概念。
- 生成 stable choices。
- 绑定 learner、research 和 source。

重构时应该把它视为 learning core 的核心实体。UI、Feed、MicroLesson 和 Shadow 都应该围绕这个结构读数据，而不是重新解释 planner 输出。

### 4.6 DailyMission: 今日应该学什么

`DailyMission` 是 Learning Engine 对用户的下一步指令。

当前逻辑是选择第一个 mastery 低于 70 的 concept，并根据 concept 找到对应 lesson。重构可以改善策略，但不能改变所有入口都必须经过 DailyMission 的原则。

DailyMission 需要保持小而清楚：

- `conceptId`
- `lessonId`
- title
- minutes
- reason

### 4.7 GeneratedKnowledgeBundle: 每日表达包

`GeneratedKnowledgeBundle` 是围绕一个 concept 生成的表达层包。

它包含：

- 微课表达：hook、解释、类比、recall prompt、completion feedback。
- Feed 主帖。
- 评论区顶层评论和轻量回复。
- AI 学习分身草稿。
- 生成来源和时间。

它不能改变 stable lesson、concept graph 或 progress。即使 LLM 输出里夹带了状态字段，也应该被 parser 或 validator 拒绝。

### 4.8 ProgressState: 用户学习状态

`ProgressState` 是学习推进的唯一状态源。

它包含：

- active topic。
- streak。
- XP。
- completed lesson IDs。
- concept mastery。
- last completed concept。
- review queue。

重构时要避免让 UI 组件、LLM 输出或 Feed 热度直接写入 mastery。只有 Learning Engine 可以根据可验证的 lesson result 更新 progress。

### 4.9 ShadowDraft: 表达辅助，不是代理发布

AI 学习分身的第一性职责是帮助用户把刚学到的东西说出来。

ShadowDraft 可以：

- 根据当前 concept 和学习记录生成评论草稿。
- 展示 confidence。
- 展示依据。
- 被用户编辑、拒绝、批准。

ShadowDraft 不可以：

- 自动公开发言。
- 冒充用户本人。
- 使用用户没学过或没表达过的观点替用户站队。

## 5. 不可破坏的系统边界

| 边界 | LLM 可以做 | 本地系统必须掌控 |
| --- | --- | --- |
| 课程路径 | 生成路径草案、解释为什么学 | 稳定 concept/lesson ID、path order、去重、补足 |
| 微课 | 生成 hook、解释、类比、反馈文案 | stable lesson、choice ID、正确答案、完成判定 |
| Feed | 生成主帖、评论、回复、下一步 hook | concept 绑定、source 标记、安全校验、状态隔离 |
| 进度 | 参考用户背景调整表达 | mastery、XP、streak、review queue |
| Shadow | 生成草稿文字和依据 | 审批、编辑、拒绝、是否进入 approved posts |
| 来源 | 复用 research anchors | source provenance、quality signals、fact review 边界 |

判断一个重构是否走偏，可以问：

- 它有没有让 LLM 直接拥有稳定状态？
- 它有没有把 fallback 伪装成主路径？
- 它有没有把 Feed 做成纯娱乐？
- 它有没有让今日任务和帖子入口走两套状态？
- 它有没有把 Web3 sample 当成产品边界？

## 6. 重构后的理想分层

当前 `App.tsx` 已经承担了很多编排职责。重构目标不是先追求更多抽象，而是让稳定内核、生成管线和体验壳各自清楚。

建议分成五层。

### 6.1 Learning Core

职责：纯领域逻辑，无 React、无 fetch、无 localStorage。

包含：

- domain types。
- curriculum validator。
- learning engine。
- progress update。
- unlock/review policy。

当前对应文件：

- `src/domain/types.ts`
- `src/domain/curriculumValidator.ts`
- `src/domain/learningEngine.ts`

### 6.2 Planning Pipeline

职责：把用户输入变成稳定课程图谱。

输入：

- onboarding input。

输出：

- `ValidatedCurriculum`。

内部步骤：

```text
buildProfiles
-> fetchResearchBrief
-> generateCurriculumDraft
-> validateCurriculumDraft
-> initializeStateForCurriculum
```

当前对应文件：

- `src/domain/profileBuilder.ts`
- `src/domain/researchEngine.ts`
- `src/domain/topicPlanner.ts`
- `src/domain/plannerContracts.ts`
- `src/domain/curriculumValidator.ts`

### 6.3 Generation Pipeline

职责：为某个 concept 生成可渲染表达包，并严格校验。

输入：

- `AppState`
- `conceptId`

输出：

- `GeneratedKnowledgeBundle`

内部步骤：

```text
build prompt
-> call LLM proxy
-> parse generated payload
-> enforce strict quality/safety/source rules
-> retry
-> fallback if all attempts fail
```

当前对应文件：

- `src/domain/generationEngine.ts`
- `src/domain/generationPrompt.ts`
- `src/domain/llmContracts.ts`
- `src/domain/fallbackGenerator.ts`
- `src/domain/llmClient.ts`

### 6.4 Experience Shell

职责：React 屏幕、导航、用户输入、可见状态。

它应该做：

- 显示 onboarding、path preview、feed、post、lesson、map、settings。
- 把用户事件转给 application service。
- 渲染 source provenance。
- 保持移动端优先交互。

它不应该做：

- 直接决定 stable IDs。
- 直接解释 planner 草案。
- 直接更新 mastery。
- 直接绕过 generation/contract 校验。

当前对应文件：

- `src/App.tsx`
- `src/components/*`
- `src/styles.css`

### 6.5 Persistence And Provenance

职责：持久化稳定状态、缓存生成表达包，并把来源边界暴露给用户。

当前对应文件：

- `src/domain/storage.ts`
- `src/components/SourceProvenance.tsx`

关键原则：

- `AppState` 是稳定学习状态。
- cached bundle 是表达层缓存。
- fallback bundle 可以渲染，但不应被当成交付证据。
- source provenance 必须在 path、feed、post、lesson、shadow/map 等关键 surface 可见。

## 7. 建议抽出的 Application Service

为了让 `App.tsx` 变薄，可以抽出一个 application service 层。它不是新业务实体，只是把当前散落在 React 事件里的流程收束成可测试用例。

建议接口：

```ts
buildLearningProgram(input: OnboardingInput): Promise<{
  state: AppState;
  firstMission: DailyMission;
  firstBundle: GeneratedKnowledgeBundle;
}>;

generateBundleForConcept(state: AppState, conceptId: string): Promise<GeneratedKnowledgeBundle>;

completeMission(state: AppState, result: LessonResult, bundle: GeneratedKnowledgeBundle): {
  state: AppState;
  shadowDraftAdded: boolean;
  nextConceptId?: string;
};

approveShadowDraft(state: AppState, draftId: string): AppState;
updateShadowDraft(state: AppState, draftId: string, body: string): AppState;
rejectShadowDraft(state: AppState, draftId: string): AppState;
```

这个 service 的价值是：

- 把 onboarding build pipeline 从 React 组件中抽离。
- 让 lesson completion、shadow draft 生成、warm upcoming bundle 可单元测试。
- 让 UI 只关心 screen state、loading state 和事件分发。
- 为未来 server-side orchestration 或多端复用留出边界。

## 8. 重构时优先保留的体验

1. 首次进入必须能从空状态完成 onboarding。
2. 用户输入任意非 Web3 主题后，路径、feed、微课和 shadow 都应围绕该主题变化。
3. 用户背景必须改变路径和表达方式。
4. 生成态要显示理解目标、联网检索、规划路径、生成讨论这几个阶段。
5. 首次生成后要先看到 7 天路径预览，再进入 feed。
6. Feed 首屏应该优先呈现生成的社区讨论，而不是课程后台。
7. 从帖子或今日任务进入微课，完成后回到评论区。
8. Shadow draft 必须显示依据，并且用户批准前不能公开。
9. 关键页面必须显示来源和研究锚点。

## 9. 重构时可以降级或删除的东西

可以降级：

- Web3 seed：只保留为 fallback sample。
- 过细的 UI 状态耦合：能由 application service 返回的状态不要留在组件里推导。
- local repair filler：可以作为 loose/demo fallback，但不能成为 delivery quality path。
- 只为测试方便存在的硬编码 topic 模板：保留在 fallback generator，不进入核心 planner 模型。

不要删除：

- deterministic fallback。
- source provenance。
- strict generation validation。
- planner retry and fallback。
- validator-owned IDs。
- shadow approval gate。

## 10. 验收重构是否正确

一次重构如果声称没有改变产品核心，至少要能回答这些问题：

1. 任意领域还成立吗？
2. 用户背景还进入 planner 和 generator 吗？
3. Research brief 还是 planning-only，并且有来源质量信号吗？
4. Planner 输出仍然只是草案吗？
5. Validator 仍然是 concept/lesson/path 的唯一权威吗？
6. Learning Engine 仍然是 mastery/XP/streak/review queue 的唯一权威吗？
7. Feed 和今日任务是否共享同一个 concept 和 lesson 边界？
8. Shadow draft 是否仍然需要用户批准？
9. fallback 是否清楚标记为 fallback，而不是伪装成 real LLM output？
10. UI 是否还能显示 `Research brief + LLM`、`Research: web`、`Path: planner` 这类机器证据？

## 11. 当前代码地图

当前实现中，核心设计已经落在这些文件里：

- `src/App.tsx`：应用编排，连接 onboarding、research、planner、validator、generation、lesson completion 和 screens。
- `src/domain/types.ts`：核心领域对象。
- `src/domain/profileBuilder.ts`：把 onboarding 输入转成 topic/learner profiles。
- `src/domain/researchEngine.ts`：research brief 获取和 fallback。
- `src/domain/topicPlanner.ts`：planner LLM 调用、retry 和 deterministic draft fallback。
- `src/domain/curriculumValidator.ts`：稳定课程图谱和初始 state。
- `src/domain/learningEngine.ts`：今日任务、lesson completion、unlock。
- `src/domain/generationEngine.ts`：daily bundle 生成、严格校验、retry、fallback。
- `src/domain/llmContracts.ts`：表达层 parser、adapter、质量和安全边界。
- `src/domain/storage.ts`：稳定 state 和 generated bundle cache。
- `src/components/SourceProvenance.tsx`：来源链路、研究锚点和可信度提示。

## 12. 最短重构原则

重构时不要先问“怎么做更像一个大系统”，先问：

```text
这次改动有没有让 KnowFeed 更清楚地保持：
任意领域
-> 用户背景
-> research evidence
-> planner draft
-> validator-owned curriculum
-> learning-engine-owned progress
-> LLM-owned expression
-> user-approved shadow
```

如果答案是否定的，这次重构大概率是在整理代码形状，而不是提炼 KnowFeed 的产品内核。
