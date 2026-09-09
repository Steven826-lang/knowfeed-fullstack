"""Lightweight quality gates for generated content."""

import re
import sqlite3
from collections.abc import Callable, Iterable
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

SLOP_PHRASES = [
    "我同意", "说得好", "非常有道理", "完全赞同", "不错的观点",
    "interesting", "great point", "i agree", "well said",
]


def is_slop(content: str) -> bool:
    lowered = content.lower().strip()
    if len(lowered) >= 40:
        return False
    for phrase in SLOP_PHRASES:
        if re.match(rf"{re.escape(phrase)}\s*[^\w\s]?$", lowered):
            return True
    return False


def has_substance(content: str) -> bool:
    return len(content.strip()) >= 8


def is_duplicate(db_path: Path, concept_id: str, content: str, threshold: int = 5, post_id: str | None = None) -> bool:
    """Reject exact or near-exact repeats within the same concept.

    For posts, check against all posts and comments in the concept.
    For comments, only check against other comments on the same post and use a
    higher similarity threshold so legitimate replies are not blocked.
    """
    conn = sqlite3.connect(db_path)
    try:
        if post_id is None:
            existing = conn.execute(
                "SELECT content FROM posts WHERE concept_id = ? UNION ALL SELECT c.content FROM comments c JOIN posts p ON c.post_id = p.post_id WHERE p.concept_id = ?",
                (concept_id, concept_id),
            ).fetchall()
        else:
            existing = conn.execute(
                "SELECT content FROM comments WHERE post_id = ?",
                (post_id,),
            ).fetchall()
    finally:
        conn.close()
    effective_threshold = 8 if post_id else threshold
    for (existing_content,) in existing:
        # Count shared bigrams as a cheap similarity metric
        a = set(ngrams(content, 2))
        b = set(ngrams(existing_content, 2))
        if len(a & b) >= effective_threshold and len(a) > 0:
            return True
    return False


def ngrams(text: str, n: int = 2) -> list[tuple[str, ...]]:
    chars = list(text)
    return [tuple(chars[i:i + n]) for i in range(len(chars) - n + 1)]


def lacks_viewpoint_diversity(db_path: Path, concept_id: str, new_stance: str, min_stances: int = 2) -> bool:
    """Require at least two distinct stances among recent posts for a concept."""
    conn = sqlite3.connect(db_path)
    try:
        rows = conn.execute(
            "SELECT stance FROM posts WHERE concept_id = ? ORDER BY created_at DESC LIMIT 10",
            (concept_id,),
        ).fetchall()
    finally:
        conn.close()
    stances = {r[0] for r in rows}
    if len(stances) >= min_stances:
        return False
    return new_stance in stances


def passes_gate(db_path: Path, concept_id: str, content: str, stance: str, post_id: str | None = None) -> bool:
    return (
        has_substance(content)
        and not is_slop(content)
        and not is_duplicate(db_path, concept_id, content, post_id=post_id)
        and not lacks_viewpoint_diversity(db_path, concept_id, stance)
    )


# ---------------------------------------------------------------------------
# §5.4 quality gate: check_content / check_batch
#
# Pure, DB-free gates used by the batch comment-tree generator and tick
# pipeline. The DB-backed gates above (passes_gate & friends) are kept for
# the existing scheduler; new code should prefer check_content / check_batch.
# ---------------------------------------------------------------------------

# Extended low-effort phrase library (Chinese + English). A piece of content
# whose entire body is one of these phrases (plus trailing punctuation)
# carries no substance; substantive content merely containing a phrase passes.
EXTENDED_SLOP_PHRASES = SLOP_PHRASES + [
    "同意", "顶", "顶一个", "顶楼主", "有道理", "赞同", "支持", "赞", "点赞",
    "沙发", "前排", "学习了", "涨姿势", "涨姿势了", "马克", "码住", "马住",
    "同感", "确实", "没错", "楼主说得对", "说得太好了", "+1", "666",
    "nice", "agree", "agreed", "this", "lol", "first", "bump",
    "good point", "so true", "cool", "awesome", "thanks for sharing",
]

COMMENT_MIN_LEN = 8
COMMENT_MAX_LEN = 300
POST_MIN_LEN = 20
POST_MAX_LEN = 500
BATCH_MIN_PASS_RATE = 0.70

# Near-duplicate thresholds mirror is_duplicate: comments legitimately share
# bigrams with their siblings, so they get a looser bound than posts.
POST_DUPLICATE_THRESHOLD = 5
COMMENT_DUPLICATE_THRESHOLD = 8


@dataclass
class QualityResult:
    """Outcome of gating a single piece of content."""

    ok: bool
    reasons: list[str]


@dataclass
class BatchReport:
    """Outcome of gating a generated batch.

    `results` aligns with the input order (kept and dropped) so callers can
    inspect why each item was rejected.
    """

    kept: list[Any]
    dropped: list[Any]
    pass_rate: float
    should_retry_batch: bool
    results: list[QualityResult] = field(default_factory=list)


def length_bounds(kind: str) -> tuple[int, int]:
    """Inclusive (min, max) character bounds per §5.4."""
    if kind == "comment":
        return COMMENT_MIN_LEN, COMMENT_MAX_LEN
    if kind == "post":
        return POST_MIN_LEN, POST_MAX_LEN
    raise ValueError(f"unknown content kind: {kind!r}")


def is_low_effort(content: str) -> bool:
    """True when the whole content is just a low-effort phrase (§5.4 slop rule)."""
    lowered = content.lower().strip()
    if not lowered:
        return False
    return any(
        re.fullmatch(rf"{re.escape(phrase)}[^\w\s]*", lowered)
        for phrase in EXTENDED_SLOP_PHRASES
    )


def _normalize(text: str) -> str:
    return " ".join(text.lower().split())


def _max_shared_bigrams(content: str, existing_contents: Iterable[str]) -> int:
    a = set(ngrams(_normalize(content), 2))
    if not a:
        return 0
    best = 0
    for other in existing_contents:
        shared = len(a & set(ngrams(_normalize(other), 2)))
        best = max(best, shared)
    return best


def is_near_duplicate(content: str, existing_contents: Iterable[str], threshold: int = POST_DUPLICATE_THRESHOLD) -> bool:
    """Pure bigram-overlap duplicate check against an in-memory corpus."""
    return _max_shared_bigrams(content, existing_contents) >= threshold


def violates_stance_diversity(stance: str, existing_stances: Iterable[str], min_stances: int = 2) -> bool:
    """True when adding `stance` would leave the comment set mono-stance."""
    distinct = {s for s in existing_stances if s}
    if len(distinct) >= min_stances:
        return False
    return stance in distinct


def check_content(
    content: str,
    kind: str,
    *,
    stance: str | None = None,
    existing_contents: Iterable[str] = (),
    existing_stances: Iterable[str] = (),
    persona_check: Callable[[str], bool] | None = None,
    duplicate_threshold: int | None = None,
) -> QualityResult:
    """Run the §5.4 quality gate on a single piece of generated content.

    Always applied: length bounds and the extended slop filter. Applied when
    context is supplied: near-duplicate bigram overlap (`existing_contents`),
    stance diversity (`stance` + `existing_stances`), and persona consistency
    (`persona_check`, a caller-injected hook returning True when the content
    fits the agent persona; default allows everything).
    """
    min_len, max_len = length_bounds(kind)  # raises ValueError on unknown kind
    if not isinstance(content, str) or not content.strip():
        return QualityResult(ok=False, reasons=["empty content"])
    text = content.strip()
    reasons: list[str] = []

    n = len(text)
    if n < min_len:
        reasons.append(f"too short: {kind} length {n} < {min_len}")
    if n > max_len:
        reasons.append(f"too long: {kind} length {n} > {max_len}")
    if is_low_effort(text):
        reasons.append("slop: content is only a low-effort phrase")

    threshold = duplicate_threshold
    if threshold is None:
        threshold = COMMENT_DUPLICATE_THRESHOLD if kind == "comment" else POST_DUPLICATE_THRESHOLD
    shared = _max_shared_bigrams(text, existing_contents)
    if shared >= threshold:
        reasons.append(f"near-duplicate: shares {shared} bigrams with existing content (>= {threshold})")

    if stance and violates_stance_diversity(stance, existing_stances):
        reasons.append(f"stance diversity: stance {stance!r} would keep the comment set mono-stance")

    if persona_check is not None and not persona_check(text):
        reasons.append("persona inconsistency: rejected by persona hook")

    return QualityResult(ok=not reasons, reasons=reasons)


def check_batch(
    items: list[Any],
    kind: str,
    *,
    existing_contents: Iterable[str] = (),
    existing_stances: Iterable[str] = (),
    persona_check: Callable[[str], bool] | None = None,
    duplicate_threshold: int | None = None,
) -> BatchReport:
    """Gate a generated batch (e.g. a comment tree) per §5.2 / §5.4.

    Each item is a content string or a dict with a "content" key (optional
    "stance"). Failing items are dropped as-is, with no per-item retry; kept
    items join the rolling duplicate corpus and stance set, so intra-batch
    repeats and mono-stance batches are caught as well. `should_retry_batch`
    is True when the pass rate falls below 70%, signalling the caller to
    regenerate once with a different persona set.
    """
    kept: list[Any] = []
    dropped: list[Any] = []
    results: list[QualityResult] = []
    corpus = list(existing_contents)
    stances = list(existing_stances)
    for item in items:
        content = item.get("content") if isinstance(item, dict) else item
        stance = item.get("stance") if isinstance(item, dict) else None
        result = check_content(
            content,
            kind,
            stance=stance,
            existing_contents=corpus,
            existing_stances=stances,
            persona_check=persona_check,
            duplicate_threshold=duplicate_threshold,
        )
        results.append(result)
        if result.ok:
            kept.append(item)
            corpus.append(content)
            if stance:
                stances.append(stance)
        else:
            dropped.append(item)
    pass_rate = len(kept) / len(items) if items else 1.0
    return BatchReport(
        kept=kept,
        dropped=dropped,
        pass_rate=pass_rate,
        should_retry_batch=pass_rate < BATCH_MIN_PASS_RATE,
        results=results,
    )
