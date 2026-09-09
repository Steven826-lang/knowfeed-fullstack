import { describe, expect, it } from "vitest";
import { parsePlannerDraft } from "./plannerContracts";

describe("plannerContracts", () => {
  it("parses fenced planner JSON and normalizes optional draft fields", () => {
    const raw = `\`\`\`json
{
  "title": "日本战国史入门：7 天讨论路径",
  "promise": "每天 5 分钟，用内容编辑视角看懂人物、史料和影视改编争论。",
  "days": [
    {
      "day": "1",
      "title": "战国时代的基本坐标",
      "whyNow": "先分清时间、地域和群雄割据。",
      "concepts": [
        {
          "temporaryName": "战国时代的基本坐标",
          "plainLanguageGoal": "能说出 1467 到 1615 这条时间线为什么有争议"
        }
      ]
    },
    {
      "day": 2,
      "title": "大名和幕府",
      "whyNow": "看懂权力结构。",
      "concepts": [
        {
          "temporaryName": "大名和幕府",
          "plainLanguageGoal": "分清地方大名和幕府权威",
          "prerequisiteNames": ["战国时代的基本坐标"],
          "sourceUrls": ["https://example.test/sengoku"]
        }
      ]
    },
    {
      "day": 3,
      "title": "史料和影视改编",
      "whyNow": "分清史料和戏剧化。",
      "concepts": [
        {
          "temporaryName": "史料和影视改编",
          "plainLanguageGoal": "知道影视改编为什么会改人物动机",
          "misconceptionToFix": "影视剧情等于史实",
          "feedHook": "影视改编到底能不能当历史入门？"
        }
      ]
    }
  ]
}
\`\`\``;

    const draft = parsePlannerDraft(raw);

    expect(draft?.days[0].day).toBe(1);
    expect(draft?.days[0].concepts[0].prerequisiteNames).toEqual([]);
    expect(draft?.days[0].concepts[0].sourceUrls).toEqual([]);
    expect(draft?.days[0].concepts[0].feedHook).toBe("先分清时间、地域和群雄割据。");
    expect(draft?.days[2].concepts[0].misconceptionToFix).toBe("影视剧情等于史实");
  });

  it("parses the first complete planner object when prompt-only JSON has trailing prose", () => {
    const raw = `下面是 JSON：
{
  "title": "摄影构图入门：7 天讨论路径",
  "promise": "每天 5 分钟，用电商运营视角判断构图选择。",
  "days": [
    {
      "day": 1,
      "title": "三分法",
      "whyNow": "先看规则服务什么画面目的。",
      "concepts": [
        {
          "temporaryName": "三分法",
          "plainLanguageGoal": "分清三分法何时有用",
          "prerequisiteNames": [],
          "misconceptionToFix": "规则等于好照片",
          "feedHook": "三分法是不是新手捷径？",
          "sourceUrls": []
        }
      ]
    },
    {
      "day": 2,
      "title": "留白",
      "whyNow": "再看留白和商品卖点。",
      "concepts": [
        {
          "temporaryName": "留白",
          "plainLanguageGoal": "判断留白是否突出商品"
        }
      ]
    },
    {
      "day": 3,
      "title": "视线动线",
      "whyNow": "最后看用户先看到什么。",
      "concepts": [
        {
          "temporaryName": "视线动线",
          "plainLanguageGoal": "用动线解释构图选择"
        }
      ]
    }
  ]
}
这份草案已经按 7 天结构组织。`;

    const draft = parsePlannerDraft(raw);

    expect(draft?.title).toContain("摄影构图");
    expect(draft?.days[0].concepts[0].temporaryName).toBe("三分法");
  });
});
