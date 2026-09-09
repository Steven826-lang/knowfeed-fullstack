import { useEffect, useRef, useState } from "react";
import {
  buildCommunityFeedContext,
  createCommunityComment,
  fetchCommunityFeed,
  fetchCommunityPost,
  markPostSeen,
  type CommunityComment,
  type CommunityPostDetail
} from "../domain/communityApi";
import {
  buildCommentContextTerms,
  commentFilters,
  commentSortModes,
  countCommentReplies,
  countCommentsByFilter,
  rankComments,
  type CommentFilter,
  type CommentSortMode
} from "../domain/feedEngine";
import type { AppState, FeedAuthor, FeedComment, FeedCommentReply, GeneratedKnowledgeBundle, LocalReply, ReplyTarget } from "../domain/types";
import { SourceProvenance } from "./SourceProvenance";

interface PostDetailProps {
  state: AppState;
  bundle: GeneratedKnowledgeBundle;
  postId?: string;
  lessonHandoff?: {
    lessonTitle: string;
    xpGained: number;
  };
  userReplies: LocalReply[];
  onBack: () => void;
  onDismissLessonHandoff: () => void;
  onStartLesson: () => void;
  onAddReply: (postId: string, reply: LocalReply) => void;
  onOpenAgent: (agentId: string) => void;
}

const POLL_INTERVAL_MS = 5000;
const POLL_TIMEOUT_MS = 30000;

export function PostDetail({
  state,
  bundle,
  postId,
  lessonHandoff,
  userReplies,
  onBack,
  onDismissLessonHandoff,
  onStartLesson,
  onAddReply,
  onOpenAgent
}: PostDetailProps) {
  const [communityPost, setCommunityPost] = useState<CommunityPostDetail | null>(null);
  const [communityComments, setCommunityComments] = useState<FeedComment[]>([]);
  const [postLoading, setPostLoading] = useState(false);
  const [resolvedPostId, setResolvedPostId] = useState(postId);
  const [awaitingResponses, setAwaitingResponses] = useState(false);
  const [freshCommentIds, setFreshCommentIds] = useState<Set<string>>(new Set());
  const communityWorldId = state.communityWorldId;

  useEffect(() => {
    setResolvedPostId(postId);
  }, [postId]);

  // Resolve the top recommended post when the screen opens without a post id
  // (e.g. straight from a finished lesson).
  useEffect(() => {
    if (!communityWorldId || !bundle.conceptId) return;
    if (resolvedPostId) return;
    let cancelled = false;
    fetchCommunityFeed(communityWorldId, buildCommunityFeedContext(state, bundle.conceptId, { limit: 3 }))
      .then((result) => {
        if (!cancelled && result.posts.length > 0) {
          setResolvedPostId(result.posts[0].postId);
        }
      })
      .catch((error) => console.error("community feed resolve failed", error));
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [communityWorldId, bundle.conceptId, resolvedPostId]);

  useEffect(() => {
    if (!resolvedPostId || !communityWorldId) return;
    let cancelled = false;
    setPostLoading(true);
    markPostSeen(resolvedPostId);
    fetchCommunityPost(resolvedPostId)
      .then((result) => {
        if (cancelled) return;
        setCommunityPost(result);
        setCommunityComments(result.comments.map(toFeedComment));
        // A fresh user post starts in "awaiting_responses" (spec 6.3): poll
        // so mini-tick replies stream in.
        if (result.postStatus === "user" && !hasAgentComment(result.comments)) {
          setAwaitingResponses(true);
        }
      })
      .catch((error) => console.error("community post load failed", error))
      .finally(() => setPostLoading(false));
    return () => { cancelled = true; };
  }, [resolvedPostId, communityWorldId]);

  // Poll for mini-tick replies every 5s; stop after 30s (spec 6.3 async model).
  useEffect(() => {
    if (!awaitingResponses || !resolvedPostId || !communityWorldId) return;
    const startedAt = Date.now();
    const timer = window.setInterval(() => {
      if (Date.now() - startedAt >= POLL_TIMEOUT_MS) {
        window.clearInterval(timer);
        setAwaitingResponses(false);
        return;
      }
      fetchCommunityPost(resolvedPostId)
        .then((fresh) => {
          setCommunityComments((current) => {
            const known = collectCommentIds(current);
            const mapped = fresh.comments.map(toFeedComment);
            const incoming = [...collectCommentIds(mapped)].filter((id) => !known.has(id));
            if (incoming.length > 0) {
              setFreshCommentIds((previous) => new Set([...previous, ...incoming]));
            }
            return mapped;
          });
        })
        .catch((error) => console.error("comment poll failed", error));
    }, POLL_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [awaitingResponses, resolvedPostId, communityWorldId]);

  const displayPost = communityPost ? adaptCommunityPost(communityPost) : bundle.post;
  const displayComments = communityPost ? communityComments : bundle.comments;
  const effectivePostId = communityPost?.postId ?? bundle.post.id;

  const [filter, setFilter] = useState<CommentFilter>("全部");
  const [sortMode, setSortMode] = useState<CommentSortMode>("热度");
  const [isComposing, setIsComposing] = useState(false);
  const [replyText, setReplyText] = useState("");
  const [replyTarget, setReplyTarget] = useState<ReplyTarget | undefined>();
  const [postLiked, setPostLiked] = useState(false);
  const [bookmarked, setBookmarked] = useState(false);
  const [shared, setShared] = useState(false);
  const [likedComments, setLikedComments] = useState<Set<string>>(new Set());
  const composerRef = useRef<HTMLElement>(null);
  const comments = rankComments(displayComments, filter, {
    sortMode,
    contextTerms: buildCommentContextTerms(bundle)
  });
  const filterCounts = countCommentsByFilter(displayComments);
  const replyCount = countCommentReplies(displayComments);
  const postLikes = communityPost ? communityPost.likeCount : Math.max(12, Math.round(bundle.comments.reduce((sum, comment) => sum + comment.heat, 0) / 3));
  const postReplyTarget = buildReplyTarget("post", displayPost.author.displayName, displayPost.body);

  function startComposing(target?: ReplyTarget) {
    setReplyTarget(target);
    setIsComposing(true);
    window.setTimeout(() => {
      composerRef.current?.scrollIntoView?.({ block: "nearest", behavior: "smooth" });
    }, 0);
  }

  function stopComposing() {
    setReplyText("");
    setReplyTarget(undefined);
    setIsComposing(false);
  }

  async function submitReply() {
    const trimmedReply = replyText.trim();
    if (!trimmedReply) return;
    if (communityPost) {
      // Community path: persist through the community API, render the
      // comment immediately, then await mini-tick responses (spec 6.3).
      const target = replyTarget;
      try {
        const result = await createCommunityComment({
          postId: communityPost.postId,
          userId: sessionKeyFor(state),
          content: trimmedReply,
          parentCommentId: target?.commentId
        });
        const ownComment = buildOwnComment(result.commentId, trimmedReply, target);
        setCommunityComments((current) =>
          target?.commentId ? insertIntoComments(current, target.commentId, ownComment) : [...current, ownComment as FeedComment]
        );
        setAwaitingResponses(true);
        stopComposing();
      } catch (error) {
        console.error("community comment failed", error);
      }
      return;
    }
    onAddReply(effectivePostId, { body: trimmedReply, target: replyTarget });
    stopComposing();
  }

  function toggleCommentLike(id: string) {
    setLikedComments((current) => {
      const next = new Set(current);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  function renderReply(reply: FeedCommentReply, depth: number) {
    const isAgentAuthor = Boolean(communityPost) && reply.author.id !== "user";
    return (
      <article key={reply.id} className="comment-reply">
        {communityPost ? (
          <span className="avatar-wrap">
            <span className={reply.author.id === "user" ? "avatar tiny self-avatar" : "avatar tiny"}>{reply.author.displayName.slice(0, 1)}</span>
            <span className={reply.author.id === "user" ? "ai-badge user-badge" : "ai-badge"}>{reply.author.id === "user" ? "我" : "AI"}</span>
          </span>
        ) : (
          <div className="avatar tiny">{reply.author.displayName.slice(0, 1)}</div>
        )}
        <div>
          <header>
            {isAgentAuthor ? (
              <button className="author-link" type="button" onClick={() => onOpenAgent(reply.author.id)}>
                <strong>{reply.author.displayName}</strong>
              </button>
            ) : (
              <strong>{reply.author.displayName}</strong>
            )}
            {reply.isOp ? <span className="author-badge">楼主</span> : null}
            {freshCommentIds.has(reply.id) ? <span className="author-badge">刚刚</span> : null}
            <span className="reply-relation">{reply.relation}</span>
          </header>
          <span className="comment-agent-role">视角 · {reply.author.role}</span>
          {reply.quote ? <blockquote>{reply.quote}</blockquote> : null}
          <p>{reply.body}</p>
          <footer className="comment-actions compact" aria-label={`${reply.author.displayName} 的回复操作`}>
            <button type="button" onClick={() => toggleCommentLike(reply.id)}>
              赞同 {reply.heat + (likedComments.has(reply.id) ? 1 : 0)}
            </button>
            {depth < 3 ? (
              <button
                type="button"
                onClick={() => startComposing(buildReplyTarget("reply", reply.author.displayName, reply.body, reply.id))}
              >
                回复
              </button>
            ) : null}
          </footer>
          {reply.replies?.length ? (
            <div className="comment-replies" aria-label={`${reply.author.displayName} 的回复`}>
              {reply.replies.map((nested) => renderReply(nested, depth + 1))}
            </div>
          ) : null}
        </div>
      </article>
    );
  }

  const isEmpty = comments.length === 0 && userReplies.length === 0;

  return (
    <section className="post-detail">
      <button className="text-button" type="button" onClick={onBack}>
        ← 返回社区
      </button>
      {lessonHandoff ? (
        <section className="lesson-handoff-card" aria-label="微课完成反馈">
          <div>
            <p className="eyebrow">微课完成</p>
            <h2>{lessonHandoff.lessonTitle}</h2>
            <p>+{lessonHandoff.xpGained} XP，AI 分身已经基于这次学习生成可编辑草稿。</p>
          </div>
          <button className="secondary-button" type="button" onClick={onDismissLessonHandoff}>
            继续看评论
          </button>
        </section>
      ) : null}
      {postLoading ? (
        <div className="post-loading" aria-label="加载讨论中">加载讨论中…</div>
      ) : null}
      <article className="social-post detail">
        <header className="post-author">
          {communityPost ? (
            <span className="avatar-wrap">
              <span className={displayPost.author.id === "user" ? "avatar self-avatar" : "avatar"}>{displayPost.author.displayName.slice(0, 1)}</span>
              <span className={displayPost.author.id === "user" ? "ai-badge user-badge" : "ai-badge"}>{displayPost.author.id === "user" ? "我" : "AI"}</span>
            </span>
          ) : (
            <div className="avatar">{displayPost.author.displayName.slice(0, 1)}</div>
          )}
          <div>
            {communityPost && displayPost.author.id !== "user" ? (
              <button className="author-link" type="button" onClick={() => onOpenAgent(displayPost.author.id)}>
                <strong>{displayPost.author.displayName}</strong>
              </button>
            ) : (
              <strong>{displayPost.author.displayName}</strong>
            )}
            <span>
              {displayPost.author.handle} · 楼主 · {displayPost.createdAtLabel}
            </span>
          </div>
          <span className="author-badge">{displayPost.author.role}</span>
        </header>
        <SourceProvenance state={state} source={bundle.source} conceptId={bundle.conceptId} label="讨论" compact />
        <p className="post-body">{displayPost.body}</p>
        <footer className="social-actions detail-actions" aria-label="帖子操作">
          <button type="button" onClick={() => setPostLiked((current) => !current)}>
            赞同 {postLikes + (postLiked ? 1 : 0)}
          </button>
          <button type="button" onClick={() => startComposing(postReplyTarget)}>
            回复 {filterCounts["全部"] + replyCount + userReplies.length}
          </button>
          <button type="button" onClick={() => setBookmarked((current) => !current)}>
            {bookmarked ? "已收藏" : "收藏"}
          </button>
          <button type="button" onClick={() => setShared(true)}>
            {shared ? "已分享" : "分享"}
          </button>
        </footer>
        <button className="primary-button full" type="button" onClick={onStartLesson}>
          {bundle.post.learnCta}
        </button>
      </article>

      <section className="thread-toolbar" aria-label="评论控制">
        <div className="thread-summary">
          <strong>评论区</strong>
          <span>{filterCounts["全部"]} 条主评论 · {replyCount} 条回复</span>
        </div>
        <div className="comment-tabs" role="tablist" aria-label="评论筛选">
          {commentFilters.map((item) => (
            <button
              key={item}
              type="button"
              role="tab"
              aria-selected={filter === item}
              className={filter === item ? "active" : ""}
              onClick={() => setFilter(item)}
            >
              {item}
              <span className="comment-tab-count">{filterCounts[item]}</span>
            </button>
          ))}
        </div>
        <div className="comment-sort" role="radiogroup" aria-label="评论排序">
          {commentSortModes.map((item) => (
            <button
              key={item}
              type="button"
              role="radio"
              aria-checked={sortMode === item}
              className={sortMode === item ? "active" : ""}
              onClick={() => setSortMode(item)}
            >
              {item}
            </button>
          ))}
        </div>
      </section>

      <section className="comments-list" aria-label="评论区">
        {userReplies.map((reply, index) => (
          <article key={`${effectivePostId}-local-reply-${index}`} className="comment-item local-reply">
            <div className="avatar small self-avatar">你</div>
            <div>
              <header>
                <strong>你</strong>
                <span className="comment-meta">刚刚 · 本地草稿</span>
              </header>
              <span className="comment-agent-role">你的理解</span>
              {reply.target ? (
                <div className="local-reply-context">
                  <span>回复 {reply.target.authorName}</span>
                  <blockquote>{reply.target.excerpt}</blockquote>
                </div>
              ) : null}
              <p>{reply.body}</p>
            </div>
          </article>
        ))}
        {comments.map((comment) => (
          <article key={comment.id} className="comment-item">
            {communityPost ? (
              <span className="avatar-wrap">
                <span className={comment.author.id === "user" ? "avatar small self-avatar" : "avatar small"}>{comment.author.displayName.slice(0, 1)}</span>
                <span className={comment.author.id === "user" ? "ai-badge user-badge" : "ai-badge"}>{comment.author.id === "user" ? "我" : "AI"}</span>
              </span>
            ) : (
              <div className="avatar small">{comment.author.displayName.slice(0, 1)}</div>
            )}
            <div>
              <header>
                {communityPost && comment.author.id !== "user" ? (
                  <button className="author-link" type="button" onClick={() => onOpenAgent(comment.author.id)}>
                    <strong>{comment.author.displayName}</strong>
                  </button>
                ) : (
                  <strong>{comment.author.displayName}</strong>
                )}
                {comment.isOp ? <span className="author-badge">楼主</span> : null}
                {freshCommentIds.has(comment.id) ? <span className="author-badge">刚刚</span> : null}
                <span className="comment-meta">热度 {comment.heat + (likedComments.has(comment.id) ? 1 : 0)}</span>
              </header>
              <span className="comment-agent-role">视角 · {comment.author.role}</span>
              <p>{comment.body}</p>
              <footer className="comment-actions" aria-label={`${comment.author.displayName} 的评论操作`}>
                <button type="button" onClick={() => toggleCommentLike(comment.id)}>
                  赞同 {comment.heat + (likedComments.has(comment.id) ? 1 : 0)}
                </button>
                <button
                  type="button"
                  onClick={() => startComposing(buildReplyTarget("comment", comment.author.displayName, comment.body, comment.id))}
                >
                  回复
                </button>
                <button
                  type="button"
                  onClick={() => startComposing(buildReplyTarget("comment", comment.author.displayName, comment.body, comment.id))}
                >
                  引用
                </button>
              </footer>
              {comment.replies?.length ? (
                <div className="comment-replies" aria-label={`${comment.author.displayName} 的回复`}>
                  {comment.replies.map((reply) => renderReply(reply, 2))}
                </div>
              ) : null}
            </div>
          </article>
        ))}
        {isEmpty ? (
          <div className="comments-empty-state">
            <strong>还没有评论</strong>
            <span>成为第一个写下追问或理解的人</span>
          </div>
        ) : null}
        {awaitingResponses ? (
          <div className="typing-indicator" aria-label="等待 AI 居民回应">
            <span className="typing-dot" />
            <span className="typing-dot" />
            <span className="typing-dot" />
            <span>AI 居民正在输入…</span>
          </div>
        ) : null}
      </section>

      <section
        ref={composerRef}
        className={isComposing ? "reply-composer composing" : "reply-composer"}
        aria-label="写回复"
      >
        <div className="avatar small self-avatar">你</div>
        {isComposing ? (
          <div className="reply-editor">
            {replyTarget ? (
              <div className="reply-target-card" aria-label="回复目标">
                <span>回复 {replyTarget.authorName}</span>
                <blockquote>{replyTarget.excerpt}</blockquote>
              </div>
            ) : null}
            <label>
              <span>你的回复</span>
              <textarea
                aria-label="你的回复"
                placeholder="写一句你刚看懂的点，或留下一个追问"
                value={replyText}
                onChange={(event) => setReplyText(event.target.value)}
              />
            </label>
            <div className="reply-editor-actions">
              <button type="button" className="secondary-button" onClick={stopComposing}>
                取消
              </button>
              <button type="button" disabled={!replyText.trim()} onClick={() => void submitReply()}>
                发布回复
              </button>
            </div>
          </div>
        ) : (
          <button type="button" onClick={() => startComposing()}>
            写下你的追问或理解...
          </button>
        )}
      </section>
    </section>
  );
}

function sessionKeyFor(state: AppState): string {
  return state.curriculum?.topic.topicId ?? "anonymous";
}

function adaptCommunityPost(communityPost: CommunityPostDetail): {
  id: string;
  conceptId: string;
  author: FeedAuthor;
  body: string;
  hook: string;
  metricText: string;
  learnCta: string;
  createdAtLabel: string;
} {
  return {
    id: communityPost.postId,
    conceptId: communityPost.conceptId,
    author: communityPost.author
      ? {
          id: communityPost.author.agentId,
          displayName: communityPost.author.displayName,
          handle: communityPost.author.handle,
          role: communityPost.author.bio,
          stance: "看热闹"
        }
      : {
          id: "user",
          displayName: "你",
          handle: "@me",
          role: "学习者",
          stance: "学习分身"
        },
    body: communityPost.content,
    hook: "",
    metricText: `${communityPost.likeCount} 赞同 · ${communityPost.commentCount} 评论 · 热度 ${communityPost.heat}`,
    learnCta: "开始微课",
    createdAtLabel: formatCreatedAt(communityPost.createdAt)
  };
}

function toFeedComment(comment: CommunityComment): FeedComment {
  return {
    id: comment.commentId,
    author: feedAuthorFor(comment.agentId, comment.userId, comment.author),
    body: comment.content,
    heat: comment.heat,
    stance: mapCommentStance(comment.stance),
    isOp: comment.isOp,
    replies: comment.replies.map(toFeedCommentReply)
  };
}

function toFeedCommentReply(reply: CommunityComment): FeedCommentReply {
  return {
    id: reply.commentId,
    author: feedAuthorFor(reply.agentId, reply.userId, reply.author),
    body: reply.content,
    heat: reply.heat,
    replyToCommentId: reply.parentCommentId ?? "",
    relation: mapRelation(reply.relation),
    quote: "",
    isOp: reply.isOp,
    replies: reply.replies.length > 0 ? reply.replies.map(toFeedCommentReply) : undefined
  };
}

function feedAuthorFor(
  agentId: string | null,
  userId: string | null,
  author: { agentId: string; displayName: string; handle: string; bio: string } | null
): FeedAuthor {
  if (agentId && author) {
    return {
      id: author.agentId,
      displayName: author.displayName,
      handle: author.handle,
      role: author.bio,
      stance: "看热闹"
    };
  }
  return {
    id: userId ? "user" : "unknown",
    displayName: userId ? "你" : "匿名居民",
    handle: userId ? "@me" : "@anon",
    role: userId ? "学习者" : "社区居民",
    stance: "学习分身"
  };
}

function buildOwnComment(commentId: string, body: string, target: ReplyTarget | undefined): FeedComment {
  return {
    id: commentId,
    author: {
      id: "user",
      displayName: "你",
      handle: "@me",
      role: "学习者",
      stance: "学习分身"
    },
    body,
    heat: 0,
    stance: "补充",
    replies: []
  };
}

function insertIntoComments(comments: FeedComment[], parentId: string, reply: FeedComment): FeedComment[] {
  return comments.map((comment) => {
    if (comment.id === parentId) {
      const nested: FeedCommentReply = {
        id: reply.id,
        author: reply.author,
        body: reply.body,
        heat: reply.heat,
        replyToCommentId: parentId,
        relation: "补充",
        replies: []
      };
      return { ...comment, replies: [...(comment.replies ?? []), nested] };
    }
    return { ...comment, replies: insertIntoReplies(comment.replies ?? [], parentId, reply) };
  });
}

function insertIntoReplies(replies: FeedCommentReply[], parentId: string, reply: FeedComment): FeedCommentReply[] {
  return replies.map((item) => {
    if (item.id === parentId) {
      const nested: FeedCommentReply = {
        id: reply.id,
        author: reply.author,
        body: reply.body,
        heat: reply.heat,
        replyToCommentId: parentId,
        relation: "补充",
        replies: []
      };
      return { ...item, replies: [...(item.replies ?? []), nested] };
    }
    return { ...item, replies: insertIntoReplies(item.replies ?? [], parentId, reply) };
  });
}

function collectCommentIds(comments: Array<FeedComment | FeedCommentReply>): Set<string> {
  const ids = new Set<string>();
  const walk = (items: Array<FeedComment | FeedCommentReply>) => {
    for (const item of items) {
      ids.add(item.id);
      walk(item.replies ?? []);
    }
  };
  walk(comments);
  return ids;
}

function hasAgentComment(comments: CommunityComment[]): boolean {
  return comments.some((comment) => Boolean(comment.agentId) || hasAgentComment(comment.replies));
}

function mapCommentStance(stance: string): "赞成" | "反对" | "补充" | "挑刺" {
  switch (stance) {
    case "supportive":
    case "support":
      return "赞成";
    case "opposing":
    case "oppose":
      return "反对";
    case "question":
    case "doubt":
      return "挑刺";
    case "sharing":
    case "add":
    default:
      return "补充";
  }
}

function mapRelation(relation: string): "追问" | "补充" | "反驳" {
  switch (relation) {
    case "追问":
    case "question":
      return "追问";
    case "反驳":
    case "refute":
      return "反驳";
    case "补充":
    case "add":
    case "support":
    default:
      return "补充";
  }
}

function formatCreatedAt(iso: string): string {
  try {
    const date = new Date(iso);
    const now = new Date();
    const diffMinutes = Math.max(0, Math.floor((now.getTime() - date.getTime()) / 60000));
    if (diffMinutes < 60) return `${diffMinutes} 分钟前`;
    const diffHours = Math.floor(diffMinutes / 60);
    if (diffHours < 24) return `${diffHours} 小时前`;
    return `${Math.floor(diffHours / 24)} 天前`;
  } catch {
    return iso;
  }
}

function buildReplyTarget(kind: ReplyTarget["kind"], authorName: string, body: string, commentId?: string): ReplyTarget {
  return {
    kind,
    authorName,
    excerpt: compactQuote(body),
    commentId
  };
}

function compactQuote(body: string): string {
  const normalized = body.replace(/\s+/g, " ").trim();
  return normalized.length > 56 ? `${normalized.slice(0, 56)}...` : normalized;
}
