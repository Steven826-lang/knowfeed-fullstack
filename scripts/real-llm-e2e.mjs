import { mkdir, rename, writeFile } from "node:fs/promises";
import { execFileSync, spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readFileSync } from "node:fs";

const appUrl = process.env.KNOWFEED_E2E_APP_URL ?? "http://127.0.0.1:5173";
const chromePort = Number(process.env.KNOWFEED_E2E_CDP_PORT ?? 9231);
const chromePath =
  process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const externalChrome = process.env.KNOWFEED_E2E_EXTERNAL_CHROME === "1";
const headedChrome = process.env.KNOWFEED_E2E_HEADLESS === "0";
const keepTabs = process.env.KNOWFEED_E2E_KEEP_TABS === "1";
const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
const outputDir = process.env.KNOWFEED_E2E_OUTPUT_DIR ?? join(tmpdir(), `knowfeed-real-llm-e2e-${timestamp}`);
const startedAt = new Date().toISOString();
const checkoutEvidence = readCheckoutEvidence();
const selectedScenarios = new Set(
  (process.env.KNOWFEED_E2E_SCENARIOS ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
);
const selectedViewports = new Set(
  (process.env.KNOWFEED_E2E_VIEWPORTS ?? "mobile")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
);
const matrixBreadthEnabled =
  process.env.KNOWFEED_E2E_REQUIRE_BREADTH === "1" ||
  [
    "KNOWFEED_E2E_MIN_SUBJECT_AREAS",
    "KNOWFEED_E2E_MIN_LEARNER_PERSONAS",
    "KNOWFEED_E2E_MIN_VIEWPORTS",
    "KNOWFEED_E2E_MIN_PASSED_RUNS"
  ].some((name) => process.env[name]);
const matrixBreadthRequirements = {
  enabled: matrixBreadthEnabled,
  minSubjectAreas: readPositiveIntegerEnv("KNOWFEED_E2E_MIN_SUBJECT_AREAS", 3),
  minLearnerPersonas: readPositiveIntegerEnv("KNOWFEED_E2E_MIN_LEARNER_PERSONAS", 3),
  minViewports: readPositiveIntegerEnv("KNOWFEED_E2E_MIN_VIEWPORTS", 1),
  minPassedRuns: readPositiveIntegerEnv("KNOWFEED_E2E_MIN_PASSED_RUNS", 3)
};
const researchLlmLabel = "今日讨论已更新";
const llmOnlyLabel = "内容已生成";
const allowLlmOnly = process.env.KNOWFEED_E2E_ALLOW_LLM_ONLY === "1";
const skipEvidenceGate = process.env.KNOWFEED_E2E_SKIP_EVIDENCE_GATE === "1";
const retryCdpTimeouts = process.env.KNOWFEED_E2E_RETRY_CDP_TIMEOUTS !== "0";
const retryLlmFallbacks = process.env.KNOWFEED_E2E_RETRY_LLM_FALLBACKS !== "0";
const maxScenarioAttempts = readPositiveIntegerEnv("KNOWFEED_E2E_SCENARIO_ATTEMPTS", 2);
const retryEvents = [];

const scenarios = [
  {
    slug: "fintech-engineer",
    subjectArea: "finance",
    learnerPersona: "engineer",
    topic: "Fintech 入门",
    background: "我是 AI 工程师，想了解金融科技，目标是能看懂行业讨论。",
    avoidedStyles: "公式推导、监管术语堆砌",
    goal: "能看懂金融科技产品、风控和监管争论",
    allowedFallbackLeakTerms: ["钱包"]
  },
  {
    slug: "ai-product-manager",
    subjectArea: "technology",
    learnerPersona: "product-manager",
    topic: "AI 入门",
    background: "我是产品经理，想判断 AI 产品机会，但不想只看模型名。",
    avoidedStyles: "模型名堆砌、技术细节",
    goal: "能判断一个 AI 产品热帖背后的真实价值"
  },
  {
    slug: "psychology-casual",
    subjectArea: "psychology",
    learnerPersona: "casual-learner",
    topic: "心理学入门",
    background: "我是普通兴趣用户，想看懂心理学讨论，每天 5 分钟。",
    avoidedStyles: "诊断口吻、学术定义",
    goal: "能看懂心理学研究和社交平台争论"
  },
  {
    slug: "climate-policy-planner",
    subjectArea: "policy",
    learnerPersona: "city-planner",
    topic: "气候变化政策入门",
    background: "我是城市规划从业者，想看懂减排、适应和政策争论。",
    avoidedStyles: "政策口号、宏大叙事",
    goal: "能分清政策工具、利益相关方和常见争议"
  },
  {
    slug: "photography-operator",
    subjectArea: "visual-arts",
    learnerPersona: "ecommerce-operator",
    topic: "摄影构图入门",
    background: "我是电商运营，想让商品图更会讲故事。",
    avoidedStyles: "器材党口吻、鸡汤审美",
    goal: "能判断构图选择和视觉叙事",
    expectedContextTerms: ["商品图", "电商", "视觉"],
    allowedFallbackLeakTerms: ["钱包"]
  },
  {
    slug: "education-course-designer",
    subjectArea: "education",
    learnerPersona: "course-designer",
    topic: "教育学入门",
    background: "我是新手课程设计师，想理解学习动机和课堂讨论。",
    avoidedStyles: "教育黑话、论文式定义",
    goal: "能看懂教学方法背后的证据和争议",
    expectedContextTerms: ["课程", "课堂", "学习动机"]
  },
  {
    slug: "classical-music-listener",
    subjectArea: "music",
    learnerPersona: "casual-listener",
    topic: "古典音乐入门",
    background: "我是通勤时听音乐的普通兴趣用户，不懂乐理。",
    avoidedStyles: "乐理黑话、学院派长文",
    goal: "能看懂作品、演奏和审美争论",
    expectedContextTerms: ["通勤", "听音乐", "不懂乐理", "作品", "演奏"],
    forbiddenCommunityAuthorTerms: ["运营", "产品", "商业"],
    forbiddenCommunityVisibleTerms: ["运营", "产品"]
  },
  {
    slug: "sengoku-history-editor",
    subjectArea: "history",
    learnerPersona: "content-editor",
    topic: "日本战国史入门",
    background: "我是内容编辑，想看懂人物关系、制度和影视改编争论。",
    avoidedStyles: "年份堆砌、王朝流水账",
    goal: "能分清历史叙事、史料和影视化改编",
    expectedContextTerms: ["内容编辑", "人物", "史料", "影视"],
    forbiddenCommunityAuthorTerms: ["运营", "产品", "商业"],
    forbiddenCommunityVisibleTerms: ["运营", "产品"]
  },
  {
    slug: "architecture-city-renewal",
    subjectArea: "architecture",
    learnerPersona: "city-renewal-practitioner",
    topic: "建筑史入门",
    background: "我是城市更新从业者，想看懂不同建筑风格、材料和历史语境。",
    avoidedStyles: "宏大叙事、学术定义",
    goal: "能判断建筑作品背后的时代、功能和审美争论",
    expectedContextTerms: ["城市更新", "建筑", "风格", "材料", "历史"],
    forbiddenCommunityAuthorTerms: [],
    forbiddenCommunityVisibleTerms: []
  }
].filter((scenario) => selectedScenarios.size === 0 || selectedScenarios.has(scenario.slug));

const viewports = [
  {
    slug: "mobile",
    width: 390,
    height: 844,
    deviceScaleFactor: 2,
    mobile: true
  },
  {
    slug: "laptop",
    width: 1280,
    height: 800,
    deviceScaleFactor: 1,
    mobile: false
  },
  {
    slug: "desktop",
    width: 1440,
    height: 1000,
    deviceScaleFactor: 1,
    mobile: false
  }
].filter((viewport) => selectedViewports.has(viewport.slug));

function CDP(webSocketUrl) {
  this.webSocket = new WebSocket(webSocketUrl);
  this.nextId = 1;
  this.pending = new Map();
  this.webSocket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    if (!message.id || !this.pending.has(message.id)) return;
    const { resolve, reject, timeout } = this.pending.get(message.id);
    this.pending.delete(message.id);
    clearTimeout(timeout);
    if (message.error) reject(new Error(`${message.error.message}: ${message.error.data ?? ""}`));
    else resolve(message.result ?? {});
  });
}

CDP.prototype.ready = async function ready() {
  if (this.webSocket.readyState === WebSocket.OPEN) return;
  await new Promise((resolve, reject) => {
    this.webSocket.addEventListener("open", resolve, { once: true });
    this.webSocket.addEventListener("error", reject, { once: true });
  });
};

CDP.prototype.send = function send(method, params = {}) {
  const id = this.nextId;
  this.nextId += 1;
  this.webSocket.send(JSON.stringify({ id, method, params }));
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      if (!this.pending.has(id)) return;
      this.pending.delete(id);
      reject(new Error(`CDP timeout for ${method}`));
    }, 360_000);
    this.pending.set(id, { resolve, reject, timeout });
  });
};

CDP.prototype.close = function close() {
  for (const { reject, timeout } of this.pending.values()) {
    clearTimeout(timeout);
    reject(new Error("CDP connection closed"));
  }
  this.pending.clear();
  this.webSocket.close();
};

await mkdir(outputDir, { recursive: true });

const results = [];
let chromeExit;
let chrome;
let chromeStderr = "";

let caughtError;

if (scenarios.length === 0) {
  caughtError = new Error("No scenarios selected. Check KNOWFEED_E2E_SCENARIOS.");
}

if (!caughtError && viewports.length === 0) {
  caughtError = new Error("No viewports selected. Use KNOWFEED_E2E_VIEWPORTS=mobile,laptop,desktop.");
}

try {
  if (caughtError) throw caughtError;

  await assertReachable(appUrl);

  if (!externalChrome) {
    const chromeArgs = [
      `--remote-debugging-port=${chromePort}`,
      `--user-data-dir=${join(tmpdir(), `knowfeed-e2e-profile-${timestamp}`)}`,
      "--no-first-run",
      "--no-default-browser-check",
      headedChrome ? "--window-size=1280,900" : "--headless=new",
      ...(headedChrome ? [] : ["--disable-gpu"]),
      "about:blank"
    ];
    chrome = spawn(chromePath, chromeArgs);

    chrome.on("exit", (code, signal) => {
      chromeExit = { code, signal };
    });

    chrome.on("error", (error) => {
      chromeExit = { error: error.message };
    });

    chrome.stderr.on("data", (chunk) => {
      const text = String(chunk);
      chromeStderr += text;
      if (/DevTools listening/.test(text)) process.stderr.write(text);
    });
  }

  await waitForChrome();

  for (const scenario of scenarios) {
    for (const viewport of viewports) {
      console.log(`Running ${scenario.slug} @ ${viewport.slug}`);
      const result = await runScenarioWithRetry(scenario, viewport);
      results.push(result);
      await writeSummary("running");
    }
  }

  assertMatrixBreadth(results);
} catch (error) {
  caughtError = error;
  if (error.e2eFailure && !results.some((result) => result.runSlug === error.e2eFailure.runSlug)) {
    results.push(error.e2eFailure);
  }
} finally {
  await stopChrome();
  let summary = await writeSummary(caughtError ? "failed" : "passed", caughtError);
  if (!caughtError && !skipEvidenceGate && !summary.evidenceGate.passed) {
    caughtError = new Error(`E2E evidence gate failed: ${summary.evidenceGate.issues.join("; ")}`);
    summary = await writeSummary("failed", caughtError);
  }
  const output = JSON.stringify(summary, null, 2);
  if (caughtError) console.error(output);
  else console.log(output);
}

if (caughtError) {
  throw caughtError;
}

async function runScenarioWithRetry(scenario, viewport) {
  const runSlug = `${scenario.slug}-${viewport.slug}`;
  for (let attempt = 1; attempt <= maxScenarioAttempts; attempt += 1) {
    try {
      return await runScenario(scenario, viewport);
    } catch (error) {
      if (attempt >= maxScenarioAttempts || !isRetryableScenarioError(error)) throw error;
      retryEvents.push({
        runSlug,
        attempt,
        failedAt: new Date().toISOString(),
        message: error.message
      });
      await preserveRetryFailureArtifacts(runSlug, attempt);
      console.warn(`Retrying ${runSlug} after transient scenario failure: ${error.message}`);
      await delay(2_000);
    }
  }
  throw new Error(`${runSlug}: scenario retry loop exited unexpectedly`);
}

function isRetryableScenarioError(error) {
  const message = [
    error?.message,
    error?.stack,
    error?.e2eFailure?.error?.message,
    error?.e2eFailure?.error?.stack
  ]
    .filter(Boolean)
    .join("\n");
  if (retryCdpTimeouts && /CDP timeout for Runtime\.evaluate/.test(message)) return true;
  if (retryLlmFallbacks && /Generated feed fell back before Research brief \+ LLM/.test(message)) return true;
  return false;
}

async function preserveRetryFailureArtifacts(runSlug, attempt) {
  await Promise.all(
    ["json", "png"].map((extension) =>
      rename(
        join(outputDir, `${runSlug}-failure.${extension}`),
        join(outputDir, `${runSlug}-attempt${attempt}-failure.${extension}`)
      ).catch(() => null)
    )
  );
}

async function runScenario(scenario, viewport) {
  const runSlug = `${scenario.slug}-${viewport.slug}`;
  const tab = await createTab("about:blank");
  const cdp = new CDP(tab.webSocketDebuggerUrl);
  await cdp.ready();
  await cdp.send("Page.enable");
  await cdp.send("Runtime.enable");
  await cdp.send("Emulation.setDeviceMetricsOverride", {
    width: viewport.width,
    height: viewport.height,
    deviceScaleFactor: viewport.deviceScaleFactor,
    mobile: viewport.mobile
  });

  try {
    await cdp.send("Page.navigate", { url: appUrl });
    await waitFor(cdp, "page body", "!!document.body", 30_000);
    await evaluate(cdp, "localStorage.clear(); location.reload(); true");
    await waitFor(cdp, "onboarding", "document.body.innerText.includes('输入你想看懂的真实讨论')", 60_000);
    await installHelpers(cdp);
    await evaluate(cdp, `window.__kf.fillLabel('想学的主题或问题', ${JSON.stringify(scenario.topic)})`);
    await evaluate(cdp, `window.__kf.fillLabel('你的背景', ${JSON.stringify(scenario.background)})`);
    if (scenario.avoidedStyles) {
      const filledAvoidedStyles = await evaluate(
        cdp,
        `window.__kf.fillLabel('不想看到的风格', ${JSON.stringify(scenario.avoidedStyles)})`
      );
      if (!filledAvoidedStyles) throw new Error("Could not fill learner avoided styles");
    }
    await evaluate(cdp, `window.__kf.fillLabel('这次想达成什么', ${JSON.stringify(scenario.goal)})`);
    await screenshot(cdp, `${runSlug}-01-onboarding.png`);

    if (!(await evaluate(cdp, "window.__kf.clickButton('生成我的学习信息流')"))) {
      throw new Error("Could not click onboarding generation button");
    }

    await waitForResearchLlmFeed(cdp, "research-backed community feed");
    await installHelpers(cdp);
    if (await evaluate(cdp, "window.__kf.clickButton('进入信息流')")) {
      await waitFor(cdp, "feed after path preview", "document.body.innerText.includes('今日任务') && !!document.querySelector('.hook-card')", 30_000);
      await installHelpers(cdp);
    }
    await evaluate(cdp, "window.__kf.expandProvenance()");
    await assertLayout(cdp, runSlug, "feed");
    await screenshot(cdp, `${runSlug}-02-feed.png`);
    const feed = await evaluate(cdp, "window.__kf.metrics()");

    if (!(await evaluate(cdp, "window.__kf.clickSelector('.hook-card')"))) {
      throw new Error("Could not open post");
    }
    await waitFor(
      cdp,
      "post comments",
      "document.querySelectorAll('.comment-item').length >= 3 && document.body.innerText.includes('全部')",
      90_000
    );
    await installHelpers(cdp);
    await assertCommentFilters(cdp, runSlug);
    await evaluate(cdp, "window.__kf.clickCommentFilter('全部')");
    await assertCommentSortModes(cdp, runSlug);
    await evaluate(cdp, "window.__kf.clickCommentSort('热度')");
    await evaluate(cdp, "window.__kf.expandProvenance()");
    await assertLayout(cdp, runSlug, "comments");
    await screenshot(cdp, `${runSlug}-03-comments.png`);
    const post = await evaluate(cdp, "window.__kf.metrics()");

    if (!(await evaluate(cdp, "window.__kf.clickSelector('.post-detail .primary-button.full')"))) {
      throw new Error("Could not start lesson from post");
    }
    await waitFor(
      cdp,
      "lesson screen",
      "document.body.innerText.includes('快速判断') && !!document.querySelector('.lesson-screen textarea')",
      90_000
    );
    await installHelpers(cdp);
    await evaluate(cdp, "window.__kf.expandProvenance()");
    await assertLayout(cdp, runSlug, "lesson");
    await screenshot(cdp, `${runSlug}-04-lesson.png`);
    const lesson = await evaluate(cdp, "window.__kf.metrics()");
    await evaluate(
      cdp,
      `window.__kf.fillSelector('.lesson-screen textarea', ${JSON.stringify(`${scenario.topic} 的争论要先看证据、边界和反方观点。`)})`
    );

    if (!(await evaluate(cdp, "window.__kf.clickButton('完成并回评论区')"))) {
      throw new Error("Could not complete lesson");
    }
    await waitFor(
      cdp,
      "return to comments after lesson",
      "window.__kf?.state()?.progress?.completedLessonIds?.length >= 1 && document.querySelectorAll('.comment-item').length >= 3",
      90_000
    );
    await installHelpers(cdp);
    await assertLayout(cdp, runSlug, "return-comments");
    await screenshot(cdp, `${runSlug}-05-return-comments.png`);
    const afterLesson = await evaluate(cdp, "window.__kf.metrics()");

    if (!(await evaluate(cdp, "window.__kf.clickNav('设置')"))) {
      throw new Error("Could not open settings tab");
    }
    await waitFor(
      cdp,
      "shadow draft",
      "document.body.innerText.includes('可发布草稿') && document.querySelectorAll('.draft-card').length >= 1",
      90_000
    );
    await installHelpers(cdp);
    await evaluate(cdp, "window.__kf.expandProvenance()");
    await assertLayout(cdp, runSlug, "settings", true);
    await screenshot(cdp, `${runSlug}-06-settings.png`);
    const shadow = await evaluate(cdp, "window.__kf.metrics()");
    const shadowWorkflow = await assertShadowDraftControls(cdp, runSlug, scenario);
    const reloaded = await assertReloadPersistence(cdp, runSlug, scenario);
    const dailyLesson = await assertDailyMissionEntry(cdp, runSlug);
    const mapLesson = await assertMapLessonIntegrity(cdp, runSlug);

    const validation = assertScenarioResult(runSlug, scenario, {
      feed,
      post,
      lesson,
      afterLesson,
      shadow,
      shadowWorkflow,
      reloaded,
      dailyLesson,
      mapLesson
    });
    return {
      status: "passed",
      runSlug,
      slug: scenario.slug,
      subjectArea: scenario.subjectArea,
      learnerPersona: scenario.learnerPersona,
      topic: scenario.topic,
      background: scenario.background,
      avoidedStyles: scenario.avoidedStyles ?? "",
      goal: scenario.goal,
      viewport: viewport.slug,
      feed,
      post,
      lesson,
      afterLesson,
      shadow,
      shadowWorkflow,
      reloaded,
      dailyLesson,
      mapLesson,
      communityQuality: validation.communityQuality
    };
  } catch (error) {
    const failure = await captureFailure(cdp, runSlug, scenario, viewport, error);
    error.e2eFailure = failure;
    throw error;
  } finally {
    cdp.close();
    if (!keepTabs) {
      await fetch(`http://127.0.0.1:${chromePort}/json/close/${tab.id}`).catch(() => null);
    }
  }
}

async function captureFailure(cdp, runSlug, scenario, viewport, error) {
  const screenshotFile = `${runSlug}-failure.png`;
  const diagnosticsFile = `${runSlug}-failure.json`;
  await installHelpers(cdp).catch(() => null);
  const metrics = await evaluate(cdp, "window.__kf?.metrics?.() ?? null").catch((diagnosticError) => ({
    diagnosticError: serializeError(diagnosticError)
  }));
  const state = await evaluate(cdp, "window.__kf?.state?.() ?? null").catch(() => null);
  const bodyText = await evaluate(cdp, "document.body?.innerText?.slice(0, 3000) ?? ''").catch(() => "");
  let screenshotSaved = false;

  try {
    await screenshot(cdp, screenshotFile);
    screenshotSaved = true;
  } catch {
    screenshotSaved = false;
  }

  const failure = {
    status: "failed",
    runSlug,
    slug: scenario.slug,
    subjectArea: scenario.subjectArea,
    learnerPersona: scenario.learnerPersona,
    viewport: viewport.slug,
    failedAt: new Date().toISOString(),
    error: serializeError(error),
    communityQuality: error.details?.communityQuality ?? null,
    artifacts: {
      diagnostics: diagnosticsFile,
      screenshot: screenshotSaved ? screenshotFile : null
    },
    scenario: {
      topic: scenario.topic,
      background: scenario.background,
      avoidedStyles: scenario.avoidedStyles ?? "",
      goal: scenario.goal
    },
    page: {
      metrics,
      state,
      bodyText
    }
  };

  await writeJson(diagnosticsFile, failure);
  return failure;
}

function assertScenarioResult(label, scenario, result) {
  const topicNeedle = scenario.topic.replace(/\s*入门$/, "");
  if (!result.feed.topic?.includes(topicNeedle)) throw new Error(`${label}: topic mismatch`);
  assertRealResearchPlannerSource(label, "feed", result.feed);
  if (!isAcceptedLlmSource(result.feed.sourceStrip)) throw new Error(`${label}: feed is not accepted LLM content`);
  assertVisibleSourceProvenance(label, "feed", result.feed);
  assertGeneratedPostAuthor(label, "feed", result.feed.generatedPostAuthor);
  assertGeneratedPostAuthor(label, "post", result.post.generatedPostAuthor);
  assertVisibleSourceProvenance(label, "post", result.post);
  if (result.post.commentCount < 8) throw new Error(`${label}: too few comments (${result.post.commentCount}/8)`);
  const sortModes = result.post.commentSortModes ?? [];
  for (const sortMode of ["热度", "新回复", "相关"]) {
    if (!sortModes.includes(sortMode)) throw new Error(`${label}: missing comment sort mode ${sortMode}`);
  }
  const stanceKinds = new Set(result.post.commentStances.map((item) => item.split(" · ")[0]));
  if (stanceKinds.size < 4) {
    throw new Error(`${label}: comments lack stance diversity (${result.post.commentStances.join(", ")})`);
  }
  const communityQuality = assertCommunityQuality(label, scenario, result.post);
  if (result.afterLesson.completedLessons < 1) throw new Error(`${label}: lesson did not complete`);
  if (result.shadow.shadowDrafts < 1 || !result.shadow.shadowBody) {
    throw new Error(`${label}: shadow draft missing`);
  }
  if (!result.shadow.shadowHasBasis) {
    throw new Error(`${label}: shadow draft lacks visible learning basis`);
  }
  assertVisibleSourceProvenance(label, "lesson", result.lesson);
  assertVisibleSourceProvenance(label, "shadow", result.shadow);
  for (const control of ["保存修改", "拒绝草稿", "批准发布"]) {
    if (!result.shadow.shadowControlLabels?.includes(control)) {
      throw new Error(`${label}: shadow draft missing control ${control}`);
    }
  }
  if (result.shadowWorkflow.approved.approvedShadowPosts < 1) {
    throw new Error(`${label}: shadow approve did not create approved history`);
  }
  if (!result.shadowWorkflow.approved.shadowApprovedBodies.some((body) => body.includes(result.shadowWorkflow.editedText))) {
    throw new Error(`${label}: approved shadow history did not preserve edited draft`);
  }
  if (result.shadowWorkflow.rejected.shadowDrafts !== 0 || result.shadowWorkflow.rejected.approvedShadowPosts < 1) {
    throw new Error(`${label}: shadow reject did not remove pending draft while keeping approved history`);
  }
  const persistedShadowCount = (result.reloaded.shadowDrafts ?? 0) + (result.reloaded.approvedShadowPosts ?? 0);
  if (result.reloaded.completedLessons < result.afterLesson.completedLessons || persistedShadowCount < 1) {
    throw new Error(`${label}: reload did not preserve completed lesson and shadow state`);
  }
  if (!isAcceptedLlmSource(result.reloaded.sourceStrip)) {
    throw new Error(`${label}: reload did not rehydrate cached accepted LLM bundle`);
  }
  assertRealResearchPlannerSource(label, "reloaded", result.reloaded);
  assertGeneratedPostAuthor(label, "reloaded", result.reloaded.generatedPostAuthor);
  if (!result.dailyLesson.integrity?.choiceLabelsMatch || !result.dailyLesson.integrity?.lessonMatchesConcept) {
    throw new Error(`${label}: daily mission lesson does not match stable curriculum state`);
  }
  if (!result.mapLesson.integrity?.choiceLabelsMatch || !result.mapLesson.integrity?.lessonMatchesConcept) {
    throw new Error(`${label}: map lesson does not match selected concept`);
  }
  const fallbackLeakTerms = ["Web3", "钱包", "Gas", "链上"].filter(
    (term) => !scenario.allowedFallbackLeakTerms?.includes(term)
  );
  const fallbackLeakPattern = new RegExp(fallbackLeakTerms.map(escapeRegExp).join("|"));
  const fallbackLeakMatches = findFallbackLeakMatches(result, fallbackLeakPattern, fallbackLeakTerms);
  if (
    fallbackLeakTerms.length &&
    fallbackLeakMatches.length &&
    scenario.slug !== "web3"
  ) {
    const error = new Error(
      `${label}: Web3 fallback leaked into non-Web3 scenario: ${fallbackLeakMatches
        .map((match) => `${match.phase}/${match.term}: ${match.snippet}`)
        .join(" | ")}`
    );
    error.details = { fallbackLeakMatches };
    throw error;
  }
  if (scenario.expectedContextTerms?.length) {
    const generatedText = [
      result.post.postBody,
      result.lesson.body,
      result.shadow.shadowBody,
      ...result.post.comments.map((comment) => `${comment.authorName} ${comment.role} ${comment.body}`),
      ...(result.post.generatedComments ?? []).map((comment) =>
        `${comment.authorName} ${comment.handle} ${comment.role} ${comment.body}`
      )
    ].join(" ");
    if (!scenario.expectedContextTerms.some((term) => generatedText.includes(term))) {
      throw new Error(
        `${label}: generated experience did not use expected learner-context terms (${scenario.expectedContextTerms.join(", ")}); text=${generatedText.slice(0, 600)}`
      );
    }
  }

  return { communityQuality };
}

function assertRealResearchPlannerSource(label, phase, metrics) {
  const acceptedResearchSource = metrics.researchSource === "web" || (allowLlmOnly && metrics.researchSource === "fallback");
  const acceptedCurriculumSource =
    metrics.curriculumSource === "planner" || (allowLlmOnly && metrics.curriculumSource === "deterministic-fallback");
  if (!acceptedResearchSource) {
    throw new Error(`${label}: ${phase} did not use accepted research source (${metrics.researchSource ?? "missing"})`);
  }
  if (!acceptedCurriculumSource) {
    throw new Error(`${label}: ${phase} did not use accepted curriculum source (${metrics.curriculumSource ?? "missing"})`);
  }
}

function assertVisibleSourceProvenance(label, phase, metrics) {
  const provenance = (metrics.sourceProvenance ?? []).join(" | ");
  const requiredPath = metrics.curriculumSource === "planner" ? "Path: planner" : "Path: deterministic";
  const requiredTexts =
    metrics.researchSource === "web"
      ? ["Research brief + LLM", "Research: web", requiredPath]
      : ["AI 生成 LLM", "Research: fallback", requiredPath];
  for (const requiredText of requiredTexts) {
    if (!provenance.includes(requiredText)) {
      throw new Error(`${label}: ${phase} missing visible source provenance ${requiredText}`);
    }
  }
  if (metrics.researchSource === "web") {
    const visibleResearchAnchors = Array.isArray(metrics.visibleResearchAnchors) ? metrics.visibleResearchAnchors : [];
    const visibleAnchorText = visibleResearchAnchors.join(" | ");
    const researchTerms = researchTermsFromMetrics(metrics);
    if (!visibleResearchAnchors.length || !visibleAnchorText.includes("研究锚点")) {
      throw new Error(`${label}: ${phase} missing visible research anchor/source chips`);
    }
    if (researchTerms.length && !researchTerms.some((term) => visibleAnchorText.toLowerCase().includes(term.toLowerCase()))) {
      throw new Error(`${label}: ${phase} visible research anchors do not match active research brief`);
    }
    const visibleResearchSources = Array.isArray(metrics.visibleResearchSources) ? metrics.visibleResearchSources : [];
    const visibleSourceText = visibleResearchSources.join(" | ");
    const researchSourceTitles = Array.isArray(metrics.researchSourceTitles) ? metrics.researchSourceTitles : [];
    if (!visibleResearchSources.length || !visibleSourceText.includes("资料来源")) {
      throw new Error(`${label}: ${phase} missing visible research source chips`);
    }
    if (
      researchSourceTitles.length &&
      !researchSourceTitles.some((title) => visibleSourceText.toLowerCase().includes(String(title).slice(0, 16).toLowerCase()))
    ) {
      throw new Error(`${label}: ${phase} visible research sources do not match active research brief`);
    }
  }
}

function findFallbackLeakMatches(result, fallbackLeakPattern, fallbackLeakTerms) {
  const phases = [
    ["feed", result.feed?.body],
    ["post", result.post?.body],
    ["shadow", result.shadow?.body]
  ];
  return phases.flatMap(([phase, text]) => {
    const body = String(text ?? "");
    if (!fallbackLeakPattern.test(body)) return [];
    return fallbackLeakTerms
      .filter((term) => body.includes(term))
      .map((term) => {
        const index = body.indexOf(term);
        return {
          phase,
          term,
          snippet: body.slice(Math.max(0, index - 80), index + term.length + 80)
        };
      });
  });
}

function assertGeneratedPostAuthor(label, phase, author) {
  if (!author) throw new Error(`${label}: ${phase} generated post author missing`);
  const authorText = `${author.authorName ?? ""} ${author.handle ?? ""} ${author.role ?? ""}`;
  if (isPlaceholderAuthor(author.authorName) || /@?knowfeed-ai|AI\s*生成角色/i.test(authorText)) {
    throw new Error(`${label}: ${phase} generated post author is placeholder (${authorText})`);
  }
}

function assertCommunityQuality(label, scenario, postMetrics) {
  const report = buildCommunityQualityReport(scenario, postMetrics);

  if (report.issues.length) {
    const error = new Error(`${label}: community quality failed: ${report.issues.join("; ")}`);
    error.details = { communityQuality: report };
    throw error;
  }

  return report;
}

function buildCommunityQualityReport(scenario, postMetrics) {
  const comments = Array.isArray(postMetrics.comments) ? postMetrics.comments : [];
  const generatedComments = Array.isArray(postMetrics.generatedComments) ? postMetrics.generatedComments : [];
  const visibleReplies = comments.flatMap((comment) =>
    Array.isArray(comment.replies)
      ? comment.replies.map((reply) => ({ source: "visible-reply", parentAuthor: comment.authorName, ...reply }))
      : []
  );
  const generatedReplies = generatedComments.flatMap((comment) =>
    Array.isArray(comment.replies)
      ? comment.replies.map((reply) => ({ source: "bundle-reply", parentAuthor: comment.authorName, ...reply }))
      : []
  );
  const generatedPostAuthor = postMetrics.generatedPostAuthor
    ? [{ source: "bundle-post-author", ...postMetrics.generatedPostAuthor }]
    : [];
  const inspectableComments = [
    ...comments.map((comment) => ({ source: "visible", ...comment })),
    ...generatedComments.map((comment) => ({ source: "bundle", ...comment }))
  ];
  const inspectableCommunityItems = [...generatedPostAuthor, ...inspectableComments, ...visibleReplies, ...generatedReplies];
  const issues = [];
  const deductions = [];
  const stanceKinds = [...new Set(comments.map((item) => item.stance).filter(Boolean))];
  const replyRelationKinds = [...new Set(visibleReplies.map((item) => item.relation).filter(Boolean))];
  const commentSortModes = Array.isArray(postMetrics.commentSortModes) ? postMetrics.commentSortModes : [];
  const requiredStances = ["赞成", "反对", "补充", "挑刺"];
  const missingStances = requiredStances.filter((stance) => !stanceKinds.includes(stance));
  const placeholderAuthors = inspectableCommunityItems.filter((comment) => isPlaceholderAuthor(comment.authorName));
  const contextTerms = [
    scenario.topic.replace(/\s*入门$/, ""),
    ...(scenario.expectedContextTerms ?? []),
    ...contextTermsFromText(scenario.background),
    ...contextTermsFromText(scenario.goal),
    ...contextTermsFromText(postMetrics.generatedConceptTitle),
    ...contextTermsFromText(postMetrics.generatedConceptPlainName),
    ...contextTermsFromText(postMetrics.lessonTitle),
    ...contextTermsFromText(postMetrics.postBody)
  ].filter(Boolean);
  const generatedContentQuality = buildGeneratedContentQualityReport(scenario, postMetrics);

  if (comments.length < 8) {
    issues.push(`community details missing (${comments.length}/8 visible comments)`);
    deductions.push(20);
  }

  if (visibleReplies.length !== 3) {
    issues.push(`community replies must be exactly 3 (${visibleReplies.length}/3 visible replies)`);
    deductions.push(15);
  }

  if (visibleReplies.length === 3 && replyRelationKinds.length < 3) {
    issues.push(`community replies must cover all relation kinds (${replyRelationKinds.join(", ") || "none"})`);
    deductions.push(15);
  }

  if (generatedReplies.length !== 3) {
    issues.push(`generated bundle replies must be exactly 3 (${generatedReplies.length}/3 generated replies)`);
    deductions.push(15);
  }

  if (missingStances.length) {
    issues.push(`missing visible stances: ${missingStances.join(", ")}`);
    deductions.push(25);
  }

  if (placeholderAuthors.length) {
    issues.push(`placeholder community authors: ${placeholderAuthors.map((item) => `${item.source}/${item.authorName}`).join(", ")}`);
    deductions.push(20);
  }

  const genericCommunityAuthors = inspectableCommunityItems.filter((comment) =>
    isGenericUnanchoredCommunityAuthor(comment, contextTerms)
  );
  if (genericCommunityAuthors.length) {
    issues.push(
      `generic community authors: ${genericCommunityAuthors
        .map((item) => `${item.source}/${item.authorName}: ${item.role ?? ""}`.slice(0, 140))
        .join(" | ")}`
    );
    deductions.push(20);
  }

  const offDomainAuthors = inspectableCommunityItems.filter((comment) =>
    scenario.forbiddenCommunityAuthorTerms?.some((term) =>
      `${comment.authorName} ${comment.handle ?? ""} ${comment.role ?? ""}`.includes(term)
    )
  );
  if (offDomainAuthors.length) {
    issues.push(
      `off-domain community authors: ${offDomainAuthors
        .map((item) => `${item.source}/${item.authorName}`)
        .join(", ")}`
    );
    deductions.push(20);
  }

  const offDomainVisibleTerms = scenario.forbiddenCommunityVisibleTerms ?? [];
  const offDomainVisibleComments = inspectableCommunityItems.filter((comment) =>
    offDomainVisibleTerms.some((term) =>
      `${comment.authorName} ${comment.handle ?? ""} ${comment.role ?? ""} ${comment.body}`.includes(term)
    )
  );
  if (offDomainVisibleComments.length) {
    issues.push(
      `off-domain inspectable community copy: ${offDomainVisibleComments
        .map((item) => `${item.source}/${item.authorName}: ${item.role ?? ""} ${item.body}`.slice(0, 180))
        .join(" | ")}`
    );
    deductions.push(25);
  }

  const authorCount = new Set(comments.map((comment) => comment.authorName)).size;
  if (authorCount < Math.min(6, comments.length)) {
    issues.push(`community authors are not distinct enough (${authorCount}/${comments.length})`);
    deductions.push(15);
  }

  const selfReplies = [...visibleReplies, ...generatedReplies].filter(
    (reply) => sameAuthorName(reply.authorName, reply.parentAuthor)
  );
  if (selfReplies.length) {
    issues.push(
      `community replies are self-replies: ${selfReplies
        .map((reply) => `${reply.parentAuthor}/${reply.relation}`)
        .join(", ")}`
    );
    deductions.push(15);
  }

  const repairPhraseCount = comments.filter((comment) =>
    /赞成先学这个点|反对把结论说满|补充一个上下文|最容易偷换/.test(comment.body)
  ).length;
  const repairReplyCount = generatedReplies.filter(
    (reply) => reply.source === "repair" || /-repair-|本地修复|万能解释/.test(`${reply.id ?? ""} ${reply.body}`)
  ).length;
  if (repairPhraseCount > 1) {
    issues.push(`community relies on generic local repair comments (${repairPhraseCount})`);
    deductions.push(20);
  }
  if (repairReplyCount > 0) {
    issues.push(`community relies on generic local repair replies (${repairReplyCount})`);
    deductions.push(15);
  }

  const contextualCommentKeys = new Set(
    inspectableCommunityItems
      .filter((comment) =>
        contextTerms.some(
          (term) =>
            String(comment.body ?? "").includes(term) ||
            String(comment.role ?? "").includes(term) ||
            String(comment.quote ?? "").includes(term)
        )
      )
      .map((comment) => `${comment.authorName}:${comment.body}`)
  );
  const contextualCommentCount = contextualCommentKeys.size;
  if (scenario.expectedContextTerms?.length && contextualCommentCount < 2) {
    issues.push(`community comments do not use learner-topic context (${contextualCommentCount}/2)`);
    deductions.push(20);
  }

  const learningSignalKinds = [...new Set(inspectableCommunityItems.flatMap((item) => learningSignalKindsFor(item.body)))];
  const lowLearningValueComments = comments.filter((comment) => learningSignalKindsFor(comment.body).length === 0);
  if (learningSignalKinds.length < 4) {
    issues.push(`community discussion lacks learning signal variety (${learningSignalKinds.join(", ") || "none"})`);
    deductions.push(20);
  }
  if (lowLearningValueComments.length > 1) {
    issues.push(
      `visible comments are too attitude-only: ${lowLearningValueComments
        .map((comment) => `${comment.authorName}: ${comment.body}`.slice(0, 120))
        .join(" | ")}`
    );
    deductions.push(20);
  }
  if (generatedContentQuality.issues.length) {
    issues.push(...generatedContentQuality.issues);
    deductions.push(20);
  }

  const score = Math.max(0, 100 - deductions.reduce((sum, item) => sum + item, 0));

  return {
    score,
    passed: issues.length === 0,
    issues,
    signals: {
      visibleCommentCount: comments.length,
      generatedCommentCount: generatedComments.length,
      visibleReplyCount: visibleReplies.length,
      generatedReplyCount: generatedReplies.length,
      commentSortModes,
      activeCommentSortMode: postMetrics.activeCommentSortMode ?? null,
      topVisibleCommentAuthor: comments[0]?.authorName ?? null,
      stanceKinds,
      replyRelationKinds,
      missingStances,
      visibleDistinctAuthorCount: authorCount,
      inspectableDistinctAuthorCount: new Set(inspectableCommunityItems.map((comment) => comment.authorName)).size,
      selfReplyCount: selfReplies.length,
      placeholderAuthorCount: placeholderAuthors.length,
      genericCommunityAuthorCount: genericCommunityAuthors.length,
      offDomainAuthorCount: offDomainAuthors.length,
      offDomainInspectableCopyCount: offDomainVisibleComments.length,
      repairPhraseCount,
      repairReplyCount,
      contextualCommentCount,
      learningSignalKinds,
      lowLearningValueCommentCount: lowLearningValueComments.length,
      generatedContentQuality: generatedContentQuality.signals,
      expectedContextTerms: contextTerms
    }
  };
}

function buildGeneratedContentQualityReport(scenario, postMetrics) {
  const contextTerms = [
    scenario.topic.replace(/\s*入门$/, ""),
    ...(scenario.expectedContextTerms ?? []),
    ...contextTermsFromText(scenario.background),
    ...contextTermsFromText(scenario.goal),
    ...contextTermsFromText(postMetrics.generatedConceptTitle),
    ...contextTermsFromText(postMetrics.generatedConceptPlainName)
  ].filter(Boolean);
  const researchTerms = researchTermsFromMetrics(postMetrics);
  const requiresResearchAnchor = postMetrics.researchSource === "web" && researchTerms.length > 0;
  const avoidedTerms = avoidedStyleTerms([scenario.avoidedStyles, ...(postMetrics.learnerAvoidedStyles ?? [])]);
  const preciseClaimSupportText = [...contextTerms, ...researchTerms].join("\n");
  const phases = [
    ["lesson", postMetrics.generatedLessonText || postMetrics.lessonTitle],
    ["post", postMetrics.generatedPostBody || postMetrics.postBody],
    ["shadow", postMetrics.generatedShadowBody || postMetrics.shadowBody]
  ].map(([phase, text]) => {
    const body = String(text ?? "");
    const signalKinds = learningSignalKindsFor(body);
    const concreteLearnerActionKinds = concreteLearnerActionKindsFor(body);
    const matchedTerms = contextTerms.filter((term) => body.includes(term)).slice(0, 8);
    const matchedResearchTerms = researchTerms.filter((term) => body.toLowerCase().includes(term.toLowerCase())).slice(0, 8);
    const matchedAvoidedTerms = avoidedTerms.filter((term) => body.toLowerCase().includes(term.toLowerCase())).slice(0, 8);
    const preciseClaimMarkers = preciseClaimMarkersFromText(body).slice(0, 12);
    const unsupportedPreciseClaimMarkers = preciseClaimMarkers
      .filter((marker) => !isSupportedPreciseClaimMarker(marker, preciseClaimSupportText))
      .slice(0, 8);
    return {
      phase,
      hasAnchor: matchedTerms.length > 0,
      hasLearningSignal: signalKinds.length > 0,
      hasConcreteLearnerAction: concreteLearnerActionKinds.length > 0,
      hasResearchAnchor: !requiresResearchAnchor || matchedResearchTerms.length > 0,
      avoidsRejectedStyles: matchedAvoidedTerms.length === 0,
      hasNoUnsupportedPreciseClaims: unsupportedPreciseClaimMarkers.length === 0,
      matchedTerms,
      matchedResearchTerms,
      matchedAvoidedTerms,
      preciseClaimMarkers,
      unsupportedPreciseClaimMarkers,
      learningSignalKinds: signalKinds,
      concreteLearnerActionKinds
    };
  });
  const groundingIssues = phases
    .filter((phase) => !phase.hasAnchor || !phase.hasLearningSignal || !phase.hasConcreteLearnerAction || !phase.hasResearchAnchor)
    .map((phase) => `generated ${phase.phase} lacks topic/learner anchoring, concrete learner action, research grounding, or learning signal`);
  const avoidedStyleIssues = phases
    .filter((phase) => !phase.avoidsRejectedStyles)
    .map((phase) => `generated ${phase.phase} echoes learner avoided styles: ${phase.matchedAvoidedTerms.join(", ")}`);
  const unsupportedPrecisionIssues = phases
    .filter((phase) => phase.unsupportedPreciseClaimMarkers.length > 0)
    .map(
      (phase) =>
        `generated ${phase.phase} contains unsupported precise claims: ${phase.unsupportedPreciseClaimMarkers.join(", ")}`
    );
  return {
    issues: [...groundingIssues, ...avoidedStyleIssues, ...unsupportedPrecisionIssues],
    signals: {
      phases,
      contextTerms,
      researchTerms,
      requiresResearchAnchor,
      avoidedStyleTerms: avoidedTerms
    }
  };
}

function avoidedStyleTerms(values) {
  const rawValues = values
    .flatMap((value) => (Array.isArray(value) ? value : String(value ?? "").split(/[,，、;；\n]/u)))
    .map((item) => String(item ?? "").trim())
    .filter(Boolean);
  const terms = rawValues.flatMap((style) => {
    const normalized = style.replace(/^(太|过于|过度)/u, "").trim();
    return [style, ...styleMarkerTerms(normalized)];
  });
  return [...new Set(terms.filter((term) => term.length >= 3))];
}

function styleMarkerTerms(style) {
  if (/数学/u.test(style)) return ["公式推导", "数学证明", "矩阵推导"];
  if (/技术/u.test(style)) return ["代码细节", "底层实现", "算法推导", "技术细节"];
  if (/学术/u.test(style)) return ["论文式", "学术定义", "文献综述"];
  if (/鸡汤/u.test(style)) return ["相信自己", "坚持就是胜利", "成长型思维"];
  return [];
}

function preciseClaimMarkersFromText(text) {
  const body = String(text ?? "");
  const patterns = [
    /(?:公元前?\s*)?(?:1[0-9]{3}|20[0-9]{2})\s*年?/gu,
    /\d+(?:\.\d+)?\s*%/gu,
    /百分之[一二三四五六七八九十百千万零〇\d.]+/gu,
    /《[^》]{2,40}(?:报告|白皮书|调查|指数|标准|指南)[^》]*》/gu,
    /[\u3400-\u9fffA-Za-z0-9]{2,30}(?:报告|白皮书|指数)(?:显示|指出|认为|称|发布)?/gu,
    /\b[A-Z][A-Za-z0-9&.' -]{1,50}(?:Report|Survey|Study|Index|White Paper)\b/gu,
    /(?:[A-Z][A-Za-z0-9&.-]{2,}(?:\s+[A-Z][A-Za-z0-9&.-]{2,}){0,3}|[\u3400-\u9fff]{2,16})(?:公司|大学|学院|研究院|协会|委员会|基金会|实验室|医院|银行|交易所|博物馆|美术馆)/gu
  ];
  const markers = patterns.flatMap((pattern) => Array.from(body.matchAll(pattern), (match) => match[0].trim()));
  return [...new Set(markers.filter((marker) => marker && !isGenericPreciseClaimMarker(marker)))];
}

function isSupportedPreciseClaimMarker(marker, supportText) {
  const normalizedSupport = normalizePreciseClaimText(supportText);
  if (!normalizedSupport) return false;
  return preciseClaimMarkerVariants(marker).some((variant) => normalizedSupport.includes(variant));
}

function preciseClaimMarkerVariants(marker) {
  const compact = normalizePreciseClaimText(marker);
  const variants = [
    compact,
    compact.replace(/^公元/u, ""),
    compact.replace(/年$/u, ""),
    compact.replace(/%$/u, ""),
    compact.replace(/^《|》$/gu, "")
  ];
  const percent = compact.match(/^(\d+(?:\.\d+)?)%$/u)?.[1];
  if (percent) variants.push(percent);
  return [...new Set(variants.filter((variant) => variant.length >= 2))];
}

function normalizePreciseClaimText(value) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/[，。,；;：:、"'“”‘’（）()[\]{}]/g, "")
    .trim();
}

function isGenericPreciseClaimMarker(marker) {
  const compact = normalizePreciseClaimText(marker);
  if (/^(某|一家|一些|许多|很多|大型|小型|本地|普通|真实|当前|相关)/u.test(compact)) return true;
  if (/^(应该|需要|可以|先看|查证|查看|回到|提示|提到|使用|引用|比如|例如)/u.test(compact) && /(报告|白皮书|指数)/u.test(compact)) {
    return true;
  }
  if (/^(ai|人工智能|金融科技|心理学|教育|建筑|音乐|历史|电商|摄影|气候|政策|科技|互联网)?(公司|大学|学院|研究院|协会|委员会|基金会|实验室|医院|银行|交易所|博物馆|美术馆)$/iu.test(compact)) {
    return true;
  }
  return /^(研究机构|监管机构|教育机构|金融机构|医疗机构|政府机构|学校|平台|机构)$/u.test(compact);
}

function learningSignalKindsFor(text) {
  const body = String(text ?? "");
  const signals = [];
  if (/边界|风险|限制|误导|误解|不等于|不是|不能|不要|不只是|不只|不仅|包含|细分|过度|过于|粗暴|错过|忽略|低估|副作用|以偏概全/.test(body)) {
    signals.push("boundary");
  }
  if (/证据|研究|数据|样本|方法|来源|史料|结构|查证|时间线|可验证|分期|年份|制度/.test(body)) {
    signals.push("evidence");
  }
  if (/比如|例如|举例|像|用[A-Za-z0-9]+|案例|巴洛克|古典|浪漫|现代|碳税|碳交易|商品图|课堂|通勤|作品|演奏|用户|城市|政策|人物|影视|游戏/.test(body)) {
    signals.push("example");
  }
  if (/先|怎么|如何|追问|判断|分清|区分|对比|比较|查证|看懂|问/.test(body)) {
    signals.push("learner-action");
  }
  if (/反对|反驳|但是|但|虽然|不过|然而|偷换|混在一起|归因|争议|前提|视角/.test(body)) {
    signals.push("counterpoint");
  }
  if (/？|\?|为什么|怎么|如何|追问/.test(body)) {
    signals.push("question");
  }
  return signals;
}

function concreteLearnerActionKindsFor(text) {
  const body = String(text ?? "");
  const actions = [];
  if (/(先|第一步|下次|看到|遇到|读到|听到|判断前).{0,18}(查证|追问|问|看|找|核对|确认|标出|回到|拆成)/u.test(body)) {
    actions.push("first-step");
  }
  if (/(先|第一步|下次|看到|遇到|读到|听到|刷到|判断前).{0,24}(搞懂|拆出|拆成|拆|辨|抓住|对应|问自己)/u.test(body)) {
    actions.push("first-step");
  }
  if (/用.{0,18}(维度|问题|框架|视角|方法).{0,18}(拆|判断|辨|抓住|对应)/u.test(body)) {
    actions.push("use-framework");
  }
  if (/(分清|区分|拆成|分开|对比|比较).{0,18}(证据|来源|样本|方法|边界|场景|前提|经验|研究|观点|概念)/u.test(body)) {
    actions.push("separate-or-compare");
  }
  if (/(查证|核对|确认|追问|问).{0,18}(来源|样本|方法|证据|报告|研究|史料|数据|出处|引用)/u.test(body)) {
    actions.push("verify-source");
  }
  if (/(判断|决定|评估|看).{0,18}(能不能|是否|适不适合|可不可以|边界|适用|代表|解释)/u.test(body)) {
    actions.push("judge-applicability");
  }
  return actions;
}

function isPlaceholderAuthor(value) {
  return /^(张三|李四|王五|小王|小李|小张|用户[A-Z]?|AI 热评员)$/i.test(String(value).trim());
}

function isGenericUnanchoredCommunityAuthor(item, contextTerms) {
  const authorText = `${item.authorName ?? ""} ${item.handle ?? ""} ${item.role ?? ""}`;
  if (contextTerms.some((term) => authorText.includes(term))) return false;
  return /AI\s*(号|热评员|生成角色)|建设派用户|风险派用户|资料补充员|逻辑挑刺员|乐观实践者|反方观察者|科普者|怀疑者|边界提醒者|建设者|实践者|支持者|反对者|补充者|挑刺者|资料党|概念警察|方法论挑刺者/.test(
    authorText
  );
}

function contextTermsFromText(value) {
  const terms = String(value ?? "")
    .split(/[^\p{L}\p{N}]+/u)
    .map((item) => item.trim())
    .filter((item) => item.length >= 2)
    .slice(0, 4);
  const normalizedTerms = terms.flatMap((term) => [term, ...deriveChineseAnchorTerms(term)]);
  return [...new Set(normalizedTerms)].slice(0, 8);
}

function researchTermsFromMetrics(metrics) {
  return [
    ...(Array.isArray(metrics.researchKeyIdeas) ? metrics.researchKeyIdeas : []),
    ...(Array.isArray(metrics.researchDisputedIdeas) ? metrics.researchDisputedIdeas : []),
    ...(Array.isArray(metrics.researchBeginnerPitfalls) ? metrics.researchBeginnerPitfalls : []),
    ...(Array.isArray(metrics.researchSourceTitles) ? metrics.researchSourceTitles : []),
    ...(Array.isArray(metrics.researchSourceSummaries) ? metrics.researchSourceSummaries : [])
  ]
    .flatMap(researchAnchorTermsFromText)
    .filter(Boolean)
    .slice(0, 80);
}

function researchAnchorTermsFromText(value) {
  const tokens = String(value ?? "")
    .split(/[^\p{L}\p{N}]+/u)
    .map((item) => item.trim())
    .filter((item) => item.length >= 3);
  const terms = tokens.flatMap((token) => {
    if (/[\u3400-\u9fff]/u.test(token)) {
      return [
        token.length <= 12 ? token : "",
        ...deriveChineseAnchorTerms(token),
        ...deriveChineseResearchNgrams(token)
      ];
    }
    return token.length >= 4 ? [token] : [];
  });
  return [...new Set(terms.map((term) => term.trim()).filter((term) => term.length >= 3 && !isGenericResearchTerm(term)))];
}

function deriveChineseResearchNgrams(value) {
  const compact = value.replace(/[^\u3400-\u9fff]+/gu, "");
  if (compact.length < 3) return [];
  const terms = [];
  for (const length of [6, 5, 4, 3]) {
    for (let index = 0; index <= compact.length - length; index += 1) {
      const term = compact.slice(index, index + length);
      if (!isGenericResearchTerm(term)) terms.push(term);
    }
  }
  return terms.slice(0, 24);
}

function isGenericResearchTerm(value) {
  return /^(入门|学习|讨论|观点|内容|背景|目标|用户|当前|围绕|组织|路径|真实|场景|常见|问题|概念|领域|核心|先学|理解|判断|看懂|资料|来源|方法|研究|证据|边界|争议|例子|例如|比如|可以|需要|必须|应该|一个|这个|那个|哪些|如何|怎么|为什么|beginner|guide)$/i.test(
    String(value ?? "").trim()
  );
}

function deriveChineseAnchorTerms(term) {
  if (!/[\u3400-\u9fff]/u.test(term)) return [];
  const suffixStripped = term
    .replace(/(基础|入门|概念|原理|方法|技巧|规则|框架|模型|策略|应用|实践|案例|练习|构图)$/u, "")
    .trim();
  const anchors = [];
  if (suffixStripped.length >= 2 && suffixStripped !== term) anchors.push(suffixStripped);
  const leadingTopic = term.match(/^([\u3400-\u9fff]{2,5})(?:基础|入门|概念|原理|方法|技巧|规则|框架|模型|策略|应用|实践|案例|练习|构图)/u)?.[1];
  const leadingDomainNoun = term.match(
    /^([\u3400-\u9fff]{2,8}?(?:法|史|学|论|乱|税|图|曲|剧|课|音乐|政策|动机|构图|课程|交易|分期|时代))(?=[\u3400-\u9fff]|$)/u
  )?.[1];
  const embeddedDomainTerms = ["课程设计", "教学", "课程", "课堂", "学习动机"].filter((item) =>
    term.includes(item)
  );
  if (leadingTopic && leadingTopic.length >= 2) anchors.push(leadingTopic);
  if (leadingDomainNoun && leadingDomainNoun.length >= 2) anchors.push(leadingDomainNoun);
  anchors.push(...embeddedDomainTerms);
  return anchors;
}

function sameAuthorName(left, right) {
  return String(left ?? "").trim().toLowerCase() === String(right ?? "").trim().toLowerCase();
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function assertReloadPersistence(cdp, slug, scenario) {
  await cdp.send("Page.reload", { ignoreCache: true });
  await waitForResearchLlmFeed(cdp, "persisted Research brief + LLM feed after reload");
  await waitFor(
    cdp,
    "persisted topic after reload",
    `document.body.innerText.includes(${JSON.stringify(scenario.topic.replace(/\s*入门$/, ""))}) && document.body.innerText.includes('学习地图')`,
    30_000
  );
  await installHelpers(cdp);
  await waitFor(
    cdp,
    "persisted progress state after reload",
    "(() => { const metrics = window.__kf.metrics(); return metrics.completedLessons >= 1 && (metrics.shadowDrafts + metrics.approvedShadowPosts) >= 1; })()",
    30_000
  );
  await evaluate(cdp, "window.__kf.expandProvenance()");
  await assertLayout(cdp, slug, "reload-feed");
  await screenshot(cdp, `${slug}-07-reload-feed.png`);
  return evaluate(cdp, "window.__kf.metrics()");
}

async function assertShadowDraftControls(cdp, slug, scenario) {
  const editedText = `${scenario.topic} 的 E2E 编辑草稿：我会先看证据、边界和反方问题，再决定是否认同这条评论。`;
  const rejectionText = `${scenario.topic} 的 E2E 拒绝草稿：这条草稿应该被移出待发布队列。`;

  const before = await evaluate(cdp, "window.__kf.metrics()");
  if (!before.shadowHasBasis) throw new Error(`${slug}: shadow basis is not visible before editing`);
  for (const control of ["保存修改", "拒绝草稿", "批准发布"]) {
    if (!before.shadowControlLabels.includes(control)) throw new Error(`${slug}: shadow control missing ${control}`);
  }

  if (!(await evaluate(cdp, `window.__kf.fillSelector('.draft-editor textarea', ${JSON.stringify(editedText)})`))) {
    throw new Error(`${slug}: could not edit shadow draft`);
  }
  if (!(await evaluate(cdp, "window.__kf.clickButton('保存修改')"))) {
    throw new Error(`${slug}: could not save shadow draft edit`);
  }
  await waitFor(
    cdp,
    "saved shadow edit",
    `window.__kf.state()?.shadowDrafts?.some((draft) => draft.body === ${JSON.stringify(editedText)})`,
    30_000
  );

  if (!(await evaluate(cdp, "window.__kf.clickButton('批准发布')"))) {
    throw new Error(`${slug}: could not approve edited shadow draft`);
  }
  await waitFor(
    cdp,
    "approved shadow draft",
    `(() => { const state = window.__kf.state(); return state?.shadowDrafts?.length === 0 && state?.approvedShadowPosts?.some((post) => post.body === ${JSON.stringify(editedText)}); })()`,
    30_000
  );
  await evaluate(cdp, "window.__kf.expandProvenance()");
  await assertLayout(cdp, slug, "settings-approved", true);
  await screenshot(cdp, `${slug}-06b-settings-approved.png`);
  const approved = await evaluate(cdp, "window.__kf.metrics()");

  if (!(await evaluate(cdp, "window.__kf.clickNav('社区')"))) {
    throw new Error(`${slug}: could not open community for reject flow`);
  }
  await waitFor(cdp, "community feed for reject flow", "document.body.innerText.includes('今日任务')", 60_000);
  if (!(await evaluate(cdp, "window.__kf.clickButton('直接开始')"))) {
    throw new Error(`${slug}: could not open daily lesson for reject flow`);
  }
  await waitFor(
    cdp,
    "lesson screen for shadow reject flow",
    "document.body.innerText.includes('快速判断') && !!document.querySelector('.lesson-screen textarea')",
    90_000
  );
  await installHelpers(cdp);
  await evaluate(cdp, `window.__kf.fillSelector('.lesson-screen textarea', ${JSON.stringify(rejectionText)})`);
  if (!(await evaluate(cdp, "window.__kf.clickButton('完成并回评论区')"))) {
    throw new Error(`${slug}: could not complete lesson for reject flow`);
  }
  await waitFor(
    cdp,
    "returned after reject-flow lesson",
    "document.querySelectorAll('.comment-item').length >= 3",
    90_000
  );
  await installHelpers(cdp);
  if (!(await evaluate(cdp, "window.__kf.clickNav('设置')"))) {
    throw new Error(`${slug}: could not reopen settings for reject flow`);
  }
  await waitFor(
    cdp,
    "new shadow draft for rejection",
    "window.__kf.metrics().shadowDrafts >= 1 && document.body.innerText.includes('拒绝草稿')",
    90_000
  );
  if (!(await evaluate(cdp, "window.__kf.clickButton('拒绝草稿')"))) {
    throw new Error(`${slug}: could not reject shadow draft`);
  }
  await waitFor(
    cdp,
    "rejected shadow draft",
    "(() => { const metrics = window.__kf.metrics(); return metrics.shadowDrafts === 0 && metrics.approvedShadowPosts >= 1 && document.body.innerText.includes('没有待发布草稿'); })()",
    30_000
  );
  await evaluate(cdp, "window.__kf.expandProvenance()");
  await assertLayout(cdp, slug, "settings-rejected", true);
  await screenshot(cdp, `${slug}-06c-settings-rejected.png`);
  const rejected = await evaluate(cdp, "window.__kf.metrics()");

  return {
    editedText,
    before,
    approved,
    rejected
  };
}

async function assertDailyMissionEntry(cdp, slug) {
  if (!(await evaluate(cdp, "window.__kf.clickNav('社区')"))) {
    throw new Error(`${slug}: could not navigate to feed for daily mission`);
  }
  await waitFor(cdp, "feed after reload", "document.body.innerText.includes('今日任务')", 60_000);
  if (!(await evaluate(cdp, "window.__kf.clickButton('直接开始')"))) {
    throw new Error(`${slug}: could not start daily mission`);
  }
  await waitFor(
    cdp,
    "daily mission lesson",
    "document.body.innerText.includes('快速判断') && !!document.querySelector('.lesson-screen textarea')",
    90_000
  );
  await installHelpers(cdp);
  await evaluate(cdp, "window.__kf.expandProvenance()");
  const state = await evaluate(cdp, "window.__kf.state()");
  const dailyConcept =
    state.curriculum.concepts.find((concept) => (state.progress.conceptMastery[concept.id] ?? 0) < 70) ??
    state.curriculum.concepts[0];
  const expectedLesson = state.curriculum.lessons.find((lesson) => lesson.conceptId === dailyConcept.id);
  const integrity = await evaluate(
    cdp,
    `window.__kf.lessonIntegrity(${JSON.stringify(dailyConcept.id)}, ${JSON.stringify(expectedLesson?.id)})`
  );
  await assertLayout(cdp, slug, "daily-lesson");
  await screenshot(cdp, `${slug}-08-daily-lesson.png`);
  return { selectedConcept: dailyConcept.title, selectedLessonId: expectedLesson?.id, integrity };
}

async function assertMapLessonIntegrity(cdp, slug) {
  if (!(await evaluate(cdp, "window.__kf.clickNav('学习地图')"))) {
    throw new Error(`${slug}: could not navigate to map`);
  }
  await waitFor(cdp, "knowledge map", "document.querySelectorAll('.path-node').length >= 7", 60_000);
  await installHelpers(cdp);
  await evaluate(cdp, "window.__kf.expandProvenance()");
  await assertLayout(cdp, slug, "map", true);
  await screenshot(cdp, `${slug}-09-map.png`);
  const selected = await evaluate(cdp, "window.__kf.clickFirstMapLesson()");
  if (!selected) throw new Error(`${slug}: no unlocked map lesson could be opened`);
  await waitFor(
    cdp,
    "map lesson screen",
    "document.body.innerText.includes('快速判断') && !!document.querySelector('.lesson-screen textarea')",
    90_000
  );
  await installHelpers(cdp);
  await evaluate(cdp, "window.__kf.expandProvenance()");
  const integrity = await evaluate(
    cdp,
    `window.__kf.lessonIntegrity(${JSON.stringify(selected.conceptId)}, ${JSON.stringify(selected.lessonId)})`
  );
  await assertLayout(cdp, slug, "map-lesson");
  await screenshot(cdp, `${slug}-10-map-lesson.png`);
  return { selected, integrity };
}

async function assertLayout(cdp, slug, stage, scrollToBottom = false) {
  const audit = await evaluate(cdp, `window.__kf.layoutAudit(${JSON.stringify(stage)}, ${scrollToBottom})`);
  if (!audit.ok) {
    throw new Error(`${slug}: layout audit failed at ${stage}: ${JSON.stringify(audit)}`);
  }
  return audit;
}

async function assertCommentFilters(cdp, slug) {
  const filters = await evaluate(cdp, "window.__kf.commentFilters()");
  const expected = ["全部", "赞成", "反对", "补充", "挑刺"];
  for (const item of expected) {
    if (!filters.includes(item)) throw new Error(`${slug}: missing comment filter ${item}`);
  }

  for (const stance of expected.filter((item) => item !== "全部")) {
    if (!(await evaluate(cdp, `window.__kf.clickCommentFilter(${JSON.stringify(stance)})`))) {
      throw new Error(`${slug}: could not click comment filter ${stance}`);
    }
    await waitFor(
      cdp,
      `${stance} comments`,
      `document.querySelectorAll('.comment-item').length >= 1 && [...document.querySelectorAll('.comment-item .comment-meta')].every((el) => el.innerText.trim().startsWith(${JSON.stringify(stance)}))`,
      10_000
    );
  }
}

async function assertCommentSortModes(cdp, slug) {
  const sortModes = await evaluate(cdp, "window.__kf.commentSortModes()");
  const expected = ["热度", "新回复", "相关"];
  for (const item of expected) {
    if (!sortModes.includes(item)) throw new Error(`${slug}: missing comment sort mode ${item}`);
  }

  for (const mode of expected) {
    if (!(await evaluate(cdp, `window.__kf.clickCommentSort(${JSON.stringify(mode)})`))) {
      throw new Error(`${slug}: could not click comment sort mode ${mode}`);
    }
    await waitFor(
      cdp,
      `${mode} comment sort`,
      `document.querySelectorAll('.comment-item').length >= 3 && document.querySelector('.comment-sort button.active')?.innerText.trim() === ${JSON.stringify(mode)}`,
      10_000
    );
  }
}

async function assertReachable(url) {
  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`${response.status}`);
  } catch (error) {
    throw new Error(`Cannot reach ${url}. Start npm run dev before running this script. ${error}`);
  }
}

async function waitForChrome() {
  const versionUrl = `http://127.0.0.1:${chromePort}/json/version`;
  const started = Date.now();
  while (Date.now() - started < 60_000) {
    if (chromeExit) {
      throw new Error(`Chrome exited before opening ${versionUrl}: ${JSON.stringify(chromeExit)}\n${chromeStderr}`);
    }
    try {
      const response = await fetch(versionUrl);
      if (response.ok) return;
    } catch {
      // Keep waiting for Chrome to open the debugging port.
    }
    await delay(250);
  }
  throw new Error(`Chrome did not open ${versionUrl}\n${chromeStderr}`);
}

async function createTab(url) {
  const encoded = encodeURIComponent(url);
  let response = await fetch(`http://127.0.0.1:${chromePort}/json/new?${encoded}`, { method: "PUT" });
  if (!response.ok) response = await fetch(`http://127.0.0.1:${chromePort}/json/new`);
  if (!response.ok) throw new Error(`Could not create Chrome target: ${response.status}`);
  return response.json();
}

async function evaluate(cdp, expression) {
  const result = await cdp.send("Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true
  });
  if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails, null, 2));
  return result.result.value;
}

async function waitFor(cdp, label, predicate, timeoutMs) {
  const started = Date.now();
  let lastValue;
  while (Date.now() - started < timeoutMs) {
    lastValue = await evaluate(
      cdp,
      `(() => { try { return Boolean(${predicate}); } catch (error) { return String(error); } })()`
    );
    if (lastValue === true) return;
    await delay(750);
  }
  const text = await evaluate(cdp, "document.body?.innerText?.slice(0, 3000) ?? ''").catch(String);
  throw new Error(`Timed out waiting for ${label}; last=${JSON.stringify(lastValue)}; text=${text}`);
}

async function waitForResearchLlmFeed(cdp, label) {
  const started = Date.now();
  let lastStatus = null;
  while (Date.now() - started < 360_000) {
    lastStatus = await evaluate(
      cdp,
      `(() => {
        const text = document.body?.innerText ?? "";
        const sourceStrip = document.querySelector('.generation-strip')?.innerText?.replace(/\\s+/g, ' ').trim() ?? "";
        return {
          ready: (
            text.includes(${JSON.stringify(researchLlmLabel)}) ||
            (${allowLlmOnly ? "true" : "false"} && text.includes(${JSON.stringify(llmOnlyLabel)}))
          ) && text.includes('学习路径'),
          fellBack: sourceStrip.includes('离线演示内容') || text.includes('离线演示内容'),
          sourceStrip,
          text: text.slice(0, 1200)
        };
      })()`
    );
    if (lastStatus.ready) return;
    if (lastStatus.fellBack) {
      throw new Error(
        `Generated feed fell back before Research brief + LLM; source=${JSON.stringify(lastStatus.sourceStrip)}; text=${lastStatus.text}`
      );
    }
    await delay(750);
  }
  throw new Error(`Timed out waiting for ${label}; last=${JSON.stringify(lastStatus)}`);
}

function isAcceptedLlmSource(sourceStrip) {
  if (sourceStrip === researchLlmLabel) return true;
  return allowLlmOnly && sourceStrip === llmOnlyLabel;
}

async function installHelpers(cdp) {
  await evaluate(
    cdp,
    `(() => {
      const norm = (value) => (value || '').replace(/\\s+/g, ' ').trim();
      const setValue = (el, value) => {
        const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
        Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, value);
        el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: value }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
      };
      window.__kf = {
        clickButton(text) {
          const target = [...document.querySelectorAll('button')].find((el) => norm(el.innerText).includes(text) || norm(el.getAttribute('aria-label')).includes(text));
          if (!target) return false;
          target.scrollIntoView({ block: 'center' });
          target.click();
          return true;
        },
        clickNav(text) {
          const target = [...document.querySelectorAll('.bottom-nav button')].find((el) => norm(el.innerText).includes(text) || norm(el.getAttribute('aria-label')).includes(text));
          if (!target) return false;
          target.scrollIntoView({ block: 'center' });
          target.click();
          return true;
        },
        clickSelector(selector) {
          const target = document.querySelector(selector);
          if (!target) return false;
          target.scrollIntoView({ block: 'center' });
          target.click();
          return true;
        },
        clickCommentFilter(text) {
          const target = [...document.querySelectorAll('.comment-tabs button')].find((el) => norm(el.innerText).startsWith(text));
          if (!target) return false;
          target.scrollIntoView({ block: 'center' });
          target.click();
          return true;
        },
        commentFilters() {
          return [...document.querySelectorAll('.comment-tabs button')].map((el) => norm(el.innerText).split(' ')[0]);
        },
        clickCommentSort(text) {
          const target = [...document.querySelectorAll('.comment-sort button')].find((el) => norm(el.innerText) === text);
          if (!target) return false;
          target.scrollIntoView({ block: 'center' });
          target.click();
          return true;
        },
        commentSortModes() {
          return [...document.querySelectorAll('.comment-sort button')].map((el) => norm(el.innerText));
        },
        fillLabel(labelText, value) {
          const label = [...document.querySelectorAll('label')].find((el) => norm(el.innerText).includes(labelText));
          const target = label?.querySelector('input, textarea');
          if (!target) return false;
          target.focus();
          setValue(target, value);
          return true;
        },
        fillSelector(selector, value) {
          const target = document.querySelector(selector);
          if (!target) return false;
          target.focus();
          setValue(target, value);
          return true;
        },
        expandProvenance() {
          document.querySelectorAll('.source-disclosure').forEach((details) => {
            details.open = true;
          });
          return document.querySelectorAll('.source-disclosure[open]').length;
        },
        state() {
          const raw = localStorage.getItem('knowfeed.prototype.state.v1');
          return raw ? JSON.parse(raw) : null;
        },
        metrics() {
          const state = this.state();
          const body = norm(document.body.innerText);
          const rawBundleCache = localStorage.getItem('knowfeed.prototype.generated-bundles.v1');
          const bundleCache = rawBundleCache ? JSON.parse(rawBundleCache) : {};
          const generatedBundles = Object.values(bundleCache)
            .filter((bundle) => bundle && Array.isArray(bundle.comments))
            .sort((left, right) => Date.parse(right.generatedAt || '') - Date.parse(left.generatedAt || ''));
          const latestGeneratedBundle = generatedBundles[0] || null;
          const generatedConcept = state?.curriculum?.concepts?.find((concept) => concept.id === latestGeneratedBundle?.conceptId) || null;
          return {
            sourceStrip: norm(document.querySelector('.generation-strip')?.innerText),
            sourceProvenance: [...document.querySelectorAll('.source-provenance')].map((el) => norm(el.innerText)),
            visibleResearchAnchors: [...document.querySelectorAll('.research-anchor-list')].map((el) => norm(el.innerText)),
            visibleResearchSources: [...document.querySelectorAll('.research-source-list')].map((el) => norm(el.innerText)),
            body: body.slice(0, 3200),
            topic: state?.curriculum?.topic?.title,
            learnerBackground: state?.curriculum?.learner?.background,
            learnerAvoidedStyles: state?.curriculum?.learner?.avoidedStyles ?? [],
            researchSource: state?.curriculum?.researchBrief?.source,
            researchKeyIdeas: state?.curriculum?.researchBrief?.keyIdeas ?? [],
            researchDisputedIdeas: state?.curriculum?.researchBrief?.disputedIdeas ?? [],
            researchBeginnerPitfalls: state?.curriculum?.researchBrief?.beginnerPitfalls ?? [],
            researchSourceTitles: state?.curriculum?.researchBrief?.sources?.map((source) => norm(source.title)) ?? [],
            researchSourceSummaries: state?.curriculum?.researchBrief?.sources?.map((source) => norm(source.summary)) ?? [],
            curriculumSource: state?.curriculum?.source,
            conceptCount: state?.curriculum?.concepts?.length ?? 0,
            lessonCount: state?.curriculum?.lessons?.length ?? 0,
            completedLessons: state?.progress?.completedLessonIds?.length ?? 0,
            xp: state?.progress?.xp ?? 0,
            shadowDrafts: state?.shadowDrafts?.length ?? 0,
            approvedShadowPosts: state?.approvedShadowPosts?.length ?? 0,
            commentSortModes: this.commentSortModes(),
            activeCommentSortMode: norm(document.querySelector('.comment-sort button.active')?.innerText),
            commentCount: document.querySelectorAll('.comment-item').length,
            replyCount: document.querySelectorAll('.comment-reply').length,
            commentStances: [...document.querySelectorAll('.comment-item .comment-meta')].map((el) => norm(el.innerText)),
            comments: [...document.querySelectorAll('.comment-item')].map((item) => ({
              authorName: norm(item.querySelector('header strong')?.innerText),
              stance: norm(item.querySelector('.comment-meta')?.innerText).split(' · ')[0],
              role: norm(item.querySelector('.comment-agent-role')?.innerText),
              body: norm(item.querySelector(':scope > div > p')?.innerText),
              replies: [...item.querySelectorAll('.comment-reply')].map((reply) => ({
                authorName: norm(reply.querySelector('header strong')?.innerText),
                relation: norm(reply.querySelector('.reply-relation')?.innerText).split(' · ')[0],
                role: norm(reply.querySelector('.comment-agent-role')?.innerText),
                quote: norm(reply.querySelector('blockquote')?.innerText),
                body: norm(reply.querySelector('p')?.innerText)
              }))
            })),
            generatedComments: latestGeneratedBundle?.comments?.map((comment) => ({
              authorName: norm(comment.author?.displayName),
              handle: norm(comment.author?.handle),
              role: norm(comment.author?.role),
              stance: norm(comment.stance),
              body: norm(comment.body),
              replies: Array.isArray(comment.replies)
                ? comment.replies.map((reply) => ({
                    id: norm(reply.id),
                    authorName: norm(reply.author?.displayName),
                    handle: norm(reply.author?.handle),
                    role: norm(reply.author?.role),
                    relation: norm(reply.relation),
                    source: norm(reply.source),
                    quote: norm(reply.quote),
                    body: norm(reply.body)
                  }))
                : []
            })) ?? [],
            generatedPostAuthor: latestGeneratedBundle?.post?.author
              ? {
                  authorName: norm(latestGeneratedBundle.post.author.displayName),
                  handle: norm(latestGeneratedBundle.post.author.handle),
                  role: norm(latestGeneratedBundle.post.author.role)
                }
              : null,
            generatedLessonText: latestGeneratedBundle?.lesson
              ? norm(
                  [
                    latestGeneratedBundle.lesson.title,
                    latestGeneratedBundle.lesson.hook,
                    latestGeneratedBundle.lesson.explanation,
                    latestGeneratedBundle.lesson.analogy,
                    latestGeneratedBundle.lesson.recallPrompt,
                    latestGeneratedBundle.lesson.completionFeedback
                  ].join(' ')
                ).slice(0, 1200)
              : '',
            generatedPostBody: norm(latestGeneratedBundle?.post?.body).slice(0, 800),
            generatedShadowBody: norm(latestGeneratedBundle?.shadowDraft?.body).slice(0, 800),
            generatedConceptTitle: norm(generatedConcept?.title),
            generatedConceptPlainName: norm(generatedConcept?.plainName),
            lessonTitle: norm(document.querySelector('.lesson-screen h2')?.innerText),
            postBody: norm(document.querySelector('.post-body')?.innerText).slice(0, 800),
            shadowPendingBody: norm(document.querySelector('.draft-editor textarea')?.value).slice(0, 800),
            shadowApprovedBodies: [...document.querySelectorAll('.approved-draft p')].map((el) => norm(el.innerText).slice(0, 800)),
            shadowControlLabels: [...document.querySelectorAll('.settings-screen button')].map((el) => norm(el.innerText)),
            shadowHasBasis: body.includes('依据的学习记录'),
            shadowBody: (
              norm(document.querySelector('.draft-editor textarea')?.value) ||
              norm(document.querySelector('.approved-draft p')?.innerText) ||
              norm(document.querySelector('.draft-preview')?.innerText)
            ).slice(0, 800)
          };
        },
        lessonIntegrity(expectedConceptId, expectedLessonId) {
          const state = this.state();
          const lesson = state?.curriculum?.lessons?.find((item) => item.id === expectedLessonId);
          const concept = state?.curriculum?.concepts?.find((item) => item.id === expectedConceptId);
          const choiceLabels = [...document.querySelectorAll('.choice span')].map((el) => norm(el.innerText));
          const lessonMatchesConcept = Boolean(lesson && concept && lesson.conceptId === concept.id);
          const choiceLabelsMatch = Boolean(
            lesson?.choices?.length &&
              lesson.choices.every((choice) => choiceLabels.some((label) => label.includes(norm(choice.label).slice(0, 24))))
          );
          return {
            expectedConceptId,
            expectedLessonId,
            conceptTitle: concept?.title,
            lessonMatchesConcept,
            choiceLabelsMatch,
            choiceLabels
          };
        },
        clickFirstMapLesson() {
          const state = this.state();
          const nodes = [...document.querySelectorAll('.path-node')];
          for (let index = 0; index < nodes.length; index += 1) {
            const button = nodes[index].querySelector('button');
            if (!button || button.disabled) continue;
            const concept = state?.curriculum?.concepts?.[index];
            const lesson = state?.curriculum?.lessons?.find((item) => item.conceptId === concept?.id);
            button.scrollIntoView({ block: 'center' });
            button.click();
            return {
              conceptId: concept?.id,
              conceptTitle: concept?.title,
              lessonId: lesson?.id,
              order: concept?.order
            };
          }
          return null;
        },
        layoutAudit(stage, scrollToBottom) {
          const body = document.querySelector('.screen-body');
          const nav = document.querySelector('.bottom-nav');
          const frame = document.querySelector('.phone-frame');
          if (!body || !nav || !frame) return { ok: false, stage, reason: 'missing-shell-elements' };
          if (scrollToBottom) body.scrollTop = body.scrollHeight;
          const bodyRect = body.getBoundingClientRect();
          const navRect = nav.getBoundingClientRect();
          const frameRect = frame.getBoundingClientRect();
          const visible = (el) => {
            const rect = el.getBoundingClientRect();
            const style = window.getComputedStyle(el);
            return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
          };
          const overflow = [...frame.querySelectorAll('button, input, textarea, .source-provenance, .research-anchor-list, .research-source-list, .social-post, .comment-item, .draft-card, .map-next-card, .path-node')]
            .filter(visible)
            .filter((el) => {
              const rect = el.getBoundingClientRect();
              return rect.left < frameRect.left - 1 || rect.right > frameRect.right + 1;
            })
            .slice(0, 5)
            .map((el) => ({ tag: el.tagName, className: el.className, text: norm(el.innerText).slice(0, 60) }));
          const screen = body.querySelector(':scope > section');
          const screenChildren = screen ? [...screen.children].filter(visible) : [];
          const lastChild = screenChildren.at(-1);
          const lastRect = lastChild?.getBoundingClientRect();
          const bottomGap = lastRect ? Math.round(navRect.top - lastRect.bottom) : null;
          const buttonTextOverflow = [...frame.querySelectorAll('button')]
            .filter(visible)
            .filter((el) => el.scrollWidth > el.clientWidth + 2)
            .slice(0, 5)
            .map((el) => norm(el.innerText).slice(0, 60));
          const navOverlapsBody = bodyRect.bottom > navRect.top + 1;
          const bottomContentHidden = scrollToBottom && lastRect ? lastRect.bottom > navRect.top - 8 : false;
          return {
            ok: !navOverlapsBody && !bottomContentHidden && overflow.length === 0 && buttonTextOverflow.length === 0,
            stage,
            navOverlapsBody,
            bottomContentHidden,
            bottomGap,
            overflow,
            buttonTextOverflow
          };
        }
      };
      return true;
    })()`
  );
}

async function screenshot(cdp, filename) {
  const result = await cdp.send("Page.captureScreenshot", {
    format: "png",
    captureBeyondViewport: true
  });
  await writeFile(join(outputDir, filename), Buffer.from(result.data, "base64"));
}

async function writeJson(filename, value) {
  await writeFile(join(outputDir, filename), `${JSON.stringify(value, null, 2)}\n`);
}

async function writeSummary(status, error) {
  const matrix = buildMatrixSummary(results);
  const summary = {
    status,
    appUrl,
    outputDir,
    startedAt,
    generatedAt: new Date().toISOString(),
    run: readRunEvidence(),
    checkout: checkoutEvidence,
    selection: {
      scenarios: scenarios.map((scenario) => scenario.slug),
      viewports: viewports.map((viewport) => viewport.slug)
    },
    chrome: {
      path: chromePath,
      port: chromePort,
      managedByScript: !externalChrome,
      headed: externalChrome || headedChrome,
      keepTabs,
      exit: chromeExit ?? null,
      stderrTail: chromeStderr.slice(-4000)
    },
    failure: error ? serializeError(error) : null,
    matrix,
    matrixGate: buildMatrixGateSummary(matrix),
    retryEvents,
    scenarios: results
  };
  summary.evidenceGate = buildEvidenceGateSummary(summary);

  await writeJson("summary.json", summary);
  return summary;
}

function readCheckoutEvidence() {
  const gitSha = readCommand(["git", "rev-parse", "HEAD"]);
  const gitBranch = readCommand(["git", "branch", "--show-current"]);
  const gitStatus = readCommand(["git", "status", "--short"]);
  const packageJson = readPackageJson();
  return {
    cwd: process.cwd(),
    gitSha: gitSha || "unknown",
    gitBranch: gitBranch || "unknown",
    gitDirty: Boolean(gitStatus),
    gitStatusShort: gitStatus,
    packageName: packageJson.name ?? "unknown",
    packageVersion: packageJson.version ?? "unknown",
    buildId: process.env.KNOWFEED_BUILD_ID ?? gitSha ?? "unknown"
  };
}

function readRunEvidence() {
  return {
    command: process.argv.join(" "),
    npmLifecycleEvent: process.env.npm_lifecycle_event ?? null,
    npmLifecycleScript: process.env.npm_lifecycle_script ?? null,
    nodeVersion: process.version,
    npmVersion: readCommand(["npm", "-v"]) || "unknown",
    platform: process.platform,
    arch: process.arch,
    env: readRelevantEnv()
  };
}

function readRelevantEnv() {
  const relevantNames = Object.keys(process.env)
    .filter(
      (name) =>
        name.startsWith("KNOWFEED_E2E_") ||
        ["CHROME_PATH", "LLM_BASE_URL", "LLM_MODEL", "LLM_PROXY_PORT"].includes(name)
    )
    .sort();
  return Object.fromEntries(relevantNames.map((name) => [name, redactEnvValue(name, process.env[name] ?? "")]));
}

function redactEnvValue(name, value) {
  if (/KEY|TOKEN|SECRET|PASSWORD|AUTH/i.test(name)) return value ? "[redacted]" : "";
  return value;
}

function readCommand(command) {
  try {
    return execFileSync(command[0], command.slice(1), { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return "";
  }
}

function readPackageJson() {
  try {
    return JSON.parse(readFileSync("package.json", "utf8"));
  } catch {
    return {};
  }
}

function buildEvidenceGateSummary(summary) {
  const issues = [];
  const expectedRuns = summary.selection.scenarios.length * summary.selection.viewports.length;
  if (!summary.checkout.gitSha || summary.checkout.gitSha === "unknown") issues.push("missing git SHA");
  if (summary.checkout.gitDirty) {
    issues.push("checkout has uncommitted changes; release evidence must come from a clean checkout");
  }
  if (!summary.checkout.packageVersion || summary.checkout.packageVersion === "unknown") issues.push("missing package version");
  if (!summary.run?.command) issues.push("missing exact command metadata");
  if (!summary.run?.nodeVersion) issues.push("missing Node version metadata");
  if (!summary.run?.npmVersion || summary.run.npmVersion === "unknown") issues.push("missing npm version metadata");
  if (!/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?\b/.test(summary.appUrl)) {
    issues.push(`appUrl is not an explicit local target: ${summary.appUrl}`);
  }
  if (summary.status !== "passed") {
    issues.push(`summary status is ${summary.status}, not passed`);
  }
  if (summary.failure) issues.push("summary contains failure");
  if (summary.matrix.passedRuns !== expectedRuns) {
    issues.push(`passedRuns ${summary.matrix.passedRuns}/${expectedRuns}`);
  }
  if (summary.scenarios.some((scenario) => scenario.status !== "passed")) {
    issues.push("summary contains failed scenario");
  }
  if (summary.matrixGate.enabled && !summary.matrixGate.passed) {
    issues.push(`matrixGate failed: ${summary.matrixGate.issues.join("; ")}`);
  }
  if (summary.matrixGate.enabled && allowLlmOnly) {
    issues.push("release matrix must not use KNOWFEED_E2E_ALLOW_LLM_ONLY=1");
  }
  const llmFallbackRetries = (summary.retryEvents ?? []).filter((event) =>
    /Generated feed fell back before Research brief \+ LLM/.test(String(event.message ?? ""))
  );
  if (summary.matrixGate.enabled && llmFallbackRetries.length > 0) {
    issues.push(`release matrix had ${llmFallbackRetries.length} initial LLM fallback retry event(s)`);
  }
  for (const scenario of summary.scenarios) {
    if (scenario.status !== "passed") continue;
    if (!isAcceptedLlmSource(scenario.feed?.sourceStrip)) {
      issues.push(`${scenario.runSlug}: feed source is not accepted LLM content`);
    }
    if (!isAcceptedSourceChain(scenario.feed)) {
      issues.push(
        `${scenario.runSlug}: feed source chain is ${scenario.feed?.researchSource ?? "missing"}/${scenario.feed?.curriculumSource ?? "missing"}`
      );
    }
    if (!isAcceptedSourceChain(scenario.reloaded)) {
      issues.push(
        `${scenario.runSlug}: reloaded source chain is ${scenario.reloaded?.researchSource ?? "missing"}/${scenario.reloaded?.curriculumSource ?? "missing"}`
      );
    }
    if (!scenario.communityQuality?.passed) {
      issues.push(`${scenario.runSlug}: community quality did not pass`);
    }
    const generatedContentPhases = scenario.communityQuality?.signals?.generatedContentQuality?.phases ?? [];
    if (
      generatedContentPhases.length < 3 ||
      generatedContentPhases.some(
        (phase) =>
          !phase.hasAnchor ||
          !phase.hasLearningSignal ||
          !phase.hasConcreteLearnerAction ||
          !phase.hasResearchAnchor ||
          phase.avoidsRejectedStyles === false ||
          phase.hasNoUnsupportedPreciseClaims === false
      )
    ) {
      issues.push(
        `${scenario.runSlug}: generated lesson/post/shadow grounding, concrete learner-action, avoided-style, or unsupported-precision compliance is incomplete`
      );
    }
  }
  return {
    passed: issues.length === 0,
    issues
  };
}

function isAcceptedSourceChain(metrics) {
  const acceptedCurriculumSource =
    metrics?.curriculumSource === "planner" || (allowLlmOnly && metrics?.curriculumSource === "deterministic-fallback");
  if (!acceptedCurriculumSource) return false;
  return metrics?.researchSource === "web" || (allowLlmOnly && metrics?.researchSource === "fallback");
}

function buildMatrixSummary(items) {
  const communityReports = items
    .map((item) => item.communityQuality)
    .filter((report) => report && typeof report.score === "number");
  const scores = communityReports.map((report) => report.score);
  const totalScore = scores.reduce((sum, score) => sum + score, 0);
  const worstCommunity =
    items
      .filter((item) => item.communityQuality)
      .sort((left, right) => left.communityQuality.score - right.communityQuality.score)[0] ?? null;

  return {
    totalRuns: items.length,
    passedRuns: items.filter((item) => item.status === "passed").length,
    failedRuns: items.filter((item) => item.status === "failed").length,
    subjectAreas: [...new Set(items.map((item) => item.subjectArea).filter(Boolean))].sort(),
    learnerPersonas: [...new Set(items.map((item) => item.learnerPersona).filter(Boolean))].sort(),
    viewports: [...new Set(items.map((item) => item.viewport).filter(Boolean))].sort(),
    communityQuality:
      scores.length > 0
        ? {
            averageScore: Math.round((totalScore / scores.length) * 10) / 10,
            minScore: Math.min(...scores),
            maxScore: Math.max(...scores),
            reports: scores.length,
            worst:
              worstCommunity && worstCommunity.communityQuality
                ? {
                    runSlug: worstCommunity.runSlug,
                    score: worstCommunity.communityQuality.score,
                    issues: worstCommunity.communityQuality.issues
                  }
                : null
          }
        : null
  };
}

function assertMatrixBreadth(items) {
  const gate = buildMatrixGateSummary(buildMatrixSummary(items));
  if (!gate.enabled || gate.passed) return;
  const error = new Error(`Real LLM E2E matrix breadth failed: ${gate.issues.join("; ")}`);
  error.details = { matrixGate: gate };
  throw error;
}

function buildMatrixGateSummary(matrix) {
  const issues = [];
  if (matrixBreadthRequirements.enabled) {
    if (matrix.passedRuns < matrixBreadthRequirements.minPassedRuns) {
      issues.push(`passedRuns ${matrix.passedRuns}/${matrixBreadthRequirements.minPassedRuns}`);
    }
    if (matrix.subjectAreas.length < matrixBreadthRequirements.minSubjectAreas) {
      issues.push(`subjectAreas ${matrix.subjectAreas.length}/${matrixBreadthRequirements.minSubjectAreas}`);
    }
    if (matrix.learnerPersonas.length < matrixBreadthRequirements.minLearnerPersonas) {
      issues.push(`learnerPersonas ${matrix.learnerPersonas.length}/${matrixBreadthRequirements.minLearnerPersonas}`);
    }
    if (matrix.viewports.length < matrixBreadthRequirements.minViewports) {
      issues.push(`viewports ${matrix.viewports.length}/${matrixBreadthRequirements.minViewports}`);
    }
  }

  return {
    enabled: matrixBreadthRequirements.enabled,
    passed: issues.length === 0,
    requirements: matrixBreadthRequirements,
    observed: {
      passedRuns: matrix.passedRuns,
      subjectAreas: matrix.subjectAreas,
      learnerPersonas: matrix.learnerPersonas,
      viewports: matrix.viewports
    },
    issues
  };
}

function readPositiveIntegerEnv(name, fallback) {
  const raw = process.env[name];
  if (!raw) return fallback;
  const value = Number(raw);
  if (Number.isInteger(value) && value > 0) return value;
  throw new Error(`${name} must be a positive integer, got ${raw}`);
}

function serializeError(error) {
  if (!error) return null;
  return {
    name: error.name,
    message: error.message,
    stack: error.stack,
    details: error.details ?? null
  };
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function stopChrome() {
  if (!chrome) return;
  if (chromeExit || chrome.killed) return;
  chrome.kill("SIGTERM");
  await Promise.race([
    new Promise((resolve) => chrome.once("exit", resolve)),
    delay(5_000)
  ]);
  if (chromeExit || chrome.killed) return;
  chrome.kill("SIGKILL");
  await Promise.race([
    new Promise((resolve) => chrome.once("exit", resolve)),
    delay(1_000)
  ]);
}
