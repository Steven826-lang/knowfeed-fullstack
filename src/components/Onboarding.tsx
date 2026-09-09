import { useState } from "react";
import type { OnboardingInput, TargetDepth } from "../domain/types";

export type BuildStageId = "profile" | "research" | "planner" | "content";

interface OnboardingProps {
  isBuilding: boolean;
  activeStage?: BuildStageId;
  statusText: string;
  errorText?: string;
  onComplete: (input: OnboardingInput) => void;
}

const buildStages: Array<{ id: BuildStageId; label: string; detail: string }> = [
  { id: "profile", label: "理解目标", detail: "保存主题、背景和负偏好" },
  { id: "research", label: "联网检索", detail: "抓取真实资料锚点" },
  { id: "planner", label: "规划路径", detail: "让 AI 生成学习路线" },
  { id: "content", label: "生成讨论", detail: "生成首页微课和评论区" }
];

export function Onboarding({ isBuilding, activeStage, statusText, errorText, onComplete }: OnboardingProps) {
  const [topicTitle, setTopicTitle] = useState("");
  const [dailyMinutes, setDailyMinutes] = useState<OnboardingInput["dailyMinutes"]>(5);
  const [targetDepth, setTargetDepth] = useState<TargetDepth>("conversational");
  const canSubmit = Boolean(topicTitle.trim()) && !isBuilding;
  const activeStageIndex = buildStages.findIndex((stage) => stage.id === activeStage);

  function submit() {
    if (!canSubmit) return;
    onComplete({
      topicTitle: topicTitle.trim(),
      background: "普通兴趣学习者",
      avoidedStyles: "过于枯燥、太理论化",
      goal: "看懂核心概念与真实讨论",
      dailyMinutes,
      targetDepth,
      preferredTone: "default"
    });
  }

  return (
    <section className="onboarding-screen">
      <div className="onboarding-hero">
        <h2 className="minimal-hero-title">开启你的学习旅程</h2>
        <p className="minimal-hero-subtitle">输入你最想弄懂的一个概念、现象或争议。</p>
      </div>

      <div className="minimal-input-container">
        <input
          className="minimal-topic-input"
          value={topicTitle}
          onChange={(event) => setTopicTitle(event.target.value)}
          placeholder="例如：短剧商业模式为什么被争议"
          autoFocus
          onKeyDown={(e) => {
            if (e.key === 'Enter') submit();
          }}
        />
      </div>

      <div className="onboarding-options">
        <div className="segmented-grid" aria-label="每日时间">
        {([3, 5, 10, 15] as const).map((minutes) => (
          <button
            key={minutes}
            type="button"
            className={dailyMinutes === minutes ? "active" : ""}
            onClick={() => setDailyMinutes(minutes)}
          >
            {minutes} 分钟
          </button>
        ))}
      </div>

      <div className="segmented-grid" aria-label="学习深度">
        {[
          ["casual", "轻松刷懂"],
          ["conversational", "能参与讨论"],
          ["practical", "能判断案例"],
          ["strategic", "看行业逻辑"]
        ].map(([value, label]) => (
          <button
            key={value}
            type="button"
            className={targetDepth === value ? "active" : ""}
            onClick={() => setTargetDepth(value as TargetDepth)}
          >
            {label}
          </button>
        ))}
      </div>
      </div>

      {isBuilding ? (
        <div className="build-loading-state">
          <div className="build-spinner"></div>
          <p className="build-status-text">{statusText || "正在生成你的专属学习社区..."}</p>
          <div className="build-steps-minimal">
            {buildStages.map((stage, index) => {
              const isActive = stage.id === activeStage;
              const isComplete = activeStageIndex > index && !errorText;
              return (
                <span 
                  key={stage.id} 
                  className={isActive ? "active" : isComplete ? "complete" : "pending"}
                >
                  {stage.label}
                </span>
              );
            })}
          </div>
        </div>
      ) : errorText ? (
        <div className="build-error" role="alert">
          <strong>生成没有完成</strong>
          <span>{errorText}</span>
          <button className="secondary-button" type="button" onClick={submit}>
            保留表单并重试
          </button>
        </div>
      ) : (
        <button
          className="primary-button full submit-onboarding"
          type="button"
          disabled={!canSubmit}
          onClick={submit}
        >
          生成我的学习信息流
        </button>
      )}
    </section>
  );
}
