import { getActiveCurriculum } from "./learningEngine";
import { extractFirstJsonObject } from "./jsonObject";
import type {
  AppState,
  FeedComment,
  FeedCommentReply,
  FeedPost,
  GeneratedKnowledgeBundle,
  GeneratedLesson,
  ResearchBrief,
  ShadowDraft
} from "./types";

export interface CommunityContext {
  topicTitle: string;
  learnerBackground: string;
  learnerGoal: string;
  avoidedStyles?: string[];
  conceptTitle: string;
  conceptPlainName: string;
  researchSource?: ResearchBrief["source"];
  researchAnchors?: string[];
}

export { buildGenerationPrompt } from "./generationPrompt";
export type { GenerateKnowledgeRequest, LlmMessage, LlmProxyRequest, LlmProxyResponse } from "./generationPrompt";

export type GeneratedKnowledgePayload = Omit<GeneratedKnowledgeBundle, "source" | "conceptId" | "generatedAt">;

export interface ParseGeneratedPayloadOptions {
  minCommentAuthors?: number;
  rejectRepairedComments?: boolean;
  rejectRepairedReplies?: boolean;
  rejectLowReplyRelationCoverage?: boolean;
  rejectLowCommentLearningSignals?: boolean;
  rejectLowCommunityAuthorQuality?: boolean;
  rejectLowGeneratedContentAnchoring?: boolean;
  rejectLocalScaffoldedContent?: boolean;
  rejectAvoidedStyles?: boolean;
  rejectScriptedCommunityVoice?: boolean;
  rejectUnsupportedPreciseClaims?: boolean;
}

export interface GeneratedPayloadDiagnostics {
  accepted: boolean;
  issues: string[];
}

export function buildCommunityContext(state: AppState, conceptId: string): CommunityContext {
  const curriculum = getActiveCurriculum(state);
  const concept = curriculum.concepts.find((item) => item.id === conceptId) ?? curriculum.concepts[0];
  const researchBrief = curriculum.researchBrief ?? state.researchBrief;
  return {
    topicTitle: curriculum.topic.title,
    learnerBackground: curriculum.learner.background,
    learnerGoal: curriculum.topic.userRawGoal,
    avoidedStyles: curriculum.learner.avoidedStyles,
    conceptTitle: concept.title,
    conceptPlainName: concept.plainName,
    researchSource: researchBrief?.source,
    researchAnchors: researchBrief ? buildResearchAnchorTerms(researchBrief) : []
  };
}

export function parseGeneratedPayload(
  raw: string,
  conceptId: string,
  communityContext?: CommunityContext,
  options: ParseGeneratedPayloadOptions = {}
): GeneratedKnowledgePayload | null {
  return evaluateGeneratedPayload(raw, conceptId, communityContext, options).payload;
}

export function diagnoseGeneratedPayload(
  raw: string,
  conceptId: string,
  communityContext?: CommunityContext,
  options: ParseGeneratedPayloadOptions = {}
): GeneratedPayloadDiagnostics {
  const evaluation = evaluateGeneratedPayload(raw, conceptId, communityContext, options);
  return {
    accepted: Boolean(evaluation.payload),
    issues: evaluation.issues
  };
}

function evaluateGeneratedPayload(
  raw: string,
  conceptId: string,
  communityContext?: CommunityContext,
  options: ParseGeneratedPayloadOptions = {}
): { payload: GeneratedKnowledgePayload | null; issues: string[] } {
  const issues: string[] = [];
  try {
    const parsed = JSON.parse(extractFirstJsonObject(raw)) as Partial<GeneratedKnowledgePayload> & {
      feed?: Partial<GeneratedKnowledgePayload> & { commentReplies?: unknown };
      commentReplies?: unknown;
      shadow?: unknown;
      draft?: unknown;
      aiShadowDraft?: unknown;
    };
    const rawPost = parsed.post ?? parsed.feed?.post;
    const rawComments = parsed.comments ?? parsed.feed?.comments;
    const rawCommentReplies = parsed.commentReplies ?? parsed.feed?.commentReplies;
    const rawShadow = parsed.shadowDraft ?? parsed.shadow ?? parsed.draft ?? parsed.aiShadowDraft;
    if (
      options.rejectLocalScaffoldedContent &&
      hasLocalScaffoldDependency(rawPost, rawComments, rawCommentReplies, rawShadow, communityContext)
    ) {
      issues.push(`local scaffold dependency: ${localScaffoldDependencyIssues(rawPost, rawComments, rawCommentReplies, rawShadow, communityContext).join(", ")}`);
      return { payload: null, issues };
    }
    if (!isGeneratedLesson(parsed.lesson)) {
      issues.push("invalid lesson");
      return { payload: null, issues };
    }
    if (
      options.rejectLowCommunityAuthorQuality &&
      hasRawLowCommunityAuthorQuality(rawPost, rawComments, rawCommentReplies, communityContext)
    ) {
      issues.push("low community author quality");
      return { payload: null, issues };
    }
    const post = normalizePost(rawPost, conceptId, communityContext);
    if (!post) {
      issues.push("invalid post");
      return { payload: null, issues };
    }
    const comments = normalizeComments(
      rawComments,
      rawCommentReplies,
      parsed.lesson,
      post,
      conceptId,
      communityContext
    );
    if (comments.length < 3) {
      issues.push(`too few comments: ${comments.length}`);
      return { payload: null, issues };
    }
    if (options.minCommentAuthors && countDistinctCommentAuthors(comments) < options.minCommentAuthors) {
      issues.push(`too few distinct comment authors: ${countDistinctCommentAuthors(comments)}/${options.minCommentAuthors}`);
      return { payload: null, issues };
    }
    if (options.rejectRepairedComments && countRepairComments(comments) > 0) {
      issues.push(`repair comments: ${countRepairComments(comments)}`);
      return { payload: null, issues };
    }
    if (options.rejectRepairedReplies && countRepairReplies(comments) > 0) {
      issues.push(`repair replies: ${countRepairReplies(comments)}`);
      return { payload: null, issues };
    }
    if (options.rejectLowReplyRelationCoverage && hasLowReplyRelationCoverage(comments)) {
      issues.push("low reply relation coverage");
      return { payload: null, issues };
    }
    if (options.rejectLowCommentLearningSignals && hasLowCommentLearningSignals(comments)) {
      issues.push("low comment learning signals");
      return { payload: null, issues };
    }
    if (options.rejectScriptedCommunityVoice && hasScriptedCommunityVoice(comments)) {
      issues.push("scripted community voice");
      return { payload: null, issues };
    }
    if (options.rejectLowCommunityAuthorQuality && hasLowCommunityAuthorQuality(post, comments, communityContext)) {
      issues.push("low community author quality");
      return { payload: null, issues };
    }
    const shadowDraft = normalizeShadowDraft(rawShadow, conceptId, buildShadowFallback(parsed.lesson, post));
    if (!shadowDraft) {
      issues.push("invalid shadow draft");
      return { payload: null, issues };
    }
    if (
      options.rejectLowGeneratedContentAnchoring &&
      hasLowGeneratedContentAnchoring(parsed.lesson, post, shadowDraft, communityContext)
    ) {
      issues.push(
        `low generated content anchoring: ${generatedContentAnchoringIssues(parsed.lesson, post, shadowDraft, communityContext).join(", ")}`
      );
      return { payload: null, issues };
    }
    if (options.rejectAvoidedStyles && hasAvoidedStyleEcho(parsed.lesson, post, comments, shadowDraft, communityContext)) {
      issues.push("avoided style echo");
      return { payload: null, issues };
    }
    if (
      options.rejectUnsupportedPreciseClaims &&
      hasUnsupportedPreciseClaims(parsed.lesson, post, comments, shadowDraft, communityContext)
    ) {
      issues.push(
        `unsupported precise claims: ${unsupportedPreciseClaimMarkersFor(parsed.lesson, post, comments, shadowDraft, communityContext).join(", ")}`
      );
      return { payload: null, issues };
    }
    return {
      payload: {
        lesson: parsed.lesson,
        post,
        comments,
        shadowDraft
      },
      issues
    };
  } catch (error) {
    return { payload: null, issues: [`invalid JSON: ${String(error instanceof Error ? error.message : error)}`] };
  }
}

function countDistinctCommentAuthors(comments: FeedComment[]): number {
  return new Set(comments.map((comment) => comment.author.displayName.trim())).size;
}

function countRepairComments(comments: FeedComment[]): number {
  return comments.filter(isRepairLikeComment).length;
}

function isRepairLikeComment(comment: FeedComment): boolean {
  return /(^comment-.*-repair-)|(^repair-)|赞成先学这个点|反对把结论说满|补充一个上下文|最容易偷换/.test(
    `${comment.id} ${comment.author.id} ${comment.body}`
  );
}

function countRepairReplies(comments: FeedComment[]): number {
  return comments.reduce(
    (sum, comment) => sum + (comment.replies ?? []).filter(isRepairLikeReply).length,
    0
  );
}

function isRepairLikeReply(reply: FeedCommentReply): boolean {
  return reply.source === "repair" || /-repair-|本地修复|万能解释/.test(`${reply.id} ${reply.body}`);
}

function hasLowReplyRelationCoverage(comments: FeedComment[]): boolean {
  const modelReplies = comments.flatMap((comment) => (comment.replies ?? []).filter((reply) => reply.source !== "repair"));
  const relationKinds = new Set(modelReplies.map((reply) => reply.relation));
  return modelReplies.length !== 3 || (["追问", "补充", "反驳"] as const).some((relation) => !relationKinds.has(relation));
}

function hasLowCommentLearningSignals(comments: FeedComment[]): boolean {
  const lowSignalComments = comments.filter((comment) => nonQuestionLearningSignalKindsFor(stripAdapterContextSentence(comment.body)).length === 0);
  return lowSignalComments.length > 1;
}

function hasScriptedCommunityVoice(comments: FeedComment[]): boolean {
  const visibleBodies = comments.flatMap((comment) => [
    stripAdapterContextSentence(comment.body),
    ...(comment.replies ?? []).map((reply) => stripAdapterContextSentence(reply.body))
  ]);
  if (visibleBodies.some(hasScriptedRelationPrefix)) return true;

  const questionSlotComments = comments.filter((comment) => isQuestionSlotBody(stripAdapterContextSentence(comment.body)));
  return questionSlotComments.length > Math.max(1, Math.floor(comments.length / 4));
}

function hasLowCommunityAuthorQuality(
  post: FeedPost,
  comments: FeedComment[],
  communityContext?: CommunityContext
): boolean {
  if (!communityContext) return false;
  const authors = [
    post.author,
    ...comments.map((comment) => comment.author),
    ...comments.flatMap((comment) => (comment.replies ?? []).map((reply) => reply.author))
  ];
  return authors.some((author) => isGenericUnanchoredCommunityAuthor(author, communityContext));
}

function hasRawLowCommunityAuthorQuality(
  postValue: unknown,
  commentsValue: unknown,
  topLevelReplies: unknown,
  communityContext?: CommunityContext
): boolean {
  if (!communityContext) return false;
  const rawAuthors: unknown[] = [];
  rawAuthors.push(rawAuthorCandidate(postValue));

  if (Array.isArray(commentsValue)) {
    for (const comment of commentsValue) {
      rawAuthors.push(rawAuthorCandidate(comment));
      const replies = (comment as { replies?: unknown }).replies;
      if (Array.isArray(replies)) {
        replies.forEach((reply) => rawAuthors.push(rawAuthorCandidate(reply)));
      }
    }
  }

  if (Array.isArray(topLevelReplies)) {
    topLevelReplies.forEach((reply) => rawAuthors.push(rawAuthorCandidate(reply)));
  }

  return rawAuthors.some((author) => isRawLowCommunityAuthor(author, communityContext));
}

function isRawLowCommunityAuthor(author: unknown, communityContext: CommunityContext): boolean {
  if (!author || typeof author !== "object" || Array.isArray(author)) return false;
  const displayName = (author as { displayName?: unknown }).displayName;
  const handle = (author as { handle?: unknown }).handle;
  const role = (author as { role?: unknown }).role;
  if (typeof displayName !== "string") return false;
  if (isFormulaicRoleDisplayName(displayName, communityContext)) return true;
  const authorText = [
    displayName,
    typeof handle === "string" ? handle : "",
    typeof role === "string" ? role : ""
  ].join(" ");
  return isGenericCommunityAuthorText(authorText) && !hasCommunityContextAnchor(authorText, communityContext);
}

function hasLowGeneratedContentAnchoring(
  lesson: GeneratedLesson,
  post: FeedPost,
  shadowDraft: ShadowDraft,
  communityContext?: CommunityContext
): boolean {
  return generatedContentAnchoringIssues(lesson, post, shadowDraft, communityContext).length > 0;
}

function generatedContentAnchoringIssues(
  lesson: GeneratedLesson,
  post: FeedPost,
  shadowDraft: ShadowDraft,
  communityContext?: CommunityContext
): string[] {
  if (!communityContext) return [];
  const lessonText = [
    lesson.title,
    lesson.hook,
    lesson.explanation,
    lesson.analogy,
    lesson.recallPrompt,
    lesson.completionFeedback
  ].join(" ");
  const postText = [post.body, post.hook, post.learnCta].join(" ");
  return [
    ...contentAnchoringIssuesFor("lesson", lessonText, communityContext),
    ...contentAnchoringIssuesFor("post", postText, communityContext),
    ...contentAnchoringIssuesFor("shadowDraft", shadowDraft.body, communityContext)
  ];
}

function hasAvoidedStyleEcho(
  lesson: GeneratedLesson,
  post: FeedPost,
  comments: FeedComment[],
  shadowDraft: ShadowDraft,
  communityContext?: CommunityContext
): boolean {
  const avoidedTerms = avoidedStyleTerms(communityContext?.avoidedStyles);
  if (!avoidedTerms.length) return false;
  const text = [
    lesson.title,
    lesson.hook,
    lesson.explanation,
    lesson.analogy,
    lesson.recallPrompt,
    lesson.completionFeedback,
    post.body,
    post.hook,
    post.learnCta,
    ...comments.flatMap((comment) => [
      comment.body,
      ...(comment.replies ?? []).map((reply) => reply.body)
    ]),
    shadowDraft.body
  ].join("\n");
  return containsAnyAnchor(text, avoidedTerms);
}

function hasUnsupportedPreciseClaims(
  lesson: GeneratedLesson,
  post: FeedPost,
  comments: FeedComment[],
  shadowDraft: ShadowDraft,
  communityContext?: CommunityContext
): boolean {
  return unsupportedPreciseClaimMarkersFor(lesson, post, comments, shadowDraft, communityContext).length > 0;
}

function unsupportedPreciseClaimMarkersFor(
  lesson: GeneratedLesson,
  post: FeedPost,
  comments: FeedComment[],
  shadowDraft: ShadowDraft,
  communityContext?: CommunityContext
): string[] {
  const supportText = preciseClaimSupportText(communityContext);
  const generatedText = [
    lesson.title,
    lesson.hook,
    lesson.explanation,
    lesson.analogy,
    lesson.recallPrompt,
    lesson.completionFeedback,
    post.body,
    post.hook,
    post.learnCta,
    ...comments.flatMap((comment) => [
      comment.body,
      ...(comment.replies ?? []).flatMap((reply) => [
        reply.body,
        reply.quote ?? ""
      ])
    ]),
    shadowDraft.body
  ].join("\n");
  return preciseClaimMarkers(generatedText).filter((marker) => !isSupportedPreciseClaimMarker(marker, supportText));
}

function preciseClaimSupportText(communityContext?: CommunityContext): string {
  if (!communityContext) return "";
  return [
    communityContext.topicTitle,
    communityContext.learnerBackground,
    communityContext.learnerGoal,
    communityContext.conceptTitle,
    communityContext.conceptPlainName,
    ...(communityContext.researchAnchors ?? [])
  ].join("\n");
}

function preciseClaimMarkers(text: string): string[] {
  const patterns = [
    /(?:公元前?\s*)?(?:1[0-9]{3}|20[0-9]{2})\s*年?/gu,
    /\d+(?:\.\d+)?\s*%/gu,
    /百分之[一二三四五六七八九十百千万零〇\d.]+/gu,
    /《[^》]{2,40}(?:报告|白皮书|调查|指数|标准|指南)[^》]*》/gu,
    /[\u3400-\u9fffA-Za-z0-9]{2,30}(?:报告|白皮书|指数)(?:显示|指出|认为|称|发布)?/gu,
    /\b[A-Z][A-Za-z0-9&.' -]{1,50}(?:Report|Survey|Study|Index|White Paper)\b/gu,
    /(?:[A-Z][A-Za-z0-9&.-]{2,}(?:\s+[A-Z][A-Za-z0-9&.-]{2,}){0,3}|[\u3400-\u9fff]{2,16})(?:公司|大学|学院|研究院|协会|委员会|基金会|实验室|医院|银行|交易所|博物馆|美术馆)/gu
  ];
  const markers = patterns.flatMap((pattern) => Array.from(text.matchAll(pattern), (match) => match[0].trim()));
  return [...new Set(markers.filter((marker) => marker && !isGenericPreciseClaimMarker(marker)))];
}

function isSupportedPreciseClaimMarker(marker: string, supportText: string): boolean {
  const normalizedSupport = normalizePreciseClaimText(supportText);
  if (!normalizedSupport) return false;
  return preciseClaimMarkerVariants(marker).some((variant) => normalizedSupport.includes(variant));
}

function preciseClaimMarkerVariants(marker: string): string[] {
  const compact = normalizePreciseClaimText(marker);
  const variants = [
    compact,
    compact.replace(/^公元/u, ""),
    compact.replace(/年$/u, ""),
    compact.replace(/%$/u, ""),
    compact.replace(/^《|》$/gu, "")
  ];
  const percent = compact.match(/^(\d+(?:\.\d+)?)%$/u)?.[1];
  if (percent) variants.push(percent);
  return [...new Set(variants.filter((variant) => variant.length >= 2))];
}

function normalizePreciseClaimText(value: string): string {
  return value
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/[，。,；;：:、"'“”‘’（）()[\]{}]/g, "")
    .trim();
}

function isGenericPreciseClaimMarker(marker: string): boolean {
  const compact = normalizePreciseClaimText(marker);
  if (/^(某|一家|一些|许多|很多|大型|小型|本地|普通|真实|当前|相关)/u.test(compact)) return true;
  if (/^(应该|需要|可以|先看|查证|查看|回到|提示|提到|使用|引用|比如|例如)/u.test(compact) && /(报告|白皮书|指数)/u.test(compact)) {
    return true;
  }
  if (/^(ai|人工智能|金融科技|心理学|教育|建筑|音乐|历史|电商|摄影|气候|政策|科技|互联网)?(公司|大学|学院|研究院|协会|委员会|基金会|实验室|医院|银行|交易所|博物馆|美术馆)$/iu.test(compact)) {
    return true;
  }
  return /^(研究机构|监管机构|教育机构|金融机构|医疗机构|政府机构|学校|平台|机构)$/u.test(compact);
}

function avoidedStyleTerms(avoidedStyles: string[] | undefined): string[] {
  if (!avoidedStyles?.length) return [];
  const terms = avoidedStyles.flatMap((style) => {
    const trimmed = style.trim();
    if (!trimmed) return [];
    const normalized = trimmed.replace(/^(太|过于|过度)/u, "").trim();
    return [trimmed, ...styleMarkerTerms(normalized)];
  });
  return [...new Set(terms.filter((term) => term.length >= 3))];
}

function styleMarkerTerms(style: string): string[] {
  if (/数学/u.test(style)) return ["公式推导", "数学证明", "矩阵推导"];
  if (/技术/u.test(style)) return ["代码细节", "底层实现", "算法推导", "技术细节"];
  if (/学术/u.test(style)) return ["论文式", "学术定义", "文献综述"];
  if (/鸡汤/u.test(style)) return ["相信自己", "坚持就是胜利", "成长型思维"];
  return [];
}

function lacksContentAnchorOrLearningSignal(text: string, communityContext: CommunityContext): boolean {
  return contentAnchoringIssuesFor("content", text, communityContext).length > 0;
}

function contentAnchoringIssuesFor(label: string, text: string, communityContext: CommunityContext): string[] {
  const issues: string[] = [];
  const anchors = contextAnchors(communityContext);
  const hasAnchor = anchors.some((anchor) => text.includes(anchor));
  const learnerVisibleText = stripAdapterContextSentence(text);
  const hasLearningSignal = learningSignalKindsFor(learnerVisibleText).length > 0;
  const hasConcreteLearnerAction = concreteLearnerActionKindsFor(learnerVisibleText).length > 0;
  const researchAnchors = communityContext.researchAnchors ?? [];
  const mustUseResearch = communityContext.researchSource === "web" && researchAnchors.length > 0;
  const hasResearchAnchor = !mustUseResearch || containsAnyAnchor(text, researchAnchors);
  if (!hasAnchor) issues.push(`${label} missing topic/concept/learner anchor`);
  if (!hasLearningSignal) issues.push(`${label} missing learning signal`);
  if (!hasConcreteLearnerAction) issues.push(`${label} missing concrete learner action`);
  if (!hasResearchAnchor) issues.push(`${label} missing research anchor`);
  return issues;
}

function containsAnyAnchor(text: string, anchors: string[]): boolean {
  const haystack = text.toLowerCase();
  return anchors.some((anchor) => haystack.includes(anchor.toLowerCase()));
}

function isGenericUnanchoredCommunityAuthor(author: FeedPost["author"], communityContext: CommunityContext): boolean {
  if (isFormulaicRoleDisplayName(author.displayName, communityContext)) return true;
  const authorText = `${author.displayName} ${author.handle} ${author.role}`;
  const anchored = authorContextAnchors(communityContext).some((anchor) => authorText.includes(anchor));
  if (anchored) return false;
  return isGenericCommunityAuthorText(authorText);
}

function authorContextAnchors(communityContext: CommunityContext): string[] {
  const shortButSpecific = new Set([
    "建筑",
    "建筑史",
    "老建筑",
    "历史建筑",
    "城市更新",
    "老城",
    "老城区",
    "外滩",
    "开埠",
    "租界",
    "洋行",
    "银行",
    "仓库",
    "公寓",
    "里弄",
    "石库门",
    "电商",
    "视觉",
    "商品图",
    "通勤",
    "乐理",
    "作品",
    "演奏",
    "史料",
    "影视",
    "政策",
    "钱包",
    "链上",
    "课堂",
    "课程",
    "教学",
    "产品"
  ]);
  const researchAuthorAnchors = (communityContext.researchAnchors ?? [])
    .flatMap((anchor) => [
      anchor,
      ...deriveShortCommunityAnchors(anchor)
    ])
    .filter((anchor) => anchor.length >= 3 && anchor.length <= 12 && !isGenericResearchAnchor(anchor));
  const contextText = [
    communityContext.topicTitle,
    communityContext.learnerBackground,
    communityContext.learnerGoal,
    communityContext.conceptTitle,
    communityContext.conceptPlainName,
    ...(communityContext.researchAnchors ?? [])
  ].join(" ");
  const contextualShortAnchors = [...shortButSpecific].filter((anchor) => contextText.includes(anchor));
  return [...new Set([...contextAnchors(communityContext), ...researchAuthorAnchors, ...contextualShortAnchors])].filter(
    (anchor) => anchor.length >= 3 || shortButSpecific.has(anchor)
  );
}

function isGenericCommunityAuthorText(value: string): boolean {
  return /AI\s*(号|热评员|生成角色)|建设派用户|风险派用户|资料补充员|逻辑挑刺员|乐观实践者|反方观察者|科普者|怀疑者|边界提醒者|建设者|实践者|支持者|反对者|补充者|挑刺者|资料党|概念警察|方法论挑刺者/.test(
    value
  );
}

function hasLocalScaffoldDependency(
  postValue: unknown,
  commentsValue: unknown,
  topLevelReplies: unknown,
  shadowValue: unknown,
  communityContext?: CommunityContext
): boolean {
  return localScaffoldDependencyIssues(postValue, commentsValue, topLevelReplies, shadowValue, communityContext).length > 0;
}

function localScaffoldDependencyIssues(
  postValue: unknown,
  commentsValue: unknown,
  topLevelReplies: unknown,
  shadowValue: unknown,
  communityContext?: CommunityContext
): string[] {
  const issues: string[] = [];
  if (!hasModelOwnedAuthor(postValue, communityContext)) issues.push("post author missing or unanchored");
  if (!hasModelOwnedShadowBody(shadowValue)) issues.push("shadow body missing");
  if (!Array.isArray(commentsValue)) return [...issues, "comments missing"];

  commentsValue.forEach((comment, index) => {
    if (!hasModelOwnedAuthor(comment, communityContext)) issues.push(`comment ${index + 1} author missing or unanchored`);
  });

  const replyScan = collectRawReplyPairs(commentsValue, topLevelReplies);
  if (replyScan.hasMissingParent) issues.push("reply parent missing");
  if (replyScan.pairs.length !== 3) issues.push(`reply count ${replyScan.pairs.length}/3`);

  replyScan.pairs.forEach(({ parent, reply }, index) => {
    if (!hasModelOwnedAuthor(reply, communityContext)) issues.push(`reply ${index + 1} author missing or unanchored`);
    const parentAuthorName = rawAuthorDisplayName((parent as { author?: unknown }).author);
    const replyAuthorName = rawAuthorDisplayName((reply as { author?: unknown }).author);
    if (parentAuthorName && replyAuthorName && sameDisplayName(parentAuthorName, replyAuthorName)) {
      issues.push(`reply ${index + 1} repeats parent author`);
    }
  });

  return issues;
}

function hasModelOwnedAuthor(value: unknown, communityContext?: CommunityContext): boolean {
  const author = rawAuthorCandidate(value);
  if (!author || typeof author !== "object" || Array.isArray(author)) return false;
  const modelAuthor = author as { displayName?: unknown; handle?: unknown; role?: unknown };
  if (typeof modelAuthor.displayName !== "string" || typeof modelAuthor.role !== "string") return false;
  const displayName = modelAuthor.displayName.trim();
  const role = modelAuthor.role.trim();
  const handle = typeof modelAuthor.handle === "string" ? modelAuthor.handle.trim() : "";
  if (!displayName || !role) return false;
  if (isPlaceholderAuthorName(displayName) || isPlaceholderAuthorRole(role)) return false;
  if (handle && isPlaceholderAuthorHandle(handle)) return false;
  if (communityContext && isFormulaicRoleDisplayName(displayName, communityContext)) return false;

  const authorText = `${displayName} ${handle} ${role}`;
  if (isBareGenericDisplayName(displayName) && (!communityContext || !hasCommunityContextAnchor(authorText, communityContext))) {
    return false;
  }
  return !isGenericCommunityAuthorText(authorText) || Boolean(communityContext && hasCommunityContextAnchor(authorText, communityContext));
}

function hasModelOwnedShadowBody(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const draft = value as { body?: unknown; text?: unknown; content?: unknown };
  const body = draft.body ?? draft.text ?? normalizeShadowContent(draft.content);
  return typeof body === "string" && body.trim().length > 0;
}

function collectRawReplyPairs(
  comments: unknown[],
  topLevelReplies: unknown
): { pairs: { parent: unknown; reply: unknown }[]; hasMissingParent: boolean } {
  const pairs: { parent: unknown; reply: unknown }[] = [];
  let hasMissingParent = false;

  for (const comment of comments) {
    const replies = (comment as { replies?: unknown }).replies;
    if (!Array.isArray(replies)) continue;
    for (const reply of replies) {
      pairs.push({ parent: comment, reply });
    }
  }

  if (Array.isArray(topLevelReplies)) {
    for (const reply of topLevelReplies) {
      const parent = findRawReplyParent(comments, reply);
      if (!parent) {
        hasMissingParent = true;
        continue;
      }
      pairs.push({ parent, reply });
    }
  }

  return { pairs, hasMissingParent };
}

function findRawReplyParent(comments: unknown[], value: unknown): unknown | undefined {
  const reply = value as {
    replyToCommentId?: unknown;
    commentId?: unknown;
    parentId?: unknown;
    targetCommentId?: unknown;
    commentIndex?: unknown;
  };
  const targetId = [reply?.replyToCommentId, reply?.commentId, reply?.parentId, reply?.targetCommentId].find(
    (item): item is string => typeof item === "string"
  );
  if (targetId) {
    const byId = comments.find((comment) => (comment as { id?: unknown }).id === targetId);
    if (byId) return byId;
  }
  if (typeof reply?.commentIndex === "number" && Number.isInteger(reply.commentIndex)) {
    return comments[Math.max(0, Math.min(comments.length - 1, reply.commentIndex))];
  }
  return undefined;
}

function rawAuthorDisplayName(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const displayName = (value as { displayName?: unknown }).displayName;
  return typeof displayName === "string" && displayName.trim() ? displayName : null;
}

function rawAuthorCandidate(value: unknown): unknown {
  const record = value as { author?: unknown; handle?: unknown; role?: unknown; stance?: unknown };
  if (
    record &&
    typeof record === "object" &&
    !Array.isArray(record) &&
    typeof record.author === "string" &&
    (typeof record.handle === "string" || typeof record.role === "string")
  ) {
    return {
      displayName: record.author,
      handle: record.handle,
      role: record.role,
      stance: record.stance
    };
  }
  return record?.author;
}

function stripAdapterContextSentence(body: string): string {
  return body
    .replace(/\s+从[^。]+视角看，[^。]+要结合[^。]+这些具体线索来判断。$/u, "")
    .replace(/\s+回到当前学习目标看，$/u, "")
    .trim();
}

function learningSignalKindsFor(body: string): string[] {
  const signals: string[] = [];
  if (/边界|风险|限制|误导|误解|不等于|不是|不能|不要|过度|过于|粗暴|错过|忽略|低估|副作用|以偏概全/.test(body)) {
    signals.push("boundary");
  }
  if (/证据|研究|数据|样本|方法|来源|史料|结构|查证|时间线|可验证|分期|年份|制度/.test(body)) {
    signals.push("evidence");
  }
  if (/比如|例如|像|案例|人物|影视|商品图|课堂|通勤|作品|演奏|用户|城市|政策|游戏/.test(body)) {
    signals.push("example");
  }
  if (/先|怎么|如何|判断|分清|区分|对比|比较|查证|看懂|问/.test(body)) {
    signals.push("learner-action");
  }
  if (/反对|反驳|但是|但|虽然|不过|然而|偷换|混在一起|归因|争议|前提|视角/.test(body)) {
    signals.push("counterpoint");
  }
  if (/？|\?|为什么|怎么|如何|追问/.test(body)) {
    signals.push("question");
  }
  return signals;
}

function nonQuestionLearningSignalKindsFor(body: string): string[] {
  return learningSignalKindsFor(body).filter((kind) => kind !== "question");
}

function hasScriptedRelationPrefix(body: string): boolean {
  return /^(赞成|反对|补充|挑刺|追问|反驳)\s*[：:]/u.test(body.trim());
}

function isQuestionSlotBody(body: string): boolean {
  const trimmed = body.trim();
  if (!trimmed) return false;
  const startsLikeQuestion = /^(为什么|怎么|如何|有没有|是不是|能不能|要不要|该不该|可不可以|是否|谁能|难道)/u.test(trimmed);
  const endsLikeQuestion = /[？?]\s*$/u.test(trimmed);
  if (!startsLikeQuestion && !endsLikeQuestion) return false;

  const nonQuestionSignals = nonQuestionLearningSignalKindsFor(trimmed);
  if (nonQuestionSignals.length >= 2) return false;

  const declarativeClauses = trimmed.split(/[。；;]/u).filter((part) => part.trim() && !/[？?]\s*$/u.test(part.trim()));
  return declarativeClauses.length === 0 || trimmed.length <= 70;
}

function concreteLearnerActionKindsFor(body: string): string[] {
  const actions: string[] = [];
  if (/(先|第一步|下次|看到|遇到|读到|听到|判断前).{0,18}(查证|追问|问|看|找|核对|确认|标出|回到|拆成)/u.test(body)) {
    actions.push("first-step");
  }
  if (/(分清|区分|拆成|分开|对比|比较).{0,18}(证据|来源|样本|方法|边界|场景|前提|经验|研究|观点|概念)/u.test(body)) {
    actions.push("separate-or-compare");
  }
  if (/(查证|核对|确认|追问|问).{0,18}(来源|样本|方法|证据|报告|研究|史料|数据|出处|引用)/u.test(body)) {
    actions.push("verify-source");
  }
  if (/(判断|决定|评估|看).{0,18}(能不能|是否|适不适合|可不可以|边界|适用|代表|解释)/u.test(body)) {
    actions.push("judge-applicability");
  }
  return actions;
}

function isGeneratedLesson(value: unknown): value is GeneratedLesson {
  const lesson = value as GeneratedLesson;
  if (
    !lesson ||
    typeof lesson.title !== "string" ||
    typeof lesson.hook !== "string" ||
    typeof lesson.explanation !== "string" ||
    typeof lesson.analogy !== "string" ||
    typeof lesson.recallPrompt !== "string" ||
    typeof lesson.completionFeedback !== "string"
  ) {
    return false;
  }
  return ![
    lesson.title,
    lesson.hook,
    lesson.explanation,
    lesson.analogy,
    lesson.recallPrompt,
    lesson.completionFeedback
  ].some(violatesGeneratedTextSafety);
}

function normalizePost(value: unknown, conceptId: string, communityContext?: CommunityContext): FeedPost | null {
  const post = value as Partial<FeedPost> & {
    content?: string;
    text?: string;
    engagement?: { likes?: number; replies?: number; retweets?: number };
  };
  const body = post?.body ?? post?.content ?? post?.text;
  if (!post || typeof body !== "string") return null;
  if (violatesGeneratedTextSafety(body)) return null;

  const engagementText = post.engagement
    ? `${post.engagement.replies ?? 40} 条讨论 · ${post.engagement.likes ?? 120} 人在围观`
    : "刚刚开始讨论";
  const hook = typeof post.hook === "string" ? post.hook : "点进来先学一个概念，再回来看评论区为什么吵。";
  const learnCta = typeof post.learnCta === "string" ? post.learnCta : "看懂这条讨论";
  if (violatesGeneratedTextSafety(hook) || violatesGeneratedTextSafety(learnCta)) return null;

  return {
    id: `post-${conceptId}`,
    conceptId,
    author: normalizeAuthor(rawAuthorCandidate(post), "ai-host", undefined, communityContext),
    body,
    hook,
    metricText: typeof post.metricText === "string" ? post.metricText : engagementText,
    learnCta,
    createdAtLabel: typeof post.createdAtLabel === "string" ? post.createdAtLabel : "刚刚"
  };
}

function normalizeComments(
  value: unknown,
  topLevelReplies: unknown,
  lesson: GeneratedLesson,
  post: FeedPost,
  conceptId: string,
  communityContext?: CommunityContext
): FeedComment[] {
  if (!Array.isArray(value)) return [];
  let hasUnsafeComment = false;
  const nestedRepliesByCommentId = new Map<string, unknown[]>();
  const comments = value
    .map((item, index) => {
      const comment = item as Partial<FeedComment> & {
        text?: string;
        content?: string;
        author?: unknown;
        replies?: unknown;
      };
      const body = comment?.body ?? comment?.text ?? comment?.content;
      if (!comment || typeof body !== "string") return null;
      if (violatesGeneratedTextSafety(body)) {
        hasUnsafeComment = true;
        return null;
      }
      const stance = normalizeCommentStance(comment.stance);
      const id = typeof comment.id === "string" ? comment.id : `comment-llm-${index + 1}`;
      if (Array.isArray(comment.replies)) {
        nestedRepliesByCommentId.set(id, comment.replies);
      }
      return {
        id,
        author: normalizeAuthor(rawAuthorCandidate(comment), `ai-comment-${index + 1}`, stance, communityContext),
        body,
        heat: typeof comment.heat === "number" ? comment.heat : 70 - index * 5,
        stance
      };
    })
    .filter((comment): comment is FeedComment => Boolean(comment));
  if (hasUnsafeComment) return [];
  const diverseComments = ensureCommentDiversity(comments, lesson, post, conceptId, communityContext);
  return attachCommentReplies(diverseComments, nestedRepliesByCommentId, topLevelReplies, communityContext);
}

function attachCommentReplies(
  comments: FeedComment[],
  nestedRepliesByCommentId: Map<string, unknown[]>,
  topLevelReplies: unknown,
  communityContext?: CommunityContext
): FeedComment[] {
  let totalReplies = 0;
  let hasUnsafeReply = false;
  const maxReplies = 6;
  const buckets = new Map<string, FeedCommentReply[]>();

  const addReply = (parent: FeedComment, value: unknown) => {
    if (totalReplies >= maxReplies) return;
    const current = buckets.get(parent.id) ?? [];
    if (current.length >= 2) return;
    const normalized = normalizeCommentReply(value, parent, current.length + 1, communityContext);
    if (normalized === "unsafe") {
      hasUnsafeReply = true;
      return;
    }
    if (!normalized) return;
    current.push(normalized);
    buckets.set(parent.id, current);
    totalReplies += 1;
  };

  for (const comment of comments) {
    for (const reply of nestedRepliesByCommentId.get(comment.id) ?? []) {
      addReply(comment, reply);
    }
  }

  if (Array.isArray(topLevelReplies)) {
    for (const reply of topLevelReplies) {
      const parent = findReplyParent(comments, reply);
      if (parent) addReply(parent, reply);
    }
  }

  if (hasUnsafeReply) return [];

  repairReplyCoverage(comments, buckets, addReply);

  return comments.map((comment) => {
    const replies = buckets.get(comment.id);
    return replies?.length ? { ...comment, replies } : comment;
  });
}

function repairReplyCoverage(
  comments: FeedComment[],
  buckets: Map<string, FeedCommentReply[]>,
  addReply: (parent: FeedComment, value: unknown) => void
) {
  const targetRelations: FeedCommentReply["relation"][] = ["追问", "补充", "反驳"];
  const usedRelations = () =>
    new Set(
      [...buckets.values()].flatMap((replies) => replies.map((reply) => reply.relation))
    );

  let currentRelations = usedRelations();
  while (totalReplyCount(buckets) < 3 || currentRelations.size < 3) {
    const relation = targetRelations.find((item) => !currentRelations.has(item)) ?? targetRelations[0];
    const parent = bestParentForRepair(comments, buckets, relation);
    if (!parent) break;
    addReply(parent, buildRepairReply(parent, relation, buckets.get(parent.id)?.length ?? 0));
    const nextRelations = usedRelations();
    if (nextRelations.size === currentRelations.size && totalReplyCount(buckets) >= 3) break;
    currentRelations = nextRelations;
  }
}

function totalReplyCount(buckets: Map<string, FeedCommentReply[]>): number {
  return [...buckets.values()].reduce((sum, replies) => sum + replies.length, 0);
}

function bestParentForRepair(
  comments: FeedComment[],
  buckets: Map<string, FeedCommentReply[]>,
  relation: FeedCommentReply["relation"]
): FeedComment | undefined {
  const preferredStances: Record<FeedCommentReply["relation"], FeedComment["stance"][]> = {
    追问: ["赞成", "补充", "反对", "挑刺"],
    补充: ["反对", "挑刺", "赞成", "补充"],
    反驳: ["赞成", "补充", "反对", "挑刺"]
  };
  return preferredStances[relation]
    .map((stance) => comments.find((comment) => comment.stance === stance && (buckets.get(comment.id)?.length ?? 0) < 2))
    .find((comment): comment is FeedComment => Boolean(comment));
}

function buildRepairReply(
  parent: FeedComment,
  relation: FeedCommentReply["relation"],
  existingCount: number
): {
  id: string;
  relation: FeedCommentReply["relation"];
  quote: string;
  body: string;
  author: { displayName: string; role: string };
  source: "repair";
} {
  const quote = parent.body.slice(0, 42);
  const bodyByRelation: Record<FeedCommentReply["relation"], string> = {
    追问: `我想多问一句：按你这个说法，新手下一步该看什么证据或例子？`,
    补充: `这个点可以再垫一层：把它和原帖的具体场景放在一起看，先分清适用边界再下结论。`,
    反驳: `我不太同意直接推到结论，至少要先说明它不适用的场景。`
  };
  return {
    id: `repair-reply-${parent.id}-${relation}-${existingCount + 1}`,
    relation,
    quote,
    body: bodyByRelation[relation],
    source: "repair",
    author: {
      displayName: "刚想接一句",
      role: `${parent.author.role}互动视角`
    }
  };
}

function normalizeCommentReply(
  value: unknown,
  parent: FeedComment,
  ordinal: number,
  communityContext?: CommunityContext
): FeedCommentReply | "unsafe" | null {
  const reply = value as Partial<FeedCommentReply> & {
    text?: string;
    content?: string;
    author?: unknown;
  };
  const body = reply?.body ?? reply?.text ?? reply?.content;
  if (!reply || typeof body !== "string") return null;
  if (violatesGeneratedTextSafety(body)) return "unsafe";
  const relation = normalizeReplyRelation(reply.relation);
  const fallbackId = `ai-reply-${parent.id}-${ordinal}`;
  const normalized: FeedCommentReply = {
    id: `reply-${parent.id}-${ordinal}`,
    author: normalizeReplyAuthor(rawAuthorCandidate(reply), fallbackId, relation, parent, communityContext),
    body,
    heat: typeof reply.heat === "number" ? reply.heat : Math.max(32, parent.heat - 8 - ordinal * 3),
    replyToCommentId: parent.id,
    relation,
    source: reply.source === "repair" ? "repair" : "llm",
    quote: typeof reply.quote === "string" && reply.quote.trim() ? reply.quote.trim().slice(0, 80) : undefined
  };
  return ensureReplyHasContext(normalized, communityContext);
}

function normalizeReplyAuthor(
  value: unknown,
  fallbackId: string,
  relation: FeedCommentReply["relation"],
  parent: FeedComment,
  communityContext?: CommunityContext
): FeedPost["author"] {
  const author = normalizeAuthor(value, fallbackId, replyRelationToStance(relation), communityContext);
  if (!sameDisplayName(author.displayName, parent.author.displayName)) return author;

  for (const stance of replyAuthorFallbackStances(relation)) {
    const fallback = fallbackAuthorFor(stance, communityContext);
    if (!sameDisplayName(fallback.displayName, parent.author.displayName)) {
      return {
        id: fallbackId,
        ...fallback
      };
    }
  }

  return {
    ...author,
    id: fallbackId,
    displayName: `${author.displayName}回应者`
  };
}

function replyAuthorFallbackStances(relation: FeedCommentReply["relation"]): FeedComment["stance"][] {
  if (relation === "反驳") return ["反对", "挑刺", "补充", "赞成"];
  if (relation === "追问") return ["挑刺", "补充", "反对", "赞成"];
  return ["补充", "挑刺", "反对", "赞成"];
}

function sameDisplayName(left: string, right: string): boolean {
  return left.trim().toLowerCase() === right.trim().toLowerCase();
}

function findReplyParent(comments: FeedComment[], value: unknown): FeedComment | undefined {
  const reply = value as {
    replyToCommentId?: unknown;
    commentId?: unknown;
    parentId?: unknown;
    targetCommentId?: unknown;
    commentIndex?: unknown;
  };
  const targetId = [reply?.replyToCommentId, reply?.commentId, reply?.parentId, reply?.targetCommentId].find(
    (item): item is string => typeof item === "string"
  );
  const byId = targetId ? comments.find((comment) => comment.id === targetId) : undefined;
  if (byId) return byId;
  if (typeof reply?.commentIndex === "number" && Number.isInteger(reply.commentIndex)) {
    return comments[Math.max(0, Math.min(comments.length - 1, reply.commentIndex))];
  }
  return undefined;
}

function normalizeReplyRelation(value: unknown): FeedCommentReply["relation"] {
  const relation = String(value).toLowerCase();
  if (["追问", "question", "ask", "probe", "clarify"].includes(relation)) return "追问";
  if (["反驳", "refute", "rebut", "challenge", "counter"].includes(relation)) return "反驳";
  return "补充";
}

function replyRelationToStance(relation: FeedCommentReply["relation"]): FeedComment["stance"] {
  if (relation === "反驳" || relation === "追问") return "挑刺";
  return "补充";
}

function ensureReplyHasContext(reply: FeedCommentReply, communityContext?: CommunityContext): FeedCommentReply {
  if (!communityContext) return reply;
  const anchors = contextAnchors(communityContext);
  const haystack = reply.body;
  if (anchors.some((anchor) => haystack.includes(anchor))) return reply;
  return {
    ...reply,
    body: `${reply.body} ${buildCommentContextSentence(communityContext)}`
  };
}

function ensureCommentDiversity(
  comments: FeedComment[],
  lesson: GeneratedLesson,
  post: FeedPost,
  conceptId: string,
  communityContext?: CommunityContext
): FeedComment[] {
  const requiredStances: FeedComment["stance"][] = ["赞成", "反对", "补充", "挑刺"];
  const maxVisibleComments = 10;
  const repaired = repairMislabelledStances(comments.slice(0, maxVisibleComments), requiredStances);
  const present = new Set(repaired.map((comment) => comment.stance));
  let replaceIndex = repaired.length - 1;

  for (const stance of requiredStances) {
    if (present.has(stance)) continue;
    const comment = buildDiversityComment(stance, lesson, post, conceptId, repaired.length + 1, communityContext);
    if (repaired.length < maxVisibleComments) {
      repaired.push(comment);
    } else {
      repaired[replaceIndex] = comment;
      replaceIndex = Math.max(0, replaceIndex - 1);
    }
    present.add(stance);
  }

  return repaired.map((comment) => ensureCommentHasContext(comment, communityContext));
}

function repairMislabelledStances(
  comments: FeedComment[],
  requiredStances: FeedComment["stance"][]
): FeedComment[] {
  const repaired = comments.slice();
  const counts = countStances(repaired);

  for (let index = 0; index < Math.min(requiredStances.length, repaired.length); index += 1) {
    const requiredStance = requiredStances[index];
    const comment = repaired[index];
    if (!comment || counts[requiredStance] > 0 || counts[comment.stance] <= 1) continue;

    repaired[index] = {
      ...comment,
      stance: requiredStance
    };
    counts[comment.stance] -= 1;
    counts[requiredStance] += 1;
  }

  return repaired;
}

function countStances(comments: FeedComment[]): Record<FeedComment["stance"], number> {
  const counts: Record<FeedComment["stance"], number> = {
    赞成: 0,
    反对: 0,
    补充: 0,
    挑刺: 0
  };
  for (const comment of comments) {
    counts[comment.stance] += 1;
  }
  return counts;
}

function buildDiversityComment(
  stance: FeedComment["stance"],
  lesson: GeneratedLesson,
  post: FeedPost,
  conceptId: string,
  index: number,
  communityContext?: CommunityContext
): FeedComment {
  const contextSentence = buildCommentContextSentence(communityContext);
  const bodyByStance: Record<FeedComment["stance"], string> = {
    赞成: `我比较站这个入口：${lesson.hook} ${contextSentence} 这能帮新手把原帖里的判断落到可验证问题上。`,
    反对: `我不太买把结论说满的写法，原帖还需要交代边界。${contextSentence} 不然容易把「${lesson.title}」用成万能解释。`,
    补充: `先补一个上下文：${lesson.analogy} ${contextSentence} 把例子和概念分开，再回来看讨论会更清楚。`,
    挑刺: `别急着下结论，这里最容易偷换的是把现象直接当因果。${contextSentence} 回到「${lesson.recallPrompt}」先问证据和前提。`
  };
  const author = fallbackAuthorFor(stance, communityContext);

  return {
    id: `comment-${conceptId}-repair-${stance}`,
    author: {
      id: `repair-${stance}`,
      ...author
    },
    body: bodyByStance[stance],
    heat: Math.max(45, 72 - index * 4),
    stance
  };
}

function ensureCommentHasContext(comment: FeedComment, communityContext?: CommunityContext): FeedComment {
  if (!communityContext) return comment;
  const anchors = contextAnchors(communityContext);
  const haystack = comment.body;
  if (anchors.some((anchor) => haystack.includes(anchor))) return comment;
  return {
    ...comment,
    body: `${comment.body} ${buildCommentContextSentence(communityContext)}`
  };
}

function buildCommentContextSentence(communityContext?: CommunityContext): string {
  if (!communityContext) return "回到当前学习目标看，";
  const topic = communityContext.topicTitle.replace(/\s*入门$/, "");
  const learnerLens = learnerLensFromBackground(communityContext.learnerBackground);
  const focus = contextAnchors(communityContext)
    .filter((anchor) => anchor !== topic && anchor !== learnerLens)
    .slice(0, 2)
    .join("和");
  return `${learnerLens ? `从${learnerLens}视角看，` : ""}${topic}要结合${focus ? `${focus}这些具体线索` : "具体场景"}来判断。`;
}

function learnerLensFromBackground(background: string): string {
  return background
    .replace(/^我是/, "")
    .split(/[，。,；;]/)[0]
    .replace(/^(一个|一名)/, "")
    .trim()
}

function contextAnchors(communityContext: CommunityContext): string[] {
  const text = [
    communityContext.topicTitle,
    communityContext.learnerBackground,
    communityContext.learnerGoal,
    communityContext.conceptTitle,
    communityContext.conceptPlainName
  ].join(" ");
  const topic = communityContext.topicTitle.replace(/\s*入门$/, "");
  const lens = learnerLensFromBackground(communityContext.learnerBackground);
  const domainTerms = [
    "城市更新",
    "建筑史",
    "老建筑",
    "历史建筑",
    "老城",
    "老城区",
    "老城厢",
    "外滩",
    "开埠",
    "租界",
    "洋行",
    "石库门",
    "课程设计",
    "教学",
    "课程",
    "课堂",
    "学习动机",
    "商品图",
    "电商",
    "视觉",
    "城市规划",
    "政策",
    "利益相关方",
    "风控",
    "监管",
    "金融科技",
    "Web3",
    "钱包",
    "链上",
    "心理学",
    "研究",
    "AI",
    "产品",
    "古典音乐",
    "通勤",
    "听音乐",
    "作品",
    "演奏",
    "乐理",
    "审美",
    "日本战国史",
    "人物",
    "内容编辑",
    "史料",
    "影视",
    "制度",
    "历史叙事"
  ].filter((term) => text.includes(term));
  const anchors = [
    topic,
    ...deriveShortCommunityAnchors(topic),
    compactCommunityLabel(topic, topic, 16),
    lens,
    ...domainTerms,
    communityContext.conceptPlainName,
    ...deriveShortCommunityAnchors(communityContext.conceptPlainName),
    compactCommunityLabel(communityContext.conceptPlainName, communityContext.conceptPlainName, 16),
    communityContext.conceptTitle,
    ...deriveShortCommunityAnchors(communityContext.conceptTitle),
    compactCommunityLabel(communityContext.conceptTitle, communityContext.conceptTitle, 16)
  ].filter((item): item is string => Boolean(item));
  return [...new Set(anchors)];
}

function buildResearchAnchorTerms(researchBrief: ResearchBrief): string[] {
  const sourceTexts = researchBrief.sources.flatMap((source) => [
    source.title,
    source.publisher,
    source.summary,
    source.reliabilityNote
  ]);
  const rawTerms = [
    ...researchBrief.keyIdeas,
    ...researchBrief.disputedIdeas,
    ...researchBrief.beginnerPitfalls,
    ...sourceTexts
  ].flatMap((item) => extractResearchAnchorTerms(item ?? ""));
  return [...new Set(rawTerms)].slice(0, 80);
}

function extractResearchAnchorTerms(value: string): string[] {
  const tokens = value
    .split(/[^\p{L}\p{N}]+/u)
    .map((item) => item.trim())
    .filter((item) => item.length >= 3);
  const terms = tokens.flatMap((token) => {
    if (/[\u3400-\u9fff]/u.test(token)) {
      return [
        token.length <= 12 ? token : "",
        ...deriveShortCommunityAnchors(token),
        ...deriveChineseResearchNgrams(token)
      ];
    }
    return token.length >= 4 ? [token] : [];
  });
  return terms
    .map((term) => term.trim())
    .filter((term) => term.length >= 3 && !isGenericResearchAnchor(term));
}

function deriveChineseResearchNgrams(value: string): string[] {
  const compact = value.replace(/[^\u3400-\u9fff]+/gu, "");
  if (compact.length < 3) return [];
  const terms: string[] = [];
  for (const length of [6, 5, 4, 3]) {
    for (let index = 0; index <= compact.length - length; index += 1) {
      const term = compact.slice(index, index + length);
      if (isGenericResearchAnchor(term)) continue;
      terms.push(term);
    }
  }
  return terms.slice(0, 24);
}

function isGenericResearchAnchor(value: string): boolean {
  return /^(入门|学习|讨论|观点|内容|背景|目标|用户|当前|围绕|组织|路径|真实|场景|常见|问题|概念|领域|核心|先学|理解|判断|看懂|资料|来源|方法|研究|证据|边界|争议|例子|例如|比如|可以|需要|必须|应该|一个|这个|那个|哪些|如何|怎么|为什么|beginner|guide)$/i.test(
    value.trim()
  );
}

function deriveShortCommunityAnchors(value: string): string[] {
  const trimmed = value.trim();
  if (!/[\u3400-\u9fff]/u.test(trimmed)) return [];
  const suffixStripped = trimmed
    .replace(/(基础|入门|概念|原理|方法|技巧|规则|框架|模型|策略|应用|实践|案例|练习|构图)$/u, "")
    .trim();
  const leadingTopic = trimmed.match(
    /^([\u3400-\u9fff]{2,5})(?:基础|入门|概念|原理|方法|技巧|规则|框架|模型|策略|应用|实践|案例|练习|构图)/u
  )?.[1];
  const leadingDomainNoun = trimmed.match(
    /^([\u3400-\u9fff]{2,8}?(?:法|史|学|论|乱|税|图|曲|剧|课|音乐|政策|动机|构图|课程|交易|分期|时代))(?=[\u3400-\u9fff]|$)/u
  )?.[1];
  const embeddedDomainTerms = ["课程设计", "教学", "课程", "课堂", "学习动机"].filter((item) => trimmed.includes(item));
  return [
    ...new Set(
      [suffixStripped, leadingTopic, leadingDomainNoun, ...embeddedDomainTerms].filter(
        (item): item is string => Boolean(item && item.length >= 2)
      )
    )
  ];
}

function normalizeShadowDraft(value: unknown, conceptId: string, fallbackBody: string): ShadowDraft | null {
  const draft = value as Partial<ShadowDraft> & { text?: string; content?: unknown };
  const body = draft?.body ?? draft?.text ?? normalizeShadowContent(draft?.content) ?? fallbackBody;
  if (!draft || typeof body !== "string" || !body.trim()) return null;
  if (violatesGeneratedTextSafety(body)) return null;
  return {
    id: typeof draft.id === "string" ? draft.id : `shadow-${conceptId}-llm`,
    conceptId,
    body,
    confidence: typeof draft.confidence === "number" ? Math.max(0, Math.min(100, draft.confidence)) : 72,
    status: "draft"
  };
}

function normalizeShadowContent(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (!value || typeof value !== "object") return undefined;
  const content = value as Record<string, unknown>;
  const preferred = ["mySummary", "myQuestion", "myOpinion", "summary", "question", "opinion", "body", "text"];
  const parts = preferred
    .map((key) => content[key])
    .filter((item): item is string => typeof item === "string" && item.trim().length > 0);
  return parts.length ? parts.join(" ") : undefined;
}

function buildShadowFallback(lesson: GeneratedLesson, post: FeedPost): string {
  return `我刚学到「${lesson.title}」：${lesson.explanation} 下次看到类似讨论，我会先追问证据、边界和反方观点。原帖里最值得继续想的是：${post.body}`;
}

function normalizeAuthor(
  value: unknown,
  fallbackId: string,
  commentStance?: FeedComment["stance"],
  communityContext?: CommunityContext
): FeedPost["author"] {
  const fallback = fallbackAuthorFor(commentStance, communityContext);
  if (typeof value === "string") {
    const displayName = isPlaceholderAuthorName(value) ? fallback.displayName : value;
    return {
      id: fallbackId,
      displayName,
      handle: `@${displayName.replace(/[^a-z0-9_]+/gi, "").slice(0, 16) || fallback.handle.replace(/^@/, "")}`,
      role: fallback.role,
      stance: fallback.stance
    };
  }
  const author = value as Partial<FeedPost["author"]>;
  const hasPlaceholderDisplayName =
    typeof author?.displayName !== "string" || isPlaceholderAuthorName(author.displayName);
  const hasAnchoredAuthorMetadata =
    communityContext && hasCommunityContextAnchor(`${author?.handle ?? ""} ${author?.role ?? ""}`, communityContext);
  const hasBareGenericDisplayName =
    typeof author?.displayName === "string" &&
    communityContext &&
    isBareGenericDisplayName(author.displayName) &&
    !hasCommunityContextAnchor(author.displayName, communityContext);
  const hasFormulaicDisplayName =
    typeof author?.displayName === "string" &&
    communityContext &&
    isFormulaicRoleDisplayName(author.displayName, communityContext);
  const displayName =
    typeof author?.displayName === "string" &&
    !hasPlaceholderDisplayName &&
    !hasFormulaicDisplayName &&
    !(hasBareGenericDisplayName && hasAnchoredAuthorMetadata)
      ? author.displayName
      : fallback.displayName;
  return {
    id: typeof author?.id === "string" ? author.id : fallbackId,
    displayName,
    handle:
      typeof author?.handle === "string" && !hasPlaceholderDisplayName && !isPlaceholderAuthorHandle(author.handle)
        ? author.handle
        : fallback.handle,
    role:
      typeof author?.role === "string" && !hasPlaceholderDisplayName && !isPlaceholderAuthorRole(author.role)
        ? author.role
        : fallback.role,
    stance: ["支持派", "反对派", "看热闹", "学习分身"].includes(String(author?.stance))
      ? (author?.stance as FeedPost["author"]["stance"])
      : fallback.stance
  };
}

function isPlaceholderAuthorName(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  return /^(张三|李四|王五|小王|小李|小张|用户[a-z]?|ai\s*热评员)$/i.test(normalized);
}

function isBareGenericDisplayName(value: string): boolean {
  return /^(AI\s*(号|热评员|生成角色)|建设派用户|风险派用户|资料补充员|逻辑挑刺员|乐观实践者|反方观察者|科普者|怀疑者|边界提醒者|建设者|实践者|支持者|反对者|补充者|挑刺者|资料党|概念警察|方法论挑刺者)$/i.test(
    value.trim()
  );
}

function isFormulaicRoleDisplayName(value: string, communityContext?: CommunityContext): boolean {
  const trimmed = value.trim();
  if (!trimmed) return true;
  if (isBareGenericDisplayName(trimmed)) return true;
  const suffixMatch = trimmed.match(
    /(实践派|边界派|资料党|挑刺员|观察员|提醒者|校验者|补充者|建设者|反对者|支持者|追问者|反驳者|拥护者|复盘者|整理者)$/u
  );
  if (!suffixMatch) return false;

  const prefix = trimmed.slice(0, -suffixMatch[0].length);
  if (!prefix) return true;
  if (communityContext && hasCommunityContextAnchor(trimmed, communityContext)) return true;
  return /^(证据|边界|资料|概念|逻辑|方法|实践|新手|入口|版规|来源|样本|目标|安全|风险|场景|OP|坐标|反方|乐观)/u.test(prefix);
}

function hasCommunityContextAnchor(value: string, communityContext: CommunityContext): boolean {
  return authorContextAnchors(communityContext).some((anchor) => value.includes(anchor));
}

function isPlaceholderAuthorHandle(value: string): boolean {
  return /^@?knowfeed-ai$/i.test(value.trim());
}

function isPlaceholderAuthorRole(value: string): boolean {
  return /^ai\s*生成角色$/i.test(value.trim());
}

function fallbackAuthorFor(
  commentStance?: FeedComment["stance"],
  communityContext?: CommunityContext
): Omit<FeedPost["author"], "id"> {
  if (communityContext) return contextualFallbackAuthorFor(commentStance, communityContext);

  if (commentStance === "赞成") {
    return {
      displayName: "先别劝退我",
      handle: "@kf-entry-note",
      role: "社区支持视角",
      stance: "支持派"
    };
  }
  if (commentStance === "反对") {
    return {
      displayName: "这坑我踩过",
      handle: "@kf-hard-lesson",
      role: "社区反对视角",
      stance: "反对派"
    };
  }
  if (commentStance === "挑刺") {
    return {
      displayName: "别急着下结论",
      handle: "@kf-slow-down",
      role: "社区挑刺视角",
      stance: "反对派"
    };
  }
  if (commentStance === "补充") {
    return {
      displayName: "半夜补资料",
      handle: "@kf-late-notes",
      role: "社区补充视角",
      stance: "看热闹"
    };
  }
  return {
    displayName: "刚刷到就懵",
    handle: "@kf-first-scroll",
    role: "社区发帖视角",
    stance: "看热闹"
  };
}

function contextualFallbackAuthorFor(
  commentStance: FeedComment["stance"] | undefined,
  communityContext: CommunityContext
): Omit<FeedPost["author"], "id"> {
  const topic = compactCommunityLabel(communityContext.topicTitle, "当前话题", 10);
  const concept = compactCommunityLabel(
    communityContext.conceptPlainName || communityContext.conceptTitle,
    topic,
    12
  );
  const lens = learnerLensFromBackground(communityContext.learnerBackground).trim();

  if (commentStance === "赞成") {
    return {
      displayName: "先别劝退我",
      handle: `@kf-entry-${topic.toLowerCase()}`,
      role: `${lens ? `${lens}视角的` : ""}${topic}入门体验视角`,
      stance: "支持派"
    };
  }

  if (commentStance === "反对") {
    return {
      displayName: "这坑我踩过",
      handle: `@kf-hard-${topic.toLowerCase()}`,
      role: `${concept}边界经验视角`,
      stance: "反对派"
    };
  }

  if (commentStance === "挑刺") {
    return {
      displayName: "别急着下结论",
      handle: `@kf-slow-${concept.toLowerCase()}`,
      role: `${concept}概念校验视角`,
      stance: "反对派"
    };
  }

  if (commentStance === "补充") {
    return {
      displayName: "半夜补资料",
      handle: `@kf-notes-${concept.toLowerCase()}`,
      role: `${concept}资料查证视角`,
      stance: "看热闹"
    };
  }

  return {
    displayName: "刚刷到就懵",
    handle: `@kf-scroll-${topic.toLowerCase()}`,
    role: `${topic}讨论发帖人`,
    stance: "看热闹"
  };
}

function compactCommunityLabel(value: string, fallback: string, maxLength: number): string {
  const compacted = value
    .replace(/^我是/, "")
    .replace(/\s*入门[：:].*$/g, "")
    .replace(/[：:].*$/g, "")
    .replace(/\s*入门$/g, "")
    .replace(/[，。,；;,.].*$/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, "")
    .trim();
  return (compacted || fallback).slice(0, maxLength);
}

function normalizeCommentStance(value: unknown): FeedComment["stance"] {
  const stance = String(value).toLowerCase();
  if (["赞成", "支持", "support", "supports", "pro", "agree", "positive"].includes(stance)) return "赞成";
  if (["反对", "oppose", "opposes", "against", "con", "negative"].includes(stance)) return "反对";
  if (["挑刺", "critic", "critique", "challenge", "skeptic", "skeptical"].includes(stance)) return "挑刺";
  if (["补充", "supplement", "context", "add", "neutral"].includes(stance)) return "补充";
  return "补充";
}

function violatesGeneratedTextSafety(body: string): boolean {
  const normalized = body.toLowerCase();
  return [
    "真实个人",
    "身份群体",
    "网暴",
    "人肉",
    "去死",
    "kill",
    "dox"
  ].some((term) => normalized.includes(term)) || violatesHighRiskAdvice(normalized);
}

function violatesHighRiskAdvice(normalizedBody: string): boolean {
  const highRiskActionPatterns = [
    /直接(吃|服用|停药|停用|加量|减量|买入|卖出|贷款|借款|起诉|上诉|签约|解约)/,
    /应该(吃|服用|停药|停用|加量|减量|买入|卖出|贷款|借款|起诉|上诉|签约|解约)/,
    /(建议|推荐|需要|适合|最好|应当|去)(你|大家|患者|用户)?(直接)?(吃|服用|用药|停药|停用|加量|减量|买入|卖出|买卖|贷款|借款|起诉|上诉|签约|解约)/,
    /(马上|立刻|必须)(吃|服用|停药|停用|加量|减量|买入|卖出|贷款|借款|起诉|上诉|签约|解约)/,
    /(买入|卖出|买卖|贷款|借款|起诉|上诉|服药|用药|停药|加量|减量)是(最合适|最优|最佳|唯一|正确)/,
    /可以确诊/,
    /(不用|无需|不必)(看医生|找医生|咨询医生|找律师|咨询律师|做检查|查证|专业人士)/,
    /(保证|稳赚|一定)(收益|赚钱|胜诉|合规|安全)/,
    /guaranteed\s+(return|profit|win|safe)/,
    /you\s+should\s+(buy|sell|short|loan|borrow|sue|stop medication|take medication)/,
    /diagnose(s|d)?\s+you\s+with/
  ];
  return highRiskActionPatterns.some((pattern) => pattern.test(normalizedBody));
}
