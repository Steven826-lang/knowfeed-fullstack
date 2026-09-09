"""World initialization: historical content backfill (spec §5.1/§6.4/§12).

One-shot fill that makes a freshly created world look like it has been
alive for days: build the agent roster, draft 8-12 historical posts in a
single LLM call, grow a full batch comment tree per post (spec §5.2,
historical backfill only — never for live user interaction), backdate
everything across the past 2-3 days, sprinkle like reactions, and mark the
head posts hot/active.

Idempotent: a world that already has posts is left untouched and the
current counts are returned instead.
"""

import asyncio
import json
import os
import random
import re
import sqlite3
import uuid
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

import httpx

import agent_manager
import quality
from content_generator import (
    STANCES,
    ContentGenerationError,
    generate_comment_tree,
)
from db import init_db, now_iso
from llm import base_url
from personas import Persona

MIN_POSTS = 8                  # spec §13: 初始化历史帖 8–12 个
MAX_POSTS = 12

POST_MIN_HOURS_AGO = 26.0      # posts must predate their comment trees
POST_MAX_HOURS_AGO = 96.0
COMMENT_MIN_HOURS_AGO = 0.5    # backfill window: the past 2-3 days
COMMENT_MAX_HOURS_AGO = 72.0

MAX_POST_LIKES = 300
HEAT_PER_LIKE = 12             # mirrors actions._recalc_heat
HOT_FRACTION = 0.3             # top 30% of posts (min 1) get is_hot
ACTIVE_TAIL = 2                # newest posts stay 'active', rest 'historical'
MAX_DEPTH = 3                  # spec §13: 评论嵌套深度 ≤ 3 层


@dataclass
class InitResult:
    """Outcome of one initialize_world call (or current state when skipped)."""

    world_id: str
    agents_created: int
    posts_created: int
    comments_created: int


@dataclass
class PostDraft:
    """One validated historical post from the drafting LLM call."""

    agent_id: str
    concept_id: str
    content: str
    stance: str
    likes: int
    hours_ago: float


def needs_initialization(db_path: Path, world_id: str) -> bool:
    """True while the world has no posts yet (historical fill not done)."""
    conn = sqlite3.connect(db_path)
    try:
        tables = {
            row[0]
            for row in conn.execute("SELECT name FROM sqlite_master WHERE type='table'")
        }
        if "posts" not in tables:
            return True
        row = conn.execute(
            "SELECT COUNT(*) FROM posts WHERE world_id = ?", (world_id,)
        ).fetchone()
        return row[0] == 0
    finally:
        conn.close()


async def initialize_world(
    db_path: Path,
    world_id: str,
    topic: str,
    concept_ids: list[str],
    *,
    posts_count: int = 10,
    agent_count: int = 28,
    rng: random.Random | None = None,
) -> InitResult:
    """Backfill a world's history: roster, posts, comment trees, reactions.

    Flow: build_world_roster -> one LLM call drafting 8-12 posts -> one
    generate_comment_tree call per post -> backdate and persist everything
    -> mark head posts hot/active -> refresh agent counters and karma.
    Idempotent: when the world already has posts, no LLM call is made and
    the existing counts are returned.
    """
    rng = rng or random.Random()
    if not needs_initialization(db_path, world_id):
        return _current_counts(db_path, world_id)
    init_db(db_path)  # self-sufficient on a bare database file

    roster = agent_manager.build_world_roster(
        db_path, world_id, topic, list(concept_ids), count=agent_count, rng=rng
    )
    personas = [Persona(**agent["persona"]) for agent in roster]
    roster_ids = [agent["agent_id"] for agent in roster]

    concept_ids = list(concept_ids) or ["general"]
    posts_count = max(MIN_POSTS, min(MAX_POSTS, posts_count))
    drafts = await _generate_historical_posts(topic, concept_ids, personas, posts_count)

    # Generate every comment tree before touching the database, so no
    # connection is held across awaits.
    bundles: list[tuple[PostDraft, Any]] = []
    for draft in drafts:
        try:
            tree = await generate_comment_tree(
                draft.content, topic, draft.concept_id, personas, rng=rng
            )
        except ContentGenerationError:
            tree = None  # a post without comments is still a valid seed
        bundles.append((draft, tree))

    now = datetime.now(timezone.utc)
    comments_total = 0
    with sqlite3.connect(db_path) as conn:
        for draft, tree in bundles:
            comments_total += _insert_post_bundle(
                conn, world_id, draft, tree, roster_ids, now, rng
            )
        _finalize_posts(conn, world_id)
        _update_agent_counters(conn, world_id)
        _touch_world(conn, world_id)
        _log_init_event(conn, world_id, len(roster), len(bundles), comments_total)

    return InitResult(
        world_id=world_id,
        agents_created=len(roster),
        posts_created=len(bundles),
        comments_created=comments_total,
    )


# ---------------------------------------------------------------------------
# Historical post drafting (one LLM call for the whole batch)
# ---------------------------------------------------------------------------


async def _generate_historical_posts(
    topic: str,
    concept_ids: list[str],
    personas: list[Persona],
    count: int,
    model: str | None = None,
) -> list[PostDraft]:
    """Draft `count` posts in one call, gate them, retry once like spec §5.2.

    Posts are dropped individually when they fail the quality gate; a batch
    below the 70% pass rate is regenerated once, then accepted as-is — never
    padded with filler to hit the count.
    """
    try:
        drafts = await _draft_posts_once(topic, concept_ids, personas, count, model)
    except ContentGenerationError:
        drafts = await _draft_posts_once(topic, concept_ids, personas, count, model)
    report = quality.check_batch(
        [{"content": d.content, "stance": d.stance} for d in drafts], "post"
    )
    if report.should_retry_batch:
        drafts = await _draft_posts_once(topic, concept_ids, personas, count, model)
        report = quality.check_batch(
            [{"content": d.content, "stance": d.stance} for d in drafts], "post"
        )
    kept = {item["content"] for item in report.kept}
    return [d for d in drafts if d.content in kept][:count]


async def _draft_posts_once(
    topic: str,
    concept_ids: list[str],
    personas: list[Persona],
    count: int,
    model: str | None,
) -> list[PostDraft]:
    messages = build_post_messages(topic, concept_ids, personas, count)
    raw = await _post_messages(messages, temperature=0.9, model=model)
    return parse_posts(raw, personas, concept_ids)


def build_post_messages(
    topic: str,
    concept_ids: list[str],
    personas: list[Persona],
    count: int,
) -> list[dict[str, str]]:
    """Chinese prompt per spec §4.2/§5.1: the whole history in one call."""
    system = (
        "你是一个学习社区的内容导演，负责为一个新建的学习社区编排一批真实自然的历史帖子。\n"
        "核心原则：\n"
        "- 帖子要有原创想法：个人经历、真实疑问、资料整理或明确观点，禁止灌水。\n"
        "- 立场要多样：支持、反对、中立、提问、分享都要覆盖到。\n"
        "- 每个 agent 的语气、口头禅、关心角度必须严格符合其人设。\n"
        "- 只输出 JSON，不要输出任何解释。"
    )
    concepts = "\n".join(f"- {cid}" for cid in concept_ids)
    roster = "\n".join(_persona_line(p) for p in personas)
    stances = " / ".join(STANCES)
    user = f"""主题：{topic}
可选概念（concept_id 必须从这个列表里选）：
{concepts}

社区 agent 名单（agent_id 必须从这个名单里选）：
{roster}

请生成 {count} 个历史帖子，要求：
- 分配给不同的 agent，每个 agent 最多两帖。
- 每帖挂一个上面列表里的 concept_id。
- stance 覆盖多种立场，不允许全是同一立场。
- 帖子用中文，20–500 字，像真实 Reddit 网友发的帖：可以有背景、经历、疑问、资料整理或吐槽。
- likes 为预计点赞数（5–200）。
- hours_ago 为发帖时间距现在的小时数（26–96，可带小数），老帖可以更早。

严格按以下 JSON 结构输出（不要加 markdown 代码围栏）：
{{"posts": [
  {{"id": "p1", "agent_id": "...", "concept_id": "...", "content": "...", "stance": "question", "likes": 42, "hours_ago": 60}}
]}}
stance 只能是：{stances}。"""
    return [
        {"role": "system", "content": system},
        {"role": "user", "content": user},
    ]


def _persona_line(persona: Persona) -> str:
    traits = "/".join(persona.traits) if isinstance(persona.traits, list) else str(persona.traits)
    return (
        f"- agent_id={persona.agent_id} | {persona.display_name} (@{persona.handle}) | "
        f"{persona.role} | 语气：{persona.voice} | 性格：{traits} | "
        f"关心：{persona.concern} | 习惯：{persona.habit} | 口头禅：{persona.catchphrase}"
    )


def parse_posts(
    raw: str,
    personas: list[Persona],
    concept_ids: list[str],
) -> list[PostDraft]:
    """Parse and validate the LLM JSON output into PostDrafts.

    Drops structurally invalid entries (unknown agent or concept, empty
    content), normalizes stance and clamps likes / hours_ago. Raises
    ContentGenerationError when nothing usable remains.
    """
    data = _extract_json(raw)
    items = data.get("posts") if isinstance(data, dict) else data
    if not isinstance(items, list):
        raise ContentGenerationError("LLM output has no post list")

    valid_agents = {p.agent_id for p in personas}
    valid_concepts = set(concept_ids)
    drafts: list[PostDraft] = []
    for item in items:
        if not isinstance(item, dict):
            continue
        content = item.get("content")
        agent_id = item.get("agent_id")
        concept_id = item.get("concept_id")
        if not isinstance(content, str) or not content.strip():
            continue
        if agent_id not in valid_agents or concept_id not in valid_concepts:
            continue
        drafts.append(PostDraft(
            agent_id=agent_id,
            concept_id=concept_id,
            content=content.strip(),
            stance=item.get("stance") if item.get("stance") in STANCES else "neutral",
            likes=_clamp_int(item.get("likes"), 0, MAX_POST_LIKES, default=10),
            hours_ago=_clamp_float(
                item.get("hours_ago"), POST_MIN_HOURS_AGO, POST_MAX_HOURS_AGO, default=72.0
            ),
        ))
    if not drafts:
        raise ContentGenerationError("no valid posts in LLM output")
    return drafts


# ---------------------------------------------------------------------------
# Persistence
# ---------------------------------------------------------------------------


def _insert_post_bundle(
    conn: sqlite3.Connection,
    world_id: str,
    draft: PostDraft,
    tree: Any,
    roster_ids: list[str],
    now: datetime,
    rng: random.Random,
) -> int:
    """Insert one post plus its comment tree and reactions. Returns #comments."""
    post_id = str(uuid.uuid4())
    comments = list(tree.comments) if tree is not None else []
    if comments:
        _relink(comments)  # re-derive paths so drops by the gate stay consistent

    # The post must be older than every comment in its tree.
    max_comment_offset = max((c.time_offset_seconds for c in comments), default=0)
    post_offset = max(int(draft.hours_ago * 3600), max_comment_offset + 3600)
    post_created = now - timedelta(seconds=post_offset)
    conn.execute(
        """
        INSERT INTO posts (post_id, world_id, concept_id, agent_id, content, stance,
                           post_status, is_hot, comment_count, heat, created_at)
        VALUES (?, ?, ?, ?, ?, ?, 'historical', 0, ?, ?, ?)
        """,
        (
            post_id, world_id, draft.concept_id, draft.agent_id, draft.content,
            draft.stance, len(comments), draft.likes * HEAT_PER_LIKE,
            post_created.isoformat(),
        ),
    )
    _sprinkle_reactions(
        conn, "post", post_id, draft.agent_id, draft.likes, post_created, roster_ids, now, rng
    )

    id_map = {c.comment_id: str(uuid.uuid4()) for c in comments}
    for c in comments:
        offset = max(
            int(COMMENT_MIN_HOURS_AGO * 3600),
            min(int(COMMENT_MAX_HOURS_AGO * 3600), c.time_offset_seconds),
        )
        created = now - timedelta(seconds=offset)
        comment_uuid = id_map[c.comment_id]
        conn.execute(
            """
            INSERT INTO comments (comment_id, post_id, parent_comment_id, agent_id,
                                  content, stance, relation, thread_path, batch_id,
                                  heat, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                comment_uuid, post_id, id_map.get(c.parent_comment_id or ""),
                c.agent_id, c.content, c.stance, c.relation, c.thread_path,
                c.batch_id, c.likes * HEAT_PER_LIKE, created.isoformat(),
            ),
        )
        _sprinkle_reactions(
            conn, "comment", comment_uuid, c.agent_id, c.likes, created, roster_ids, now, rng
        )
    return len(comments)


def _relink(comments: list[Any]) -> None:
    """Re-derive parent links and thread_path values for the kept comments.

    generate_comment_tree links the batch before the quality gate drops
    entries, so a kept reply can point at a dropped parent. Re-running the
    same linking rules over the kept set guarantees stored thread_path values
    always match stored parent ids, with depth capped at MAX_DEPTH.
    """
    by_id = {c.comment_id: c for c in comments}
    for c in comments:
        if c.parent_comment_id and (
            c.parent_comment_id not in by_id or c.parent_comment_id == c.comment_id
        ):
            c.parent_comment_id = None

    path_by_id: dict[str, str] = {}
    id_by_path: dict[str, str] = {}
    child_counters: dict[str, int] = {}
    top_counter = 0
    for c in comments:
        parent_path = path_by_id.get(c.parent_comment_id or "")
        if parent_path is None:
            top_counter += 1
            c.parent_comment_id = None
            c.thread_path = str(top_counter)
        else:
            if len(parent_path.split("/")) >= MAX_DEPTH:
                ancestor_path = "/".join(parent_path.split("/")[: MAX_DEPTH - 1])
                c.parent_comment_id = id_by_path[ancestor_path]
                parent_path = ancestor_path
            child_counters[parent_path] = child_counters.get(parent_path, 0) + 1
            c.thread_path = f"{parent_path}/{child_counters[parent_path]}"
        path_by_id[c.comment_id] = c.thread_path
        id_by_path[c.thread_path] = c.comment_id


def _sprinkle_reactions(
    conn: sqlite3.Connection,
    target_type: str,
    target_id: str,
    author_id: str,
    likes: int,
    target_created: datetime,
    roster_ids: list[str],
    now: datetime,
    rng: random.Random,
) -> int:
    """Insert one like row per like, one voter per agent (authors never self-like).

    The roster caps how many distinct voters exist; the full like count still
    lands in the target's heat, so popular history stays popular.
    """
    candidates = [a for a in roster_ids if a != author_id]
    n = min(max(0, likes), len(candidates))
    if n == 0:
        return 0
    span = max(60.0, (now - target_created).total_seconds())
    for agent_id in rng.sample(candidates, n):
        ts = target_created + timedelta(seconds=rng.uniform(0.05, 1.0) * span)
        conn.execute(
            """
            INSERT INTO reactions (reaction_id, target_type, target_id, agent_id, reaction_type, created_at)
            VALUES (?, ?, ?, ?, 'like', ?)
            """,
            (str(uuid.uuid4()), target_type, target_id, agent_id, ts.isoformat()),
        )
    return n


def _finalize_posts(conn: sqlite3.Connection, world_id: str) -> None:
    """Mark post_status and is_hot once every comment count is known.

    The newest ACTIVE_TAIL posts stay 'active' (still discussed); the rest
    become 'historical'. The top HOT_FRACTION by engagement get is_hot.
    """
    rows = conn.execute(
        "SELECT post_id, comment_count, heat, created_at FROM posts WHERE world_id = ?",
        (world_id,),
    ).fetchall()
    if not rows:
        return
    ranked = sorted(rows, key=lambda r: (r[1], r[2]), reverse=True)
    hot = {r[0] for r in ranked[: max(1, round(len(rows) * HOT_FRACTION))]}
    newest = sorted(rows, key=lambda r: r[3], reverse=True)
    active = {r[0] for r in newest[:ACTIVE_TAIL]}
    for (post_id, *_rest) in rows:
        conn.execute(
            "UPDATE posts SET post_status = ?, is_hot = ? WHERE post_id = ?",
            ("active" if post_id in active else "historical", 1 if post_id in hot else 0, post_id),
        )


def _update_agent_counters(conn: sqlite3.Connection, world_id: str) -> None:
    """Refresh post_count / comment_count and add karma for likes received."""
    conn.execute(
        """
        UPDATE agents SET
            post_count = (SELECT COUNT(*) FROM posts p WHERE p.agent_id = agents.agent_id),
            comment_count = (SELECT COUNT(*) FROM comments c WHERE c.agent_id = agents.agent_id),
            karma = karma
                + (SELECT COUNT(*) FROM reactions r
                   JOIN posts p ON r.target_type = 'post' AND r.target_id = p.post_id
                   WHERE p.agent_id = agents.agent_id)
                + (SELECT COUNT(*) FROM reactions r
                   JOIN comments c ON r.target_type = 'comment' AND r.target_id = c.comment_id
                   WHERE c.agent_id = agents.agent_id)
        WHERE world_id = ?
        """,
        (world_id,),
    )


def _touch_world(conn: sqlite3.Connection, world_id: str) -> None:
    tables = {
        row[0] for row in conn.execute("SELECT name FROM sqlite_master WHERE type='table'")
    }
    if "worlds" in tables:
        conn.execute(
            "UPDATE worlds SET updated_at = ? WHERE world_id = ?", (now_iso(), world_id)
        )


def _log_init_event(
    conn: sqlite3.Connection,
    world_id: str,
    agents: int,
    posts: int,
    comments: int,
) -> None:
    tables = {
        row[0] for row in conn.execute("SELECT name FROM sqlite_master WHERE type='table'")
    }
    if "events" not in tables:
        return
    conn.execute(
        """
        INSERT INTO events (world_id, round, phase, agent_id, action, payload_json, created_at)
        VALUES (?, 0, 'init', NULL, 'world_initialized', ?, ?)
        """,
        (
            world_id,
            json.dumps({"agents": agents, "posts": posts, "comments": comments}, ensure_ascii=False),
            now_iso(),
        ),
    )


def _current_counts(db_path: Path, world_id: str) -> InitResult:
    """Counts for the idempotent early-return path."""
    conn = sqlite3.connect(db_path)
    try:
        agents = _count(conn, "SELECT COUNT(*) FROM agents WHERE world_id = ?", world_id)
        posts = _count(conn, "SELECT COUNT(*) FROM posts WHERE world_id = ?", world_id)
        comments = _count(
            conn,
            "SELECT COUNT(*) FROM comments c JOIN posts p ON c.post_id = p.post_id WHERE p.world_id = ?",
            world_id,
        )
    finally:
        conn.close()
    return InitResult(
        world_id=world_id, agents_created=agents, posts_created=posts, comments_created=comments
    )


def _count(conn: sqlite3.Connection, sql: str, world_id: str) -> int:
    try:
        return conn.execute(sql, (world_id,)).fetchone()[0]
    except sqlite3.OperationalError:
        return 0


# ---------------------------------------------------------------------------
# LLM transport (same pattern as llm.generate_action / content_generator)
# ---------------------------------------------------------------------------


async def _post_messages(
    messages: list[dict[str, str]],
    *,
    temperature: float,
    model: str | None,
) -> str:
    """POST to the LLM proxy; initialization uses the high-quality tier (spec §10)."""
    model = (
        model
        or os.environ.get("LLM_MODEL_INIT")
        or os.environ.get("LLM_MODEL_BATCH")
        or os.environ.get("LLM_MODEL", "gpt-4.1-mini")
    )
    async with httpx.AsyncClient(timeout=60.0) as client:
        backoff = [1, 2, 4]
        for attempt in range(3):
            response = await client.post(
                f"{base_url()}/api/generate",
                json={"model": model, "temperature": temperature, "messages": messages},
            )
            if response.status_code == 429 and attempt < 2:
                await asyncio.sleep(backoff[attempt])
                continue
            response.raise_for_status()
            break
    return response.json().get("content", "")


# ---------------------------------------------------------------------------
# Small tolerant helpers (mirrors of content_generator's parsing utilities)
# ---------------------------------------------------------------------------


def _extract_json(raw: str) -> Any:
    """Tolerate markdown fences and prose around the JSON payload."""
    text = raw.strip()
    candidates = [text]
    fenced = re.sub(r"^```(?:json)?\s*", "", text, flags=re.IGNORECASE)
    fenced = re.sub(r"\s*```$", "", fenced)
    candidates.append(fenced)
    for candidate in (text, fenced):
        start = candidate.find("{")
        end = candidate.rfind("}")
        if start != -1 and end > start:
            candidates.append(candidate[start : end + 1])
        start = candidate.find("[")
        end = candidate.rfind("]")
        if start != -1 and end > start:
            candidates.append(candidate[start : end + 1])
    for candidate in candidates:
        try:
            return json.loads(candidate)
        except Exception:
            continue
    raise ContentGenerationError("LLM output is not valid JSON")


def _clamp_int(value: Any, lo: int, hi: int, default: int) -> int:
    try:
        v = int(float(value))
    except (TypeError, ValueError):
        return default
    return max(lo, min(hi, v))


def _clamp_float(value: Any, lo: float, hi: float, default: float) -> float:
    try:
        v = float(value)
    except (TypeError, ValueError):
        return default
    return max(lo, min(hi, v))
