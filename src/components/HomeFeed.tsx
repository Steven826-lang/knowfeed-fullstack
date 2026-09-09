import { useEffect, useState } from "react";
import {
  buildCommunityFeedContext,
  fetchCommunityFeed,
  formatCommunityTime,
  recordFeedPreferences,
  type CommunityFeedPost,
  type CommunityPreference
} from "../domain/communityApi";
import { countCommentReplies, getPrimaryPost } from "../domain/feedEngine";
import { getActiveCurriculum } from "../domain/learningEngine";
import type { AppState, CurriculumSource, DailyMission, FeedPost, GeneratedKnowledgeBundle, ResearchBrief } from "../domain/types";
import { SourceProvenance } from "./SourceProvenance";

interface HomeFeedProps {
  state: AppState;
  mission: DailyMission;
  bundle: GeneratedKnowledgeBundle;
  onStartDaily: () => void;
  onStartConcept: (conceptId: string) => void;
  onOpenPost: (postId?: string) => void;
  onOpenMap: () => void;
  onOpenAgent: (agentId: string) => void;
  onNewPost: () => void;
}

export function HomeFeed({
  state,
  mission,
  bundle,
  onStartDaily,
  onStartConcept,
  onOpenPost,
  onOpenMap,
  onOpenAgent,
  onNewPost
}: HomeFeedProps) {
  const [communityPosts, setCommunityPosts] = useState<CommunityFeedPost[]>([]);
  const [feedLoading, setFeedLoading] = useState(false);
  const [feedbackMenuOpen, setFeedbackMenuOpen] = useState(false);
  const [feedbackHint, setFeedbackHint] = useState<string | null>(null);
  const [feedRefreshKey, setFeedRefreshKey] = useState(0);

  useEffect(() => {
    if (!state.communityWorldId || !bundle.conceptId) return;
    const worldId = state.communityWorldId;
    let cancelled = false;
    setFeedLoading(true);
    fetchCommunityFeed(worldId, buildCommunityFeedContext(state, bundle.conceptId, { limit: 10 }))
      .then((result) => {
        if (!cancelled) setCommunityPosts(result.posts);
      })
      .catch((error) => console.error("community feed load failed", error))
      .finally(() => setFeedLoading(false));
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.communityWorldId, bundle.conceptId, feedRefreshKey]);

  useEffect(() => {
    if (!feedbackHint) return;
    const timer = window.setTimeout(() => setFeedbackHint(null), 4000);
    return () => window.clearTimeout(timer);
  }, [feedbackHint]);

  const communityPost = communityPosts && communityPosts.length > 0 ? communityPosts[0] : undefined;
  const post = communityPost ? adaptCommunityPost(communityPost, bundle) : getPrimaryPost(bundle);
  const extraPosts = communityPosts && communityPosts.length > 0 ? communityPosts.slice(1) : [];
  const curriculum = getActiveCurriculum(state);
  const activeOrder = curriculum.concepts.find((concept) => concept.id === mission.conceptId)?.order ?? 1;
  const upcoming = curriculum.concepts.filter((concept) => concept.order > activeOrder).slice(0, 3);
  const pathPreview = curriculum.concepts.slice(0, 5);
  const previewComments = (bundle.comments || []).slice(0, 2);
  const replyCount = countCommentReplies(bundle.comments || []);
  const totalThreadItems = communityPost ? communityPost.commentCount : (bundle.comments || []).length + replyCount;
  const postLikes = communityPost ? communityPost.likeCount : Math.max(12, Math.round((bundle.comments || []).reduce((sum, comment) => sum + comment.heat, 0) / 3));

  // Recommendation feedback (spec 7.3 多推/少推): persist preferences locally,
  // then reload the feed so the recommender applies them immediately.
  function handleFeedback(direction: "more" | "less") {
    setFeedbackMenuOpen(false);
    const conceptId = communityPost?.conceptId ?? bundle.conceptId;
    const preferences: CommunityPreference[] = [];
    if (direction === "more") {
      preferences.push({ preference_type: "like_topic", target_value: conceptId, strength: 1.0 });
      const handle = communityPost?.author?.handle;
      if (handle) preferences.push({ preference_type: "like_author", target_value: handle, strength: 1.0 });
    } else {
      preferences.push({ preference_type: "dislike_topic", target_value: conceptId, strength: 1.0 });
      if (communityPost?.stance) {
        preferences.push({ preference_type: "dislike_stance", target_value: communityPost.stance, strength: 1.0 });
      }
    }
    recordFeedPreferences(preferences);
    setFeedbackHint("已调整推荐");
    setFeedRefreshKey((key) => key + 1);
  }

  return (
    <div className="feed-stack">
      <div className="presence-badge">
        {feedLoading ? "加载社区中…" : communityPosts.length > 0 ? `${Math.min(50, communityPosts.length * 3 + 8)} 人正在讨论这个知识点` : "加载社区中…"}
      </div>
      <div className="feed-composer-card">
        <button className="composer-input" type="button" onClick={onNewPost}>
          发个帖，让 AI 居民来聊聊…
        </button>
        <button className="composer-action" type="button" onClick={onNewPost}>
          发帖
        </button>
      </div>
      <article className="social-post feed-post" aria-label="生成的社区讨论">
        <header className="post-author">
          {communityPost ? (
            <span className="avatar-wrap">
              <span className={post.author.id === "user" ? "avatar self-avatar" : "avatar"}>{post.author.name?.slice(0, 1) || post.author.displayName?.slice(0, 1) || "?"}</span>
              <span className={post.author.id === "user" ? "ai-badge user-badge" : "ai-badge"}>{post.author.id === "user" ? "我" : "AI"}</span>
            </span>
          ) : (
            <div className="avatar">{post.author.name?.slice(0, 1) || post.author.displayName?.slice(0, 1) || "?"}</div>
          )}
          <div>
            {communityPost && post.author.id !== "user" ? (
              <button className="author-link" type="button" onClick={() => onOpenAgent(post.author.id)}>
                <strong>{post.author.name || post.author.displayName || "未知作者"}</strong>
              </button>
            ) : (
              <strong>{post.author.name || post.author.displayName || "未知作者"}</strong>
            )}
            <span>
              {post.author.role || post.author.handle || ""} · {post.createdAtLabel || post.timestamp ? formatCommunityTime(post.timestamp) : "刚刚"}
            </span>
          </div>
          {communityPost?.isHot ? <span className="author-badge">热</span> : null}
          <div className="post-feedback">
            <button
              className="icon-button"
              type="button"
              aria-label="推荐反馈"
              aria-haspopup="menu"
              aria-expanded={feedbackMenuOpen}
              title="多推 / 少推这类帖子"
              onClick={() => setFeedbackMenuOpen((open) => !open)}
            >
              ···
            </button>
            {feedbackMenuOpen ? (
              <div className="feedback-menu" role="menu" aria-label="推荐反馈选项">
                <button type="button" role="menuitem" onClick={() => handleFeedback("more")}>
                  多推这类
                </button>
                <button type="button" role="menuitem" onClick={() => handleFeedback("less")}>
                  少推这类
                </button>
                <button type="button" role="menuitem" onClick={() => setFeedbackMenuOpen(false)}>
                  取消
                </button>
              </div>
            ) : null}
          </div>
        </header>
        <SourceProvenance state={state} source={bundle.source} conceptId={bundle.conceptId} label="讨论" compact />
        {feedbackHint ? (
          <span className="source-pill feedback-hint" role="status">
            {feedbackHint}
          </span>
        ) : null}
        <p className="post-body">{post.body}</p>
        {communityPost?.reason ? <span className="source-pill community-reason">{communityPost.reason}</span> : null}
        <footer className="social-actions" aria-label="帖子操作">
          <button type="button" disabled title="赞同功能即将上线">
            赞同 {postLikes}
          </button>
          <button type="button" onClick={() => onOpenPost(communityPost?.postId)}>
            评论 {totalThreadItems}
          </button>
          <button type="button" disabled title="收藏功能即将上线">
            收藏
          </button>
          <button type="button" disabled title="分享功能即将上线">
            分享
          </button>
        </footer>
        <button className="hook-card" type="button" aria-label={post.learnCta} onClick={() => onOpenPost(communityPost?.postId)}>
          <strong>{post.learnCta}</strong>
          <span>{post.hook}</span>
        </button>
        <div className="preview-comments" aria-label="评论预览">
          {previewComments.map((comment) => (
            <button key={comment.id} type="button" onClick={() => onOpenPost(communityPost?.postId)}>
              <div className="preview-comment-author">
                <strong>{comment.author.displayName}</strong>
                <small>{comment.author.handle}</small>
              </div>
              <span className="preview-comment-body">{comment.body}</span>
            </button>
          ))}
        </div>
        <footer className="post-metrics">{post.metricText}</footer>
      </article>

      {extraPosts.length > 0 ? (
        <section className="feed-stack" aria-label="更多社区讨论">
          {extraPosts.map((extra) => (
            <article key={extra.postId} className="social-post feed-post">
              <header className="post-author">
                <span className="avatar-wrap">
                  <span className={extra.userId ? "avatar self-avatar" : "avatar"}>
                    {(extra.userId ? "你" : extra.author?.displayName ?? "匿").slice(0, 1)}
                  </span>
                  <span className={extra.userId ? "ai-badge user-badge" : "ai-badge"}>{extra.userId ? "我" : "AI"}</span>
                </span>
                <div>
                  {extra.agentId ? (
                    <button className="author-link" type="button" onClick={() => onOpenAgent(extra.agentId!)}>
                      <strong>{extra.author?.displayName ?? "匿名居民"}</strong>
                    </button>
                  ) : (
                    <strong>{extra.userId ? "你" : extra.author?.displayName ?? "匿名居民"}</strong>
                  )}
                  <span>
                    {extra.userId ? "@me" : extra.author?.handle ?? ""} · {formatCommunityTime(extra.createdAt)}
                  </span>
                </div>
                {extra.isHot ? <span className="author-badge">热</span> : null}
              </header>
              <p className="post-body">{extra.content}</p>
              {extra.reason ? <span className="source-pill community-reason">{extra.reason}</span> : null}
              <footer className="social-actions" aria-label="帖子操作">
                <button type="button" onClick={() => onOpenPost(extra.postId)}>
                  ⬆️ {extra.likeCount}
                </button>
                <button type="button" onClick={() => onOpenPost(extra.postId)}>
                  💬 {extra.commentCount}
                </button>
                <button type="button" onClick={() => onOpenPost(extra.postId)}>
                  查看讨论
                </button>
              </footer>
            </article>
          ))}
        </section>
      ) : null}

      <section className="feed-learning-card" aria-label="今日学习任务">
        <div>
          <p className="eyebrow">今日任务 · {mission.minutes} 分钟</p>
          <h2>{mission.title}</h2>
          <p>{mission.reason}</p>
        </div>
        <button className="primary-button" type="button" onClick={onStartDaily}>
          直接开始
        </button>
      </section>

      <section className="feed-topic-bar" aria-label="当前学习主题">
        <div>
          <p className="eyebrow">正在学习</p>
          <strong>{curriculum.topic.title}</strong>
          <span>{curriculum.promise}</span>
        </div>
        <button className="composer-action" type="button" onClick={onOpenMap}>
          路径
        </button>
        <span>{buildCurriculumSourceLabel(curriculum.source, curriculum.researchBrief?.source)}</span>
      </section>

      <section className="feed-path-strip" aria-label="学习路径预览">
        <header>
          <div>
            <p className="eyebrow">学习路径</p>
            <strong>{state.progress.completedLessonIds.length} 个任务已完成</strong>
          </div>
          <button className="text-button" type="button" onClick={onOpenMap}>
            查看完整地图
          </button>
        </header>
        <div className="path-chip-list">
          {pathPreview.map((concept) => (
            <button
              key={concept.id}
              type="button"
              className={concept.id === mission.conceptId ? "path-chip active" : "path-chip"}
              onClick={() => onStartConcept(concept.id)}
            >
              <span>{concept.order}</span>
              {concept.title}
            </button>
          ))}
        </div>
      </section>

      <section className="scroll-teasers" aria-label="后续钩子">
        <h3>继续刷会遇到</h3>
        <div className="teaser-list">
          {upcoming.map((concept) => (
            <button key={concept.id} type="button" onClick={() => onStartConcept(concept.id)}>
              {concept.unlockHint}
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}

function adaptCommunityPost(communityPost: CommunityFeedPost, bundle: GeneratedKnowledgeBundle): FeedPost {
  return {
    id: communityPost.postId,
    conceptId: communityPost.conceptId,
    author: communityPost.author
      ? {
          id: communityPost.agentId ?? "user",
          displayName: communityPost.author.name ?? communityPost.author.displayName ?? "匿名居民",
          handle: communityPost.author.role ?? communityPost.author.handle ?? "@anon",
          role: "社区居民",
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
    hook: bundle.post?.hook || "继续学习",
    metricText: `${communityPost.likeCount} 赞同 · ${communityPost.commentCount} 评论 · 热度 ${communityPost.heat}`,
    learnCta: bundle.post?.learnCta || "看懂讨论",
    createdAtLabel: formatCommunityTime(communityPost.createdAt)
  };
}

function buildCurriculumSourceLabel(
  source: CurriculumSource,
  researchSource: ResearchBrief["source"] | undefined
): string {
  if (source === "planner") return researchSource === "web" ? "研究 + AI" : "AI 路径";
  if (source === "deterministic-fallback") return "离线演示";
  return "示例内容";
}
