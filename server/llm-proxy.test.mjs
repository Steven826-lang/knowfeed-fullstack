import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  buildChatCompletionBody,
  buildLocalResearchBrief,
  buildResearchQuerySet,
  fetchWithTimeout,
  isAllowedCorsOrigin,
  isColearningServiceRoute,
  normalizeResearchMode,
  normalizeResponseFormatMode,
  rankResearchSources,
  server,
  summarizeProviderError,
  validateGenerateProxyRequestPayload
} from "./llm-proxy.mjs";

describe("fetchWithTimeout", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("aborts slow upstream fetches with a gateway timeout error", async () => {
    vi.useFakeTimers();
    let capturedSignal;
    const slowFetch = vi.fn((_url, options) => {
      capturedSignal = options.signal;
      return new Promise((_resolve, reject) => {
        options.signal.addEventListener("abort", () => reject(options.signal.reason));
      });
    });
    vi.stubGlobal("fetch", slowFetch);

    const pending = fetchWithTimeout("https://example.test/slow", {}, { timeoutMs: 25, label: "slow upstream" });
    const rejection = expect(pending).rejects.toMatchObject({
      name: "ProxyTimeoutError",
      statusCode: 504,
      message: "slow upstream timed out after 25ms"
    });
    await vi.advanceTimersByTimeAsync(26);

    await rejection;
    expect(capturedSignal.aborted).toBe(true);
  });
});

describe("research proxy helpers", () => {
  it("keeps live web research on by default but allows a local fallback mode", () => {
    expect(normalizeResearchMode(undefined)).toBe("web");
    expect(normalizeResearchMode("web")).toBe("web");
    expect(normalizeResearchMode("off")).toBe("off");
    expect(normalizeResearchMode("local")).toBe("off");
    expect(normalizeResearchMode("disabled")).toBe("off");

    const brief = buildLocalResearchBrief(
      "建筑史入门",
      "能判断建筑作品背后的时代、功能和审美争论",
      "我是城市更新从业者",
      "2026-06-20T00:00:00.000Z"
    );

    expect(brief.source).toBe("fallback");
    expect(brief.sources).toHaveLength(1);
    expect(brief.sources[0].url).toBe("local:fallback-research-brief");
    expect(brief.sources[0].retrievedAt).toBe("2026-06-20T00:00:00.000Z");
    expect(brief.sources[0].qualitySignals).toEqual(["fallback", "planning-only"]);
    expect(brief.keyIdeas.join("\n")).toContain("建筑史入门");
  });

  it("builds learner-aware query sets without changing the topic pipeline", () => {
    const queries = buildResearchQuerySet(
      "气候变化政策入门",
      "能分清政策工具、利益相关方和常见争议",
      "我是城市规划从业者"
    );

    expect(queries).toHaveLength(4);
    expect(queries.join("\n")).toContain("气候变化政策");
    expect(queries.join("\n")).toContain("能分清政策工具");
    expect(queries.join("\n")).toContain("城市规划");
  });

  it("dedupes, filters low-signal results, and ranks relevant sources first", () => {
    const ranked = rankResearchSources(
      [
        {
          title: "Boxer Rebellion",
          url: "https://zh.wikipedia.org/wiki/Boxer_Rebellion",
          summary: "A military history article about nineteenth-century diplomacy and armed conflict."
        },
        {
          title: "Login portal",
          url: "https://spam.example.com/login?ref=ad",
          summary: "Casino coupon signup discount download apk."
        },
        {
          title: "Generic city blog",
          url: "https://example.org/posts/climate-policy#comments",
          summary: "A short mention of climate policy."
        },
        {
          title: "Climate policy and urban planning",
          url: "https://www.ipcc.ch/report/climate-policy/",
          summary:
            "Climate policy links mitigation, adaptation, transport planning, land use, public infrastructure and stakeholder tradeoffs."
        },
        {
          title: "Duplicate IPCC mirror",
          url: "https://ipcc.ch/report/climate-policy/?utm_source=test",
          summary: "This duplicate should not survive canonical URL dedupe."
        }
      ],
      {
        topic: "climate policy",
        goal: "understand stakeholder tradeoffs",
        background: "urban planning"
      },
      "2026-06-11T00:00:00.000Z"
    );

    expect(ranked.map((source) => source.url)).toEqual([
      "https://www.ipcc.ch/report/climate-policy/",
      "https://example.org/posts/climate-policy#comments"
    ]);
    expect(ranked[0].retrievedAt).toBe("2026-06-11T00:00:00.000Z");
    expect(ranked[0].qualityScore).toBeGreaterThan(ranked[1].qualityScore);
    expect(ranked[0].qualitySignals).toEqual(
      expect.arrayContaining(["topic-match", "goal-match", "learner-background-match", "reference-or-institutional", "planning-only"])
    );
    expect(ranked[0].factReviewStatus).toBe("planning-only");
    expect(ranked[0].reliabilityNote).toContain("Rank 1");
    expect(ranked[0].reliabilityNote).toContain("reference/institutional source");
    expect(ranked.some((source) => source.title === "Login portal")).toBe(false);
  });

  it("keeps at most six ranked planning sources", () => {
    const ranked = rankResearchSources(
      Array.from({ length: 8 }, (_, index) => ({
        title: `Education evidence source ${index + 1}`,
        url: `https://example${index}.org/education-evidence`,
        summary:
          "Education evidence connects learning motivation, classroom practice, formative assessment and learner background."
      })),
      {
        topic: "education evidence",
        goal: "understand classroom practice",
        background: "course designer"
      },
      "2026-06-11T00:00:00.000Z"
    );

    expect(ranked).toHaveLength(6);
    expect(ranked.every((source) => typeof source.qualityScore === "number")).toBe(true);
    expect(ranked.every((source) => source.qualitySignals.includes("planning-only"))).toBe(true);
    expect(ranked.every((source) => source.reliabilityNote.includes("planning context only"))).toBe(true);
  });

  it("recognizes Chinese topic fragments instead of requiring exact full-title matches", () => {
    const ranked = rankResearchSources(
      [
        {
          title: "中国的气候变化",
          url: "https://zh.wikipedia.org/wiki/%E4%B8%AD%E5%9B%BD%E7%9A%84%E6%B0%94%E5%80%99%E5%8F%98%E5%8C%96",
          summary: "气候变化对基础设施、城市系统、政策工具和公众适应都有影响。"
        },
        {
          title: "八国联军之役",
          url: "https://zh.wikipedia.org/wiki/%E5%85%AB%E5%9B%BD%E8%81%94%E5%86%9B%E4%B9%8B%E5%BD%B9",
          summary: "军事史、外交史和武装冲突。"
        },
        {
          title: "科学",
          url: "https://zh.wikipedia.org/wiki/%E7%A7%91%E5%AD%A6",
          summary: "这条摘要提到政策工具和常见争议，但讨论的是通用科学方法。"
        }
      ],
      {
        topic: "气候变化政策入门",
        goal: "能分清政策工具、利益相关方和常见争议",
        background: "我是城市规划从业者"
      },
      "2026-06-11T00:00:00.000Z"
    );

    expect(ranked).toHaveLength(1);
    expect(ranked[0].title).toBe("中国的气候变化");
    expect(ranked[0].qualitySignals).toContain("topic-match");
    expect(ranked[0].reliabilityNote).toContain("topic match");
  });
});

describe("generate proxy guardrails", () => {
  it("keeps JSON response format configurable for providers with cheaper prompt-only JSON models", () => {
    const messages = [{ role: "user", content: "return JSON" }];

    expect(normalizeResponseFormatMode(undefined)).toBe("json_object");
    expect(normalizeResponseFormatMode("none")).toBe("none");
    expect(normalizeResponseFormatMode("off")).toBe("none");
    expect(
      buildChatCompletionBody({
        model: "step-3.5-flash-2603",
        temperature: 0,
        messages,
        responseFormatMode: "none"
      })
    ).toEqual({
      model: "step-3.5-flash-2603",
      temperature: 0,
      messages
    });
    expect(
      buildChatCompletionBody({
        model: "gpt-4.1-mini",
        temperature: 0,
        messages
      })
    ).toEqual({
      model: "gpt-4.1-mini",
      temperature: 0,
      messages,
      response_format: { type: "json_object" }
    });
  });

  it("allows only configured local development origins by default", () => {
    expect(isAllowedCorsOrigin(undefined)).toBe(true);
    expect(isAllowedCorsOrigin("http://127.0.0.1:5173")).toBe(true);
    expect(isAllowedCorsOrigin("http://127.0.0.1:5174")).toBe(true);
    expect(isAllowedCorsOrigin("http://localhost:5173")).toBe(true);
    expect(isAllowedCorsOrigin("https://malicious.example")).toBe(false);
  });

  it("rejects malformed or overbroad generation requests before spending the API key", () => {
    expect(
      validateGenerateProxyRequestPayload({
        temperature: 0.7,
        messages: [
          { role: "system", content: "只返回 JSON" },
          { role: "user", content: "生成一条 KnowFeed 内容" }
        ]
      })
    ).toBe(true);

    expect(validateGenerateProxyRequestPayload({ messages: [{ role: "assistant", content: "nope" }] })).toBe(false);
    expect(validateGenerateProxyRequestPayload({ messages: [] })).toBe(false);
    expect(validateGenerateProxyRequestPayload({ temperature: 9, messages: [{ role: "user", content: "x" }] })).toBe(false);
    expect(
      validateGenerateProxyRequestPayload({
        messages: [{ role: "user", content: "x".repeat(120_001) }]
      })
    ).toBe(false);
  });

  it("summarizes provider rejection bodies without leaking full payloads", () => {
    expect(summarizeProviderError(JSON.stringify({ error: { message: "Insufficient Balance" } }))).toBe(
      "Insufficient Balance"
    );
    expect(summarizeProviderError("  plain upstream failure  ".repeat(40))).toHaveLength(500);
  });
});

describe("co-learning service route forwarding", () => {
  it("matches /api/colearning/* and /api/community/* prefixes only", () => {
    expect(isColearningServiceRoute("/api/colearning/worlds")).toBe(true);
    expect(isColearningServiceRoute("/api/community/posts")).toBe(true);
    expect(isColearningServiceRoute("/api/community/posts/post-1?sort=hot")).toBe(true);

    expect(isColearningServiceRoute("/api/community")).toBe(false);
    expect(isColearningServiceRoute("/api/communityx/posts")).toBe(false);
    expect(isColearningServiceRoute("/api/research")).toBe(false);
    expect(isColearningServiceRoute(undefined)).toBeFalsy();
  });

  describe("when the co-learning service is not running", () => {
    let address;

    beforeAll(async () => {
      await new Promise((resolveListen) => server.listen(0, "127.0.0.1", resolveListen));
      address = `http://127.0.0.1:${server.address().port}`;
    });

    afterAll(async () => {
      server.closeAllConnections();
      await new Promise((resolveClose) => server.close(resolveClose));
    });

    it("routes /api/community/* to the co-learning forwarder instead of the 404 fallthrough", async () => {
      const communityResponse = await fetch(`${address}/api/community/posts`);
      expect(communityResponse.status).toBe(503);
      expect(await communityResponse.json()).toEqual({ error: "Co-learning service is not running" });

      const colearningResponse = await fetch(`${address}/api/colearning/worlds`);
      expect(colearningResponse.status).toBe(503);
      expect(await colearningResponse.json()).toEqual({ error: "Co-learning service is not running" });

      const unmatchedResponse = await fetch(`${address}/api/community`);
      expect(unmatchedResponse.status).toBe(404);
    });

    it("applies the same CORS handling to /api/community/* responses", async () => {
      const response = await fetch(`${address}/api/community/posts`, {
        headers: { origin: "http://127.0.0.1:5173" }
      });
      expect(response.status).toBe(503);
      expect(response.headers.get("access-control-allow-origin")).toBe("http://127.0.0.1:5173");
    });
  });
});
