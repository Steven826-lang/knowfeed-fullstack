import type {
  AppState,
  Concept,
  GeneratedCurriculumDraft,
  LearnerProfile,
  ResearchBrief,
  StableLesson,
  TopicProfile,
  ValidatedCurriculum
} from "./types";

export function validateCurriculumDraft(
  draft: GeneratedCurriculumDraft,
  topic: TopicProfile,
  learner: LearnerProfile,
  researchBrief: ResearchBrief,
  source: ValidatedCurriculum["source"] = "planner"
): ValidatedCurriculum {
  const conceptNameToId = new Map<string, string>();
  const concepts: Concept[] = [];
  const lessons: StableLesson[] = [];
  const seenNames = new Set<string>();

  for (const day of draft.days.slice(0, topic.dayCount)) {
    const conceptDraft = day.concepts[0];
    if (!conceptDraft) continue;

    const normalizedName = normalizeName(conceptDraft.temporaryName || day.title);
    if (seenNames.has(normalizedName)) continue;
    seenNames.add(normalizedName);

    const conceptId = stableId(`${topic.topicId}-${day.day}-${normalizedName}`);
    conceptNameToId.set(normalizedName, conceptId);
    const prerequisites = conceptDraft.prerequisiteNames
      .map((name) => conceptNameToId.get(normalizeName(name)))
      .filter((id): id is string => Boolean(id));

    concepts.push({
      id: conceptId,
      title: trimTo(conceptDraft.temporaryName || day.title, 28),
      plainName: trimTo(conceptDraft.temporaryName || day.title, 18),
      order: concepts.length + 1,
      unlockHint: trimTo(conceptDraft.feedHook || day.whyNow, 96),
      prerequisiteIds: prerequisites,
      mastery: 0
    });

    lessons.push({
      id: `lesson-${conceptId}-001`,
      conceptId,
      day: day.day,
      estimatedMinutes: learner.dailyMinutes,
      promptGoal: trimTo(conceptDraft.plainLanguageGoal || day.whyNow, 110),
      choices: buildChoices(conceptId, conceptDraft.misconceptionToFix, conceptDraft.plainLanguageGoal)
    });
  }

  const filled = ensureSevenConcepts(concepts, lessons, topic, learner, researchBrief);

  return {
    curriculumId: `curriculum-${topic.topicId}-${stableId(draft.title).slice(-6)}`,
    source,
    topic,
    learner,
    researchBrief,
    title: trimTo(draft.title || `${topic.title} 7 天路径`, 40),
    promise: trimTo(draft.promise || `每天 ${learner.dailyMinutes} 分钟看懂 ${topic.title} 的讨论`, 120),
    concepts: filled.concepts,
    lessons: filled.lessons
  };
}

export function initializeStateForCurriculum(curriculum: ValidatedCurriculum): AppState {
  return {
    topicProfile: curriculum.topic,
    learnerProfile: curriculum.learner,
    researchBrief: curriculum.researchBrief,
    curriculum,
    progress: {
      activeTopic: curriculum.topic.topicId,
      streak: 1,
      xp: 0,
      completedLessonIds: [],
      conceptMastery: Object.fromEntries(curriculum.concepts.map((concept) => [concept.id, 0])),
      reviewQueue: []
    },
    shadowDrafts: [],
    approvedShadowPosts: [],
    postReplies: {}
  };
}

function ensureSevenConcepts(
  concepts: Concept[],
  lessons: StableLesson[],
  topic: TopicProfile,
  learner: LearnerProfile,
  research: ResearchBrief
) {
  const nextConcepts = [...concepts];
  const nextLessons = [...lessons];

  while (nextConcepts.length < topic.dayCount) {
    const order = nextConcepts.length + 1;
    const idea = research.keyIdeas[(order - 1) % Math.max(research.keyIdeas.length, 1)] ?? `${topic.title} 的关键问题`;
    const conceptId = stableId(`${topic.topicId}-auto-${order}-${idea}`);
    const prerequisiteIds = order === 1 ? [] : [nextConcepts[order - 2].id];
    nextConcepts.push({
      id: conceptId,
      title: trimTo(`${topic.title} 第 ${order} 步`, 28),
      plainName: trimTo(idea, 18),
      order,
      unlockHint: trimTo(research.disputedIdeas[(order - 1) % Math.max(research.disputedIdeas.length, 1)] ?? idea, 96),
      prerequisiteIds,
      mastery: 0
    });
    nextLessons.push({
      id: `lesson-${conceptId}-001`,
      conceptId,
      day: order,
      estimatedMinutes: learner.dailyMinutes,
      promptGoal: trimTo(`用自己的话解释：${idea}`, 110),
      choices: buildChoices(conceptId, "把热点话术当成完整理解", idea)
    });
  }

  return { concepts: nextConcepts.slice(0, topic.dayCount), lessons: nextLessons.slice(0, topic.dayCount) };
}

function buildChoices(conceptId: string, misconception: string, goal: string) {
  return [
    {
      id: `${conceptId}-choice-a`,
      label: trimTo(goal, 80),
      correct: true,
      feedback: "这个解释抓住了今天的核心，不只是复述术语。"
    },
    {
      id: `${conceptId}-choice-b`,
      label: trimTo(misconception || "把一个热词当成完整答案", 80),
      correct: false,
      feedback: "这正是今天要拆掉的误解：它听起来顺，但会漏掉关键约束。"
    },
    {
      id: `${conceptId}-choice-c`,
      label: "先把所有专业名词背下来再看讨论",
      correct: false,
      feedback: "KnowFeed 的路径是先看懂讨论里的问题，再逐步补概念。"
    }
  ];
}

function normalizeName(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function stableId(value: string): string {
  const ascii = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  if (ascii && ascii.length > 5) return ascii.slice(0, 42);

  let hash = 5381;
  for (const char of value) hash = ((hash << 5) + hash + char.charCodeAt(0)) >>> 0;
  return `c-${hash.toString(36)}`;
}

function trimTo(value: string, maxLength: number): string {
  const trimmed = value.trim();
  return trimmed.length > maxLength ? `${trimmed.slice(0, maxLength - 1)}…` : trimmed;
}
