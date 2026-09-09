// @deprecated OASIS 本地社区已退役（spec 11），由 /api/community/* 取代。
// 本文件不再被任何运行时代码引用，保留仅为历史参考，不再维护。
import type { FeedAuthor, FeedComment, FeedCommentReply, GeneratedKnowledgeBundle } from "./types";

export type OasisCommunityJobStatus = "idle" | "queued" | "starting" | "running" | "complete" | "failed" | "stopped";

export interface OasisCommunityAgent {
  id: number;
  username: string;
  displayName: string;
  bio: string;
  persona: string;
}

export interface OasisCommunityPost {
  id: number;
  agentId: number;
  content: string;
  createdAt: string;
  likes: number;
  dislikes: number;
  shares: number;
}

export interface OasisCommunityComment {
  id: number;
  postId: number;
  agentId: number;
  content: string;
  createdAt: string;
  likes: number;
  dislikes: number;
}

export interface OasisCommunityTrace {
  id: number;
  userId: number;
  createdAt: string;
  action: string;
  info: Record<string, unknown>;
}

export interface OasisCommunityEvent {
  id: number;
  round: number;
  action: string;
  agentId: number;
  agentName: string;
  content: string;
  postId?: number;
  commentId?: number;
  createdAt: string;
}

export interface OasisCommunitySnapshot {
  topic: string;
  mode: "scripted" | "llm" | string;
  agents: OasisCommunityAgent[];
  posts: OasisCommunityPost[];
  comments: OasisCommunityComment[];
  traces: OasisCommunityTrace[];
}

export interface OasisCommunityJob {
  jobId: string;
  status: OasisCommunityJobStatus;
  message: string;
  startedAt: string;
  updatedAt: string;
  mode: string;
  topic: string;
  events: OasisCommunityEvent[];
  snapshot?: OasisCommunitySnapshot;
  error?: string;
  stderr?: string[];
}

export interface StartOasisCommunityInput {
  topic: string;
  goal: string;
  mode?: "scripted";
  delayMs?: number;
}

export async function startOasisCommunitySimulation(input: StartOasisCommunityInput): Promise<OasisCommunityJob> {
  const response = await fetch("/api/oasis-community/start", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input)
  });
  return parseOasisCommunityResponse(response);
}

export async function fetchOasisCommunityJob(jobId: string): Promise<OasisCommunityJob> {
  const response = await fetch(`/api/oasis-community/status?jobId=${encodeURIComponent(jobId)}`);
  return parseOasisCommunityResponse(response);
}

export function agentById(snapshot: OasisCommunitySnapshot | undefined, agentId: number): OasisCommunityAgent | undefined {
  return snapshot?.agents.find((agent) => agent.id === agentId);
}

export function commentsForPost(snapshot: OasisCommunitySnapshot | undefined, postId: number): OasisCommunityComment[] {
  return (snapshot?.comments ?? [])
    .filter((comment) => comment.postId === postId)
    .sort((left, right) => right.likes - right.dislikes - (left.likes - left.dislikes) || left.id - right.id);
}

export function communityScore(post: OasisCommunityPost): number {
  return Math.max(0, post.likes - post.dislikes);
}

export function buildOasisKnowledgeBundle(
  snapshot: OasisCommunitySnapshot,
  baseBundle: GeneratedKnowledgeBundle,
  conceptId = baseBundle.conceptId
): GeneratedKnowledgeBundle {
  const [primaryPost] = snapshot.posts;
  if (!primaryPost) return baseBundle;

  const primaryComments = snapshot.comments
    .filter((comment) => comment.postId === primaryPost.id)
    .map((comment, index) => buildOasisComment(snapshot, comment, index));
  const branchComments = snapshot.posts
    .filter((post) => post.id !== primaryPost.id)
    .map((post, index) => buildBranchComment(snapshot, post, primaryComments.length + index));
  const comments = [...primaryComments, ...branchComments];

  return {
    ...baseBundle,
    source: "llm",
    conceptId,
    generatedAt: new Date().toISOString(),
    post: {
      ...baseBundle.post,
      id: `oasis-post-${primaryPost.id}`,
      conceptId,
      author: buildOasisAuthor(snapshot, primaryPost.agentId),
      body: primaryPost.content,
      hook: "看评论区怎么把这个说法拆开",
      metricText: `${snapshot.comments.length} 条评论 · ${Math.max(0, snapshot.posts.length - 1)} 个分叉点 · ${snapshot.agents.length} 个账号参与`,
      learnCta: "看懂这条讨论",
      createdAtLabel: "刚刚"
    },
    comments,
    shadowDraft: {
      ...baseBundle.shadowDraft,
      id: `oasis-shadow-${conceptId}-${snapshot.traces.length}`,
      conceptId,
      generationSource: "llm",
      body: `我刚看完这轮评论，感觉重点不是背一个结论，而是先把原帖改写成一句能被打脸的话。改得出来，再去找例子；改不出来，就先把它当口号。`,
      confidence: Math.max(baseBundle.shadowDraft.confidence, 74),
      status: "draft"
    }
  };
}

function buildOasisComment(snapshot: OasisCommunitySnapshot, comment: OasisCommunityComment, index: number): FeedComment {
  return {
    id: `oasis-comment-${comment.id}`,
    author: buildOasisAuthor(snapshot, comment.agentId),
    body: comment.content,
    heat: buildOasisHeat(comment.likes, comment.dislikes, index),
    stance: oasisCommentStance(index)
  };
}

function buildBranchComment(snapshot: OasisCommunitySnapshot, post: OasisCommunityPost, index: number): FeedComment {
  const commentId = `oasis-branch-${post.id}`;
  const replies = snapshot.comments
    .filter((comment) => comment.postId === post.id)
    .map((comment, replyIndex) => buildOasisReply(snapshot, comment, commentId, replyIndex));
  return {
    id: commentId,
    author: buildOasisAuthor(snapshot, post.agentId),
    body: `另开一楼：${post.content}`,
    heat: buildOasisHeat(post.likes, post.dislikes, index),
    stance: "补充",
    replies
  };
}

function buildOasisReply(
  snapshot: OasisCommunitySnapshot,
  comment: OasisCommunityComment,
  replyToCommentId: string,
  index: number
): FeedCommentReply {
  const relations = ["补充", "追问", "反驳"] as const;
  return {
    id: `oasis-reply-${comment.id}`,
    author: buildOasisAuthor(snapshot, comment.agentId),
    body: comment.content,
    heat: buildOasisHeat(comment.likes, comment.dislikes, index),
    replyToCommentId,
    relation: relations[index % relations.length],
    source: "llm"
  };
}

function buildOasisAuthor(snapshot: OasisCommunitySnapshot, agentId: number): FeedAuthor {
  const agent = agentById(snapshot, agentId);
  const stances = ["看热闹", "支持派", "反对派", "看热闹"] as const;
  return {
    id: `oasis-agent-${agentId}`,
    displayName: agent?.displayName ?? `agent-${agentId}`,
    handle: agent?.username ? `@${agent.username}` : `@agent-${agentId}`,
    role: agent?.bio ?? "OASIS 社区角色",
    stance: stances[Math.abs(agentId) % stances.length]
  };
}

function buildOasisHeat(likes: number, dislikes: number, index: number): number {
  return Math.max(12, 82 - index * 6 + likes * 12 - dislikes * 8);
}

function oasisCommentStance(index: number): FeedComment["stance"] {
  const stances: Array<FeedComment["stance"]> = ["补充", "挑刺", "赞成", "反对"];
  return stances[index % stances.length];
}

async function parseOasisCommunityResponse(response: Response): Promise<OasisCommunityJob> {
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(typeof payload.error === "string" ? normalizeOasisCommunityError(payload.error) : "本地社区刷新失败");
  }
  return payload as OasisCommunityJob;
}

export function normalizeOasisCommunityError(message: string): string {
  if (/OASIS worker/i.test(message)) return "本地社区刷新失败";
  return message;
}
