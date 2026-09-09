"""Five-signal learning-community recommender (spec section 7).

Signals and weights: interest 30%, popularity 25%, freshness 20%,
diversity 15%, learning value 10%. All scoring functions are pure; the only
database access lives in `_load_candidates`, which opens its own read-only
connection against the spec 3.1 schema and never writes.
"""

import base64
import json
import math
import sqlite3
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib.parse import quote

# Signal weights (spec 7.1)
W_INTEREST = 0.30
W_POPULARITY = 0.25
W_FRESHNESS = 0.20
W_DIVERSITY = 0.15
W_LEARNING = 0.10

# Popularity: (likes - dislikes * 0.8 + comments * 2 + quality bonus) * time decay
POPULARITY_DISLIKE_WEIGHT = 0.8
POPULARITY_COMMENT_WEIGHT = 2.0
QUALITY_BONUS_HOT = 20.0  # quality bonus for posts flagged is_hot by the tick engine
POPULARITY_HALF_LIFE_HOURS = 24.0
POPULARITY_SATURATION = 60.0  # raw value at which the normalized score reaches 0.5

# Freshness: exponential decay, seen posts drop to zero
FRESHNESS_DECAY_HOURS = 18.0

# Diversity: one exploration slot (controversial / question / off-interest) per block
EXPLORATION_EVERY = 5

# Reason tag thresholds (spec 7.3)
NEW_POST_MAX_AGE_HOURS = 24.0
HOT_MIN_COMMENT_COUNT = 5
HOT_MIN_POPULARITY = 0.5

SOURCE_MARKERS = ("http", "www.", "来源", "资料", "论文", "链接", "研究", "文献", "doi")
EXPLAINER_STANCES = {"neutral", "sharing"}
EXPLAINER_MIN_LENGTH = 80


@dataclass
class UserContext:
    """Learner profile fields sent by the frontend (spec 7.1 data sources).

    background / goal / motivation come from onboarding; known_areas and
    avoided_styles are free-form string lists; review_queue entries are either
    concept id strings or {"concept_id", "title"} dicts; preferences mirror
    user_preferences rows: {"preference_type", "target_value", "strength"}.
    """

    background: str = ""
    goal: str = ""
    motivation: str = ""
    known_areas: list[str] = field(default_factory=list)
    avoided_styles: list[str] = field(default_factory=list)
    review_queue: list[Any] = field(default_factory=list)
    current_concept_id: str | None = None
    seen_post_ids: set[str] = field(default_factory=set)
    preferences: list[Any] = field(default_factory=list)


@dataclass
class PostCandidate:
    """One feed candidate with everything the pure scorers need pre-loaded."""

    post_id: str
    world_id: str
    concept_id: str
    agent_id: str | None
    user_id: str | None
    content: str
    stance: str
    heat: int
    is_hot: bool
    created_at: datetime
    author_name: str | None
    author_handle: str | None
    like_count: int
    dislike_count: int
    comment_count: int
    comment_stances: set[str]
    has_delta: bool
    has_qa: bool

    @property
    def has_source(self) -> bool:
        lowered = self.content.lower()
        return any(marker in lowered for marker in SOURCE_MARKERS)

    @property
    def explains_concept(self) -> bool:
        """Heuristic: longer neutral/sharing posts read as concept explainers."""
        return self.stance in EXPLAINER_STANCES and len(self.content) >= EXPLAINER_MIN_LENGTH

    @property
    def is_controversial(self) -> bool:
        if self.like_count >= 3 and self.dislike_count >= max(1, int(self.like_count * 0.25)):
            return True
        return len(self.comment_stances) >= 3

    @property
    def is_newbie_question(self) -> bool:
        return self.stance == "question"


# ---------------------------------------------------------------------------
# Pure scoring helpers
# ---------------------------------------------------------------------------


def parse_time(value: str) -> datetime:
    """Parse the ISO timestamps written by db.now_iso, tolerating a trailing Z."""
    parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed


def _age_hours(post: PostCandidate, now: datetime) -> float:
    return max(0.0, (now - post.created_at).total_seconds() / 3600.0)


def time_decay(age_hours: float, half_life_hours: float = POPULARITY_HALF_LIFE_HOURS) -> float:
    """Exponential half-life decay: 1.0 when fresh, 0.5 after one half-life."""
    return 0.5 ** (max(0.0, age_hours) / half_life_hours)


def popularity_raw(post: PostCandidate, now: datetime) -> float:
    """Spec 7.1 heat formula: engagement balance times time decay."""
    engagement = (
        post.like_count
        - post.dislike_count * POPULARITY_DISLIKE_WEIGHT
        + post.comment_count * POPULARITY_COMMENT_WEIGHT
        + (QUALITY_BONUS_HOT if post.is_hot else 0.0)
    )
    return max(0.0, engagement * time_decay(_age_hours(post, now)))


def popularity_score(post: PostCandidate, now: datetime) -> float:
    """Normalize raw heat to 0..1 with a saturation curve (keeps scoring per-post pure)."""
    raw = popularity_raw(post, now)
    return raw / (raw + POPULARITY_SATURATION) if raw > 0 else 0.0


def freshness_score(post: PostCandidate, user_ctx: UserContext, now: datetime) -> float:
    """Already-seen posts score zero; new posts decay smoothly with age."""
    if post.post_id in user_ctx.seen_post_ids:
        return 0.0
    return math.exp(-_age_hours(post, now) / FRESHNESS_DECAY_HOURS)


def learning_value_score(post: PostCandidate, user_ctx: UserContext) -> float:
    """Reward concept explainers, sourced posts, Q&A threads and delta moments."""
    score = 0.0
    if post.explains_concept:
        score += 0.25
    if post.has_source:
        score += 0.25
    if post.has_qa:
        score += 0.25
    if post.has_delta:
        score += 0.35
    return min(1.0, score)


def _bigrams(text: str) -> set[str]:
    chars = [c for c in text.lower() if not c.isspace()]
    return {"".join(chars[i : i + 2]) for i in range(len(chars) - 1)}


def _pref_parts(pref: Any) -> tuple[str, str, float]:
    """Accept user_preferences-shaped dicts or objects."""
    if isinstance(pref, dict):
        return (
            str(pref.get("preference_type", "")),
            str(pref.get("target_value", "")),
            float(pref.get("strength", 1.0)),
        )
    return (
        str(getattr(pref, "preference_type", "")),
        str(getattr(pref, "target_value", "")),
        float(getattr(pref, "strength", 1.0)),
    )


def followed_author_names(user_ctx: UserContext) -> set[str]:
    """Author identifiers (agent_id / handle / display_name) the user asked more of."""
    names: set[str] = set()
    for pref in user_ctx.preferences:
        pref_type, target, _ = _pref_parts(pref)
        if pref_type == "like_author" and target:
            names.add(target)
    return names


def _review_concepts(user_ctx: UserContext) -> dict[str, str]:
    """Normalize review_queue into a concept_id -> title map."""
    concepts: dict[str, str] = {}
    for entry in user_ctx.review_queue:
        if isinstance(entry, dict):
            concept_id = str(entry.get("concept_id", ""))
            if concept_id:
                concepts[concept_id] = str(entry.get("title") or concept_id)
        else:
            concepts[str(entry)] = str(entry)
    return concepts


def interest_score(post: PostCandidate, user_ctx: UserContext) -> float:
    """Match against current concept, review queue, profile keywords and preferences."""
    score = 0.0
    if user_ctx.current_concept_id and post.concept_id == user_ctx.current_concept_id:
        score += 0.50
    if post.concept_id in _review_concepts(user_ctx):
        score += 0.35

    profile_text = " ".join(
        [user_ctx.background, user_ctx.goal, user_ctx.motivation, *user_ctx.known_areas]
    )
    if profile_text.strip() and post.content:
        overlap = _bigrams(post.content) & _bigrams(profile_text)
        score += 0.30 * min(1.0, len(overlap) / 8.0)

    penalty = 0.0
    for style in user_ctx.avoided_styles:
        if style and (style == post.stance or style in post.content):
            penalty += 0.25
    for pref in user_ctx.preferences:
        pref_type, target, strength = _pref_parts(pref)
        if not target:
            continue
        if pref_type == "like_topic" and (target in post.content or target == post.concept_id):
            score += 0.20 * strength
        elif pref_type == "dislike_topic" and (target in post.content or target == post.concept_id):
            penalty += 0.30 * strength
        elif pref_type == "like_author" and target in {
            post.agent_id,
            post.author_handle,
            post.author_name,
        }:
            score += 0.25 * strength
        elif pref_type == "dislike_stance" and target == post.stance:
            penalty += 0.30 * strength
    return min(1.0, max(0.0, score - min(0.5, penalty)))


def diversity_score(post: PostCandidate, placed: list[PostCandidate]) -> float:
    """1.0 for a fresh voice, penalized for repeating the last author or stance run."""
    if not placed:
        return 1.0
    score = 1.0
    last = placed[-1]
    if post.agent_id and last.agent_id and post.agent_id == last.agent_id:
        score -= 0.6
    if post.agent_id and any(p.agent_id == post.agent_id for p in placed[-3:-1]):
        score -= 0.2
    if len(placed) >= 2 and placed[-2].stance == last.stance == post.stance:
        score -= 0.4
    return max(0.0, score)


def combined_base_score(post: PostCandidate, user_ctx: UserContext, now: datetime) -> float:
    """Weighted sum of the four order-independent signals (diversity applies later)."""
    return (
        W_INTEREST * interest_score(post, user_ctx)
        + W_POPULARITY * popularity_score(post, now)
        + W_FRESHNESS * freshness_score(post, user_ctx, now)
        + W_LEARNING * learning_value_score(post, user_ctx)
    )


# ---------------------------------------------------------------------------
# Data loading (read-only, own connection, spec 3.1 schema)
# ---------------------------------------------------------------------------


def _connect_read_only(db_path: Path) -> sqlite3.Connection:
    """Open a read-only connection; quote() keeps paths with spaces valid URIs."""
    return sqlite3.connect(f"file:{quote(str(db_path))}?mode=ro", uri=True)


def _load_candidates(db_path: Path, world_id: str) -> list[PostCandidate]:
    conn = _connect_read_only(db_path)
    conn.row_factory = sqlite3.Row
    try:
        rows = conn.execute(
            """
            SELECT p.post_id, p.world_id, p.concept_id, p.agent_id, p.user_id,
                   p.content, p.stance, p.heat, p.is_hot, p.created_at,
                   a.display_name AS author_name, a.handle AS author_handle,
                   (SELECT COUNT(*) FROM reactions r
                     WHERE r.target_type = 'post' AND r.target_id = p.post_id
                       AND r.reaction_type = 'like') AS like_count,
                   (SELECT COUNT(*) FROM reactions r
                     WHERE r.target_type = 'post' AND r.target_id = p.post_id
                       AND r.reaction_type = 'dislike') AS dislike_count,
                   (SELECT COUNT(*) FROM comments c WHERE c.post_id = p.post_id) AS comment_count
            FROM posts p
            LEFT JOIN agents a ON p.agent_id = a.agent_id
            WHERE p.world_id = ?
            """,
            (world_id,),
        ).fetchall()

        stance_rows = conn.execute(
            """
            SELECT c.post_id, c.stance FROM comments c
            JOIN posts p ON c.post_id = p.post_id
            WHERE p.world_id = ?
            """,
            (world_id,),
        ).fetchall()
        stances_by_post: dict[str, set[str]] = {}
        for row in stance_rows:
            stances_by_post.setdefault(row["post_id"], set()).add(row["stance"])

        # Delta moments: stance flips recorded by the belief engine (spec 3.2).
        delta_posts: set[str] = set()
        delta_pairs: set[tuple[str, str]] = set()
        for row in conn.execute(
            "SELECT payload_json FROM events WHERE world_id = ? AND action = 'delta'",
            (world_id,),
        ):
            try:
                payload = json.loads(row["payload_json"])
            except (TypeError, json.JSONDecodeError):
                continue
            if payload.get("post_id"):
                delta_posts.add(str(payload["post_id"]))
            if payload.get("agent_id") and payload.get("concept_id"):
                delta_pairs.add((str(payload["agent_id"]), str(payload["concept_id"])))

        # Q&A: a follow-up question comment that received an answer.
        qa_posts = {
            row["post_id"]
            for row in conn.execute(
                """
                SELECT DISTINCT c1.post_id FROM comments c1
                JOIN comments c2 ON c2.parent_comment_id = c1.comment_id
                JOIN posts p ON c1.post_id = p.post_id
                WHERE p.world_id = ? AND c1.relation = '追问'
                """,
                (world_id,),
            )
        }
    finally:
        conn.close()

    candidates = []
    for row in rows:
        candidates.append(
            PostCandidate(
                post_id=row["post_id"],
                world_id=row["world_id"],
                concept_id=row["concept_id"],
                agent_id=row["agent_id"],
                user_id=row["user_id"],
                content=row["content"],
                stance=row["stance"],
                heat=row["heat"],
                is_hot=bool(row["is_hot"]),
                created_at=parse_time(row["created_at"]),
                author_name=row["author_name"],
                author_handle=row["author_handle"],
                like_count=row["like_count"],
                dislike_count=row["dislike_count"],
                comment_count=row["comment_count"],
                comment_stances=stances_by_post.get(row["post_id"], set()),
                has_delta=row["post_id"] in delta_posts
                or (row["agent_id"], row["concept_id"]) in delta_pairs,
                has_qa=row["post_id"] in qa_posts
                or (row["stance"] == "question" and row["comment_count"] > 0),
            )
        )
    return candidates


# ---------------------------------------------------------------------------
# Diversity rerank (spec 7.1: no author twice in a row, no stance 3x in a row,
# proportional injection of controversial / newbie / exploration posts)
# ---------------------------------------------------------------------------


def _is_exploration(post: PostCandidate, user_ctx: UserContext) -> bool:
    return (
        post.is_controversial
        or post.is_newbie_question
        or interest_score(post, user_ctx) < 0.2
    )


def rerank_with_diversity(
    scored: list[tuple[PostCandidate, float]], user_ctx: UserContext
) -> list[PostCandidate]:
    """Greedily pick the best base score plus diversity bonus, one slot at a time."""
    remaining = list(scored)
    placed: list[PostCandidate] = []
    while remaining:
        pool = remaining
        if len(placed) % EXPLORATION_EVERY == EXPLORATION_EVERY - 1:
            exploration = [item for item in remaining if _is_exploration(item[0], user_ctx)]
            if exploration:
                pool = exploration
        best = max(
            pool,
            key=lambda item: (
                item[1] + W_DIVERSITY * diversity_score(item[0], placed),
                item[1],
                item[0].post_id,
            ),
        )
        placed.append(best[0])
        remaining.remove(best)
    return _repair_adjacency(placed)


def _clashes(items: list[PostCandidate], i: int) -> bool:
    """Check the hard adjacency rules at position i against its predecessors."""
    current = items[i]
    prev = items[i - 1]
    if current.agent_id and prev.agent_id and current.agent_id == prev.agent_id:
        return True
    if i >= 2 and items[i - 2].stance == prev.stance == current.stance:
        return True
    return False


def _repair_adjacency(placed: list[PostCandidate]) -> list[PostCandidate]:
    """Swap later items forward until the hard adjacency rules hold."""
    items = list(placed)
    for _ in range(len(items) * len(items)):
        violation = next((i for i in range(1, len(items)) if _clashes(items, i)), None)
        if violation is None:
            break
        fixed = False
        for j in range(violation + 1, len(items)):
            items[violation], items[j] = items[j], items[violation]
            if not _clashes(items, violation) and not _clashes(items, j):
                fixed = True
                break
            items[violation], items[j] = items[j], items[violation]
        if not fixed:
            break
    return items


# ---------------------------------------------------------------------------
# Reason tags (spec 7.3)
# ---------------------------------------------------------------------------


def _age_text(age_hours: float) -> str:
    if age_hours < 1:
        return f"{max(1, int(age_hours * 60))} 分钟"
    if age_hours < 24:
        return f"{int(age_hours)} 小时"
    return f"{int(age_hours // 24)} 天"


def reason_for_post(
    post: PostCandidate, user_ctx: UserContext, now: datetime, popularity: float
) -> tuple[str, str]:
    """Pick the single most salient recommendation reason: (label text, code)."""
    followed = followed_author_names(user_ctx)
    if post.agent_id and {post.agent_id, post.author_handle, post.author_name} & followed:
        return f"👤 来自你关注的 {post.author_name or post.author_handle}", "followed_author"
    if user_ctx.current_concept_id and post.concept_id == user_ctx.current_concept_id:
        return f"🎯 和你正在学的“{post.concept_id}”相关", "concept"
    review = _review_concepts(user_ctx)
    if post.concept_id in review:
        return f"🔄 复习一下“{review[post.concept_id]}”", "review"
    if post.is_hot or (popularity >= HOT_MIN_POPULARITY and post.comment_count >= HOT_MIN_COMMENT_COUNT):
        return "🔥 热帖 · 讨论很激烈", "hot"
    age = _age_hours(post, now)
    if age < NEW_POST_MAX_AGE_HOURS:
        return f"🆕 新帖 · 刚发 {_age_text(age)}", "new"
    if post.comment_count >= HOT_MIN_COMMENT_COUNT:
        return "🔥 热帖 · 讨论很激烈", "hot"
    return f"🆕 新帖 · 刚发 {_age_text(age)}", "new"


# ---------------------------------------------------------------------------
# Cursor paging: the first page pins `as_of` so later pages re-rank the same
# snapshot deterministically (spec 7.2: recompute every 10 posts, no repeats)
# ---------------------------------------------------------------------------


def _encode_cursor(offset: int, as_of: datetime) -> str:
    payload = json.dumps({"offset": offset, "as_of": as_of.isoformat()})
    return base64.urlsafe_b64encode(payload.encode()).decode()


def _decode_cursor(cursor: str) -> tuple[int, datetime]:
    payload = json.loads(base64.urlsafe_b64decode(cursor.encode()).decode())
    return int(payload["offset"]), parse_time(str(payload["as_of"]))


# ---------------------------------------------------------------------------
# Feed assembly
# ---------------------------------------------------------------------------


def get_feed(
    db_path: Path,
    world_id: str,
    user_ctx: UserContext | None = None,
    limit: int = 10,
    cursor: str | None = None,
    now: datetime | None = None,
) -> dict[str, Any] | None:
    """Rank one world of posts for the learner and return one page.

    Returns None when the world does not exist. Each post carries a `reason`
    label (spec 7.3) and a `signals` breakdown of the four scored signals.
    """
    user_ctx = user_ctx or UserContext()
    if cursor:
        offset, as_of = _decode_cursor(cursor)
    else:
        offset, as_of = 0, now or datetime.now(timezone.utc)

    conn = _connect_read_only(db_path)
    try:
        world = conn.execute(
            "SELECT world_id FROM worlds WHERE world_id = ?", (world_id,)
        ).fetchone()
    finally:
        conn.close()
    if not world:
        return None

    candidates = _load_candidates(db_path, world_id)
    unseen = [c for c in candidates if c.post_id not in user_ctx.seen_post_ids]

    scored = [(c, combined_base_score(c, user_ctx, as_of)) for c in unseen]
    ranked = rerank_with_diversity(scored, user_ctx)

    page = ranked[offset : offset + limit]
    posts = []
    for post in page:
        popularity = popularity_score(post, as_of)
        label, code = reason_for_post(post, user_ctx, as_of, popularity)
        posts.append(
            {
                "post_id": post.post_id,
                "concept_id": post.concept_id,
                "agent_id": post.agent_id,
                "user_id": post.user_id,
                "author": (
                    {"display_name": post.author_name, "handle": post.author_handle}
                    if post.agent_id
                    else None
                ),
                "content": post.content,
                "stance": post.stance,
                "heat": post.heat,
                "is_hot": post.is_hot,
                "comment_count": post.comment_count,
                "like_count": post.like_count,
                "dislike_count": post.dislike_count,
                "created_at": post.created_at.isoformat(),
                "score": round(combined_base_score(post, user_ctx, as_of), 4),
                "reason": label,
                "reason_code": code,
                "signals": {
                    "interest": round(interest_score(post, user_ctx), 4),
                    "popularity": round(popularity, 4),
                    "freshness": round(freshness_score(post, user_ctx, as_of), 4),
                    "learning": round(learning_value_score(post, user_ctx), 4),
                },
            }
        )

    next_offset = offset + limit
    return {
        "world_id": world_id,
        "posts": posts,
        "next_cursor": _encode_cursor(next_offset, as_of) if next_offset < len(ranked) else None,
    }
