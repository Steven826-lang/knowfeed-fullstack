import { useState } from "react";
import { communityUserId, createCommunityPost, type CommunityStance } from "../domain/communityApi";
import type { AppState } from "../domain/types";

interface NewPostProps {
  state: AppState;
  worldId?: string;
  currentConceptId: string;
  onCancel: () => void;
  onPosted: (postId: string) => void;
}

const stanceOptions: Array<{ label: string; hint: string; stance: CommunityStance }> = [
  { label: "提问", hint: "我有个问题想请教", stance: "question" },
  { label: "分享", hint: "分享一个理解或案例", stance: "sharing" },
  { label: "质疑", hint: "我对某个说法有异议", stance: "opposing" },
  { label: "吐槽", hint: "随便聊聊学习感受", stance: "neutral" }
];

export function NewPost({ state, worldId, currentConceptId, onCancel, onPosted }: NewPostProps) {
  const [content, setContent] = useState("");
  const [stance, setStance] = useState<CommunityStance>("question");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const conceptTitle = state.curriculum?.concepts.find((concept) => concept.id === currentConceptId)?.title;

  async function submit() {
    const trimmed = content.trim();
    if (!trimmed || !worldId || submitting) return;
    setSubmitting(true);
    setError(undefined);
    try {
      const result = await createCommunityPost({
        worldId,
        userId: communityUserId(state),
        content: trimmed,
        stance,
        conceptId: currentConceptId
      });
      onPosted(result.postId);
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "发布失败，请重试");
      setSubmitting(false);
    }
  }

  return (
    <section className="post-detail">
      <button className="text-button" type="button" onClick={onCancel}>
        ← 返回社区
      </button>

      <article className="social-post" aria-label="发新帖">
        <header className="post-author">
          <span className="avatar-wrap">
            <span className="avatar self-avatar">你</span>
            <span className="ai-badge user-badge">我</span>
          </span>
          <div>
            <strong>发个帖</strong>
            <span>{conceptTitle ? `关联知识点：${conceptTitle}` : "发到整个社区"}</span>
          </div>
        </header>

        <div className="comment-sort stance-picker" role="radiogroup" aria-label="帖子立场">
          {stanceOptions.map((option) => (
            <button
              key={option.stance}
              type="button"
              role="radio"
              aria-checked={stance === option.stance}
              className={stance === option.stance ? "active" : ""}
              title={option.hint}
              onClick={() => setStance(option.stance)}
            >
              {option.label}
            </button>
          ))}
        </div>

        <div className="reply-editor">
          <label>
            <span>帖子内容</span>
            <textarea
              aria-label="帖子内容"
              placeholder="说说你的问题、理解或反对意见，AI 居民会来回应…"
              value={content}
              onChange={(event) => setContent(event.target.value)}
            />
          </label>
          {error ? <p className="composer-error">{error}</p> : null}
          {!worldId ? <p className="comment-meta">社区准备中，稍等一下再发</p> : null}
          <div className="reply-editor-actions">
            <button type="button" className="secondary-button" onClick={onCancel}>
              取消
            </button>
            <button type="button" disabled={!content.trim() || !worldId || submitting} onClick={() => void submit()}>
              {submitting ? "发布中…" : "发布帖子"}
            </button>
          </div>
        </div>
      </article>

      <p className="post-metrics">发布后不会立刻有人秒回——AI 居民会在半分钟到一分半内陆续回应，帖子页会自动更新。</p>
    </section>
  );
}
