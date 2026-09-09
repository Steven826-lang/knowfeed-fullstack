"""Tests for the §5.4 quality gate (check_content / check_batch).

Legacy gates (passes_gate / is_slop / is_duplicate / lacks_viewpoint_diversity)
are covered in test_actions.py; only their preserved-behavior invariants are
asserted here.
"""

import pytest

from quality import (
    BATCH_MIN_PASS_RATE,
    BatchReport,
    QualityResult,
    check_batch,
    check_content,
    is_low_effort,
    is_near_duplicate,
    is_slop,
    violates_stance_diversity,
)

DISTINCT_COMMENTS = [
    "大模型的注意力机制其实就是在计算词与词之间的相关性权重。",
    "我不同意楼上，注意力权重不等于真正的语义理解，别忘了涌现问题。",
    "补充一个资料：原论文《Attention is All You Need》里讲得很清楚。",
    "说人话就是，模型在看每个词的时候会自动决定该关注谁。",
    "省流：注意力就是加权平均，但权重是学出来的，这才是关键。",
    "我踩过这个坑，当初把 QKV 矩阵的维度搞混了整整两天。",
    "从实际应用角度看，理解注意力对写 prompt 帮助其实不大。",
    "有个反例：有些不开源的模型根本查不到架构细节，怎么学习？",
    "追问一下，多头注意力的头数一般是怎么定的？有讲究吗？",
    "类比一下，多头注意力就像让多个评委同时从不同角度打分。",
]

GOOD_COMMENT = "这个解释很到位，补充一点自己的经验。"


# --- length rules (§5.4) ----------------------------------------------------


def test_comment_length_bounds():
    too_short = check_content("一二三四五六七", "comment")
    assert not too_short.ok
    assert any("too short" in r for r in too_short.reasons)
    assert check_content("一二三四五六七八", "comment").ok
    assert check_content("字" * 300, "comment").ok
    too_long = check_content("字" * 301, "comment")
    assert not too_long.ok
    assert any("too long" in r for r in too_long.reasons)


def test_post_length_bounds():
    assert not check_content("字" * 19, "post").ok
    assert check_content("字" * 20, "post").ok
    assert check_content("字" * 500, "post").ok
    assert not check_content("字" * 501, "post").ok


def test_empty_content_rejected():
    for bad in ("", "   ", None):
        result = check_content(bad, "comment")
        assert not result.ok
        assert result.reasons == ["empty content"]


def test_unknown_kind_raises():
    with pytest.raises(ValueError):
        check_content(GOOD_COMMENT, "tweet")


# --- slop phrases (§5.4) ------------------------------------------------------

SLOPPY = [
    "同意", "顶", "顶！", "说得好", "非常有道理", "沙发", "学习了", "赞", "+1",
    "great point", "I agree", "well said!", "this", "nice", "so true",
]


@pytest.mark.parametrize("phrase", SLOPPY)
def test_slop_phrases_rejected(phrase):
    result = check_content(phrase, "comment")
    assert not result.ok
    assert any("slop" in r for r in result.reasons)


def test_substantive_content_mentioning_slop_passes():
    text = "说得好，不过我想补充一个反例：上次我在项目里试这个方案就踩过坑。"
    assert check_content(text, "comment").ok
    assert not is_low_effort(text)
    assert is_low_effort("同意")
    assert not is_low_effort("")


def test_legacy_slop_behavior_preserved():
    assert is_slop("我同意")
    assert not is_slop("我同意，但这里有个反例：上次我试的时候发现...")
    # The legacy phrase list is untouched: phrases added for the new gate
    # must not change is_slop.
    assert not is_slop("顶")
    assert not is_slop("this")


# --- near-duplicate bigram overlap (§5.4) -------------------------------------


def test_near_duplicate_rejected():
    existing = ["大模型就是统计机器"]
    dup = check_content("大模型就是统计机器", "comment", existing_contents=existing)
    assert not dup.ok
    assert any("near-duplicate" in r for r in dup.reasons)
    fresh = check_content(GOOD_COMMENT, "comment", existing_contents=existing)
    assert fresh.ok, fresh.reasons


def test_duplicate_threshold_defaults_differ_by_kind():
    existing = ["大模型就是统计机器"]
    candidate = "大模型就是统计萝卜青菜"  # shares exactly 6 bigrams
    as_post = check_content(candidate, "post", existing_contents=existing)
    assert any("near-duplicate" in r for r in as_post.reasons)
    as_comment = check_content(candidate, "comment", existing_contents=existing)
    assert as_comment.ok, as_comment.reasons


def test_duplicate_threshold_override():
    existing = ["大模型就是统计机器"]
    candidate = "大模型就是统计萝卜青菜"  # 6 shared bigrams
    strict = check_content(candidate, "comment", existing_contents=existing, duplicate_threshold=5)
    assert any("near-duplicate" in r for r in strict.reasons)


def test_is_near_duplicate_helper():
    assert is_near_duplicate("大模型就是统计机器", ["大模型就是统计机器"])
    assert not is_near_duplicate("完全不同的内容哦", ["大模型就是统计机器"])
    assert not is_near_duplicate("大模型就是统计机器", [])


# --- stance diversity within a comment set (§5.4) -----------------------------


def test_stance_diversity():
    # Empty set: anything goes.
    assert check_content(GOOD_COMMENT, "comment", stance="support", existing_stances=[]).ok
    # Mono-stance set: same stance blocked, new stance allowed.
    blocked = check_content(GOOD_COMMENT, "comment", stance="support", existing_stances=["support", "support"])
    assert not blocked.ok
    assert any("stance diversity" in r for r in blocked.reasons)
    allowed = check_content(GOOD_COMMENT, "comment", stance="opposing", existing_stances=["support", "support"])
    assert allowed.ok, allowed.reasons
    # Already diverse: any stance allowed.
    assert check_content(GOOD_COMMENT, "comment", stance="support", existing_stances=["support", "opposing"]).ok
    # No stance supplied: rule skipped.
    assert check_content(GOOD_COMMENT, "comment").ok


def test_violates_stance_diversity_helper():
    assert violates_stance_diversity("support", ["support"])
    assert not violates_stance_diversity("opposing", ["support"])
    assert not violates_stance_diversity("support", ["support", "opposing"])
    assert not violates_stance_diversity("support", [])


# --- persona consistency hook (§5.4) -------------------------------------------


def test_persona_hook_default_allows():
    assert check_content(GOOD_COMMENT, "comment").ok


def test_persona_hook_rejects():
    seen = []

    def hook(content: str) -> bool:
        seen.append(content)
        return False

    result = check_content(GOOD_COMMENT, "comment", persona_check=hook)
    assert not result.ok
    assert any("persona" in r for r in result.reasons)
    assert seen == [GOOD_COMMENT]


def test_persona_hook_accepts():
    result = check_content("资料呢？没有来源我先骑墙观望一下。", "comment", persona_check=lambda c: True)
    assert result.ok


# --- check_content result shape ------------------------------------------------


def test_result_shape_and_accumulated_reasons():
    ok_result = check_content(GOOD_COMMENT, "comment")
    assert isinstance(ok_result, QualityResult)
    assert ok_result.ok is True
    assert ok_result.reasons == []

    bad = check_content(
        "同意", "comment",
        stance="support", existing_stances=["support"], persona_check=lambda c: False,
    )
    assert not bad.ok
    assert len(bad.reasons) == 4
    assert any("too short" in r for r in bad.reasons)
    assert any("slop" in r for r in bad.reasons)
    assert any("stance diversity" in r for r in bad.reasons)
    assert any("persona" in r for r in bad.reasons)


# --- check_batch batch policy (§5.2 / §5.4) -------------------------------------


def test_check_batch_pass_rate_boundary_no_retry():
    items = [{"content": c} for c in DISTINCT_COMMENTS[:7]]
    items += [{"content": "顶"}, {"content": "同意"}, {"content": "赞"}]
    report = check_batch(items, "comment")
    assert isinstance(report, BatchReport)
    assert len(report.kept) == 7
    assert len(report.dropped) == 3
    assert report.pass_rate == pytest.approx(BATCH_MIN_PASS_RATE)
    assert report.should_retry_batch is False


def test_check_batch_retry_below_threshold():
    items = [{"content": c} for c in DISTINCT_COMMENTS[:6]]
    items += [{"content": "顶"}, {"content": "同意"}, {"content": "赞"}, {"content": "+1"}]
    report = check_batch(items, "comment")
    assert report.pass_rate == pytest.approx(0.6)
    assert report.should_retry_batch is True


def test_check_batch_empty():
    report = check_batch([], "comment")
    assert report.kept == []
    assert report.dropped == []
    assert report.pass_rate == 1.0
    assert report.should_retry_batch is False


def test_check_batch_accepts_plain_strings():
    report = check_batch([GOOD_COMMENT, "顶"], "comment")
    assert report.kept == [GOOD_COMMENT]
    assert report.dropped == ["顶"]
    assert [r.ok for r in report.results] == [True, False]


def test_check_batch_kept_items_preserve_metadata():
    items = [
        {"content": DISTINCT_COMMENTS[0], "stance": "support", "agent_id": "a1", "relation": "add"},
        {"content": "顶", "stance": "support", "agent_id": "a2", "relation": "add"},
    ]
    report = check_batch(items, "comment")
    assert report.kept == [items[0]]
    assert report.dropped == [items[1]]


def test_check_batch_catches_intra_batch_duplicates():
    text = "这个解释很到位，尤其是类比部分真的帮到我理解了。"
    report = check_batch([text, text], "comment")
    assert report.kept == [text]
    assert report.dropped == [text]
    assert any("near-duplicate" in r for r in report.results[1].reasons)


def test_check_batch_mono_stance_rolling_diversity():
    items = [{"content": c, "stance": "support"} for c in DISTINCT_COMMENTS[:3]]
    report = check_batch(items, "comment")
    assert report.kept == [items[0]]
    assert report.dropped == items[1:]
    assert any("stance diversity" in r for r in report.results[1].reasons)
    assert report.should_retry_batch is True


def test_check_batch_diverse_stances_all_kept():
    stances = ["support", "opposing", "question"]
    items = [{"content": c, "stance": s} for c, s in zip(DISTINCT_COMMENTS[:3], stances)]
    report = check_batch(items, "comment")
    assert len(report.kept) == 3
    assert report.should_retry_batch is False


def test_check_batch_external_context_respected():
    report = check_batch(
        ["大模型就是统计机器"], "comment",
        existing_contents=["大模型就是统计机器"],
    )
    assert report.dropped == ["大模型就是统计机器"]
    assert report.should_retry_batch is True

    items = [{"content": c, "stance": "support"} for c in DISTINCT_COMMENTS[:2]]
    report = check_batch(items, "comment", existing_stances=["support"])
    assert len(report.kept) == 0
    assert report.should_retry_batch is True


def test_check_batch_recovers_diversity_within_batch():
    items = [
        {"content": DISTINCT_COMMENTS[0], "stance": "opposing"},
        {"content": DISTINCT_COMMENTS[1], "stance": "support"},
    ]
    report = check_batch(items, "comment", existing_stances=["support"])
    assert len(report.kept) == 2


def test_check_batch_persona_hook_applies_to_all_items():
    report = check_batch(
        [GOOD_COMMENT, "我有个不同的看法，想反驳一下楼上的观点。"],
        "comment",
        persona_check=lambda c: "反驳" not in c,
    )
    assert report.kept == [GOOD_COMMENT]
    assert len(report.dropped) == 1


def test_check_batch_dict_missing_content_dropped():
    report = check_batch([{"stance": "support"}], "comment")
    assert report.dropped == [{"stance": "support"}]
    assert report.results[0].reasons == ["empty content"]


def test_check_batch_posts_use_post_length_bounds():
    report = check_batch(["一二三四五六七八九十"], "post")  # 10 chars < 20
    assert report.dropped == ["一二三四五六七八九十"]
    assert any("too short" in r for r in report.results[0].reasons)
