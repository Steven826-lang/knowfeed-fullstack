import type { ReactNode } from "react";
import type { GenerationSource, Screen } from "../domain/types";

type MainTab = Extract<Screen, "feed" | "map" | "settings">;

interface PhoneShellProps {
  activeScreen: Screen;
  streak: number;
  xp: number;
  source: GenerationSource;
  isGenerating: boolean;
  children: ReactNode;
  onNavigate: (screen: MainTab) => void;
}

const navItems: Array<{ screen: MainTab; label: string }> = [
  { screen: "feed", label: "社区" },
  { screen: "map", label: "学习地图" },
  { screen: "settings", label: "设置" }
];

function sourceLabel(source: GenerationSource, isGenerating: boolean, activeScreen: Screen): string {
  if (activeScreen === "onboarding" && !isGenerating) return "准备生成你的第一条讨论流";
  if (isGenerating) return "正在整理今天的讨论";
  if (source === "research-llm") return "今日讨论已更新";
  if (source === "llm") return "内容已生成";
  return "离线演示内容";
}

function screenTitle(activeScreen: Screen): string {
  if (activeScreen === "map") return "学习地图";
  if (activeScreen === "settings") return "设置";
  if (activeScreen === "onboarding") return "KnowFeed";
  if (activeScreen === "path-preview") return "学习路径";
  if (activeScreen === "agent-profile") return "AI 居民";
  if (activeScreen === "new-post") return "发帖";
  return "社区";
}

function activeTab(activeScreen: Screen): MainTab | undefined {
  if (activeScreen === "map") return "map";
  if (activeScreen === "settings") return "settings";
  if (activeScreen === "path-preview" || activeScreen === "onboarding") return undefined;
  return "feed";
}

export function PhoneShell({
  activeScreen,
  streak,
  xp,
  source,
  isGenerating,
  children,
  onNavigate
}: PhoneShellProps) {
  return (
    <main className="app-shell">
      <section className="phone-frame" aria-label="KnowFeed 原型">
        <header className="top-bar">
          <div className="app-mark" aria-hidden="true">知</div>
          <div>
            <p className="eyebrow">KnowFeed</p>
            <h1>{screenTitle(activeScreen)}</h1>
          </div>
          <div className="stat-pills" aria-label="学习状态">
            <span>{streak} 天</span>
            <span>{xp} XP</span>
          </div>
        </header>

        <div className="generation-strip">
          <span className={source === "fallback" && activeScreen !== "onboarding" ? "fallback-dot" : "live-dot"} />
          <span>{sourceLabel(source, isGenerating, activeScreen)}</span>
        </div>

        <div className="screen-body">{children}</div>

        <nav className="bottom-nav" aria-label="主导航">
          {navItems.map((item) => (
            <button
              key={item.screen}
              type="button"
              className={activeTab(activeScreen) === item.screen ? "nav-item active" : "nav-item"}
              onClick={() => onNavigate(item.screen)}
            >
              {item.label}
            </button>
          ))}
        </nav>
      </section>
    </main>
  );
}
