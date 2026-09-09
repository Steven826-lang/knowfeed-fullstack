import { describe, expect, it } from "vitest";
import { extractFirstJsonObject } from "./jsonObject";

describe("jsonObject", () => {
  it("extracts the first balanced object before trailing prose", () => {
    expect(extractFirstJsonObject('prefix {"ok": true} trailing')).toBe('{"ok": true}');
  });

  it("extracts a top-level array returned by prompt-only providers", () => {
    expect(extractFirstJsonObject('```json\n[{"id":"a"},{"id":"b"}]\n```\nextra')).toBe('[{"id":"a"},{"id":"b"}]');
  });
});
