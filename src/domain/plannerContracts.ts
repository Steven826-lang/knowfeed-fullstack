import type { GeneratedCurriculumDraft, LearnerProfile, ResearchBrief, TopicProfile } from "./types";
import { extractFirstJsonObject } from "./jsonObject";

export interface PlannerPromptRequest {
  topicProfile: TopicProfile;
  learnerProfile: LearnerProfile;
  researchBrief: ResearchBrief;
}

export function buildPlannerPrompt({
  topicProfile,
  learnerProfile,
  researchBrief
}: PlannerPromptRequest) {
  return {
    temperature: 0.55,
    messages: [
      {
        role: "system" as const,
        content:
          "你是 KnowFeed 的课程规划引擎。只返回 JSON，不要 Markdown。你只能生成 7 天课程草案，不能生成永久 ID、进度、mastery 或代表用户公开发言。课程必须根据用户背景变化，并服务普通兴趣学习者的低压力探索。learnerProfile.avoidedStyles 是硬性负偏好，路径命名、解释目标和 feed hook 都必须避开这些风格。"
      },
      {
        role: "user" as const,
        content: JSON.stringify({
          task: "根据主题、用户背景和联网资料，生成 7 天 KnowFeed 学习路径草案",
          topicProfile,
          learnerProfile,
          researchBrief,
          rules: [
            "每天只安排 1 个核心概念",
            "每个概念要能支撑一条社交媒体式讨论",
            "避免专家课程目录口吻",
            "遵守 learnerProfile.avoidedStyles，不要输出用户明确不想看的口吻、难度或表达套路",
            "用中文输出",
            "不要输出 conceptId 或 lessonId"
          ],
          outputShape: {
            title: "string",
            promise: "string",
            days: [
              {
                day: 1,
                title: "string",
                whyNow: "string",
                concepts: [
                  {
                    temporaryName: "string",
                    plainLanguageGoal: "string",
                    prerequisiteNames: ["string"],
                    misconceptionToFix: "string",
                    feedHook: "string",
                    sourceUrls: ["string"]
                  }
                ]
              }
            ]
          }
        })
      }
    ]
  };
}

export function parsePlannerDraft(raw: string): GeneratedCurriculumDraft | null {
  try {
    const parsed = JSON.parse(extractFirstJsonObject(raw)) as GeneratedCurriculumDraft;
    if (!isDraftLike(parsed)) return null;
    return {
      ...parsed,
      days: parsed.days.slice(0, 7).map((day, index) => ({
        day: normalizeDay(day.day, index),
        title: day.title,
        whyNow: day.whyNow,
        concepts: day.concepts.map((concept) => ({
          temporaryName: concept.temporaryName,
          plainLanguageGoal: concept.plainLanguageGoal,
          prerequisiteNames: Array.isArray(concept.prerequisiteNames)
            ? concept.prerequisiteNames.filter((item): item is string => typeof item === "string")
            : [],
          misconceptionToFix: typeof concept.misconceptionToFix === "string" ? concept.misconceptionToFix : "",
          feedHook: typeof concept.feedHook === "string" ? concept.feedHook : day.whyNow,
          sourceUrls: Array.isArray(concept.sourceUrls)
            ? concept.sourceUrls.filter((item): item is string => typeof item === "string")
            : []
        }))
      }))
    };
  } catch {
    return null;
  }
}

function isDraftLike(value: unknown): value is GeneratedCurriculumDraft {
  const draft = value as GeneratedCurriculumDraft;
  return Boolean(
    draft &&
      typeof draft.title === "string" &&
      typeof draft.promise === "string" &&
      Array.isArray(draft.days) &&
      draft.days.length >= 3 &&
      draft.days.every(
        (day) =>
          (typeof day.day === "number" || typeof day.day === "string") &&
          typeof day.title === "string" &&
          typeof day.whyNow === "string" &&
          Array.isArray(day.concepts) &&
          day.concepts.length >= 1 &&
          day.concepts.every(
            (concept) =>
              typeof concept.temporaryName === "string" &&
              typeof concept.plainLanguageGoal === "string" &&
              (concept.prerequisiteNames === undefined || Array.isArray(concept.prerequisiteNames)) &&
              (concept.misconceptionToFix === undefined || typeof concept.misconceptionToFix === "string") &&
              (concept.feedHook === undefined || typeof concept.feedHook === "string") &&
              (concept.sourceUrls === undefined || Array.isArray(concept.sourceUrls))
          )
      )
  );
}

function normalizeDay(value: number | string, index: number): number {
  const numericValue = typeof value === "string" ? Number.parseInt(value, 10) : value;
  if (Number.isInteger(numericValue) && numericValue >= 1 && numericValue <= 7) return numericValue;
  return index + 1;
}
