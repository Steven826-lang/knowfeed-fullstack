import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const packageJson = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
const scripts = new Set(Object.keys(packageJson.scripts ?? {}));
const releaseReadinessPath = path.join(root, "docs/delivery/RELEASE_READINESS.md");
const envLocalPath = path.join(root, ".env.local");
const evidenceRoot = path.join(root, ".omx/evidence/knowfeed");

const requiredDocs = [
  "docs/product/PRD_V2.md",
  "docs/engineering/SYSTEM_CONTRACT.md",
  "docs/product/UX_FLOW.md",
  "docs/engineering/LLM_CONTRACTS.md",
  "docs/delivery/DELIVERY_REQUIREMENTS.md",
  "docs/delivery/DOCUMENTATION_GOVERNANCE.md",
  "docs/delivery/ACCEPTANCE_CHECKLIST.md",
  "docs/engineering/E2E_RUNBOOK.md",
  "docs/delivery/RELEASE_READINESS.md"
];

const requiredArtifacts = [
  "docs/product/knowfeed-project-intro.html",
  "public/knowfeed-icon.svg",
  "public/site.webmanifest"
];

const requiredEnvExampleKeys = [
  "LLM_PROVIDER",
  "LLM_BASE_URL",
  "LLM_API_KEY",
  "LLM_MODEL",
  "LLM_RESPONSE_FORMAT",
  "LLM_RESEARCH_MODE",
  "LLM_PROXY_PORT",
  "LLM_PROVIDER_PROBE_TIMEOUT_MS",
  "LLM_PROXY_RESEARCH_TIMEOUT_MS",
  "LLM_PROXY_GENERATE_TIMEOUT_MS",
  "VITE_LLM_CLIENT_TIMEOUT_MS"
];

const envExampleSyncKeys = ["LLM_PROVIDER", "LLM_BASE_URL", "LLM_MODEL", "LLM_RESPONSE_FORMAT"];
const envExampleSyncFiles = ["README.md", "docs/engineering/GETTING_STARTED.md"];

const requiredRuntimeDocRefs = [
  {
    token: "LLM_RESEARCH_MODE",
    files: ["README.md", "docs/engineering/GETTING_STARTED.md", "docs/engineering/E2E_RUNBOOK.md", "docs/delivery/DELIVERY_REQUIREMENTS.md", "docs/delivery/RELEASE_READINESS.md"]
  },
  {
    token: "NODE_USE_ENV_PROXY",
    files: ["README.md", "docs/engineering/GETTING_STARTED.md", "docs/engineering/E2E_RUNBOOK.md", "docs/delivery/RELEASE_READINESS.md"]
  },
  {
    token: "LLM_RESPONSE_FORMAT",
    files: ["README.md", "docs/engineering/GETTING_STARTED.md", "docs/delivery/RELEASE_READINESS.md"]
  }
];

const errors = [];
const warnings = [];

function listMarkdownFiles(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  return entries.flatMap((entry) => {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) return listMarkdownFiles(fullPath);
    return entry.isFile() && entry.name.endsWith(".md") ? [fullPath] : [];
  });
}

for (const relPath of requiredDocs) {
  if (!fs.existsSync(path.join(root, relPath))) {
    errors.push(`Missing required documentation file: ${relPath}`);
  }
}

for (const relPath of requiredArtifacts) {
  if (!fs.existsSync(path.join(root, relPath))) {
    errors.push(`Missing required delivery artifact: ${relPath}`);
  }
}

const envExamplePath = path.join(root, ".env.example");
if (fs.existsSync(envExamplePath)) {
  const envExample = fs.readFileSync(envExamplePath, "utf8");
  const envExampleConfig = readEnvFile(envExamplePath);
  for (const key of requiredEnvExampleKeys) {
    if (!new RegExp(`^${key}=`, "m").test(envExample)) {
      errors.push(`.env.example must document ${key}`);
    }
  }
  for (const key of envExampleSyncKeys) {
    const value = envExampleConfig[key];
    if (!value) {
      errors.push(`.env.example must set ${key} so provider examples can be verified`);
      continue;
    }
    for (const relPath of envExampleSyncFiles) {
      const content = fs.readFileSync(path.join(root, relPath), "utf8");
      if (!content.includes(`${key}=${value}`)) {
        errors.push(`${relPath}: provider setup example must match .env.example ${key}=${value}`);
      }
    }
  }
} else {
  errors.push("Missing .env.example");
}

const markdownFiles = ["README.md", ...listMarkdownFiles(path.join(root, "docs")).map((file) => path.relative(root, file))];

for (const relPath of markdownFiles) {
  const absolutePath = path.join(root, relPath);
  const content = fs.readFileSync(absolutePath, "utf8");
  const dir = path.dirname(absolutePath);

  for (const match of content.matchAll(/npm run ([A-Za-z0-9:._-]+)/g)) {
    const scriptName = match[1];
    if (scriptName === "...") continue;
    if (!scripts.has(scriptName)) {
      errors.push(`${relPath}: references missing npm script "${scriptName}"`);
    }
  }

  for (const match of content.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)) {
    const target = match[1].split("#")[0];
    if (!target || /^[a-z]+:\/\//i.test(target) || target.startsWith("mailto:")) continue;
    if (target.startsWith("/")) continue;

    const decodedTarget = decodeURIComponent(target);
    const resolved = path.resolve(dir, decodedTarget);
    if (!resolved.startsWith(root)) continue;
    if (!fs.existsSync(resolved)) {
      errors.push(`${relPath}: broken Markdown link "${match[1]}"`);
    }
  }

  if (/\/tmp\/knowfeed-(?!\*)/.test(content)) {
    if (relPath === "docs/delivery/RELEASE_READINESS.md") {
      errors.push(`${relPath}: must not cite volatile /tmp/knowfeed-* paths as release evidence; use .omx/evidence/knowfeed artifacts or mark old paths in docs/delivery/ACCEPTANCE_CHECKLIST.md as historical context`);
    } else if (!/historical|历史|not current delivery proof|volatile evidence/i.test(content)) {
      errors.push(`${relPath}: cites volatile /tmp/knowfeed-* evidence without marking it as historical/non-delivery proof`);
    } else {
      warnings.push(`${relPath}: contains historical volatile /tmp/knowfeed-* evidence; do not use it for current delivery status`);
    }
  }
}

for (const { token, files } of requiredRuntimeDocRefs) {
  for (const relPath of files) {
    const absolutePath = path.join(root, relPath);
    if (!fs.existsSync(absolutePath)) {
      errors.push(`${relPath}: missing required runtime documentation file for ${token}`);
      continue;
    }
    const content = fs.readFileSync(absolutePath, "utf8");
    if (!content.includes(token)) {
      errors.push(`${relPath}: must mention ${token} so provider/research-mode docs do not drift`);
    }
  }
}

if (fs.existsSync(releaseReadinessPath) && !hasReleaseGradeEvidence()) {
  const releaseReadiness = fs.readFileSync(releaseReadinessPath, "utf8");
  const requiredBlockedSignals = [
    [/Do not mark the project complete/i, "must explicitly warn not to mark the project complete"],
    [/not a current delivery pass/i, "must distinguish historical evidence from current delivery pass"],
    [/npm run verify:evidence-archive`?: now intentionally fails/i, "must state that verify:evidence-archive currently fails intentionally"],
    [/research anchor\/source chips/i, "must require visible research anchor/source chips in release evidence"],
    [/avoided-style compliance|avoidedStyles|negative preferences/i, "must require learner avoided-style compliance in release evidence"],
    [/unsupported-precision compliance|unsupported precise|unsupported specifics|unsupported precision/i, "must require unsupported-precision compliance in release evidence"]
  ];

  for (const [pattern, message] of requiredBlockedSignals) {
    if (!pattern.test(releaseReadiness)) {
      errors.push(`docs/delivery/RELEASE_READINESS.md: ${message} while no release-grade expanded-full evidence exists`);
    }
  }

  const currentStatus = readCurrentStatusBlock(releaseReadiness);
  if (!currentStatus) {
    errors.push("docs/delivery/RELEASE_READINESS.md: missing machine-readable knowfeed-current-status block while no release-grade expanded-full evidence exists");
  } else {
    if (currentStatus.status === "complete") {
      errors.push("docs/delivery/RELEASE_READINESS.md: current status block must not be complete while no release-grade expanded-full evidence exists");
    }
    if (!String(currentStatus.liveProvider ?? "").trim()) {
      errors.push("docs/delivery/RELEASE_READINESS.md: current status block must record the live provider status");
    }
    const localLlmConfig = readLocalLlmConfig();
    if (localLlmConfig) {
      const liveProvider = String(currentStatus.liveProvider ?? "");
      for (const [key, value] of Object.entries(localLlmConfig)) {
        if (!liveProvider.includes(value)) {
          errors.push(`docs/delivery/RELEASE_READINESS.md: current status liveProvider must mention local ${key}=${value}`);
        }
      }
    }
    const localResearchMode = readLocalEnvValue("LLM_RESEARCH_MODE");
    if (localResearchMode && !String(currentStatus.researchMode ?? "").includes(`LLM_RESEARCH_MODE=${localResearchMode}`)) {
      errors.push(
        `docs/delivery/RELEASE_READINESS.md: current status researchMode must mention local LLM_RESEARCH_MODE=${localResearchMode}`
      );
    }
    if (!/no release-grade expanded-full/i.test(String(currentStatus.evidenceArchive ?? ""))) {
      errors.push("docs/delivery/RELEASE_READINESS.md: current status block must record the missing release-grade expanded-full archive");
    }
  }
}

if (!packageJson.engines?.node) {
  errors.push("package.json must declare engines.node so verification does not drift across unsupported runtimes");
}

for (const releaseScript of ["e2e:real-llm:architecture:archive", "e2e:real-llm:matrix:expanded:full:archive"]) {
  const command = packageJson.scripts?.[releaseScript] ?? "";
  if (!command.includes("KNOWFEED_E2E_RETRY_LLM_FALLBACKS=0")) {
    errors.push(`${releaseScript} must set KNOWFEED_E2E_RETRY_LLM_FALLBACKS=0 so release evidence cannot pass after an initial LLM fallback`);
  }
}

if (warnings.length) {
  console.warn(["Documentation warnings:", ...warnings.map((item) => `- ${item}`)].join("\n"));
}

if (errors.length) {
  console.error(["Documentation verification failed:", ...errors.map((item) => `- ${item}`)].join("\n"));
  process.exit(1);
}

console.log(`Documentation verification passed for ${markdownFiles.length} Markdown files.`);

function hasReleaseGradeEvidence() {
  return summaryFiles(evidenceRoot).some((summaryFile) => {
    try {
      const summary = JSON.parse(fs.readFileSync(summaryFile, "utf8"));
      return (
        summary?.status === "passed" &&
        summary?.evidenceGate?.passed === true &&
        summary?.matrixGate?.passed === true &&
        summary?.matrixGate?.enabled === true &&
        Number.isFinite(summary?.matrix?.passedRuns) &&
        summary.matrix.passedRuns >= 15 &&
        Array.isArray(summary?.scenarios) &&
        summary.scenarios.length >= 15
      );
    } catch {
      return false;
    }
  });
}

function readCurrentStatusBlock(content) {
  const match = content.match(
    /<!-- knowfeed-current-status:start -->\s*```json\s*([\s\S]*?)\s*```\s*<!-- knowfeed-current-status:end -->/
  );
  if (!match) return null;
  try {
    return JSON.parse(match[1]);
  } catch (error) {
    errors.push(`docs/delivery/RELEASE_READINESS.md: current status block is not valid JSON: ${error.message}`);
    return null;
  }
}

function readLocalLlmConfig() {
  const env = readLocalEnv();
  if (!env) return null;
  const config = {};
  for (const key of ["LLM_MODEL", "LLM_RESPONSE_FORMAT"]) {
    if (env[key]) config[key] = env[key];
  }
  return Object.keys(config).length ? config : null;
}

function readLocalEnvValue(key) {
  return readLocalEnv()?.[key];
}

function readLocalEnv() {
  return readEnvFile(envLocalPath);
}

function readEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return null;
  const config = {};
  for (const line of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const separatorIndex = trimmed.indexOf("=");
    if (separatorIndex === -1) continue;
    const key = trimmed.slice(0, separatorIndex);
    const value = trimmed.slice(separatorIndex + 1).trim().replace(/^['"]|['"]$/g, "");
    if (key && value) config[key] = value;
  }
  return config;
}

function summaryFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) return summaryFiles(fullPath);
    return entry.isFile() && entry.name === "summary.json" ? [fullPath] : [];
  });
}
