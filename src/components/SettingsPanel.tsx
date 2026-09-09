import { useState } from "react";
import type { AppState, GenerationSource, ShadowDraft } from "../domain/types";
import { SourceProvenance } from "./SourceProvenance";

interface SettingsPanelProps {
  state: AppState;
  currentDraft: ShadowDraft;
  currentSource: GenerationSource;
  onApproveDraft: (draftId: string) => void;
  onUpdateDraft: (draftId: string, body: string) => void;
  onRejectDraft: (draftId: string) => void;
  onReset: () => void;
}

export function SettingsPanel({
  state,
  currentDraft,
  currentSource,
  onApproveDraft,
  onUpdateDraft,
  onRejectDraft,
  onReset
}: SettingsPanelProps) {
  const [draftEdits, setDraftEdits] = useState<Record<string, string>>({});
  const [isConfirmingReset, setIsConfirmingReset] = useState(false);
  const [savingDraftId, setSavingDraftId] = useState<string | null>(null);
  const [approvingDraftId, setApprovingDraftId] = useState<string | null>(null);
  const [draftError, setDraftError] = useState<string | null>(null);
  const pendingDrafts = state.shadowDrafts;

  async function handleUpdateDraft(draftId: string, body: string) {
    setDraftError(null);
    setSavingDraftId(draftId);
    try {
      await onUpdateDraft(draftId, body);
      setDraftEdits((current) => ({
        ...current,
        [draftId]: body
      }));
    } catch (error) {
      setDraftError(error instanceof Error ? error.message : "保存失败，请重试");
    } finally {
      setSavingDraftId(null);
    }
  }

  async function handleApproveDraft(draftId: string) {
    setDraftError(null);
    setApprovingDraftId(draftId);
    try {
      await onApproveDraft(draftId);
    } catch (error) {
      setDraftError(error instanceof Error ? error.message : "批准失败，请重试");
    } finally {
      setApprovingDraftId(null);
    }
  }

  return (
    <section className="settings-screen">
      <div className="settings-header">
        <div className="avatar large">设</div>
        <div>
          <p className="eyebrow">设置</p>
          <h2>学习分身、进度和原型选项</h2>
        </div>
      </div>

      <div className="settings-stats">
        <span>{state.progress.xp} XP</span>
        <span>{state.progress.streak} 天连续</span>
        <span>{state.approvedShadowPosts.length} 条已批准</span>
      </div>

      <section className="draft-list" aria-label="AI 学习分身">
        <h3>AI 学习分身</h3>
        <p className="settings-copy">它只替你起草，不替你公开发言。完成微课后，草稿会出现在这里。</p>
        <div className="draft-section-heading">
          <strong>可发布草稿</strong>
          <span>{pendingDrafts.length} 条待处理</span>
        </div>
        {draftError ? (
          <p className="draft-error" role="alert">{draftError}</p>
        ) : null}
        {pendingDrafts.length === 0 ? (
          <article className="draft-card empty-draft">
            <strong>没有待发布草稿</strong>
            <p>完成微课后，分身会根据你的学习记录生成可编辑草稿。</p>
            <div className="draft-preview">
              <span className="ai-generated-badge">AI 生成预览</span>
              <SourceProvenance
                state={state}
                source={currentDraft.generationSource ?? currentSource}
                conceptId={currentDraft.conceptId}
                label="分身草稿"
                compact
              />
              <p>{currentDraft.body}</p>
            </div>
          </article>
        ) : (
          pendingDrafts.map((draft) => {
            const draftText = draftEdits[draft.id] ?? draft.body;
            const trimmedDraft = draftText.trim();

            return (
              <article key={draft.id} className="draft-card pending-draft">
                <div className="draft-card-header">
                  <strong>AI 生成草稿</strong>
                  <span className="ai-generated-badge">AI 生成 · 需你确认</span>
                </div>
                <SourceProvenance
                  state={state}
                  source={draft.generationSource ?? currentSource}
                  conceptId={draft.conceptId}
                  label="分身草稿"
                  compact
                />
                <DraftBasis state={state} draft={draft} />
                <label className="draft-editor">
                  <span>编辑分身草稿</span>
                  <textarea
                    aria-label="编辑分身草稿"
                    value={draftText}
                    onChange={(event) =>
                      setDraftEdits((current) => ({
                        ...current,
                        [draft.id]: event.target.value
                      }))
                    }
                  />
                </label>
                <footer>
                  <span>自信度 {draft.confidence}%</span>
                  <div className="draft-actions">
                    <button
                      className="secondary-button"
                      type="button"
                      disabled={!trimmedDraft || savingDraftId === draft.id || approvingDraftId === draft.id}
                      onClick={() => handleUpdateDraft(draft.id, trimmedDraft)}
                      aria-busy={savingDraftId === draft.id}
                    >
                      {savingDraftId === draft.id ? "保存中…" : "保存修改"}
                    </button>
                    <button
                      className="secondary-button"
                      type="button"
                      onClick={() => onRejectDraft(draft.id)}
                      disabled={approvingDraftId === draft.id || savingDraftId === draft.id}
                    >
                      拒绝草稿
                    </button>
                    <button
                      type="button"
                      onClick={() => handleApproveDraft(draft.id)}
                      disabled={approvingDraftId === draft.id || savingDraftId === draft.id}
                      aria-busy={approvingDraftId === draft.id}
                    >
                      {approvingDraftId === draft.id ? "批准中…" : "批准发布"}
                    </button>
                  </div>
                </footer>
              </article>
            );
          })
        )}
      </section>

      <section className="draft-list approved-list">
        <h3>已批准内容</h3>
        {state.approvedShadowPosts.length === 0 ? (
          <article className="draft-card empty-draft">
            <p>还没有批准发布的分身内容。</p>
          </article>
        ) : (
          state.approvedShadowPosts.map((post) => (
            <article key={post.id} className="draft-card approved-draft">
              <SourceProvenance
                state={state}
                source={post.generationSource ?? currentSource}
                conceptId={post.conceptId}
                label="已批准分身内容"
                compact
              />
              <p>{post.body}</p>
              <footer>
                <span>已批准 · AI 生成，经你确认 · 自信度 {post.confidence}%</span>
              </footer>
            </article>
          ))
        )}
      </section>

      <section className="reset-confirmation" aria-label="重置原型进度">
        {isConfirmingReset ? (
          <>
            <p>重置会清空本机进度、学习路径和分身草稿。</p>
            <div>
              <button className="secondary-button" type="button" onClick={() => setIsConfirmingReset(false)}>
                取消
              </button>
              <button className="danger-button" type="button" onClick={onReset}>
                确认重置
              </button>
            </div>
          </>
        ) : (
          <button className="danger-button" type="button" onClick={() => setIsConfirmingReset(true)}>
            重置原型进度
          </button>
        )}
      </section>
    </section>
  );
}

function DraftBasis({ state, draft }: { state: AppState; draft: ShadowDraft }) {
  const topicTitle = state.curriculum?.topic.title ?? state.progress.activeTopic;
  const concept = state.curriculum?.concepts.find((item) => item.id === draft.conceptId);
  const completedCount = state.progress.completedLessonIds.length;
  const mastery = Math.round(state.progress.conceptMastery[draft.conceptId] ?? 0);
  const motivation = state.curriculum?.learner.motivation;

  return (
    <section className="draft-basis" aria-label="依据的学习记录">
      <h4>依据的学习记录</h4>
      <ul>
        <li>主题：{topicTitle}</li>
        <li>当前概念：{concept?.title ?? draft.conceptId}</li>
        <li>已完成 {completedCount} 个微课</li>
        <li>概念掌握度 {mastery}%</li>
        {motivation && <li>学习目标：{motivation}</li>}
      </ul>
    </section>
  );
}
