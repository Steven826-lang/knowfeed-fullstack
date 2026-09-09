import { useEffect, useState } from "react";
import { getLessonById } from "../domain/learningEngine";
import type { AppState, DailyMission, GeneratedKnowledgeBundle, LessonResult } from "../domain/types";
import { SourceProvenance } from "./SourceProvenance";

interface MicroLessonProps {
  activeMission: DailyMission;
  state: AppState;
  bundle: GeneratedKnowledgeBundle;
  onBack: () => void;
  onComplete: (result: LessonResult) => void;
}

export function MicroLesson({ activeMission, state, bundle, onBack, onComplete }: MicroLessonProps) {
  const stableLesson = getLessonById(state, activeMission.lessonId);
  const [selectedChoiceId, setSelectedChoiceId] = useState(stableLesson?.choices?.[0]?.id ?? "");
  const [freeResponse, setFreeResponse] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const selectedChoice = stableLesson?.choices?.find((choice) => choice.id === selectedChoiceId);
  const hasChoices = Boolean(stableLesson?.choices && stableLesson.choices.length > 0);
  const canSubmit = !isSubmitting; // 不再强依赖 hasChoices，因为新的 AI 生成可能没有 choice

  useEffect(() => {
    setSelectedChoiceId(stableLesson?.choices?.[0]?.id ?? "");
    setFreeResponse("");
    setIsSubmitting(false);
  }, [stableLesson?.id]);

  async function submit() {
    if (!canSubmit) return;
    setIsSubmitting(true);
    try {
      await onComplete({
        lessonId: activeMission.lessonId,
        conceptId: activeMission.conceptId,
        selectedChoiceId,
        freeResponse,
        completedAt: new Date().toISOString()
      });
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <section className="lesson-screen">
      <button className="text-button" type="button" onClick={onBack}>
        ← 返回信息流
      </button>
      <section className="lesson-context-card" aria-label="课程来源讨论">
        <div className="post-author">
          <div className="avatar tiny">{bundle.post.author.name?.slice(0, 1) || bundle.post.author.displayName?.slice(0, 1) || "?"}</div>
          <div>
            <strong>来自这条讨论</strong>
            <span>
              {bundle.post.author.name || bundle.post.author.displayName || "未知作者"} · {bundle.post.createdAtLabel || "刚刚"}
            </span>
          </div>
        </div>
        <p>{bundle.post.body}</p>
        <button className="text-button" type="button" onClick={onBack}>
          回到原帖
        </button>
      </section>
      <p className="eyebrow">微任务 · {activeMission.minutes} 分钟</p>
      <SourceProvenance state={state} source={bundle.source} conceptId={bundle.conceptId} label="微课" compact />
      <h2>{bundle.lesson.title}</h2>
      <p className="lesson-hook">{bundle.lesson.hook}</p>

      <div className="lesson-block">
        <h3>先抓住这一点</h3>
        <p>{bundle.lesson.explanation}</p>
        <p className="analogy">{bundle.lesson.analogy}</p>
      </div>

      <div className="choice-block">
        <h3>快速判断</h3>
        {hasChoices ? (
          stableLesson!.choices.map((choice) => (
            <label key={choice.id} className={selectedChoiceId === choice.id ? "choice selected" : "choice"}>
              <input
                type="radio"
                name="lesson-choice"
                value={choice.id}
                checked={selectedChoiceId === choice.id}
                onChange={() => setSelectedChoiceId(choice.id)}
                disabled={isSubmitting}
              />
              <span>{choice.label}</span>
            </label>
          ))
        ) : (
          <p className="choice-empty-notice">本题暂无选项，请直接填写下方理解后完成。</p>
        )}
        {selectedChoice && <p className="feedback-preview">{selectedChoice.feedback}</p>}
      </div>

      <label className="recall-box">
        <span>{bundle.lesson.recallPrompt}</span>
        <textarea
          value={freeResponse}
          onChange={(event) => setFreeResponse(event.target.value)}
          rows={4}
          placeholder="写一句你自己的理解"
          disabled={isSubmitting}
        />
      </label>

      <button
        className="primary-button full"
        type="button"
        onClick={submit}
        disabled={!canSubmit}
        aria-busy={isSubmitting}
      >
        {isSubmitting ? "提交中…" : "完成并回评论区"}
      </button>
    </section>
  );
}
