import { describe, expect, it } from "vitest";
import { buildFallbackBundle } from "./fallbackGenerator";
import {
  buildCommentContextTerms,
  commentFilters,
  commentSortModes,
  countCommentReplies,
  countCommentsByFilter,
  rankComments
} from "./feedEngine";
import { defaultAppState } from "./storage";

describe("feedEngine", () => {
  it("exposes all learning-oriented community filters", () => {
    expect(commentFilters).toEqual(["全部", "赞成", "反对", "补充", "挑刺"]);
    expect(commentSortModes).toEqual(["热度", "新回复", "相关"]);
  });

  it("ranks comments by heat and filters each stance exactly", () => {
    const bundle = buildFallbackBundle(defaultAppState, "wallet");
    const all = rankComments(bundle.comments, "全部");
    const against = rankComments(bundle.comments, "反对");
    const supplement = rankComments(bundle.comments, "补充");
    const challenge = rankComments(bundle.comments, "挑刺");

    expect(all[0].heat).toBeGreaterThanOrEqual(all[1].heat);
    expect(against.every((comment) => comment.stance === "反对")).toBe(true);
    expect(supplement.every((comment) => comment.stance === "补充")).toBe(true);
    expect(challenge.every((comment) => comment.stance === "挑刺")).toBe(true);
  });

  it("counts comments for each visible filter", () => {
    const bundle = buildFallbackBundle(defaultAppState, "wallet");

    expect(countCommentsByFilter(bundle.comments)).toEqual({
      全部: 4,
      赞成: 1,
      反对: 1,
      补充: 1,
      挑刺: 1
    });
  });

  it("counts nested community replies without changing top-level stance filters", () => {
    const bundle = buildFallbackBundle(defaultAppState, "wallet");
    const commentsWithReplies = bundle.comments.map((comment, index) =>
      index === 0
        ? {
            ...comment,
            replies: [
              {
                id: "reply-1",
                author: comment.author,
                body: "追问：这个判断的边界是什么？",
                heat: 42,
                replyToCommentId: comment.id,
                relation: "追问" as const
              },
              {
                id: "reply-2",
                author: comment.author,
                body: "补充：先回到学习目标看。",
                heat: 40,
                replyToCommentId: comment.id,
                relation: "补充" as const
              }
            ]
          }
        : comment
    );

    expect(countCommentsByFilter(commentsWithReplies).全部).toBe(4);
    expect(countCommentReplies(commentsWithReplies)).toBe(4);
  });

  it("can rank active reply threads ahead of hotter flat comments", () => {
    const bundle = buildFallbackBundle(defaultAppState, "wallet");
    const comments = bundle.comments.map((comment, index) =>
      index === 2
        ? {
            ...comment,
            heat: 40,
            replies: [
              {
                id: "reply-active",
                author: comment.author,
                body: "刚刚有人追问：这个边界到底怎么判断？",
                heat: 110,
                replyToCommentId: comment.id,
                relation: "追问" as const
              }
            ]
          }
        : { ...comment, replies: [] }
    );

    expect(rankComments(comments, "全部", { sortMode: "热度" })[0].id).toBe(bundle.comments[0].id);
    expect(rankComments(comments, "全部", { sortMode: "新回复" })[0].id).toBe(bundle.comments[2].id);
  });

  it("can rank context-heavy comments ahead of hotter generic comments", () => {
    const bundle = buildFallbackBundle(defaultAppState, "wallet");
    const contextTerms = ["心理学", "研究", "认知偏差"];
    const comments = [
      {
        ...bundle.comments[0],
        id: "generic-hot",
        body: "这个说法很有道理，大家都应该先看懂。",
        heat: 100,
        replies: []
      },
      {
        ...bundle.comments[1],
        id: "relevant-cool",
        body: "心理学研究里谈认知偏差时，需要先看样本和边界。",
        heat: 42,
        replies: [
          {
            id: "reply-relevant",
            author: bundle.comments[1].author,
            body: "追问：这个认知偏差能不能解释日常讨论？",
            heat: 35,
            replyToCommentId: "relevant-cool",
            relation: "追问" as const
          }
        ]
      }
    ];

    expect(rankComments(comments, "全部", { sortMode: "相关", contextTerms })[0].id).toBe("relevant-cool");
  });

  it("extracts stable context terms from the current generated bundle", () => {
    const bundle = buildFallbackBundle(defaultAppState, "wallet");
    const terms = buildCommentContextTerms(bundle);

    expect(terms).toContain(bundle.lesson.title);
    expect(terms.some((term) => bundle.post.body.includes(term))).toBe(true);
  });
});
