import { afterEach, describe, expect, it, vi } from "vitest";
import { requestGeneratedContent, resolveRequestTimeoutMs } from "./llmClient";
import type { LlmProxyRequest } from "./llmContracts";

const request: LlmProxyRequest = {
  messages: [{ role: "user", content: "Generate JSON" }]
};

describe("llmClient", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("retries one transient proxy failure before falling back to the caller", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 502 })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ content: "{\"lesson\":{}}", model: "test-model" })
      });
    vi.stubGlobal("fetch", fetch);

    await expect(requestGeneratedContent(request)).resolves.toBe("{\"lesson\":{}}");
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("uses a positive configured browser timeout and otherwise keeps the default", () => {
    expect(resolveRequestTimeoutMs("180000")).toBe(180000);
    expect(resolveRequestTimeoutMs("0")).toBe(60000);
    expect(resolveRequestTimeoutMs("not-a-number")).toBe(60000);
  });
});
