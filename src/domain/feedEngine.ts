import type { FeedComment, FeedPost, GeneratedKnowledgeBundle, ShadowDraft } from "./types";

export const commentFilters = ["全部", "赞成", "反对", "补充", "挑刺"] as const;
export type CommentFilter = (typeof commentFilters)[number];
export const commentSortModes = ["热度", "新回复", "相关"] as const;
export type CommentSortMode = (typeof commentSortModes)[number];

interface RankCommentOptions {
  sortMode?: CommentSortMode;
  contextTerms?: string[];
}

export function rankComments(
  comments: FeedComment[],
  filter: CommentFilter,
  options: RankCommentOptions = {}
): FeedComment[] {
  const sortMode = options.sortMode ?? "热度";
  const contextTerms = options.contextTerms ?? [];
  return comments
    .filter((comment) => {
      if (filter === "全部") return true;
      return comment.stance === filter;
    })
    .sort((a, b) => compareComments(a, b, sortMode, contextTerms));
}

export function countCommentsByFilter(comments: FeedComment[]): Record<CommentFilter, number> {
  const counts = Object.fromEntries(commentFilters.map((filter) => [filter, 0])) as Record<CommentFilter, number>;
  counts["全部"] = comments.length;
  for (const comment of comments) {
    counts[comment.stance] += 1;
  }
  return counts;
}

export function countCommentReplies(comments: FeedComment[]): number {
  if (!comments) return 0;
  let count = 0;
  for (const comment of comments) {
    if (comment.replies) {
      count += comment.replies.length;
    }
  }
  return count;
}

export function buildCommentContextTerms(bundle: GeneratedKnowledgeBundle): string[] {
  const raw = [
    bundle.lesson.title,
    bundle.lesson.hook,
    bundle.lesson.recallPrompt,
    bundle.post.body,
    bundle.post.hook,
    bundle.shadowDraft.body
  ];
  const phraseTerms = raw.map((item) => item.trim()).filter((item) => item.length >= 2 && item.length <= 48);
  const terms = [...phraseTerms, ...raw.flatMap(extractContextTerms)];
  return [...new Set(terms)].slice(0, 24);
}

function compareComments(
  left: FeedComment,
  right: FeedComment,
  sortMode: CommentSortMode,
  contextTerms: string[]
): number {
  if (sortMode === "新回复") {
    return compareScore(replyActivityScore(right), replyActivityScore(left)) || compareScore(right.heat, left.heat);
  }
  if (sortMode === "相关") {
    return (
      compareScore(relevanceScore(right, contextTerms), relevanceScore(left, contextTerms)) ||
      compareScore(replyActivityScore(right), replyActivityScore(left)) ||
      compareScore(right.heat, left.heat)
    );
  }
  return compareScore(right.heat, left.heat);
}

function compareScore(left: number, right: number): number {
  return left === right ? 0 : left > right ? 1 : -1;
}

function replyActivityScore(comment: FeedComment): number {
  const replies = comment.replies ?? [];
  const newestReplyHeat = Math.max(0, ...replies.map((reply) => reply.heat));
  return newestReplyHeat + replies.length * 8;
}

function relevanceScore(comment: FeedComment, contextTerms: string[]): number {
  if (!contextTerms.length) return 0;
  const text = [
    comment.author.displayName,
    comment.author.role,
    comment.body,
    ...(comment.replies ?? []).flatMap((reply) => [reply.author.displayName, reply.author.role, reply.quote ?? "", reply.body])
  ].join(" ");
  const matches = contextTerms.filter((term) => text.includes(term));
  const replyBonus = (comment.replies?.length ?? 0) * 2;
  return matches.length * 12 + replyBonus;
}

function extractContextTerms(value: string): string[] {
  return value
    .split(/[^\p{Script=Han}a-zA-Z0-9]+/u)
    .map((term) => term.trim())
    .filter((term) => term.length >= 2)
    .filter((term) => !/^(https?|www|com|刚刚|这个|那个|一种|一个|不是|可以|为什么|什么)$/.test(term));
}

export function getPrimaryPost(bundle: GeneratedKnowledgeBundle): FeedPost {
  return bundle.post;
}

export function getShadowDraft(bundle: GeneratedKnowledgeBundle): ShadowDraft {
  return bundle.shadowDraft;
}
