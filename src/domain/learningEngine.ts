import { sampleCurriculum } from "./seed";
import type { AppState, DailyMission, LessonResult, StableLesson, ValidatedCurriculum } from "./types";

export function getActiveCurriculum(state: AppState): ValidatedCurriculum {
  return state.curriculum ?? sampleCurriculum;
}

export function getDailyMission(state: AppState): DailyMission {
  const curriculum = getActiveCurriculum(state);
  const nextConcept =
    curriculum.concepts.find((concept) => (state.progress.conceptMastery[concept.id] ?? 0) < 70) ??
    curriculum.concepts[0];

  return buildMissionForConcept(curriculum, nextConcept.id);
}

export function getMissionForConcept(state: AppState, conceptId: string): DailyMission {
  return buildMissionForConcept(getActiveCurriculum(state), conceptId);
}

export function getLessonForConcept(state: AppState, conceptId: string): StableLesson {
  const curriculum = getActiveCurriculum(state);
  const lesson = curriculum.lessons.find((item) => item.conceptId === conceptId);
  if (!lesson) return curriculum.lessons[0];
  return lesson;
}

export function getLessonById(state: AppState, lessonId: string): StableLesson {
  const curriculum = getActiveCurriculum(state);
  return curriculum.lessons.find((lesson) => lesson.id === lessonId) ?? curriculum.lessons[0];
}

function buildMissionForConcept(curriculum: ValidatedCurriculum, conceptId: string): DailyMission {
  const concept = curriculum.concepts.find((item) => item.id === conceptId) ?? curriculum.concepts[0];
  const lesson = curriculum.lessons.find((item) => item.conceptId === concept.id) ?? curriculum.lessons[0];

  return {
    conceptId: concept.id,
    lessonId: lesson.id,
    title: `今天看懂：${concept.title}`,
    minutes: lesson.estimatedMinutes,
    reason: `${curriculum.title} 的第 ${concept.order} 个基础点，完成后会刷新信息流讨论。`
  };
}

export function completeLesson(state: AppState, result: LessonResult): AppState {
  const selectedLesson = getLessonById(state, result.lessonId);
  const completedConceptId = selectedLesson.conceptId;
  const currentMastery = state.progress.conceptMastery[completedConceptId] ?? 0;
  const selectedChoice = selectedLesson?.choices.find((choice) => choice.id === result.selectedChoiceId);
  const qualityBonus = selectedChoice?.correct ? 32 : 12;
  const expressionBonus = result.freeResponse.trim().length >= 12 ? 12 : 0;
  const nextMastery = Math.min(100, currentMastery + qualityBonus + expressionBonus);

  return {
    ...state,
    progress: {
      ...state.progress,
      streak: state.progress.streak + 1,
      xp: state.progress.xp + (selectedChoice?.correct ? 35 : 20) + expressionBonus,
      completedLessonIds: Array.from(new Set([...state.progress.completedLessonIds, selectedLesson.id])),
      conceptMastery: {
        ...state.progress.conceptMastery,
        [completedConceptId]: nextMastery
      },
      lastCompletedConceptId: completedConceptId,
      reviewQueue: Array.from(new Set([completedConceptId, ...state.progress.reviewQueue])).slice(0, 4)
    }
  };
}

export function getUnlockedConceptIds(state: AppState): string[] {
  return getActiveCurriculum(state).concepts
    .filter((concept) =>
      concept.prerequisiteIds.every((id) => (state.progress.conceptMastery[id] ?? 0) >= 60)
    )
    .map((concept) => concept.id);
}
