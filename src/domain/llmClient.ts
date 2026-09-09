import type { LlmProxyRequest, LlmProxyResponse } from "./generationPrompt";

const maxAttempts = 2;
const requestTimeoutMs = resolveRequestTimeoutMs(
  (import.meta as unknown as { env?: { VITE_LLM_CLIENT_TIMEOUT_MS?: string } }).env?.VITE_LLM_CLIENT_TIMEOUT_MS
);

export async function requestGeneratedContent(request: LlmProxyRequest): Promise<string> {
  let lastError: unknown;

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    try {
      return await postToProxy(request);
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError instanceof Error ? lastError : new Error("LLM proxy request failed");
}

async function postToProxy(request: LlmProxyRequest): Promise<string> {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), requestTimeoutMs);

  try {
    const response = await fetch("/api/generate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(request),
      signal: controller.signal
    });

    if (!response.ok) {
      throw new Error(`LLM proxy returned ${response.status}`);
    }

    const payload = (await response.json()) as LlmProxyResponse;
    if (typeof payload.content !== "string" || !payload.content.trim()) {
      throw new Error("LLM proxy returned empty content");
    }
    return payload.content;
  } finally {
    window.clearTimeout(timeout);
  }
}

export function resolveRequestTimeoutMs(value: unknown, fallbackMs = 60_000): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallbackMs;
}
