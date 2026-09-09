import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const evidenceRoot = path.join(root, ".omx/evidence/knowfeed");
const releaseReadinessPath = path.join(root, "docs/delivery/RELEASE_READINESS.md");
const errors = [];
const warnings = [];

function walk(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) return walk(fullPath);
    return entry.isFile() ? [fullPath] : [];
  });
}

function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    errors.push(`${path.relative(root, filePath)} is not valid JSON: ${error.message}`);
    return null;
  }
}

function hasStructuredEvidence(summary) {
  return Boolean(
    summary &&
      typeof summary === "object" &&
      Object.keys(summary).length > 0 &&
      (
        typeof summary.status === "string" ||
        summary.evidenceGate ||
        summary.matrixGate ||
        summary.communityQuality ||
        Array.isArray(summary.results) ||
        Number.isFinite(summary.passedRuns) ||
        Number.isFinite(summary.totalRuns)
      )
  );
}

const evidenceFiles = walk(evidenceRoot);
const summaryFiles = evidenceFiles.filter((file) => path.basename(file) === "summary.json");

if (!fs.existsSync(evidenceRoot)) {
  errors.push("Missing durable evidence root: .omx/evidence/knowfeed");
}

if (summaryFiles.length === 0) {
  errors.push("No durable summary.json files found under .omx/evidence/knowfeed");
}

let structuredSummaryCount = 0;
let releaseGradeSummaryCount = 0;
const releaseGradeCandidates = [];
for (const summaryFile of summaryFiles) {
  const relativePath = path.relative(root, summaryFile);
  const summary = readJson(summaryFile);
  if (!summary) continue;
  if (hasStructuredEvidence(summary)) {
    structuredSummaryCount += 1;
    const releaseGrade = releaseGradeIssues(summary);
    if (releaseGrade.length === 0) {
      releaseGradeSummaryCount += 1;
      releaseGradeCandidates.push(relativePath);
    } else if (isExpandedFullSummary(summaryFile, summary)) {
      warnings.push(`${relativePath} is not release-grade evidence: ${releaseGrade.join("; ")}`);
    }
  } else {
    warnings.push(`${relativePath} is empty or lacks gate fields; do not use it as final machine-readable proof`);
  }
}

if (summaryFiles.length > 0 && structuredSummaryCount === 0) {
  errors.push("No structured durable summary.json files found under .omx/evidence/knowfeed");
}

if (summaryFiles.length > 0 && releaseGradeSummaryCount === 0) {
  errors.push(
    "No release-grade expanded-full real-LLM summary found. Required: status=passed, evidenceGate.passed=true, matrixGate.passed=true, passedRuns>=15, clean checkout, zero LLM fallback retry events, real web research + planner source, visible source provenance with research anchor/source chips, generated lesson/post/shadow topic + research grounding signals, concrete learner-action signals, avoided-style compliance, unsupported-precision compliance, and full flow screenshots for every run."
  );
}

if (fs.existsSync(releaseReadinessPath)) {
  const releaseReadiness = fs.readFileSync(releaseReadinessPath, "utf8");
  if (/\/tmp\/knowfeed-/.test(releaseReadiness)) {
    errors.push("docs/delivery/RELEASE_READINESS.md must not cite volatile /tmp/knowfeed-* evidence paths");
  }

  const referencedEvidencePaths = [...releaseReadiness.matchAll(/`(\.omx\/evidence\/knowfeed\/[^`]+)`/g)].map((match) => match[1]);
  for (const referencedPath of referencedEvidencePaths) {
    const absolutePath = path.join(root, referencedPath);
    if (!fs.existsSync(absolutePath)) {
      errors.push(`docs/delivery/RELEASE_READINESS.md references missing durable evidence artifact: ${referencedPath}`);
    }
  }
}

function isExpandedFullSummary(summaryFile, summary) {
  const relativePath = path.relative(root, summaryFile);
  const selectedViewports = summary?.selection?.viewports ?? [];
  const selectedScenarios = summary?.selection?.scenarios ?? [];
  return (
    relativePath.includes("expanded-full") ||
    (Array.isArray(selectedViewports) && selectedViewports.length >= 3 && Array.isArray(selectedScenarios) && selectedScenarios.length >= 5)
  );
}

function releaseGradeIssues(summary) {
  const issues = [];
  if (summary?.status !== "passed") issues.push(`status=${summary?.status ?? "missing"}`);
  if (summary?.evidenceGate?.passed !== true) issues.push("evidenceGate.passed is not true");
  if (summary?.matrixGate?.passed !== true) issues.push("matrixGate.passed is not true");
  if (!summary?.matrixGate?.enabled) issues.push("matrixGate is not enabled");
  if (summary?.checkout?.gitDirty !== false) {
    issues.push("checkout.gitDirty is not false");
  }
  if (!Number.isFinite(summary?.matrix?.passedRuns) || summary.matrix.passedRuns < 15) {
    issues.push(`passedRuns=${summary?.matrix?.passedRuns ?? "missing"}/15`);
  }
  if (!Array.isArray(summary?.scenarios) || summary.scenarios.length < 15) {
    issues.push(`scenario count=${Array.isArray(summary?.scenarios) ? summary.scenarios.length : "missing"}/15`);
  }
  if (!summary?.run?.command || !summary?.run?.nodeVersion || !summary?.run?.npmVersion) {
    issues.push("missing run command/node/npm metadata");
  }
  const llmFallbackRetries = (Array.isArray(summary?.retryEvents) ? summary.retryEvents : []).filter((event) =>
    /Generated feed fell back before Research brief \+ LLM/.test(String(event?.message ?? ""))
  );
  if (llmFallbackRetries.length > 0) {
    issues.push(`LLM fallback retry events=${llmFallbackRetries.length}`);
  }

  for (const scenario of Array.isArray(summary?.scenarios) ? summary.scenarios : []) {
    if (scenario.status !== "passed") {
      issues.push(`${scenario.runSlug ?? "unknown"} status=${scenario.status ?? "missing"}`);
      continue;
    }
    if (scenario.feed?.sourceStrip !== "今日讨论已更新") {
      issues.push(`${scenario.runSlug}: sourceStrip=${scenario.feed?.sourceStrip ?? "missing"}`);
    }
    if (scenario.feed?.researchSource !== "web" || scenario.feed?.curriculumSource !== "planner") {
      issues.push(
        `${scenario.runSlug}: feed source chain ${scenario.feed?.researchSource ?? "missing"}/${scenario.feed?.curriculumSource ?? "missing"}`
      );
    }
    if (scenario.reloaded?.researchSource !== "web" || scenario.reloaded?.curriculumSource !== "planner") {
      issues.push(
        `${scenario.runSlug}: reload source chain ${scenario.reloaded?.researchSource ?? "missing"}/${scenario.reloaded?.curriculumSource ?? "missing"}`
      );
    }
    for (const phase of ["feed", "post", "lesson", "shadow"]) {
      if (!hasVisibleSourceProvenance(scenario[phase])) {
        issues.push(`${scenario.runSlug}: ${phase} visible source provenance incomplete`);
      }
    }
    const missingScreenshots = missingScenarioScreenshots(summary, scenario);
    if (missingScreenshots.length > 0) {
      issues.push(`${scenario.runSlug}: missing screenshots ${missingScreenshots.join(", ")}`);
    }
    if (scenario.communityQuality?.passed !== true) {
      issues.push(`${scenario.runSlug}: communityQuality.passed is not true`);
    }
    const generatedContentPhases = scenario.communityQuality?.signals?.generatedContentQuality?.phases ?? [];
    if (
      generatedContentPhases.length < 3 ||
      generatedContentPhases.some(
        (phase) =>
          phase.hasAnchor !== true ||
          phase.hasLearningSignal !== true ||
          phase.hasConcreteLearnerAction !== true ||
          phase.hasResearchAnchor !== true ||
          phase.avoidsRejectedStyles === false ||
          phase.hasNoUnsupportedPreciseClaims === false
      )
    ) {
      issues.push(`${scenario.runSlug}: generated lesson/post/shadow grounding, concrete learner action, avoided-style, or unsupported-precision signals incomplete`);
    }
  }

  return issues;
}

function missingScenarioScreenshots(summary, scenario) {
  const runSlug = scenario?.runSlug;
  if (!runSlug) return ["runSlug"];
  const outputDir = typeof summary?.outputDir === "string" ? summary.outputDir : "";
  const absoluteOutputDir = path.isAbsolute(outputDir) ? outputDir : path.join(root, outputDir);
  const requiredSuffixes = [
    "01-onboarding",
    "02-feed",
    "03-comments",
    "04-lesson",
    "05-return-comments",
    "06-settings",
    "06b-settings-approved",
    "06c-settings-rejected",
    "07-reload-feed",
    "08-daily-lesson",
    "09-map",
    "10-map-lesson"
  ];
  return requiredSuffixes
    .map((suffix) => `${runSlug}-${suffix}.png`)
    .filter((filename) => !fs.existsSync(path.join(absoluteOutputDir, filename)));
}

function hasVisibleSourceProvenance(metrics) {
  const provenance = Array.isArray(metrics?.sourceProvenance) ? metrics.sourceProvenance.join(" | ") : "";
  const hasSourceChain = ["Research brief + LLM", "Research: web", "Path: planner"].every((requiredText) =>
    provenance.includes(requiredText)
  );
  const visibleAnchors = Array.isArray(metrics?.visibleResearchAnchors) ? metrics.visibleResearchAnchors.join(" | ") : "";
  const visibleSources = Array.isArray(metrics?.visibleResearchSources) ? metrics.visibleResearchSources.join(" | ") : "";
  const hasResearchAnchors = metrics?.researchSource !== "web" || (visibleAnchors.includes("研究锚点") && visibleAnchors.length > 8);
  const hasResearchSources = metrics?.researchSource !== "web" || (visibleSources.includes("资料来源") && visibleSources.length > 8);
  return hasSourceChain && hasResearchAnchors && hasResearchSources;
}

if (warnings.length) {
  console.warn(["Evidence archive warnings:", ...warnings.map((item) => `- ${item}`)].join("\n"));
}

if (errors.length) {
  console.error(["Evidence archive verification failed:", ...errors.map((item) => `- ${item}`)].join("\n"));
  process.exit(1);
}

console.log(
  `Evidence archive verification passed for ${summaryFiles.length} summary files (${structuredSummaryCount} structured, ${releaseGradeSummaryCount} release-grade).`
);
if (releaseGradeCandidates.length) {
  console.log(`Release-grade evidence: ${releaseGradeCandidates.join(", ")}`);
}
