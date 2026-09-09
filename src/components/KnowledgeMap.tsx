import { useState } from "react";
import { getActiveCurriculum, getDailyMission, getUnlockedConceptIds } from "../domain/learningEngine";
import type { AppState, GenerationSource } from "../domain/types";
import { SourceProvenance } from "./SourceProvenance";

interface KnowledgeMapProps {
  state: AppState;
  activeConceptId: string;
  source: GenerationSource;
  onStartConcept: (conceptId: string) => void;
  onReset: () => void;
}

export function KnowledgeMap({ state, activeConceptId, source, onStartConcept, onReset }: KnowledgeMapProps) {
  const [isConfirmingReset, setIsConfirmingReset] = useState(false);
  const unlockedIds = getUnlockedConceptIds(state);
  const curriculum = getActiveCurriculum(state);
  const recommendedMission = getDailyMission(state);
  const recommendedConcept = curriculum.concepts.find((concept) => concept.id === recommendedMission.conceptId);

  return (
    <section className="map-screen">
      <p className="eyebrow">学习路径</p>
      <h2>{curriculum.title}</h2>
      <SourceProvenance state={state} source={source} conceptId={activeConceptId} label="学习地图" />
      
      <article className="micro-lesson-card">
        <div className="micro-lesson-header">
          <span className="micro-lesson-label">今日小课堂</span>
        </div>
        <div className="micro-lesson-content">
          <h3>{recommendedMission.title}</h3>
          <p>{recommendedMission.reason}</p>
        </div>
        <button 
          className="primary-button micro-lesson-action" 
          type="button" 
          onClick={() => onStartConcept(recommendedMission.conceptId)}
        >
          进入课堂 →
        </button>
      </article>

      <div className="path-list timeline-layout">
        {curriculum.concepts.map((concept) => {
          const mastery = state.progress.conceptMastery[concept.id] ?? 0;
          const unlocked = unlockedIds.includes(concept.id);
          const isCurrent = activeConceptId === concept.id;
          
          return (
            <article
              key={concept.id}
              className={[
                "path-node timeline-node",
                isCurrent ? "current" : "",
                unlocked ? "unlocked" : "locked"
              ].join(" ")}
            >
              <div className="timeline-marker">
                <span className="node-order">{concept.order}</span>
              </div>
              <div className="timeline-content">
                <h3>{concept.title}</h3>
                
                <p className="node-hint">{concept.unlockHint}</p>
                
                <div className="mastery-indicator">
                  <span className="mastery-value">掌握度 {mastery}%</span>
                </div>
                
                <button 
                  className="timeline-action-button"
                  type="button" 
                  disabled={!unlocked} 
                  onClick={() => onStartConcept(concept.id)}
                >
                  {unlocked ? (isCurrent ? "继续学习 →" : "进入小任务 →") : "先解锁前置概念"}
                </button>
              </div>
            </article>
          );
        })}
      </div>

      <section className="reset-confirmation" aria-label="重新选择主题" style={{ marginTop: '2rem' }}>
        {isConfirmingReset ? (
          <>
            <p style={{ fontSize: '0.875rem', color: 'var(--text-secondary)', marginBottom: '0.5rem' }}>
              更改领域将清空当前进度和学习路径，返回主题选择界面。
            </p>
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <button className="secondary-button" type="button" onClick={() => setIsConfirmingReset(false)}>
                取消
              </button>
              <button className="danger-button" type="button" onClick={onReset}>
                确认更改
              </button>
            </div>
          </>
        ) : (
          <button className="secondary-button" type="button" onClick={() => setIsConfirmingReset(true)} style={{ width: '100%' }}>
            更改学习领域
          </button>
        )}
      </section>
    </section>
  );
}
