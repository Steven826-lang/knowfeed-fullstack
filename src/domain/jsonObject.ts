export function extractFirstJsonObject(raw: string): string {
  const candidate = stripJsonFence(raw);
  const extracted = findBalancedJsonValue(candidate);
  return extracted ?? candidate;
}

function stripJsonFence(raw: string): string {
  return raw
    .trim()
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/\s*```$/i, "");
}

function findBalancedJsonValue(value: string): string | null {
  const objectStart = value.indexOf("{");
  const arrayStart = value.indexOf("[");
  const starts = [objectStart, arrayStart].filter((index) => index >= 0);
  if (!starts.length) return null;
  const start = Math.min(...starts);
  const opener = value[start];
  const closerByOpener: Record<string, string> = { "{": "}", "[": "]" };
  const openerByCloser: Record<string, string> = { "}": "{", "]": "[" };
  const stack: string[] = [];

  let inString = false;
  let escaped = false;

  for (let index = start; index < value.length; index += 1) {
    const char = value[index];

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === "\"") {
        inString = false;
      }
      continue;
    }

    if (char === "\"") {
      inString = true;
      continue;
    }
    if (char === "{" || char === "[") {
      stack.push(char);
      continue;
    }
    if (char !== "}" && char !== "]") continue;

    if (stack[stack.length - 1] !== openerByCloser[char]) return null;
    stack.pop();
    if (stack.length === 0 && char === closerByOpener[opener]) return value.slice(start, index + 1);
  }

  return null;
}
