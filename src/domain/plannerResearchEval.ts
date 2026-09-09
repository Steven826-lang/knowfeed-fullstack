import type {
  GeneratedCurriculumDraft,
  LearnerProfile,
  ResearchBrief,
  TopicProfile,
  ValidatedCurriculum
} from "./types";

export interface PlannerResearchEvalInput {
  topicProfile: TopicProfile;
  learnerProfile: LearnerProfile;
  researchBrief: ResearchBrief;
  draft: GeneratedCurriculumDraft;
  curriculum: ValidatedCurriculum;
  forbiddenTerms?: string[];
}

export interface PlannerResearchEvalCheck {
  id: string;
  passed: boolean;
  points: number;
  maxPoints: number;
  detail: string;
}

export interface PlannerResearchEvalResult {
  passed: boolean;
  score: number;
  maxScore: number;
  checks: PlannerResearchEvalCheck[];
}

export function evaluatePlannerResearchFit(input: PlannerResearchEvalInput): PlannerResearchEvalResult {
  const checks = [
    scoreResearchBrief(input),
    scoreSourceQuality(input),
    scorePathShape(input),
    scoreTopicFit(input),
    scoreLearnerFit(input),
    scoreResearchUse(input),
    scoreStateBoundary(input),
    scoreForbiddenLeakage(input)
  ];
  const score = checks.reduce((sum, check) => sum + check.points, 0);
  const maxScore = checks.reduce((sum, check) => sum + check.maxPoints, 0);

  return {
    passed: score >= 85 && checks.every((check) => check.passed),
    score,
    maxScore,
    checks
  };
}

function scoreResearchBrief(input: PlannerResearchEvalInput): PlannerResearchEvalCheck {
  const { researchBrief, topicProfile } = input;
  const topicTerms = termsFor(topicProfile.title);
  const sourceCountOk = researchBrief.sources.length >= 3;
  const sourcedOk = researchBrief.sources.every(
    (source) => source.url && source.retrievedAt && source.summary && source.reliabilityNote
  );
  const relevantCount = researchBrief.sources.filter((source) =>
    matchesAny(`${source.title} ${source.summary} ${source.reliabilityNote}`, topicTerms)
  ).length;
  const relevanceOk = relevantCount >= Math.min(3, researchBrief.sources.length);
  const passed = sourceCountOk && sourcedOk && relevanceOk;

  return {
    id: "research-brief-quality",
    passed,
    points: passed ? 18 : sourceCountOk && sourcedOk ? 10 : 0,
    maxPoints: 18,
    detail: `${researchBrief.sources.length} sources, ${relevantCount} topic-relevant sources`
  };
}

function scoreSourceQuality(input: PlannerResearchEvalInput): PlannerResearchEvalCheck {
  const { researchBrief, topicProfile } = input;
  const sources = researchBrief.sources;

  if (researchBrief.source === "fallback") {
    const explicitlyMarkedFallback = sources.every(
      (source) =>
        source.qualityScore === 0 &&
        source.qualitySignals?.includes("fallback") &&
        source.qualitySignals?.includes("planning-only") &&
        source.factReviewStatus === "planning-only"
    );
    return {
      id: "source-quality-signals",
      passed: explicitlyMarkedFallback,
      points: explicitlyMarkedFallback ? 10 : 0,
      maxPoints: 10,
      detail: explicitlyMarkedFallback
        ? "fallback sources are explicitly marked planning-only"
        : "fallback sources are missing explicit planning-only quality metadata"
    };
  }

  const topicTerms = termsFor(topicProfile.title);
  const explicitMetadataCount = sources.filter(
    (source) =>
      typeof source.qualityScore === "number" &&
      Number.isFinite(source.qualityScore) &&
      Array.isArray(source.qualitySignals) &&
      source.factReviewStatus === "planning-only"
  ).length;
  const planningOnlyCount = sources.filter(
    (source) =>
      source.qualitySignals?.includes("planning-only") &&
      /planning context only|planning-only|not a complete fact review/i.test(source.reliabilityNote)
  ).length;
  const topicSignalCount = sources.filter(
    (source) => source.qualitySignals?.includes("topic-match") || matchesAny(`${source.title} ${source.summary}`, topicTerms)
  ).length;
  const highSignalCount = sources.filter(
    (source) => (source.qualityScore ?? 0) >= 8 && source.qualitySignals?.includes("topic-match")
  ).length;
  const enoughTopicSignals = topicSignalCount >= Math.min(3, sources.length);
  const passed =
    sources.length > 0 &&
    explicitMetadataCount === sources.length &&
    planningOnlyCount === sources.length &&
    enoughTopicSignals &&
    highSignalCount >= 1;

  return {
    id: "source-quality-signals",
    passed,
    points: passed ? 10 : explicitMetadataCount === sources.length && topicSignalCount > 0 ? 5 : 0,
    maxPoints: 10,
    detail: `${explicitMetadataCount}/${sources.length} explicit quality metadata, ${topicSignalCount} topic signals, ${highSignalCount} high-signal sources`
  };
}

function scorePathShape(input: PlannerResearchEvalInput): PlannerResearchEvalCheck {
  const { topicProfile, curriculum } = input;
  const conceptIds = curriculum.concepts.map((concept) => concept.id);
  const lessonConceptIds = new Set(curriculum.lessons.map((lesson) => lesson.conceptId));
  const uniqueConcepts = new Set(conceptIds).size === topicProfile.dayCount;
  const uniqueLessons = new Set(curriculum.lessons.map((lesson) => lesson.id)).size === topicProfile.dayCount;
  const validLessons = curriculum.lessons.every(
    (lesson) => lesson.id === `lesson-${lesson.conceptId}-001` && conceptIds.includes(lesson.conceptId)
  );
  const ordered = curriculum.concepts.every((concept, index) => concept.order === index + 1);
  const linked = conceptIds.every((id) => lessonConceptIds.has(id));
  const passed =
    curriculum.concepts.length === topicProfile.dayCount &&
    curriculum.lessons.length === topicProfile.dayCount &&
    uniqueConcepts &&
    uniqueLessons &&
    validLessons &&
    ordered &&
    linked;

  return {
    id: "validated-path-shape",
    passed,
    points: passed ? 18 : 0,
    maxPoints: 18,
    detail: `${curriculum.concepts.length} concepts, ${curriculum.lessons.length} lessons`
  };
}

function scoreTopicFit(input: PlannerResearchEvalInput): PlannerResearchEvalCheck {
  const topicTerms = termsFor(input.topicProfile.title);
  const text = combinedPathText(input);
  const matched = topicTerms.filter((term) => normalize(text).includes(term));
  const passed = matched.length >= Math.min(3, topicTerms.length);

  return {
    id: "topic-fit",
    passed,
    points: passed ? 14 : matched.length ? 7 : 0,
    maxPoints: 14,
    detail: `matched ${matched.length}/${topicTerms.length} topic terms`
  };
}

function scoreLearnerFit(input: PlannerResearchEvalInput): PlannerResearchEvalCheck {
  const learnerTerms = termsFor(input.learnerProfile.background);
  const text = combinedPathText(input);
  const matched = learnerTerms.filter((term) => normalize(text).includes(term));
  const passed = matched.length >= 1;

  return {
    id: "learner-fit",
    passed,
    points: passed ? 12 : 0,
    maxPoints: 12,
    detail: matched.length ? `matched learner terms: ${matched.slice(0, 4).join(", ")}` : "no learner background term found"
  };
}

function scoreResearchUse(input: PlannerResearchEvalInput): PlannerResearchEvalCheck {
  const sourceUrls = new Set(input.researchBrief.sources.map((source) => source.url));
  const draftConcepts = input.draft.days.flatMap((day) => day.concepts);
  const sourcedConcepts = draftConcepts.filter((concept) =>
    concept.sourceUrls.some((url) => sourceUrls.has(url))
  ).length;
  const passed = draftConcepts.length >= input.topicProfile.dayCount && sourcedConcepts >= input.topicProfile.dayCount;

  return {
    id: "research-source-use",
    passed,
    points: passed ? 14 : sourcedConcepts > 0 ? 7 : 0,
    maxPoints: 14,
    detail: `${sourcedConcepts}/${draftConcepts.length} draft concepts reference ranked sources`
  };
}

function scoreStateBoundary(input: PlannerResearchEvalInput): PlannerResearchEvalCheck {
  const bannedKeys = ["conceptId", "lessonId", "pathOrder", "mastery", "progress", "completedLessonIds"];
  const found = findKeys(input.draft, bannedKeys);
  const passed = found.length === 0;

  return {
    id: "state-boundary",
    passed,
    points: passed ? 16 : 0,
    maxPoints: 16,
    detail: passed ? "draft has no stable state keys" : `draft contains banned keys: ${found.join(", ")}`
  };
}

function scoreForbiddenLeakage(input: PlannerResearchEvalInput): PlannerResearchEvalCheck {
  const forbidden = input.forbiddenTerms ?? ["Web3", "钱包", "Gas", "链上"];
  const text = combinedPathText(input);
  const leaked = forbidden.filter((term) => normalize(text).includes(normalize(term)));
  const passed = leaked.length === 0;

  return {
    id: "forbidden-sample-leakage",
    passed,
    points: passed ? 8 : 0,
    maxPoints: 8,
    detail: passed ? "no forbidden sample terms" : `leaked terms: ${leaked.join(", ")}`
  };
}

function combinedPathText(input: PlannerResearchEvalInput): string {
  return [
    input.draft.title,
    input.draft.promise,
    ...input.draft.days.flatMap((day) => [
      day.title,
      day.whyNow,
      ...day.concepts.flatMap((concept) => [
        concept.temporaryName,
        concept.plainLanguageGoal,
        concept.misconceptionToFix,
        concept.feedHook
      ])
    ]),
    input.curriculum.title,
    input.curriculum.promise,
    ...input.curriculum.concepts.flatMap((concept) => [concept.title, concept.plainName, concept.unlockHint]),
    ...input.curriculum.lessons.map((lesson) => lesson.promptGoal)
  ].join("\n");
}

function findKeys(value: unknown, bannedKeys: string[]): string[] {
  if (!value || typeof value !== "object") return [];
  if (Array.isArray(value)) return [...new Set(value.flatMap((item) => findKeys(item, bannedKeys)))];

  const found: string[] = [];
  for (const [key, child] of Object.entries(value)) {
    if (bannedKeys.includes(key)) found.push(key);
    found.push(...findKeys(child, bannedKeys));
  }
  return [...new Set(found)];
}

function matchesAny(value: string, terms: string[]): boolean {
  const text = normalize(value);
  return terms.some((term) => text.includes(term));
}

function termsFor(value: string): string[] {
  const normalized = normalize(value).replace(/入门/g, " ").replace(/[^\p{L}\p{N}]+/gu, " ").trim();
  const words = normalized.split(/\s+/).filter((word) => word.length >= 3 || word === "ai");
  const compact = normalized.replace(/\s+/g, "");
  if (compact && /[\u4e00-\u9fa5]/.test(compact)) {
    words.push(compact);
    for (const segment of compact.match(/[\u4e00-\u9fa5]{2,}/g) ?? []) {
      for (let index = 0; index < segment.length - 1; index += 1) {
        const chunk = segment.slice(index, index + 2);
        if (!broadChineseTerms.has(chunk)) words.push(chunk);
      }
    }
  }
  return [...new Set(words)];
}

const broadChineseTerms = new Set(["我是", "入门", "政策", "工具", "常见", "争议", "用户", "背景", "学习"]);

function normalize(value: string): string {
  return value
    .toLowerCase()
    .replace(/氣/g, "气")
    .replace(/變/g, "变")
    .replace(/學/g, "学")
    .replace(/樂/g, "乐")
    .replace(/戰/g, "战")
    .replace(/國/g, "国")
    .replace(/歷/g, "历")
    .replace(/\s+/g, " ");
}
