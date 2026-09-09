import { getActiveCurriculum } from "../domain/learningEngine";
import type { AppState, DailyMission, GenerationSource } from "../domain/types";
import { SourceProvenance } from "./SourceProvenance";

interface PathPreviewProps {
  state: AppState;
  mission: DailyMission;
  source: GenerationSource;
  onStartDaily: () => void;
  onEnterFeed: () => void;
  onOpenMap: () => void;
}

export function PathPreview({ state, mission, source, onStartDaily, onEnterFeed, onOpenMap }: PathPreviewProps) {
  const curriculum = getActiveCurriculum(state);
  const learnerMinutes = curriculum.learner.dailyMinutes;

  return (
    <section className="path-preview-screen" aria-label="生成后的学习路径预览">
      <header className="path-preview-hero">
        <div className="path-preview-step">
          <p className="eyebrow">{curriculum.topic.title}</p>
          <span>7 天路径已生成</span>
        </div>
        <h2>{curriculum.title}</h2>
        <p>{curriculum.promise}</p>
        <SourceProvenance state={state} source={source} conceptId={mission.conceptId} label="学习路径" />
      </header>

      <div className="path-preview-actions">
        <button className="primary-button" type="button" onClick={onStartDaily}>
          直接开始
        </button>
        <button className="secondary-button" type="button" onClick={onEnterFeed}>
          进入信息流
        </button>
      </div>

      <ol className="path-preview-list">
        {curriculum.concepts.map((concept) => {
          const lesson = curriculum.lessons.find((item) => item.conceptId === concept.id);
          const isToday = concept.id === mission.conceptId;

          return (
            <li key={concept.id} className={isToday ? "path-preview-item current" : "path-preview-item"}>
              <span>Day {concept.order}</span>
              <div>
                <h3>{concept.title}</h3>
                <p>{lesson?.promptGoal ?? concept.unlockHint}</p>
                <small>{isToday ? "今日任务" : `${learnerMinutes} 分钟`}</small>
              </div>
            </li>
          );
        })}
      </ol>

      <button className="text-button path-preview-map" type="button" onClick={onOpenMap}>
        查看完整地图
      </button>
    </section>
  );
}
