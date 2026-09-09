import { buildFallbackBundle } from "./fallbackGenerator";
import { buildCommentsPrompt, buildLessonPostPrompt, buildShadowDraftPrompt } from "./generationPrompt";
import { extractFirstJsonObject } from "./jsonObject";
import { buildCommunityContext, parseGeneratedPayload } from "./llmContracts";
import { requestGeneratedContent } from "./llmClient";
import type { AppState, GeneratedKnowledgeBundle } from "./types";

const generationAttempts = 4;
const strictGenerationOptions = {
  minCommentAuthors: 8,
  rejectRepairedComments: true,
  rejectRepairedReplies: true,
  rejectLowReplyRelationCoverage: true,
  rejectLowCommentLearningSignals: true,
  rejectLowCommunityAuthorQuality: true,
  rejectLowGeneratedContentAnchoring: true,
  rejectLocalScaffoldedContent: true,
  rejectAvoidedStyles: true,
  rejectScriptedCommunityVoice: true,
  rejectUnsupportedPreciseClaims: true
} as const;
const llmOnlyGenerationAttempts = 2;
const llmOnlyGenerationOptions = {
  minCommentAuthors: 4,
  rejectLowCommentLearningSignals: true,
  rejectAvoidedStyles: true,
  rejectScriptedCommunityVoice: true,
  rejectUnsupportedPreciseClaims: true
} as const;

export async function generateKnowledgeBundle(
  state: AppState,
  conceptId: string,
  client: typeof requestGeneratedContent = requestGeneratedContent
): Promise<GeneratedKnowledgeBundle> {
  const communityContext = buildCommunityContext(state, conceptId);
  const policy = generationPolicyFor(communityContext);
  for (let attempt = 0; attempt < policy.attempts; attempt += 1) {
    try {
      const payload = await requestSegmentedPayload(state, conceptId, communityContext, attempt, policy.options, client);
      if (!payload) continue;

      return {
        source: state.researchBrief?.source === "web" ? "research-llm" : "llm",
        conceptId,
        generatedAt: new Date().toISOString(),
        ...payload
      };
    } catch {
      // Retry below; fallback remains deterministic if all attempts fail.
    }
  }

  return buildFallbackBundle(state, conceptId);
}

function generationPolicyFor(communityContext: ReturnType<typeof buildCommunityContext>) {
  if (communityContext.researchSource === "fallback") {
    return {
      attempts: llmOnlyGenerationAttempts,
      options: llmOnlyGenerationOptions
    };
  }
  return {
    attempts: generationAttempts,
    options: strictGenerationOptions
  };
}

async function requestSegmentedPayload(
  state: AppState,
  conceptId: string,
  communityContext: ReturnType<typeof buildCommunityContext>,
  attempt: number,
  options: typeof strictGenerationOptions | typeof llmOnlyGenerationOptions,
  client: typeof requestGeneratedContent
) {
  const surface = await requestLessonPostSurface(state, conceptId, communityContext, attempt, options, client);
  if (!surface) return null;

  const fullPayload = parseGeneratedPayload(JSON.stringify(surface), conceptId, communityContext, options);
  if (fullPayload) return fullPayload;

  if (hasModelGeneratedComments(surface)) return null;

  if (!hasGeneratedShadowDraft(surface)) {
    const partialSurface = {
      lesson: surface.lesson,
      post: surface.post ?? surface.feed?.post
    };
    const shadowPrompt = buildShadowDraftPrompt({ state, conceptId, generatedSurface: partialSurface });
    const commentsPrompt = buildCommentsPrompt({ state, conceptId, generatedSurface: partialSurface });
    if (attempt > 0) {
      const retryFeedback = buildRetryFeedback(attempt);
      shadowPrompt.messages.push({
        role: "user",
        content: retryFeedback
      });
      commentsPrompt.messages.push({
        role: "user",
        content: retryFeedback
      });
    }
    const [shadowRaw, commentsRaw] = await Promise.all([client(shadowPrompt), client(commentsPrompt)]);
    const shadow = parseObject(shadowRaw);
    const comments = parseJsonValue(commentsRaw);
    if (!hasGeneratedShadowDraft(shadow) || !comments) return null;

    const combinedRaw = JSON.stringify({
      ...partialSurface,
      shadowDraft: readGeneratedShadowDraft(shadow),
      comments: Array.isArray(comments) ? comments : comments.comments ?? comments.feed?.comments,
      commentReplies: Array.isArray(comments) ? undefined : comments.commentReplies ?? comments.feed?.commentReplies
    });

    return parseGeneratedPayload(combinedRaw, conceptId, communityContext, options);
  }

  const commentsPrompt = buildCommentsPrompt({ state, conceptId, generatedSurface: surface });
  if (attempt > 0) {
    commentsPrompt.messages.push({
      role: "user",
      content: buildRetryFeedback(attempt)
    });
  }
  const commentsRaw = await client(commentsPrompt);
  const comments = parseJsonValue(commentsRaw);
  if (!comments) return null;

  const combinedRaw = JSON.stringify({
    lesson: surface.lesson,
    post: surface.post ?? surface.feed?.post,
    shadowDraft: surface.shadowDraft ?? surface.shadow ?? surface.draft ?? surface.aiShadowDraft,
    comments: Array.isArray(comments) ? comments : comments.comments ?? comments.feed?.comments,
    commentReplies: Array.isArray(comments) ? undefined : comments.commentReplies ?? comments.feed?.commentReplies
  });

  return parseGeneratedPayload(combinedRaw, conceptId, communityContext, options);
}

async function requestLessonPostSurface(
  state: AppState,
  conceptId: string,
  communityContext: ReturnType<typeof buildCommunityContext>,
  attempt: number,
  options: typeof strictGenerationOptions | typeof llmOnlyGenerationOptions,
  client: typeof requestGeneratedContent
): Promise<Record<string, any> | null> {
  const lessonPostPrompt = buildLessonPostPrompt({ state, conceptId });
  if (attempt > 0) {
    lessonPostPrompt.messages.push({
      role: "user",
      content: buildRetryFeedback(attempt)
    });
  }
  const lessonPostRaw = await client(lessonPostPrompt);
  const legacyFullPayload = parseGeneratedPayload(lessonPostRaw, conceptId, communityContext, options);
  if (legacyFullPayload) return legacyFullPayload as unknown as Record<string, any>;

  const lessonPost = parseObject(lessonPostRaw);
  if (lessonPost && hasModelGeneratedComments(lessonPost)) return null;
  if (!hasGeneratedLessonPost(lessonPost)) return null;

  const partialSurface = {
    lesson: lessonPost.lesson,
    post: lessonPost.post ?? lessonPost.feed?.post
  };
  if (hasGeneratedShadowDraft(lessonPost)) {
    return {
      ...partialSurface,
      shadowDraft: readGeneratedShadowDraft(lessonPost)
    };
  }

  return partialSurface;
}

function parseJsonValue(raw: string): any | null {
  try {
    return JSON.parse(extractFirstJsonObject(raw));
  } catch {
    return null;
  }
}

function parseObject(raw: string): Record<string, any> | null {
  const parsed = parseJsonValue(raw);
  return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
}

function hasGeneratedLessonPost(value: Record<string, any> | null): value is Record<string, any> {
  if (!value) return false;
  return Boolean(value.lesson && (value.post ?? value.feed?.post));
}

function hasGeneratedShadowDraft(value: Record<string, any> | null): boolean {
  return Boolean(readGeneratedShadowDraft(value));
}

function readGeneratedShadowDraft(value: Record<string, any> | null) {
  if (!value) return null;
  return value.shadowDraft ?? value.shadow ?? value.draft ?? value.aiShadowDraft ?? (isShadowDraftObject(value) ? value : null);
}

function isShadowDraftObject(value: Record<string, any>) {
  return typeof value.body === "string" && (value.status === "draft" || typeof value.confidence !== "undefined");
}

function hasModelGeneratedComments(value: Record<string, any>): boolean {
  return Array.isArray(value.comments ?? value.feed?.comments);
}

function buildRetryFeedback(attempt: number): string {
  const base =
    "上一次输出没有通过 KnowFeed 的表达层校验：可能没有足够的内部 stance 多样性、社区 agent 少于 8 个、model-generated 社区回复数量不是 exactly 3、reply relation 没有覆盖 追问/补充/反驳、主评论缺少学习信号、评论/回复以“赞成：”“追问：”这类标签开头、主评论被写成提问清单、displayName 还是角色/立场/职业标签、微课/主帖/学习分身缺少 topic、concept 或 learnerProfile 锚点、web research 场景下没有让 lesson/post/shadowDraft 各自接住 researchBrief 的 keyIdeas/source summary 资料锚点、没有给出具体学习动作、没有遵守 learnerProfile.avoidedStyles、写了 researchBrief 没有支撑的精确年份/百分比/机构/报告/公司案例、输出了 YYYY-MM-DD/timestamp、post/comment/reply author 或 shadowDraft 依赖本地补齐、JSON 结构不完整、包含高风险确定性建议，或写入了不允许的状态字段。请重新返回完整 JSON，顶层字段顺序必须是 lesson、post、shadowDraft、comments；先输出 shadowDraft.body，再输出 comments；JSON 对象结束后立刻停止。lesson、post、shadowDraft 都必须显式贴合当前 topic、concept 或 learnerProfile，并包含具体学习动作；如果 researchBrief.source 是 web，三者还必须各自自然复用一个来自 researchBrief.keyIdeas、disputedIdeas、beginnerPitfalls 或 source summary 的具体资料锚点。post.author、每条 comment.author、每条 reply.author 和 shadowDraft.body 必须由你直接生成，不能省略后交给本地默认值补齐。comments 需要 exactly 8 条，8 个不同 author；先写真实社区评论，再给每条 comment 选择最接近的内部 stance 字符串：赞成、反对、补充、挑刺；stance 和 relation 只放在 JSON 字段，comment.body 和 reply.body 不要以这些标签开头。社区角色由你根据当前 topic、concept、researchBrief 和 learnerProfile 自己设计，不要套固定角色清单；displayName 要像真实社区昵称、网名或临时 ID，topic/concept 锚点可以由 handle、role、正文承担。comments 内嵌 replies 或顶层 commentReplies 必须正好 3 条，全部由你生成，reply author 必须不同于 parent comment author，relation 必须覆盖：追问、补充、反驳。每条主评论必须包含至少一个学习信号，例如证据、史料、数据、边界、误解、判断、分清、对比、查证、比如、例如；问题只能嵌在具体反应、证据、边界或行动建议里，不能把一条主评论只写成提问。如果不确定某个精确数字、年份、百分比、公司、机构或报告是否被 researchBrief 明确支持，就不要写成事实；改写成待查证问题、趋势判断或类比例子。医疗、法律、金融等高风险主题只能给学习框架、查证动作和风险边界，不能输出确诊、用药、买卖、贷款、投资、诉讼或合规的确定性行动建议。不要输出 lessonId、progress、mastery 或 pathOrder。";

  if (attempt < generationAttempts - 1) return base;

  return [
    base,
    "这是最后一次重试，请优先保证结构和可校验性，少写花活，确保表达层能直接渲染。",
    "顶层必须只有 lesson、post、shadowDraft、comments，且 shadowDraft 必须在 comments 前面。",
    "comments 需要 exactly 8 条；每条评论必须有新的社区 agent 和新的知识位置。",
    "所有 comment.stance 只能从 赞成、反对、补充、挑刺 里选，但这是内部分类；先写真实评论，再选最接近的分类。",
    "只生成 3 条 replies，不能少于或多于 3 条；全部由你生成；relation 分别覆盖 追问、补充、反驳；reply author 必须不同于 parent comment author。",
    "所有 author.displayName、handle、role 都要贴合当前 topic/concept/learnerProfile，不能使用占位名、AI 角色或通用 stance 标签。",
    "不要输出 YYYY-MM-DD、ISO timestamp、四位年份或任何 researchBrief 没有逐字支持的精确数字；改写成待查证问题、趋势判断、类比例子或相对时期。"
  ].join("\n");
}

export function selectRenderableBundle(
  state: AppState,
  activeConceptId: string,
  bundle: GeneratedKnowledgeBundle
): GeneratedKnowledgeBundle {
  if (bundle.conceptId === activeConceptId) return bundle;
  return buildFallbackBundle(state, activeConceptId);
}
