import http from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { spawn } from "node:child_process";
import { pathToFileURL } from "node:url";

function loadLocalEnv() {
  for (const file of [".env.local", ".env"]) {
    const path = resolve(process.cwd(), file);
    if (!existsSync(path)) continue;

    for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue;
      const [rawKey, ...rawValue] = trimmed.split("=");
      const key = rawKey.trim();
      const value = rawValue.join("=").trim().replace(/^['"]|['"]$/g, "");
      if (key && process.env[key] === undefined) process.env[key] = value;
    }
  }
}

loadLocalEnv();

function startColearningService() {
  if (colearningProcess) return;
  const backendPath = resolve(process.cwd());
  const servicePath = resolve(process.cwd(), "server/colearning/main.py");
  if (!existsSync(servicePath)) {
    console.warn("Co-learning service not found, /api/colearning routes will be unavailable");
    return;
  }
  const env = {
    ...process.env,
    COLEARNING_DB_PATH: resolve(process.cwd(), "server/colearning/colearning.db"),
    LLM_BASE_URL: `http://127.0.0.1:${port}`,
  };
  colearningProcess = spawn("uv", ["run", "uvicorn", "main:app", "--port", String(colearningPort)], {
    cwd: resolve(process.cwd(), "server/colearning"),
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  colearningProcess.stdout.on("data", (chunk) => {
    console.log(`[colearning] ${chunk}`.trimEnd());
  });
  colearningProcess.stderr.on("data", (chunk) => {
    console.error(`[colearning] ${chunk}`.trimEnd());
  });
  colearningProcess.on("close", (code) => {
    console.warn(`Co-learning service exited with code ${code}`);
    colearningProcess = null;
  });
}

const port = Number(process.env.LLM_PROXY_PORT ?? 8787);
const colearningPort = Number(process.env.COLEARNING_PORT ?? 8788);
let colearningProcess = null;
const baseUrl = process.env.LLM_BASE_URL ?? "https://api.openai.com/v1";
const apiKey = process.env.LLM_API_KEY;
const model = process.env.LLM_MODEL ?? "gpt-4.1-mini";
const responseFormatMode = normalizeResponseFormatMode(process.env.LLM_RESPONSE_FORMAT);
const researchMode = normalizeResearchMode(process.env.LLM_RESEARCH_MODE);
const researchFetchTimeoutMs = readTimeoutMs("LLM_PROXY_RESEARCH_TIMEOUT_MS", 12_000);
const llmFetchTimeoutMs = readTimeoutMs("LLM_PROXY_GENERATE_TIMEOUT_MS", 55_000);
const allowedOrigins = readAllowedOrigins();
const devToken = process.env.LLM_PROXY_DEV_TOKEN;
const maxGenerateMessages = 16;
const maxGenerateContentLength = 120_000;

export class ProxyTimeoutError extends Error {
  constructor(label, timeoutMs) {
    super(`${label} timed out after ${timeoutMs}ms`);
    this.name = "ProxyTimeoutError";
    this.statusCode = 504;
  }
}

function readTimeoutMs(envKey, fallbackMs) {
  const raw = process.env[envKey] ?? process.env.LLM_PROXY_FETCH_TIMEOUT_MS;
  const parsed = Number(raw);
  if (Number.isFinite(parsed) && parsed > 0) return Math.floor(parsed);
  return fallbackMs;
}

export async function fetchWithTimeout(url, options = {}, { timeoutMs = 30_000, label = "upstream fetch" } = {}) {
  const resolvedTimeoutMs = Number.isFinite(Number(timeoutMs)) && Number(timeoutMs) > 0
    ? Math.floor(Number(timeoutMs))
    : 30_000;
  const controller = new AbortController();
  const timeoutError = new ProxyTimeoutError(label, resolvedTimeoutMs);
  const timeout = setTimeout(() => controller.abort(timeoutError), resolvedTimeoutMs);

  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } catch (error) {
    if (error === timeoutError || controller.signal.reason === timeoutError) throw timeoutError;
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function isProxyTimeoutError(error) {
  return error instanceof ProxyTimeoutError || error?.name === "ProxyTimeoutError" || error?.statusCode === 504;
}

function readAllowedOrigins() {
  const configured = (process.env.LLM_PROXY_ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  return configured.length ? configured : ["http://127.0.0.1:5173", "http://localhost:5173"];
}

export function isAllowedCorsOrigin(origin, allowed = allowedOrigins) {
  if (!origin) return true;
  if (allowed.includes(origin)) return true;
  try {
    const url = new URL(origin);
    return ["127.0.0.1", "localhost", "::1"].includes(url.hostname);
  } catch {
    return false;
  }
}

function corsHeadersFor(request) {
  const origin = request?.headers?.origin;
  if (!isAllowedCorsOrigin(origin)) return {};
  return origin
    ? {
        "access-control-allow-origin": origin,
        "access-control-allow-methods": "GET, POST, OPTIONS",
        "access-control-allow-headers": "content-type, x-knowfeed-dev-token",
        vary: "origin"
      }
    : {};
}

function sendJson(response, statusCode, payload, request) {
  response.writeHead(statusCode, {
    "content-type": "application/json",
    ...corsHeadersFor(request)
  });
  response.end(JSON.stringify(payload));
}

function rejectDisallowedOrigin(request, response) {
  if (isAllowedCorsOrigin(request.headers.origin)) return false;
  sendJson(response, 403, { error: "Origin is not allowed" }, request);
  return true;
}

function rejectMissingDevToken(request, response) {
  if (!devToken) return false;
  if (request.headers["x-knowfeed-dev-token"] === devToken) return false;
  sendJson(response, 401, { error: "Development token required" }, request);
  return true;
}

export function validateGenerateProxyRequestPayload(body) {
  if (!body || typeof body !== "object") return false;
  if (!Array.isArray(body.messages) || body.messages.length === 0 || body.messages.length > maxGenerateMessages) return false;
  if (
    body.temperature !== undefined &&
    (!Number.isFinite(Number(body.temperature)) || Number(body.temperature) < 0 || Number(body.temperature) > 2)
  ) {
    return false;
  }

  let totalContentLength = 0;
  for (const message of body.messages) {
    if (!message || typeof message !== "object") return false;
    if (!["system", "user"].includes(message.role)) return false;
    if (typeof message.content !== "string" || !message.content.trim()) return false;
    totalContentLength += message.content.length;
    if (totalContentLength > maxGenerateContentLength) return false;
  }
  return true;
}

export function normalizeResponseFormatMode(value) {
  const normalized = String(value ?? "json_object").trim().toLowerCase();
  if (["none", "off", "disabled", "false"].includes(normalized)) return "none";
  return "json_object";
}

export function normalizeResearchMode(value) {
  const normalized = String(value ?? "web").trim().toLowerCase();
  if (["off", "none", "disabled", "false", "local", "fallback"].includes(normalized)) return "off";
  return "web";
}

export function buildChatCompletionBody({ model, temperature, messages, responseFormatMode = "json_object" }) {
  const body = {
    model,
    temperature,
    messages
  };
  if (normalizeResponseFormatMode(responseFormatMode) === "json_object") {
    body.response_format = { type: "json_object" };
  }
  return body;
}

function readBody(request) {
  return new Promise((resolveBody, reject) => {
    let body = "";
    request.on("data", (chunk) => {
      body += chunk;
      if (body.length > 1_000_000) {
        request.destroy();
        reject(new Error("Request body too large"));
      }
    });
    request.on("end", () => resolveBody(body));
    request.on("error", reject);
  });
}

function stripHtml(value) {
  return value
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function decodeDuckUrl(value) {
  try {
    const url = new URL(value, "https://duckduckgo.com");
    const uddg = url.searchParams.get("uddg");
    return uddg ? decodeURIComponent(uddg) : url.href;
  } catch {
    return value;
  }
}

async function searchDuckDuckGo(query) {
  const response = await fetchWithTimeout(
    `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`,
    {
      headers: {
        "user-agent": "KnowFeed prototype research bot/0.1"
      }
    },
    { timeoutMs: researchFetchTimeoutMs, label: "DuckDuckGo research search" }
  );
  if (!response.ok) throw new Error(`DuckDuckGo returned ${response.status}`);
  const html = await response.text();
  const results = [];
  const regex = /<a rel="nofollow" class="result__a" href="([^"]+)">([\s\S]*?)<\/a>[\s\S]*?<a class="result__snippet"[\s\S]*?>([\s\S]*?)<\/a>/g;
  let match;
  while ((match = regex.exec(html)) && results.length < 3) {
    results.push({
      title: stripHtml(match[2]),
      url: decodeDuckUrl(match[1]),
      summary: stripHtml(match[3])
    });
  }
  return results;
}

async function searchWikipedia(query, language = "en") {
  const endpoint = `https://${language}.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(query)}&format=json&origin=*`;
  const response = await fetchWithTimeout(
    endpoint,
    {
      headers: {
        "user-agent": "KnowFeed prototype research bot/0.1"
      }
    },
    { timeoutMs: researchFetchTimeoutMs, label: `${language} Wikipedia research search` }
  );
  if (!response.ok) throw new Error(`Wikipedia returned ${response.status}`);
  const payload = await response.json();
  return (payload.query?.search ?? []).slice(0, 3).map((item) => ({
    title: stripHtml(item.title),
    url: `https://${language}.wikipedia.org/wiki/${encodeURIComponent(item.title.replace(/\s+/g, "_"))}`,
    summary: stripHtml(item.snippet || item.title)
  }));
}

async function fetchWikipediaSummary(title) {
  const response = await fetchWithTimeout(
    `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`,
    {
      headers: {
        "user-agent": "KnowFeed prototype research bot/0.1"
      }
    },
    { timeoutMs: researchFetchTimeoutMs, label: "Wikipedia summary lookup" }
  );
  if (!response.ok) throw new Error(`Wikipedia summary returned ${response.status}`);
  const payload = await response.json();
  return {
    title: stripHtml(payload.title ?? title),
    url: payload.content_urls?.desktop?.page ?? `https://en.wikipedia.org/wiki/${encodeURIComponent(title)}`,
    summary: stripHtml(payload.extract ?? payload.description ?? title)
  };
}

async function directSummarySources(topic) {
  const lower = topic.toLowerCase();
  const titles = lower.includes("fintech") || topic.includes("金融科技")
    ? ["Financial_technology", "Open_banking", "Regulatory_technology"]
    : topic.includes("心理")
      ? ["Psychology", "Cognitive_bias", "Emotional_self-regulation"]
      : lower.includes("ai") || topic.includes("人工智能") || topic.includes("大模型")
        ? ["Artificial_intelligence", "Large_language_model", "Explainable_artificial_intelligence"]
        : lower.includes("web3") || topic.includes("区块链")
          ? ["Web3", "Blockchain", "Decentralized_finance"]
          : [];

  const batches = await Promise.allSettled(titles.map((title) => fetchWikipediaSummary(title)));
  return batches.flatMap((batch) => (batch.status === "fulfilled" ? [batch.value] : []));
}

async function searchWebSources(query) {
  const duckResults = await searchDuckDuckGo(query).catch(() => []);
  if (duckResults.length) return duckResults;

  const wikiQuery = cleanWikipediaQuery(query);
  const zhResults = await searchWikipedia(wikiQuery, "zh").catch(() => []);
  const enResults = await searchWikipedia(wikiQuery, "en").catch(() => []);
  return [...zhResults, ...enResults].slice(0, 3);
}

function cleanWikipediaQuery(query) {
  return query
    .replace(/\bbeginner guide\b/gi, " ")
    .replace(/\bcontroversy beginner\b/gi, " ")
    .replace(/\bexplained\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizedResearchTerm(topic) {
  const lower = topic.toLowerCase();
  if (lower.includes("fintech") || topic.includes("金融科技")) return "Financial technology fintech";
  if (topic.includes("心理")) return "Psychology cognitive bias emotion regulation";
  if (lower.includes("ai") || topic.includes("人工智能") || topic.includes("大模型")) return "Artificial intelligence large language model";
  if (lower.includes("web3") || topic.includes("区块链")) return "Web3 blockchain cryptocurrency";
  return topic.replace(/入门/g, "").trim() || topic;
}

export function buildResearchQuerySet(topic, goal, background) {
  const researchTerm = normalizedResearchTerm(topic);
  return [
    `${researchTerm} beginner guide`,
    `${researchTerm} controversy beginner`,
    `${researchTerm} ${goal}`,
    `${researchTerm} ${background} explained`
  ];
}

export function buildLocalResearchBrief(topic, goal, background, retrievedAt = new Date().toISOString()) {
  const safeTopic = String(topic ?? "AI 入门").trim() || "AI 入门";
  const safeGoal = String(goal ?? "看懂讨论").trim() || "看懂讨论";
  const safeBackground = String(background ?? "普通兴趣学习者").trim() || "普通兴趣学习者";

  return {
    topic: safeTopic,
    querySet: buildResearchQuerySet(safeTopic, safeGoal, safeBackground),
    sources: [
      {
        title: `${safeTopic} local planning brief`,
        url: "local:fallback-research-brief",
        retrievedAt,
        summary: `本地 planning brief：面向${safeBackground}，围绕“${safeGoal}”组织 ${safeTopic} 的入门学习路径。`,
        reliabilityNote:
          "Local fallback used because live web research is disabled; planning context only, not release-grade source evidence.",
        qualityScore: 0,
        qualitySignals: ["fallback", "planning-only"],
        factReviewStatus: "planning-only"
      }
    ],
    keyIdeas: [`${safeTopic} 可以先拆成核心概念、真实场景和常见争议`, "先学能解释讨论的问题，再追求系统完整性"],
    disputedIdeas: [`${safeTopic} 的热点讨论需要区分事实、观点和包装`, `${safeGoal} 通常会牵涉边界条件`],
    beginnerPitfalls: [`只背 ${safeTopic} 术语但不知道讨论对象`, "把单一观点当成领域共识"],
    source: "fallback"
  };
}

export function rankResearchSources(rawSources, context, retrievedAt = new Date().toISOString()) {
  const deduped = new Map();
  for (const source of rawSources) {
    const key = canonicalSourceKey(source.url);
    if (!key || deduped.has(key)) continue;
    deduped.set(key, source);
  }

  return [...deduped.values()]
    .map((source) => {
      const score = scoreResearchSource(source, context);
      return { ...source, score };
    })
    .filter((source) => source.score > 0)
    .sort((a, b) => b.score - a.score || String(a.title).localeCompare(String(b.title)))
    .slice(0, 6)
    .map(({ score, ...source }, index) => ({
      ...source,
      retrievedAt,
      qualityScore: Math.max(0, Math.round(score)),
      qualitySignals: qualitySignalsForSource(source, context, score),
      factReviewStatus: "planning-only",
      reliabilityNote: buildReliabilityNote(source, context, score, index + 1)
    }));
}

function canonicalSourceKey(value) {
  try {
    const url = new URL(value);
    url.hash = "";
    url.search = "";
    url.pathname = url.pathname.replace(/\/$/, "");
    return `${url.hostname.replace(/^www\./, "").toLowerCase()}${url.pathname.toLowerCase()}`;
  } catch {
    return "";
  }
}

function scoreResearchSource(source, context) {
  const title = String(source.title ?? "");
  const summary = String(source.summary ?? "");
  const haystack = normalizeForMatching(`${title} ${summary}`);
  const host = sourceHostname(source.url);
  const topicTerms = termsFor(context.topic);
  const goalTerms = termsFor(context.goal);
  const backgroundTerms = termsFor(context.background);
  const topicMatches = topicTerms.filter((term) => haystack.includes(term)).length;
  const goalMatches = goalTerms.filter((term) => haystack.includes(term)).length;
  const backgroundMatches = backgroundTerms.filter((term) => haystack.includes(term)).length;
  let score = 0;

  if (topicTerms.length > 0 && topicMatches === 0) return 0;
  score += topicMatches * 4;
  score += goalMatches * 2;
  score += backgroundMatches;
  if (summary.length >= 80) score += 2;
  if (title.length >= 4) score += 1;
  if (isReferenceHost(host)) score += 3;
  if (isInstitutionHost(host)) score += 2;
  if (topicMatches + goalMatches + backgroundMatches === 0) score -= 8;
  if (isLowSignalSource(source)) score -= 4;
  return score;
}

function termsFor(value) {
  const text = normalizeForMatching(String(value ?? ""))
    .replace(/入门/g, " ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
  const words = text.split(/\s+/).filter((item) => item.length >= 3 || item === "ai");
  if (/\bai\b/i.test(String(value ?? ""))) words.push("artificial", "intelligence");
  const compact = text.replace(/\s+/g, "");
  if (compact && /[\u4e00-\u9fa5]/.test(compact)) {
    words.push(compact);
    for (const segment of compact.match(/[\u4e00-\u9fa5]{2,}/g) ?? []) {
      for (let index = 0; index < segment.length - 1; index += 1) {
        const chunk = segment.slice(index, index + 2);
        if (!broadChineseTerms.has(chunk)) words.push(chunk);
      }
    }
  }
  return [...new Set(words)];
}

const broadChineseTerms = new Set(["入门", "政策", "工具", "常见", "争议", "问题", "领域"]);

function normalizeForMatching(value) {
  return value
    .toLowerCase()
    .replace(/氣/g, "气")
    .replace(/候/g, "候")
    .replace(/變/g, "变")
    .replace(/學/g, "学")
    .replace(/樂/g, "乐")
    .replace(/戰/g, "战")
    .replace(/國/g, "国")
    .replace(/歷/g, "历")
    .replace(/史/g, "史");
}

function sourceHostname(value) {
  try {
    return new URL(value).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return "";
  }
}

function isReferenceHost(host) {
  return [
    "wikipedia.org",
    "britannica.com",
    "ourworldindata.org",
    "ipcc.ch",
    "un.org",
    "nasa.gov",
    "oecd.org",
    "worldbank.org"
  ].some((suffix) => host === suffix || host.endsWith(`.${suffix}`));
}

function isInstitutionHost(host) {
  return /\.(edu|gov|org)$/.test(host) || /\.(edu|gov)\.[a-z]{2}$/.test(host);
}

function isLowSignalSource(source) {
  const text = `${source.title ?? ""} ${source.summary ?? ""}`.toLowerCase();
  return /coupon|discount|casino|login|signup|buy now|download apk|广告|优惠|博彩/.test(text);
}

function qualitySignalsForSource(source, context, score) {
  const host = sourceHostname(source.url) || "unknown source";
  const signals = [];
  const text = normalizeForMatching(`${source.title ?? ""} ${source.summary ?? ""}`);
  if (termsFor(context.topic).some((term) => text.includes(term))) signals.push("topic-match");
  if (termsFor(context.goal).some((term) => text.includes(term))) signals.push("goal-match");
  if (termsFor(context.background).some((term) => text.includes(term))) signals.push("learner-background-match");
  if (String(source.summary ?? "").length >= 80) signals.push("summary-depth");
  if (isReferenceHost(host) || isInstitutionHost(host)) signals.push("reference-or-institutional");
  if (score <= 6) signals.push("low-confidence");
  signals.push("planning-only");
  return [...new Set(signals)];
}

function buildReliabilityNote(source, context, score, rank) {
  const signals = qualitySignalsForSource(source, context, score);
  const reasonLabels = signals
    .filter((signal) => signal !== "planning-only")
    .map((signal) => qualitySignalLabel(signal));
  const reasons = reasonLabels.length ? reasonLabels : ["general search result"];
  return `Rank ${rank}, score ${score}: ${reasons.join(", ")}. Public web summary for planning context only; not a complete fact review.`;
}

function qualitySignalLabel(signal) {
  return {
    "topic-match": "topic match",
    "goal-match": "goal match",
    "learner-background-match": "learner background match",
    "summary-depth": "summary depth",
    "reference-or-institutional": "reference/institutional source",
    "low-confidence": "low confidence"
  }[signal] ?? signal;
}

async function handleResearch(request, response) {
  try {
    const body = JSON.parse(await readBody(request));
    const topic = String(body.topic ?? "AI 入门").trim();
    const goal = String(body.goal ?? "看懂讨论").trim();
    const background = String(body.background ?? "普通兴趣学习者").trim();

    if (researchMode === "off") {
      sendJson(response, 200, buildLocalResearchBrief(topic, goal, background), request);
      return;
    }

    const querySet = buildResearchQuerySet(topic, goal, background);

    const directSources = await directSummarySources(topic);
    const batches = await Promise.allSettled(querySet.slice(0, 3).map((query) => searchWebSources(query)));
    const retrievedAt = new Date().toISOString();
    const sources = rankResearchSources(
      [
        ...directSources,
        ...batches.flatMap((batch) => (batch.status === "fulfilled" ? batch.value : []))
      ],
      { topic, goal, background },
      retrievedAt
    );

    if (!sources.length) {
      sendJson(response, 502, { error: "No research sources returned" }, request);
      return;
    }

    sendJson(response, 200, {
      topic,
      querySet,
      sources,
      keyIdeas: sources.slice(0, 3).map((source) => source.summary || source.title),
      disputedIdeas: [`${topic} 的热点讨论需要区分事实、观点和商业包装`, `${goal} 通常会牵涉真实案例和边界条件`],
      beginnerPitfalls: [`只背 ${topic} 术语但不知道讨论对象`, "把搜索热度当成领域共识"],
      source: "web"
    }, request);
  } catch (error) {
    const timedOut = isProxyTimeoutError(error);
    sendJson(response, timedOut ? 504 : 500, {
      error: timedOut ? "Research upstream timed out" : "Research proxy failed"
    }, request);
  }
}

export function isColearningServiceRoute(url) {
  return url?.startsWith("/api/colearning/") || url?.startsWith("/api/community/");
}

export const server = http.createServer(async (request, response) => {
  if (rejectDisallowedOrigin(request, response)) return;

  if (request.method === "OPTIONS") {
    sendJson(response, 204, {}, request);
    return;
  }

  if (request.url === "/api/research" && request.method === "POST") {
    await handleResearch(request, response);
    return;
  }

  if (request.url === "/api/colearning/health" && request.method === "GET") {
    sendJson(response, 200, { status: colearningProcess ? "up" : "down" }, request);
    return;
  }

  if (isColearningServiceRoute(request.url)) {
    if (!colearningProcess) {
      sendJson(response, 503, { error: "Co-learning service is not running" }, request);
      return;
    }
    try {
      const body = request.method === "GET" ? undefined : await readBody(request);
      const targetUrl = `http://127.0.0.1:${colearningPort}${request.url}`;
      const upstreamResponse = await fetchWithTimeout(
        targetUrl,
        {
          method: request.method,
          headers: body ? { "content-type": "application/json" } : undefined,
          body,
        },
        { timeoutMs: 90_000, label: "colearning service" },
      );
      const upstreamText = await upstreamResponse.text();
      response.writeHead(upstreamResponse.status, {
        "content-type": upstreamResponse.headers.get("content-type") || "application/json",
        ...corsHeadersFor(request),
      });
      response.end(upstreamText);
    } catch (error) {
      const timedOut = isProxyTimeoutError(error);
      sendJson(response, timedOut ? 504 : 502, { error: timedOut ? "Co-learning service timed out" : "Co-learning proxy failed" }, request);
    }
    return;
  }

  if (request.url !== "/api/generate" || request.method !== "POST") {
    sendJson(response, 404, { error: "Not found" }, request);
    return;
  }

  if (rejectMissingDevToken(request, response)) return;

  if (!apiKey || apiKey === "replace-with-your-key") {
    sendJson(response, 503, {
      error: "LLM_API_KEY is not configured. The client will use deterministic fallback."
    }, request);
    return;
  }

  try {
    const body = JSON.parse(await readBody(request));
    if (!validateGenerateProxyRequestPayload(body)) {
      sendJson(response, 400, { error: "Invalid generation request" }, request);
      return;
    }
    const upstreamResponse = await fetchWithTimeout(
      `${baseUrl.replace(/\/$/, "")}/chat/completions`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${apiKey}`
        },
        body: JSON.stringify(buildChatCompletionBody({
          model,
          temperature: body.temperature ?? 0.7,
          messages: body.messages,
          responseFormatMode
        }))
      },
      { timeoutMs: llmFetchTimeoutMs, label: "LLM provider" }
    );

    const upstreamText = await upstreamResponse.text();
    if (!upstreamResponse.ok) {
      sendJson(response, upstreamResponse.status, {
        error: "LLM provider rejected the request",
        providerStatus: upstreamResponse.status,
        providerStatusText: upstreamResponse.statusText,
        providerError: summarizeProviderError(upstreamText)
      }, request);
      return;
    }

    const upstreamJson = JSON.parse(upstreamText);
    const content = upstreamJson.choices?.[0]?.message?.content;
    if (!content) {
      sendJson(response, 502, { error: "LLM response did not include message content" }, request);
      return;
    }

    sendJson(response, 200, { content, model }, request);
  } catch (error) {
    const timedOut = isProxyTimeoutError(error);
    sendJson(response, timedOut ? 504 : 500, {
      error: timedOut ? "LLM provider timed out" : "LLM proxy failed"
    }, request);
  }
});

export function summarizeProviderError(rawText) {
  if (!rawText) return "";
  try {
    const parsed = JSON.parse(rawText);
    const candidate =
      parsed?.error?.message ??
      parsed?.error?.type ??
      parsed?.message ??
      parsed?.detail ??
      rawText;
    return String(candidate).slice(0, 500);
  } catch {
    return rawText.replace(/\s+/g, " ").trim().slice(0, 500);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  server.listen(port, "127.0.0.1", () => {
    console.log(`KnowFeed LLM proxy listening on http://127.0.0.1:${port}`);
    startColearningService();
  });
}
