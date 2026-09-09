import type { AppState, CurriculumSource, GenerationSource, ResearchBrief } from "../domain/types";

interface SourceProvenanceProps {
  state: AppState;
  source: GenerationSource;
  label: string;
  conceptId?: string;
  compact?: boolean;
}

export function SourceProvenance({ state, source, label, conceptId, compact = false }: SourceProvenanceProps) {
  const curriculum = state.curriculum;
  const concept = conceptId ? curriculum?.concepts.find((item) => item.id === conceptId) : undefined;
  const researchAnchors = buildResearchAnchors(curriculum?.researchBrief, compact ? 2 : 3);
  const researchSources = buildResearchSources(curriculum?.researchBrief, compact ? 1 : 2);
  const trustSignals = buildTrustSignals(curriculum?.researchBrief);
  const visibleEvidence = compact ? buildVisibleEvidence(researchAnchors, researchSources) : [];
  const generation = generationLabel(source);
  const research = researchLabel(curriculum?.researchBrief?.source);
  const curriculumSource = curriculumLabel(curriculum?.source);

  return (
    <section
      className={compact ? "source-provenance compact" : "source-provenance"}
      aria-label={`${label}生成来源`}
      data-generation-source={source}
    >
      {visibleEvidence.length > 0 ? (
        <div className="source-quick-evidence" aria-label={`${label}可见研究依据`}>
          {visibleEvidence.map((item) => (
            <span key={item}>{item}</span>
          ))}
        </div>
      ) : null}
      <details className="source-disclosure" open={!compact}>
        <summary aria-label={`${label}来源详情`}>
          <div className="source-provenance-main">
            <p className="eyebrow">{label}来源</p>
            <strong>
              <span>{generation.display}</span>
              <span className="source-evidence-code">{generation.evidence}</span>
            </strong>
          </div>
          <div className="source-summary-side">
            <div className="source-chain">
              <span>
                <span>{research.display}</span>
                <span className="source-evidence-code">{research.evidence}</span>
              </span>
              <span>
                <span>{curriculumSource.display}</span>
                <span className="source-evidence-code">{curriculumSource.evidence}</span>
              </span>
              {concept ? <span>Concept: {concept.title}</span> : null}
            </div>
            {trustSignals.length > 0 ? (
              <div className="source-trust-band" aria-label={`${label}可信度提示`}>
                {trustSignals.map((signal) => (
                  <span key={signal.evidence}>
                    <span>{signal.display}</span>
                    <span className="source-evidence-code">{signal.evidence}</span>
                  </span>
                ))}
              </div>
            ) : null}
            <span className="trust-disclosure-label">{compact ? "为什么可信" : "收起依据"}</span>
          </div>
        </summary>
        <div className="source-evidence">
          {researchAnchors.length > 0 ? (
            <div className="research-anchor-list" aria-label={`${label}研究锚点`}>
              <span>研究锚点</span>
              {researchAnchors.map((anchor) => (
                <span key={`${anchor.kind}-${anchor.text}`}>{anchor.kind}: {anchor.text}</span>
              ))}
            </div>
          ) : null}
          {researchSources.length > 0 ? (
            <div className="research-source-list" aria-label={`${label}资料来源`}>
              <span>资料来源</span>
              {researchSources.map((source) =>
                source.url ? (
                  <a
                    key={`${source.title}-${source.url}`}
                    href={source.url}
                    target="_blank"
                    rel="noreferrer"
                    aria-label={source.fullTitle}
                  >
                    {source.title}
                  </a>
                ) : (
                  <span key={source.title}>{source.title}</span>
                )
              )}
            </div>
          ) : null}
        </div>
      </details>
    </section>
  );
}

interface SourceLabel {
  display: string;
  evidence: string;
}

function buildVisibleEvidence(
  anchors: Array<{ kind: string; text: string }>,
  sources: Array<{ title: string; fullTitle: string; url?: string }>
): string[] {
  const [anchor] = anchors;
  const [source] = sources;
  return [
    anchor ? `锚点: ${anchor.text}` : null,
    source ? `来源: ${source.title}` : null
  ].filter((item): item is string => Boolean(item));
}

function generationLabel(source: GenerationSource): SourceLabel {
  if (source === "research-llm") {
    return { display: "网页资料辅助的 AI 生成", evidence: "Research brief + LLM" };
  }
  if (source === "llm") return { display: "AI 生成", evidence: "LLM" };
  return { display: "演示内容", evidence: "Fallback" };
}

function researchLabel(source: ResearchBrief["source"] | undefined): SourceLabel {
  if (source === "web") return { display: "已接入网页资料", evidence: "Research: web" };
  if (source === "fallback") return { display: "资料检索未完成", evidence: "Research: fallback" };
  return { display: "资料不可用", evidence: "Research: unavailable" };
}

function curriculumLabel(source: CurriculumSource | undefined): SourceLabel {
  if (source === "planner") return { display: "AI 规划路径", evidence: "Path: planner" };
  if (source === "deterministic-fallback") return { display: "本地规划路径", evidence: "Path: deterministic" };
  if (source === "sample-seed") return { display: "示例路径", evidence: "Path: sample" };
  return { display: "路径来源未知", evidence: "Path: unavailable" };
}

function buildResearchAnchors(brief: ResearchBrief | undefined, limit: number): Array<{ kind: string; text: string }> {
  if (brief?.source !== "web") return [];

  const candidates = [
    ...brief.keyIdeas.map((text) => ({ kind: "观点", text })),
    ...brief.disputedIdeas.map((text) => ({ kind: "争议", text })),
    ...brief.beginnerPitfalls.map((text) => ({ kind: "坑点", text })),
    ...brief.sources.map((source) => ({ kind: "来源", text: source.publisher ? `${source.publisher} ${source.title}` : source.title }))
  ];

  const seen = new Set<string>();
  return candidates
    .map((item) => ({ ...item, text: compactAnchorText(item.text) }))
    .filter((item) => {
      if (!item.text || seen.has(item.text)) return false;
      seen.add(item.text);
      return true;
    })
    .slice(0, limit);
}

function buildResearchSources(
  brief: ResearchBrief | undefined,
  limit: number
): Array<{ title: string; fullTitle: string; url?: string }> {
  if (brief?.source !== "web") return [];

  const seen = new Set<string>();
  return brief.sources
    .map((source) => {
      const fullTitle = source.publisher ? `${source.publisher} · ${source.title}` : source.title;
      return {
        title: compactAnchorText(fullTitle),
        fullTitle,
        url: /^https?:\/\//i.test(source.url) ? source.url : undefined
      };
    })
    .filter((source) => {
      if (!source.title || seen.has(source.title)) return false;
      seen.add(source.title);
      return true;
    })
    .slice(0, limit);
}

function buildTrustSignals(brief: ResearchBrief | undefined): SourceLabel[] {
  if (brief?.source !== "web" || brief.sources.length === 0) return [];

  const statuses = new Set(brief.sources.map((source) => source.factReviewStatus).filter(Boolean));
  const scores = brief.sources
    .map((source) => source.qualityScore)
    .filter((score): score is number => typeof score === "number" && Number.isFinite(score));
  const retrievedTimes = brief.sources
    .map((source) => Date.parse(source.retrievedAt))
    .filter((time) => Number.isFinite(time));
  const averageScore = scores.length ? scores.reduce((sum, score) => sum + score, 0) / scores.length : null;
  const latestRetrievedAt = retrievedTimes.length ? new Date(Math.max(...retrievedTimes)).toISOString().slice(0, 10) : null;

  const factStatus = statuses.has("needs-review") ? "needs-review" : "planning-only";

  return [
    {
      display: factStatus === "needs-review" ? "边界: 等待人工核验" : "用途: 学习规划参考",
      evidence: `Fact: ${factStatus}`
    },
    averageScore === null
      ? null
      : {
          display: `来源质量 ${averageScore.toFixed(1)}`,
          evidence: `Quality ${averageScore.toFixed(1)}`
        },
    latestRetrievedAt
      ? {
          display: `更新 ${latestRetrievedAt}`,
          evidence: `Fresh ${latestRetrievedAt}`
        }
      : null
  ].filter((item): item is SourceLabel => Boolean(item));
}

function compactAnchorText(value: string): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= 34) return normalized;
  return `${normalized.slice(0, 32)}...`;
}
