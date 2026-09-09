import { describe, expect, it } from "vitest";
import { completeLesson, getDailyMission, getUnlockedConceptIds } from "./learningEngine";
import { defaultAppState } from "./storage";

describe("learningEngine", () => {
  it("selects the first unfinished concept as the daily mission", () => {
    const mission = getDailyMission(defaultAppState);

    expect(mission.conceptId).toBe("wallet");
    expect(mission.lessonId).toBe("lesson-wallet-001");
  });

  it("updates mastery, xp, streak, completion and review queue after a lesson", () => {
    const next = completeLesson(defaultAppState, {
      lessonId: "lesson-wallet-001",
      conceptId: "wallet",
      selectedChoiceId: "wallet-choice-a",
      freeResponse: "钱包更像签名钥匙，不只是平台账号。",
      completedAt: "2026-06-09T00:00:00.000Z"
    });

    expect(next.progress.conceptMastery.wallet).toBeGreaterThan(40);
    expect(next.progress.xp).toBeGreaterThan(defaultAppState.progress.xp);
    expect(next.progress.streak).toBe(1);
    expect(next.progress.completedLessonIds).toContain("lesson-wallet-001");
    expect(next.progress.reviewQueue[0]).toBe("wallet");
  });

  it("derives completed concept from the stable lesson instead of trusting the result payload", () => {
    const next = completeLesson(defaultAppState, {
      lessonId: "lesson-wallet-001",
      conceptId: "gas",
      selectedChoiceId: "wallet-choice-a",
      freeResponse: "钱包更像签名钥匙，不只是平台账号。",
      completedAt: "2026-06-09T00:00:00.000Z"
    });

    expect(next.progress.conceptMastery.wallet).toBeGreaterThan(40);
    expect(next.progress.conceptMastery.gas).toBeUndefined();
    expect(next.progress.lastCompletedConceptId).toBe("wallet");
    expect(next.progress.reviewQueue[0]).toBe("wallet");
  });

  it("unlocks concepts only after prerequisites are mastered", () => {
    const locked = getUnlockedConceptIds(defaultAppState);
    const unlocked = getUnlockedConceptIds({
      ...defaultAppState,
      progress: {
        ...defaultAppState.progress,
        conceptMastery: { ...defaultAppState.progress.conceptMastery, wallet: 70 }
      }
    });

    expect(locked).toEqual(["wallet"]);
    expect(unlocked).toContain("gas");
  });
});
