import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

loadLocalEnv();

const baseUrl = process.env.LLM_BASE_URL ?? "https://api.openai.com/v1";
const apiKey = process.env.LLM_API_KEY;
const model = process.env.LLM_MODEL ?? "gpt-4.1-mini";
const responseFormatMode = normalizeResponseFormatMode(process.env.LLM_RESPONSE_FORMAT);
const timeoutMs = readPositiveIntegerEnv("LLM_PROVIDER_PROBE_TIMEOUT_MS", 20_000);

if (!apiKey || apiKey === "replace-with-your-key") {
  console.error(
    JSON.stringify(
      {
        ok: false,
        error: "LLM_API_KEY is not configured",
        diagnosis: "missing-api-key",
        nextActions: [
          "Copy .env.example to .env.local if needed.",
          "Set LLM_API_KEY to a server-side provider key.",
          "Run npm run probe:llm-provider again before real-LLM E2E."
        ]
      },
      null,
      2
    )
  );
  process.exit(1);
}

const controller = new AbortController();
const timeout = setTimeout(() => controller.abort(), timeoutMs);

try {
  const response = await fetch(`${baseUrl.replace(/\/$/, "")}/chat/completions`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify(buildChatCompletionBody({
      model,
      temperature: 0,
      responseFormatMode,
      messages: [
        { role: "system", content: "Return JSON only. No markdown." },
        { role: "user", content: "Return exactly {\"ok\":true,\"label\":\"knowfeed-provider-probe\"}." }
      ]
    })),
    signal: controller.signal
  });
  const text = await response.text();
  if (!response.ok) {
    const providerError = summarizeProviderError(text);
    console.error(
      JSON.stringify(
        {
          ok: false,
          providerStatus: response.status,
          providerStatusText: response.statusText,
          providerError,
          diagnosis: diagnoseProviderFailure(response.status, providerError),
          nextActions: buildProviderNextActions(response.status, providerError)
        },
        null,
        2
      )
    );
    process.exit(1);
  }

  const content = parseProviderContent(text);
  console.log(
    JSON.stringify(
      {
        ok: true,
        providerStatus: response.status,
        model,
        responseFormat: responseFormatMode,
        contentPreview: content.slice(0, 200)
      },
      null,
      2
    )
  );
} catch (error) {
  console.error(
    JSON.stringify(
      {
        ok: false,
        error: error?.name === "AbortError" ? `Provider probe timed out after ${timeoutMs}ms` : String(error?.message ?? error),
        diagnosis: error?.name === "AbortError" ? "provider-timeout" : "provider-request-error",
        nextActions:
          error?.name === "AbortError"
            ? [
                "Check provider status and network reachability.",
                "Increase LLM_PROVIDER_PROBE_TIMEOUT_MS only if the provider is healthy but slow.",
                "Run npm run probe:llm-provider again before real-LLM E2E."
              ]
            : [
                "Check LLM_BASE_URL and network reachability.",
                "Confirm the provider supports the OpenAI-compatible /chat/completions endpoint.",
                "Run npm run probe:llm-provider again before real-LLM E2E."
              ]
      },
      null,
      2
    )
  );
  process.exit(1);
} finally {
  clearTimeout(timeout);
}

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

function parseProviderContent(rawText) {
  try {
    const parsed = JSON.parse(rawText);
    return String(parsed?.choices?.[0]?.message?.content ?? "");
  } catch {
    return rawText;
  }
}

function summarizeProviderError(rawText) {
  if (!rawText) return "";
  try {
    const parsed = JSON.parse(rawText);
    const candidate = parsed?.error?.message ?? parsed?.error?.type ?? parsed?.message ?? parsed?.detail ?? rawText;
    return String(candidate).slice(0, 500);
  } catch {
    return rawText.replace(/\s+/g, " ").trim().slice(0, 500);
  }
}

function diagnoseProviderFailure(status, providerError) {
  const errorText = providerError.toLowerCase();
  if (status === 401 || status === 403) return "auth-or-permission";
  if (status === 402 || /insufficient|balance|quota|billing|payment/.test(errorText)) return "billing-or-quota";
  if (status === 404 || /model|not found/.test(errorText)) return "model-or-endpoint";
  if (status === 408 || status === 504) return "provider-timeout";
  if (status === 429 || /rate limit|too many/.test(errorText)) return "rate-limited";
  if (status >= 500) return "provider-server-error";
  return "provider-rejected-request";
}

function buildProviderNextActions(status, providerError) {
  const diagnosis = diagnoseProviderFailure(status, providerError);
  if (diagnosis === "billing-or-quota") {
    return [
      "Restore provider balance/quota for the configured API key.",
      "Confirm LLM_MODEL is available on that account.",
      "Rerun npm run probe:llm-provider before any real-LLM archive or Kimi browser proof."
    ];
  }
  if (diagnosis === "auth-or-permission") {
    return [
      "Check that LLM_API_KEY is current and belongs to the configured provider.",
      "Confirm the key has chat/completions access.",
      "Rerun npm run probe:llm-provider before real-LLM E2E."
    ];
  }
  if (diagnosis === "model-or-endpoint") {
    return [
      "Check LLM_BASE_URL and LLM_MODEL in .env.local.",
      "Confirm the provider exposes an OpenAI-compatible /chat/completions endpoint.",
      "Use a model that supports JSON response_format, or set LLM_RESPONSE_FORMAT=none only after confirming prompt-only JSON passes provider and E2E gates."
    ];
  }
  if (diagnosis === "rate-limited") {
    return [
      "Wait for provider rate limits to reset or use a key/model tier with enough throughput.",
      "Do not run the expanded-full real-LLM archive until this probe is green.",
      "Rerun npm run probe:llm-provider."
    ];
  }
  if (diagnosis === "provider-timeout" || diagnosis === "provider-server-error") {
    return [
      "Check provider status and retry after the upstream is healthy.",
      "Keep LLM proxy timeouts bounded; do not weaken release gates to accept fallback output.",
      "Rerun npm run probe:llm-provider before real-LLM E2E."
    ];
  }
  return [
    "Inspect providerError and providerStatusText.",
    "Confirm LLM_BASE_URL, LLM_MODEL, and account permissions.",
    "Rerun npm run probe:llm-provider before real-LLM E2E."
  ];
}

function readPositiveIntegerEnv(name, fallback) {
  const value = Number(process.env[name]);
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

function normalizeResponseFormatMode(value) {
  const normalized = String(value ?? "json_object").trim().toLowerCase();
  if (["none", "off", "disabled", "false"].includes(normalized)) return "none";
  return "json_object";
}

function buildChatCompletionBody({ model, temperature, messages, responseFormatMode = "json_object" }) {
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
