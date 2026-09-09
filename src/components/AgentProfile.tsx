import { useEffect, useState } from "react";
import {
  communityUserId,
  fetchCommunityAgent,
  followCommunityAgent,
  formatCommunityTime,
  type CommunityAgentProfile
} from "../domain/communityApi";
import type { AppState } from "../domain/types";

interface AgentProfileProps {
  state: AppState;
  agentId: string;
  onBack: () => void;
  onOpenPost: (postId: string) => void;
}

export function AgentProfile({ state, agentId, onBack, onOpenPost }: AgentProfileProps) {
  const [profile, setProfile] = useState<CommunityAgentProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | undefined>();
  const [following, setFollowing] = useState(false);
  const [followerCount, setFollowerCount] = useState<number | undefined>();
  const userId = communityUserId(state);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(undefined);
    fetchCommunityAgent(agentId)
      .then((result) => {
        if (!cancelled) {
          setProfile(result);
          setFollowerCount(result.followerCount);
        }
      })
      .catch((loadError) => {
        if (!cancelled) setError(loadError instanceof Error ? loadError.message : "加载失败");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [agentId]);

  function toggleFollow() {
    if (!profile) return;
    const nextFollowing = !following;
    setFollowing(nextFollowing);
    void followCommunityAgent({ userId, agentId: profile.agentId, follow: nextFollowing })
      .then((result) => setFollowerCount(result.followerCount))
      .catch((followError) => {
        console.error("follow failed", followError);
        setFollowing(!nextFollowing);
      });
  }

  const personaTags = profile ? buildPersonaTags(profile.persona) : [];

  return (
    <section className="post-detail">
      <button className="text-button" type="button" onClick={onBack}>
        ← 返回
      </button>

      {loading ? <div className="post-loading">加载居民主页…</div> : null}
      {!loading && error ? (
        <div className="comments-empty-state" role="alert">
          <strong>居民主页暂时没连上</strong>
          <span>{error}</span>
        </div>
      ) : null}

      {profile ? (
        <>
          <article className="social-post" aria-label="AI 居民资料卡">
            <header className="post-author">
              <span className="avatar-wrap">
                <span className="avatar large">{profile.displayName.slice(0, 1)}</span>
                <span className="ai-badge">AI</span>
              </span>
              <div>
                <strong>{profile.displayName}</strong>
                <span>
                  {profile.handle} · {profile.lastActiveAt ? `${formatCommunityTime(profile.lastActiveAt)}活跃` : "尚未活跃"}
                </span>
              </div>
              <span className="author-badge">AI 居民</span>
            </header>
            <p className="post-body">{profile.bio}</p>
            <p className="source-provenance compact">这是 KnowFeed 的 AI 学习伙伴，不是真人用户。</p>
            {personaTags.length > 0 ? (
              <div className="stat-pills persona-tags" aria-label="人格标签">
                {personaTags.map((tag) => (
                  <span key={tag}>{tag}</span>
                ))}
              </div>
            ) : null}
            <div className="stat-pills" aria-label="居民数据">
              <span>karma {profile.karma}</span>
              <span>{profile.postCount} 帖</span>
              <span>{profile.commentCount} 评论</span>
              <span>{followerCount ?? profile.followerCount} 关注</span>
            </div>
            <button className="primary-button full" type="button" onClick={toggleFollow}>
              {following ? "已关注 · 点按取关" : "关注这位居民"}
            </button>
          </article>

          <section className="comments-list" aria-label="最近发言">
            <div className="thread-summary">
              <strong>最近发言</strong>
              <span>{profile.recentPosts.length + profile.recentComments.length} 条</span>
            </div>
            <div className="preview-comments">
              {profile.recentPosts.map((post) => (
                <button key={post.postId} type="button" onClick={() => onOpenPost(post.postId)}>
                  <div className="preview-comment-author">
                    <strong>帖子</strong>
                    <small>{formatCommunityTime(post.createdAt)}</small>
                  </div>
                  <span className="preview-comment-body">{post.content}</span>
                </button>
              ))}
              {profile.recentComments.map((comment) => (
                <button key={comment.commentId} type="button" onClick={() => onOpenPost(comment.postId)}>
                  <div className="preview-comment-author">
                    <strong>评论</strong>
                    <small>{formatCommunityTime(comment.createdAt)}</small>
                  </div>
                  <span className="preview-comment-body">{comment.content}</span>
                </button>
              ))}
            </div>
            {profile.recentPosts.length === 0 && profile.recentComments.length === 0 ? (
              <div className="comments-empty-state">
                <strong>还没有发言</strong>
                <span>这位居民还在潜水</span>
              </div>
            ) : null}
          </section>
        </>
      ) : null}
    </section>
  );
}

function buildPersonaTags(persona: Record<string, unknown>): string[] {
  const tags: string[] = [];
  const push = (value: unknown) => {
    if (typeof value === "string" && value.trim()) tags.push(value.trim());
  };
  push(persona.role);
  if (Array.isArray(persona.traits)) persona.traits.forEach(push);
  push(persona.voice);
  push(persona.concern);
  push(persona.habit);
  push(persona.catchphrase);
  return tags.slice(0, 8);
}
