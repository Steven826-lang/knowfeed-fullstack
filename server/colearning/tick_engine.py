"""Community evolution engine (spec §6).

Entry points:
- run_tick: one regular evolution round. 3-6 active agents each make a single
  LLM decision (do_nothing ~40% / create_post ~15% / create_comment ~30% /
  like-dislike ~15%, distribution guided by the prompt), then OP engagement,
  one forced counter-exposure response, BeliefState updates and event logging.
- run_mini_tick: lightweight asynchronous response round after user activity
  (spec §6.3). 2-3 agents reply with single comments (never the batch comment
  tree) and a few likes are scattered.
- run_catchup: wake-up catch-up after idle time (spec §6.4). Picks none /
  normal / condensed / deep mode from the idle gap; condensed ticks evolve
  several posts in one batched LLM call with timestamps spread over the gap.

Concurrency (spec §6.5): a process-wide per-world asyncio lock guarantees a
single running tick per world; duplicate triggers return the current state.
"""

import asyncio
import json
import os
import random
import re
import sqlite3
import uuid
from contextlib import asynccontextmanager
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

import httpx

import agent_manager
import db
from belief_state import BeliefState
from db import now_iso
from llm import base_url, build_observation_text
from personas import Persona
from quality import passes_gate

ACTIVE_MIN = 3
ACTIVE_MAX = 6
TIMELINE_LIMIT = 5            # prompt budget: only the 5 freshest timeline items

OP_REPLY_PROB = 0.4           # spec §5.3: OP answers a new comment 40% of the time
OP_QUESTION_REPLY_PROB = 0.8  # spec §5.3: OP answers a direct question 80%
OP_SUMMARY_PROB = 0.6         # milestone summary is allowed, not mandatory
OP_MILESTONES = (5, 10, 20)
OP_REPLIES_MAX = 3            # budget guard: cap OP replies per tick

HOT_COMMENT_THRESHOLD = 8     # spec §13: active posts carry 8-15 comments
MINI_TICK_FALLBACK_MAX = 3    # extra agents tried when no direct reply lands yet
CATCHUP_NONE_MINUTES = 5      # spec §6.1: tick only when idle > 5 minutes
CATCHUP_NORMAL_MINUTES = 30   # spec §6.4: < 30 min is a normal tick
CATCHUP_DEEP_HOURS = 24       # spec §6.4: > 24 h needs a briefing card
CATCHUP_MAX_TICKS = 3
CONDENSED_POST_LIMIT = 5
CONDENSED_LIKE_LIMIT = 5

STANCE_ALIASES = {
    "supportive": "supportive",
    "support": "supportive",
    "opposing": "opposing",
    "oppose": "opposing",
    "doubt": "question",
    "question": "question",
    "neutral": "neutral",
    "sharing": "sharing",
    "add": "sharing",
}
STANCES = ("supportive", "opposing", "neutral", "question", "sharing")

RELATION_ALIASES = {
    "追问": "追问",
    "补充": "补充",
    "反驳": "反驳",
    "歪楼": "歪楼",
    "总结": "总结",
    "question": "追问",
    "refute": "反驳",
    "add": "补充",
    "off-topic": "歪楼",
    "summary": "总结",
}
RELATIONS = ("追问", "补充", "反驳", "歪楼", "总结")

DECISION_GUIDE = (
    "决策倾向（请自觉遵守）：大约四成时间选择 do_nothing 潜水；约一成半发新帖；"
    "约三成评论或回复别人的内容；约一成半点赞或点踩。\n"
    "发帖要有原创想法（20–500 字，有背景和理由）；评论要有实质内容（8–300 字），"
    "可以追问、补充、反驳、歪楼或总结；不要纯附和；被说服时可以改变立场。"
)


# ---------------------------------------------------------------------------
# Public result types
# ---------------------------------------------------------------------------


@dataclass
class TickResult:
    """Outcome of one regular tick."""

    tick_num: int
    posts_created: int
    comments_created: int
    reactions_added: int
    deltas: list
    actions: list[dict]


@dataclass
class MiniTickResult:
    """Outcome of a user-triggered mini-tick (spec §6.3)."""

    replies: list[dict]
    reactions_added: int


@dataclass
class CatchupResult:
    """Outcome of a wake-up catch-up (spec §6.4)."""

    ticks_run: int
    briefing: dict


# ---------------------------------------------------------------------------
# Per-world tick lock (spec §6.5)
# ---------------------------------------------------------------------------

_LOCKS: dict[str, asyncio.Lock] = {}


def _get_lock(world_id: str) -> asyncio.Lock:
    lock = _LOCKS.get(world_id)
    if lock is None:
        lock = asyncio.Lock()
        _LOCKS[world_id] = lock
    return lock


@asynccontextmanager
async def tick_lock(world_id: str):
    """In-process per-world tick lock: one running tick per world at a time."""
    lock = _get_lock(world_id)
    await lock.acquire()
    try:
        yield lock
    finally:
        lock.release()


# ---------------------------------------------------------------------------
# Catch-up mode selection (spec §6.4)
# ---------------------------------------------------------------------------


def catchup_mode(last_tick_at: str, now) -> str:
    """Classify the idle gap: "none" / "normal" / "condensed" / "deep"."""
    now_dt = _coerce_dt(now) or datetime.now(timezone.utc)
    last_dt = _parse_ts(last_tick_at)
    if last_dt is None:
        return "normal"
    gap = now_dt - last_dt
    if gap < timedelta(minutes=CATCHUP_NONE_MINUTES):
        return "none"
    if gap < timedelta(minutes=CATCHUP_NORMAL_MINUTES):
        return "normal"
    if gap < timedelta(hours=CATCHUP_DEEP_HOURS):
        return "condensed"
    return "deep"


# ---------------------------------------------------------------------------
# Regular tick (spec §6.2)
# ---------------------------------------------------------------------------


async def run_tick(
    db_path: Path,
    world_id: str,
    *,
    rng: random.Random | None = None,
    now: datetime | None = None,
    force_counter_exposure: bool = True,
) -> TickResult:
    """Run one regular evolution round for a world.

    Duplicate triggers while a tick for the same world is running return the
    current (unchanged) state instead of queuing (spec §6.5).
    """
    rng = rng or random.Random()
    now = now or datetime.now(timezone.utc)
    lock = _get_lock(world_id)
    if lock.locked():
        return TickResult(_current_tick_num(db_path, world_id), 0, 0, 0, [], [])
    async with lock:
        return await _run_tick(db_path, world_id, rng=rng, now=now, force_counter_exposure=force_counter_exposure)


async def _run_tick(
    db_path: Path,
    world_id: str,
    *,
    rng: random.Random,
    now: datetime,
    force_counter_exposure: bool,
) -> TickResult:
    world = db.get_world(db_path, world_id)
    if world is None:
        raise ValueError(f"unknown world: {world_id}")
    tick_num = _next_tick_num(db_path, world_id)
    last_tick_at = _last_tick_at(db_path, world_id)
    concept_id = world.get("current_concept_id") or _recent_concept(db_path, world_id) or "general"
    ts = _iso(now)

    n = rng.randint(ACTIVE_MIN, ACTIVE_MAX)
    picked = agent_manager.pick_active_agents(db_path, world_id, n, rng)
    roster_by_id = {a["agent_id"]: a for a in agent_manager.load_roster(db_path, world_id)}
    # Refresh rows: picks may carry stale belief snapshots.
    active = [roster_by_id[a["agent_id"]] for a in picked if a["agent_id"] in roster_by_id]
    if not active:
        return TickResult(tick_num, 0, 0, 0, [], [])

    display_timeline, seen_timeline = _load_timeline(db_path, world_id, limit=TIMELINE_LIMIT)
    posts = _load_posts(db_path, world_id, limit=50)
    post_by_id = {p["post_id"]: p for p in posts}
    comment_by_id = {c["comment_id"]: c for c in _load_comments(db_path, world_id, limit=50)}

    raw_decisions = await asyncio.gather(
        *(_decide_action(a, world["topic_title"], concept_id, display_timeline) for a in active),
        return_exceptions=True,
    )

    beliefs: dict[str, BeliefState] = {}
    seen: dict[str, list[dict]] = {}
    engagement: dict[str, dict[str, int]] = {}

    def track(agent_row: dict) -> str:
        aid = agent_row["agent_id"]
        if aid not in beliefs:
            beliefs[aid] = BeliefState.from_dict(agent_row.get("belief") or {})
            seen[aid] = []
            engagement[aid] = {"likes_received": 0, "dislikes_received": 0}
        return aid

    for agent_row in active:
        aid = track(agent_row)
        seen[aid].extend(seen_timeline)

    actions: list[dict] = []
    deltas: list[dict] = []
    counts = {"posts": 0, "comments": 0, "reactions": 0}
    prev_comment_counts: dict[str, int] = {}

    def remember_count(post_id: str) -> None:
        if post_id not in prev_comment_counts and post_id in post_by_id:
            prev_comment_counts[post_id] = _comment_count(db_path, post_id)

    def note_reaction(aid: str, target: dict, reaction_type: str) -> None:
        """Trust/engagement bookkeeping for a reaction that just landed."""
        author = target.get("author_id")
        if not author or author == aid:
            return
        beliefs[aid].update_trust(author, reaction_type)
        if author not in beliefs and author in roster_by_id:
            track(roster_by_id[author])
        if author in engagement:
            key = "likes_received" if reaction_type == "like" else "dislikes_received"
            engagement[author][key] += 1

    # --- step 2/3: per-agent decisions, executed against the DB ------------
    for agent_row, decision in zip(active, raw_decisions):
        aid = agent_row["agent_id"]
        if isinstance(decision, Exception):
            actions.append({"agent_id": aid, "action": "do_nothing", "ok": False, "reason": f"llm error: {decision}"})
            continue
        action = str(decision.get("action") or "do_nothing")

        if action == "create_post":
            content = str(decision.get("content") or "").strip()
            stance = _normalize_stance(decision.get("stance"))
            if passes_gate(db_path, concept_id, content, stance):
                post_id = _insert_post(db_path, world_id, concept_id, aid, content, stance, created_at=ts)
                counts["posts"] += 1
                actions.append({"agent_id": aid, "action": action, "ok": True, "post_id": post_id})
                _log_event(db_path, world_id, tick_num, "tick", aid, "create_post", {"post_id": post_id, "stance": stance})
            else:
                actions.append({"agent_id": aid, "action": action, "ok": False, "reason": "quality gate"})
                _log_event(db_path, world_id, tick_num, "tick", aid, "create_post_rejected", {"content": content[:100]})

        elif action == "create_comment":
            post_id = str(decision.get("post_id") or "")
            post = post_by_id.get(post_id)
            if post is None:
                actions.append({"agent_id": aid, "action": action, "ok": False, "reason": "unknown post_id"})
                continue
            parent = decision.get("parent_comment_id")
            parent = str(parent) if parent and str(parent) in comment_by_id else None
            content = str(decision.get("content") or "").strip()
            stance = _normalize_stance(decision.get("stance"))
            relation = _normalize_relation(decision.get("relation"))
            if passes_gate(db_path, post["concept_id"], content, stance, post_id=post_id):
                remember_count(post_id)
                comment_id, thread_path = _insert_comment(
                    db_path, post_id, aid, content, stance, relation, parent,
                    batch_id=f"tick-{tick_num}", created_at=ts,
                )
                counts["comments"] += 1
                seen[aid].append(_seen_item_for_post(post))
                actions.append({"agent_id": aid, "action": action, "ok": True, "comment_id": comment_id, "post_id": post_id})
                _log_event(db_path, world_id, tick_num, "tick", aid, "create_comment",
                           {"comment_id": comment_id, "post_id": post_id, "thread_path": thread_path})
            else:
                actions.append({"agent_id": aid, "action": action, "ok": False, "reason": "quality gate"})
                _log_event(db_path, world_id, tick_num, "tick", aid, "create_comment_rejected", {"post_id": post_id})

        elif action in ("like", "dislike"):
            target_type = decision.get("target_type")
            target_id = str(decision.get("target_id") or "")
            target = None
            if target_type == "post":
                target = post_by_id.get(target_id)
            elif target_type == "comment":
                target = comment_by_id.get(target_id)
            if target is None:
                actions.append({"agent_id": aid, "action": action, "ok": False, "reason": "unknown target"})
                continue
            inserted = _insert_reaction(db_path, target_type, target_id, aid, action, created_at=ts)
            if inserted:
                counts["reactions"] += 1
            note_reaction(aid, target, action)
            seen[aid].append(
                _seen_item_for_post(target) if target_type == "post" else _seen_item_for_comment(target)
            )
            actions.append({"agent_id": aid, "action": action, "ok": True,
                            "target_type": target_type, "target_id": target_id})
            _log_event(db_path, world_id, tick_num, "tick", aid, action,
                       {"target_type": target_type, "target_id": target_id})

        else:
            actions.append({"agent_id": aid, "action": "do_nothing", "ok": True})

    # --- OP engagement (spec §5.3) ------------------------------------------
    op_replies = 0
    for cand in _op_candidates(db_path, world_id, last_tick_at):
        if op_replies >= OP_REPLIES_MAX:
            break
        op_id = cand["op_id"]
        if not op_id or op_id not in roster_by_id or cand["agent_id"] == op_id:
            continue
        if _op_already_replied(db_path, cand["comment_id"], op_id):
            continue
        direct_question = cand["relation"] == "追问" or cand.get("parent_author") == op_id
        prob = OP_QUESTION_REPLY_PROB if direct_question else OP_REPLY_PROB
        if rng.random() >= prob:
            continue
        op_row = roster_by_id[op_id]
        reply = await _generate_single_comment(_op_reply_messages(op_row, cand, milestone=None))
        if reply is None:
            continue
        content, stance, relation = reply
        if not passes_gate(db_path, cand["concept_id"], content, stance, post_id=cand["post_id"]):
            continue
        remember_count(cand["post_id"])
        comment_id, _ = _insert_comment(
            db_path, cand["post_id"], op_id, content, stance, relation, cand["comment_id"],
            batch_id=f"tick-{tick_num}", created_at=ts,
        )
        counts["comments"] += 1
        op_replies += 1
        track(op_row)
        seen[op_id].append({
            "comment_id": cand["comment_id"],
            "author_id": cand["agent_id"],
            "concept_id": cand["concept_id"],
            "stance": cand["stance"],
            "likes": 0,
        })
        actions.append({"agent_id": op_id, "action": "op_reply", "ok": True,
                        "comment_id": comment_id, "post_id": cand["post_id"]})
        _log_event(db_path, world_id, tick_num, "tick", op_id, "op_reply",
                   {"comment_id": comment_id, "post_id": cand["post_id"], "in_reply_to": cand["comment_id"]})

    # Milestone summaries: a post that just crossed 5/10/20 comments may get a
    # closing statement from its OP.
    for post_id, prev in prev_comment_counts.items():
        crossed = [m for m in OP_MILESTONES if prev < m <= _comment_count(db_path, post_id)]
        if not crossed:
            continue
        post = post_by_id.get(post_id)
        op_id = post["author_id"] if post else None
        if not op_id or op_id not in roster_by_id:
            continue
        if rng.random() >= OP_SUMMARY_PROB:
            continue
        op_row = roster_by_id[op_id]
        reply = await _generate_single_comment(_op_reply_messages(op_row, post, milestone=max(crossed)))
        if reply is None:
            continue
        content, stance, _ = reply
        if not passes_gate(db_path, post["concept_id"], content, stance, post_id=post_id):
            continue
        comment_id, _ = _insert_comment(
            db_path, post_id, op_id, content, stance, "总结", None,
            batch_id=f"tick-{tick_num}", created_at=ts,
        )
        counts["comments"] += 1
        track(op_row)
        actions.append({"agent_id": op_id, "action": "op_summary", "ok": True,
                        "comment_id": comment_id, "post_id": post_id, "milestone": max(crossed)})
        _log_event(db_path, world_id, tick_num, "tick", op_id, "op_summary",
                   {"comment_id": comment_id, "post_id": post_id, "milestone": max(crossed)})

    for post_id in prev_comment_counts:
        _maybe_mark_hot(db_path, post_id)

    # --- forced counter exposure (spec §3.2 echo-chamber suppression) -------
    if force_counter_exposure:
        order = list(active)
        rng.shuffle(order)
        for agent_row in order:
            aid = agent_row["agent_id"]
            candidates = [
                p for p in posts
                if p["stance"] in ("supportive", "opposing") and p["author_id"] != aid
            ]
            pick = beliefs[aid].pick_counter_exposure(candidates)
            if not pick:
                continue
            reply = await _generate_single_comment(_counter_messages(agent_row, pick, beliefs[aid]))
            if reply is None:
                continue
            content, stance, relation = reply
            if not passes_gate(db_path, pick["concept_id"], content, stance, post_id=pick["post_id"]):
                continue
            remember_count(pick["post_id"])
            comment_id, _ = _insert_comment(
                db_path, pick["post_id"], aid, content, stance, relation, None,
                batch_id=f"tick-{tick_num}", created_at=ts,
            )
            counts["comments"] += 1
            seen[aid].append(_seen_item_for_post(pick))
            _maybe_mark_hot(db_path, pick["post_id"])
            actions.append({"agent_id": aid, "action": "counter_exposure", "ok": True,
                            "post_id": pick["post_id"], "comment_id": comment_id})
            _log_event(db_path, world_id, tick_num, "tick", aid, "counter_exposure",
                       {"post_id": pick["post_id"], "comment_id": comment_id})
            break

    # --- step 4/5: belief updates, delta events, activity stamps ------------
    for aid, belief in beliefs.items():
        own = {k: v for k, v in (engagement.get(aid) or {}).items() if v}
        agent_deltas = belief.update_from_round(seen.get(aid, []), own, tick_num)
        _save_belief(db_path, aid, belief)
        agent_manager.touch_active(db_path, aid)
        for d in agent_deltas:
            deltas.append({"agent_id": aid, **d})
            _log_event(db_path, world_id, tick_num, "tick", aid, "delta", d)

    # Marker event so _last_tick_at advances even when every agent idled.
    _log_event(db_path, world_id, tick_num, "tick", None, "tick_done", {
        "posts_created": counts["posts"],
        "comments_created": counts["comments"],
        "reactions_added": counts["reactions"],
        "deltas": len(deltas),
    })
    return TickResult(tick_num, counts["posts"], counts["comments"], counts["reactions"], deltas, actions)


# ---------------------------------------------------------------------------
# Mini-tick: asynchronous first responses to user content (spec §6.3)
# ---------------------------------------------------------------------------


async def run_mini_tick(
    db_path: Path,
    world_id: str,
    target_post_id: str | None = None,
    *,
    user_comment_id: str | None = None,
    rng: random.Random | None = None,
    post_id: str | None = None,
    comment_id: str | None = None,
) -> MiniTickResult:
    """Generate the first 2-3 agent replies to a user post/comment.

    At least one reply directly answers the user's content; a few likes are
    scattered on top. Single comments only — the batch comment tree is for
    historical backfill and is never used here.

    post_id/comment_id are compatibility aliases for the FastAPI layer
    (main.py, parallel workstream), which currently calls
    run_mini_tick(db_path, world_id, post_id=..., comment_id=...).
    """
    target_post_id = target_post_id or post_id
    user_comment_id = user_comment_id or comment_id
    if not target_post_id:
        raise ValueError("target_post_id is required")
    rng = rng or random.Random()
    post = _get_post(db_path, world_id, target_post_id)
    if post is None:
        raise ValueError(f"unknown post: {target_post_id}")
    user_comment = _get_comment(db_path, user_comment_id) if user_comment_id else None
    tick_num = _current_tick_num(db_path, world_id)
    ts = now_iso()
    batch_id = f"mini-{uuid.uuid4().hex[:8]}"

    roster_by_id = {a["agent_id"]: a for a in agent_manager.load_roster(db_path, world_id)}
    picked = agent_manager.pick_active_agents(db_path, world_id, rng.randint(2, 3), rng)
    agents = [roster_by_id[a["agent_id"]] for a in picked if a["agent_id"] in roster_by_id]

    replies: list[dict] = []
    used: set[str] = set()
    direct_done = False

    async def try_reply(agent_row: dict, direct: bool) -> dict | None:
        messages = _mini_reply_messages(agent_row, post, user_comment, direct)
        parsed = await _generate_single_comment(messages)
        if parsed is None:
            return None
        content, stance, relation = parsed
        if not passes_gate(db_path, post["concept_id"], content, stance, post_id=target_post_id):
            return None
        parent = user_comment_id if (direct and user_comment_id) else None
        comment_id, thread_path = _insert_comment(
            db_path, target_post_id, agent_row["agent_id"], content, stance, relation, parent,
            batch_id=batch_id, created_at=ts,
        )
        agent_manager.touch_active(db_path, agent_row["agent_id"])
        _log_event(db_path, world_id, tick_num, "mini_tick", agent_row["agent_id"], "mini_reply",
                   {"post_id": target_post_id, "comment_id": comment_id, "direct": direct})
        return {
            "comment_id": comment_id,
            "post_id": target_post_id,
            "agent_id": agent_row["agent_id"],
            "content": content,
            "stance": stance,
            "relation": relation,
            "parent_comment_id": parent,
            "thread_path": thread_path,
            "reply_to_user": direct,
        }

    for idx, agent_row in enumerate(agents):
        reply = await try_reply(agent_row, direct=idx == 0 and not direct_done)
        used.add(agent_row["agent_id"])
        if reply:
            replies.append(reply)
            direct_done = direct_done or reply["reply_to_user"]

    if not direct_done:
        # Guarantee one direct answer to the user: try a few fresh roster
        # members until one reply survives generation and the quality gate.
        attempts = 0
        for agent_row in agent_manager.load_roster(db_path, world_id):
            if attempts >= MINI_TICK_FALLBACK_MAX:
                break
            if agent_row["agent_id"] in used:
                continue
            attempts += 1
            reply = await try_reply(agent_row, True)
            used.add(agent_row["agent_id"])
            if reply:
                replies.append(reply)
                break

    reactions_added = _scatter_likes(db_path, world_id, tick_num, post, user_comment, replies, rng, ts)
    return MiniTickResult(replies=replies, reactions_added=reactions_added)


def _scatter_likes(
    db_path: Path,
    world_id: str,
    tick_num: int,
    post: dict,
    user_comment: dict | None,
    replies: list[dict],
    rng: random.Random,
    ts: str,
) -> int:
    """Sprinkle 2-3 likes over the user's content and the fresh replies."""
    n = rng.randint(2, 3)
    targets = [("post", post["post_id"], post.get("author_id"))]
    if user_comment:
        targets.append(("comment", user_comment["comment_id"], user_comment.get("agent_id")))
    for r in replies:
        targets.append(("comment", r["comment_id"], r["agent_id"]))
    roster = agent_manager.load_roster(db_path, world_id)
    rng.shuffle(roster)
    added = 0
    for target_type, target_id, author_id in targets:
        if added >= n:
            break
        for agent_row in roster:
            if agent_row["agent_id"] == author_id:
                continue  # no self-likes
            if _insert_reaction(db_path, target_type, target_id, agent_row["agent_id"], "like", created_at=ts):
                added += 1
                _log_event(db_path, world_id, tick_num, "mini_tick", agent_row["agent_id"], "like",
                           {"target_type": target_type, "target_id": target_id})
                break  # one like per target
    return added


# ---------------------------------------------------------------------------
# Wake-up catch-up (spec §6.4)
# ---------------------------------------------------------------------------


async def run_catchup(
    db_path: Path,
    world_id: str,
    *,
    now: datetime | None = None,
    rng: random.Random | None = None,
) -> CatchupResult:
    """Bring a world up to date after the user comes back.

    none: nothing to do. normal: one regular tick. condensed: one batched
    tick. deep: 1-3 condensed ticks plus a "while you were away" briefing.
    """
    rng = rng or random.Random()
    now_dt = _coerce_dt(now) or datetime.now(timezone.utc)
    world = db.get_world(db_path, world_id)
    if world is None:
        raise ValueError(f"unknown world: {world_id}")
    last_tick_at = _last_tick_at(db_path, world_id)
    mode = catchup_mode(last_tick_at, now_dt)

    if mode == "none":
        return CatchupResult(0, {})
    if mode == "normal":
        await run_tick(db_path, world_id, rng=rng, now=now_dt)
        return CatchupResult(1, {})

    last_dt = _parse_ts(last_tick_at) or now_dt
    if mode == "condensed":
        await _run_condensed_tick(db_path, world_id, window_start=last_dt, window_end=now_dt, rng=rng)
        return CatchupResult(1, {})

    days = max(1, (now_dt - last_dt).days)
    ticks = min(CATCHUP_MAX_TICKS, days)
    span = now_dt - last_dt
    hot: set[str] = set()
    touched: dict[str, str] = {}
    deltas: list[dict] = []
    for i in range(ticks):
        w_start = last_dt + span * i / ticks
        w_end = last_dt + span * (i + 1) / ticks
        stats = await _run_condensed_tick(db_path, world_id, window_start=w_start, window_end=w_end, rng=rng)
        hot |= stats["hot"]
        touched.update(stats["touched"])
        deltas.extend(stats["deltas"])

    current = world.get("current_concept_id")
    relevant = {pid for pid, cid in touched.items() if current is None or cid == current}
    briefing = {
        "new_hot_posts": len(hot),
        "relevant_discussions": len(relevant),
        "delta_moments": len(deltas),
        "summary": (
            f"你不在的时候：{len(hot)} 个新热帖、{len(relevant)} 条和你相关的讨论、"
            f"{len(deltas)} 个 delta 瞬间。"
        ),
    }
    return CatchupResult(ticks, briefing)


async def _run_condensed_tick(
    db_path: Path,
    world_id: str,
    *,
    window_start: datetime,
    window_end: datetime,
    rng: random.Random,
) -> dict:
    """One condensed tick: a single LLM call evolves several posts at once.

    Generated timestamps are spread over [window_start, window_end] so the
    backfilled activity keeps a sense of elapsed time (spec §6.4).
    """
    stats: dict[str, Any] = {"comments": 0, "reactions": 0, "touched": {}, "hot": set(), "deltas": []}
    lock = _get_lock(world_id)
    if lock.locked():
        return stats
    async with lock:
        world = db.get_world(db_path, world_id)
        if world is None:
            return stats
        tick_num = _next_tick_num(db_path, world_id)

        def mark_done() -> None:
            # Marker event so the catch-up clock advances even for empty ticks.
            _log_event(db_path, world_id, tick_num, "catchup", None, "condensed_tick_done", {
                "comments": stats["comments"],
                "reactions": stats["reactions"],
            })

        posts = _load_posts(db_path, world_id, limit=CONDENSED_POST_LIMIT, evolving=True)
        if not posts:
            mark_done()
            return stats
        picked = agent_manager.pick_active_agents(db_path, world_id, rng.randint(ACTIVE_MIN, ACTIVE_MAX), rng)
        roster_by_id = {a["agent_id"]: a for a in agent_manager.load_roster(db_path, world_id)}
        participants = [roster_by_id[a["agent_id"]] for a in picked if a["agent_id"] in roster_by_id]
        if not participants:
            mark_done()
            return stats

        messages = _condensed_messages(world["topic_title"], posts, participants)
        try:
            raw = await _post_messages(messages, temperature=0.85, model=None)
            data = _extract_json(raw)
        except Exception:
            mark_done()
            return stats
        if not isinstance(data, dict):
            mark_done()
            return stats

        post_by_id = {p["post_id"]: p for p in posts}
        member_ids = {a["agent_id"] for a in participants}
        span_seconds = max(0.0, (window_end - window_start).total_seconds())

        def spread_ts() -> str:
            return _iso(window_start + timedelta(seconds=rng.uniform(0, span_seconds)))

        beliefs: dict[str, BeliefState] = {}
        engagement: dict[str, dict[str, int]] = {}

        def track(agent_row: dict) -> str:
            aid = agent_row["agent_id"]
            if aid not in beliefs:
                beliefs[aid] = BeliefState.from_dict(agent_row.get("belief") or {})
                engagement[aid] = {"likes_received": 0, "dislikes_received": 0}
            return aid

        seen_items = [_seen_item_for_post(p) for p in posts]
        for agent_row in participants:
            track(agent_row)

        batch_id = f"catchup-{tick_num}"
        parsed_comments = []
        for item in data.get("comments") or []:
            if not isinstance(item, dict):
                continue
            post_id = str(item.get("post_id") or "")
            agent_id = str(item.get("agent_id") or "")
            content = str(item.get("content") or "").strip()
            if post_id not in post_by_id or agent_id not in member_ids or not content:
                continue
            parsed_comments.append({
                "post_id": post_id,
                "agent_id": agent_id,
                "content": content,
                "stance": _normalize_stance(item.get("stance")),
                "relation": _normalize_relation(item.get("relation")),
                "created_at": spread_ts(),
            })
        parsed_comments.sort(key=lambda c: c["created_at"])

        for c in parsed_comments:
            post = post_by_id[c["post_id"]]
            if not passes_gate(db_path, post["concept_id"], c["content"], c["stance"], post_id=c["post_id"]):
                continue
            comment_id, _ = _insert_comment(
                db_path, c["post_id"], c["agent_id"], c["content"], c["stance"], c["relation"], None,
                batch_id=batch_id, created_at=c["created_at"],
            )
            stats["comments"] += 1
            stats["touched"][c["post_id"]] = post["concept_id"]
            _log_event(db_path, world_id, tick_num, "catchup", c["agent_id"], "create_comment",
                       {"comment_id": comment_id, "post_id": c["post_id"], "batch_id": batch_id})

        likes = data.get("likes") or []
        for item in likes[:CONDENSED_LIKE_LIMIT] if isinstance(likes, list) else []:
            if not isinstance(item, dict):
                continue
            post_id = str(item.get("post_id") or "")
            agent_id = str(item.get("agent_id") or "")
            if post_id not in post_by_id or agent_id not in member_ids:
                continue
            reaction = "dislike" if item.get("reaction_type") == "dislike" else "like"
            if _insert_reaction(db_path, "post", post_id, agent_id, reaction, created_at=spread_ts()):
                stats["reactions"] += 1
                author = post_by_id[post_id].get("author_id")
                if author and author != agent_id:
                    beliefs[agent_id].update_trust(author, reaction)
                    if author in roster_by_id:
                        track(roster_by_id[author])
                        key = "likes_received" if reaction == "like" else "dislikes_received"
                        engagement[author][key] += 1
                _log_event(db_path, world_id, tick_num, "catchup", agent_id, reaction,
                           {"target_type": "post", "target_id": post_id})

        for post_id in stats["touched"]:
            if _maybe_mark_hot(db_path, post_id):
                stats["hot"].add(post_id)

        for aid, belief in beliefs.items():
            own = {k: v for k, v in (engagement.get(aid) or {}).items() if v}
            agent_deltas = belief.update_from_round(seen_items, own, tick_num)
            _save_belief(db_path, aid, belief)
            agent_manager.touch_active(db_path, aid)
            for d in agent_deltas:
                stats["deltas"].append({"agent_id": aid, **d})
                _log_event(db_path, world_id, tick_num, "catchup", aid, "delta", d)

        mark_done()
        return stats


# ---------------------------------------------------------------------------
# LLM calls and prompts
# ---------------------------------------------------------------------------


async def _post_messages(
    messages: list[dict[str, str]],
    *,
    temperature: float,
    model: str | None,
) -> str:
    """POST to the LLM proxy, same transport pattern as content_generator."""
    model = model or os.environ.get("LLM_MODEL_TICK") or os.environ.get("LLM_MODEL", "gpt-4.1-mini")
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


async def _decide_action(agent_row: dict, topic_title: str, concept_label: str, timeline: list[dict]) -> dict:
    """One LLM decision call for one active agent (spec §6.2)."""
    messages = _decision_messages(agent_row, topic_title, concept_label, timeline)
    raw = await _post_messages(messages, temperature=0.85, model=None)
    return _parse_action(raw)


async def _generate_single_comment(messages: list[dict[str, str]]) -> tuple[str, str, str] | None:
    """Generate one comment body; returns (content, stance, relation) or None."""
    try:
        raw = await _post_messages(messages, temperature=0.9, model=None)
        data = _extract_json(raw)
    except Exception:
        return None
    if not isinstance(data, dict):
        return None
    content = str(data.get("content") or "").strip()
    if not content:
        return None
    return content, _normalize_stance(data.get("stance")), _normalize_relation(data.get("relation"))


def _decision_messages(agent_row: dict, topic_title: str, concept_label: str, timeline: list[dict]) -> list[dict[str, str]]:
    """Decision prompt: persona + belief state + 5-item timeline + concept."""
    persona = Persona(**agent_row["persona"])
    belief = BeliefState.from_dict(agent_row.get("belief") or {})
    system = persona.to_prompt() + "\n\n" + belief.to_prompt_text() + "\n\n" + DECISION_GUIDE
    observation = {
        "topic_title": topic_title,
        "concept_title": concept_label,
        "recent_posts": timeline,
    }
    return [
        {"role": "system", "content": system},
        {"role": "user", "content": build_observation_text(observation)},
    ]


def _op_reply_messages(agent_row: dict, post: dict, milestone: int | None) -> list[dict[str, str]]:
    """OP-engagement prompt (spec §5.3): reply to a new comment or summarize."""
    persona = Persona(**agent_row["persona"])
    belief = BeliefState.from_dict(agent_row.get("belief") or {})
    system = persona.to_prompt() + "\n\n" + belief.to_prompt_text()
    if milestone is not None:
        user = (
            f"你是楼主。你的帖子评论数刚达到 {milestone} 条：\n"
            f"帖子内容：{post['content'][:300]}\n"
            "请以楼主身份来一段总结陈词：梳理大家的争议点、补充新资料，"
            "或者承认自己被大家说服改变了看法。语气要符合你的人设。\n"
            '输出 JSON：{"content": "...", "stance": "...", "relation": "总结"}（content 8–300 字）'
        )
    else:
        comment = post  # caller passes the candidate row shaped like a comment
        user = (
            "你是楼主，你的帖子收到了新评论：\n"
            f"帖子内容：{comment['post_content'][:300]}\n"
            f"新评论（{comment['author']}）：{comment['content'][:300]}\n"
            "请以楼主身份回应这条评论，方式符合你的人设：资料型就甩新来源，"
            "杠精就怼回去，萌新就道谢，段子手可以歪一下再拉回来。\n"
            '输出 JSON：{"content": "...", "stance": "...", "relation": "..."}（content 8–300 字）'
        )
    return [
        {"role": "system", "content": system},
        {"role": "user", "content": user},
    ]


def _counter_messages(agent_row: dict, post_item: dict, belief: BeliefState) -> list[dict[str, str]]:
    """Forced counter-exposure prompt (spec §3.2): respond to an opposing post."""
    persona = Persona(**agent_row["persona"])
    own = belief.positions.get(str(post_item["concept_id"]), 0.0)
    system = persona.to_prompt() + "\n\n" + belief.to_prompt_text()
    user = (
        "你在时间线上刷到一篇与你立场相反的帖子（这是社区安排的“对立曝光”，请认真回应）：\n"
        f"[{post_item['author']}] {post_item['content'][:300]}\n"
        f"你在该概念上的立场是 {own:+.2f}（-1 反对 ~ +1 支持），这篇帖子的立场与你相反。\n"
        "请回应这篇帖子：可以反驳、追问细节，也可以被说服后改变立场（delta 瞬间是允许的）。\n"
        '输出 JSON：{"content": "...", "stance": "...", "relation": "..."}（content 8–300 字）'
    )
    return [
        {"role": "system", "content": system},
        {"role": "user", "content": user},
    ]


def _mini_reply_messages(
    agent_row: dict,
    post: dict,
    user_comment: dict | None,
    direct: bool,
) -> list[dict[str, str]]:
    """Mini-tick prompt (spec §6.3): one single reply to fresh user content."""
    persona = Persona(**agent_row["persona"])
    belief = BeliefState.from_dict(agent_row.get("belief") or {})
    system = persona.to_prompt() + "\n\n" + belief.to_prompt_text()
    lines = [f"社区里有一个帖子（作者 {post['author']}）：{post['content'][:300]}"]
    if user_comment is not None:
        lines.append(f"用户刚在楼下评论：{user_comment['content'][:300]}")
    if direct and user_comment is not None:
        lines.append("请直接回应用户的这条评论：回答、补充或追问都可以，让用户感到被认真对待。")
    elif direct:
        lines.append("请直接回应用户发的这个帖子：回答、补充或追问都可以，让用户感到被认真对待。")
    else:
        lines.append("请围绕这个帖子自然发言（补充视角、追问细节或适度歪楼都可以），不必直接回应用户。")
    lines.append('输出 JSON：{"content": "...", "stance": "...", "relation": "..."}（content 8–300 字）')
    return [
        {"role": "system", "content": system},
        {"role": "user", "content": "\n".join(lines)},
    ]


def _condensed_messages(topic_title: str, posts: list[dict], participants: list[dict]) -> list[dict[str, str]]:
    """Condensed-tick prompt (spec §6.4): batch-evolve several posts in one call."""
    system = (
        "你是一个学习社区的内容导演。用户离开了一段时间，现在要用一次调用补齐社区的演化："
        "为下面的多个帖子各补 1–2 条新评论，再撒几个点赞。"
        "评论要有实质（亲身经历、数据、追问、反驳），严格符合每个 agent 的人设，"
        "评论之间可以有互动感，允许 delta 瞬间。只输出 JSON，不要输出任何解释。"
    )
    post_lines = "\n".join(
        f"- post_id={p['post_id']} | 作者 @{p['author']} | 立场 {p['stance']} | "
        f"已有 {p['comment_count']} 条评论 | {p['content'][:200]}"
        for p in posts
    )
    roster = "\n".join(_persona_summary(a["persona"]) for a in participants)
    stances = " / ".join(STANCES)
    relations = " / ".join(RELATIONS)
    user = f"""主题：{topic_title}

待演化的帖子：
{post_lines}

参与 agent 名单（agent_id 必须从这个名单里选）：
{roster}

要求：
- 每个帖子补 1–2 条新评论，agent 尽量错开，不要一个 agent 刷屏。
- 评论用中文，8–300 字，像真实 Reddit 网友一样轻松随意。
- 再挑 2–5 个帖子点赞（like）。
严格按以下 JSON 结构输出（不要加 markdown 代码围栏）：
{{"comments": [{{"post_id": "...", "agent_id": "...", "content": "...", "stance": "supportive", "relation": "补充"}}],
  "likes": [{{"post_id": "...", "agent_id": "...", "reaction_type": "like"}}]}}
stance 只能是：{stances}；relation 只能是：{relations}。"""
    return [
        {"role": "system", "content": system},
        {"role": "user", "content": user},
    ]


def _persona_summary(persona: dict) -> str:
    traits = persona.get("traits") or []
    traits_text = "/".join(traits) if isinstance(traits, list) else str(traits)
    return (
        f"- agent_id={persona.get('agent_id')} | {persona.get('display_name')} (@{persona.get('handle')}) | "
        f"{persona.get('role')} | 语气：{persona.get('voice')} | 性格：{traits_text} | "
        f"关心：{persona.get('concern')} | 习惯：{persona.get('habit')} | 口头禅：{persona.get('catchphrase')}"
    )


# ---------------------------------------------------------------------------
# Parsing / normalization helpers
# ---------------------------------------------------------------------------


def _parse_action(raw: str) -> dict:
    """Parse a decision response; anything unusable degrades to do_nothing."""
    try:
        data = _extract_json(raw)
    except Exception:
        return {"action": "do_nothing", "reason": "parse failed"}
    if not isinstance(data, dict):
        return {"action": "do_nothing", "reason": "parse failed"}
    action = str(data.get("action") or "do_nothing")
    if action not in ("do_nothing", "create_post", "create_comment", "like", "dislike"):
        return {"action": "do_nothing", "reason": f"unknown action {action!r}"}
    return data


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
    raise ValueError("LLM output is not valid JSON")


def _normalize_stance(value: Any) -> str:
    return STANCE_ALIASES.get(str(value or "").strip().lower(), "neutral")


def _normalize_relation(value: Any) -> str:
    return RELATION_ALIASES.get(str(value or "").strip(), "补充")


# ---------------------------------------------------------------------------
# DB helpers
# ---------------------------------------------------------------------------


def _connect(db_path: Path) -> sqlite3.Connection:
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    return conn


def _current_tick_num(db_path: Path, world_id: str) -> int:
    conn = sqlite3.connect(db_path)
    try:
        row = conn.execute("SELECT COALESCE(MAX(round), 0) FROM events WHERE world_id = ?", (world_id,)).fetchone()
        return int(row[0])
    finally:
        conn.close()


def _next_tick_num(db_path: Path, world_id: str) -> int:
    return _current_tick_num(db_path, world_id) + 1


def _last_tick_at(db_path: Path, world_id: str) -> str:
    conn = _connect(db_path)
    try:
        row = conn.execute("SELECT MAX(created_at) FROM events WHERE world_id = ?", (world_id,)).fetchone()
        if row and row[0]:
            return row[0]
        row = conn.execute("SELECT created_at FROM worlds WHERE world_id = ?", (world_id,)).fetchone()
        return row[0] if row else now_iso()
    finally:
        conn.close()


def _recent_concept(db_path: Path, world_id: str) -> str | None:
    conn = sqlite3.connect(db_path)
    try:
        row = conn.execute(
            "SELECT concept_id FROM posts WHERE world_id = ? ORDER BY created_at DESC LIMIT 1",
            (world_id,),
        ).fetchone()
        return row[0] if row else None
    finally:
        conn.close()


def _comment_count(db_path: Path, post_id: str) -> int:
    conn = sqlite3.connect(db_path)
    try:
        row = conn.execute("SELECT comment_count FROM posts WHERE post_id = ?", (post_id,)).fetchone()
        return int(row[0]) if row else 0
    finally:
        conn.close()


def _load_posts(db_path: Path, world_id: str, limit: int, evolving: bool = False) -> list[dict]:
    order = (
        "p.is_hot DESC, p.heat DESC, p.comment_count DESC, p.created_at DESC"
        if evolving
        else "p.created_at DESC"
    )
    conn = _connect(db_path)
    try:
        rows = conn.execute(
            f"""
            SELECT p.post_id, p.concept_id, p.agent_id AS author_id, p.user_id,
                   p.content, p.stance, p.comment_count, p.is_hot, p.heat, p.created_at,
                   COALESCE(a.handle, CASE WHEN p.user_id IS NOT NULL THEN '用户' ELSE 'unknown' END) AS author
            FROM posts p LEFT JOIN agents a ON a.agent_id = p.agent_id
            WHERE p.world_id = ?
            ORDER BY {order} LIMIT ?
            """,
            (world_id, limit),
        ).fetchall()
        return [dict(r) for r in rows]
    finally:
        conn.close()


def _load_comments(db_path: Path, world_id: str, limit: int) -> list[dict]:
    conn = _connect(db_path)
    try:
        rows = conn.execute(
            """
            SELECT c.comment_id, c.post_id, c.parent_comment_id, c.agent_id AS author_id, c.user_id,
                   c.content, c.stance, c.relation, c.thread_path, c.heat, c.created_at, p.concept_id,
                   COALESCE(a.handle, CASE WHEN c.user_id IS NOT NULL THEN '用户' ELSE 'unknown' END) AS author
            FROM comments c
            JOIN posts p ON p.post_id = c.post_id
            LEFT JOIN agents a ON a.agent_id = c.agent_id
            WHERE p.world_id = ?
            ORDER BY c.created_at DESC LIMIT ?
            """,
            (world_id, limit),
        ).fetchall()
        return [dict(r) for r in rows]
    finally:
        conn.close()


def _load_timeline(db_path: Path, world_id: str, limit: int) -> tuple[list[dict], list[dict]]:
    """The freshest posts+comments as (prompt display items, belief seen items).

    Belief seen items deliberately avoid carrying a comment's post_id: the
    exposure dedup prefers post_id over comment_id, which would key a comment
    by its post and collide with the post itself.
    """
    posts = _load_posts(db_path, world_id, limit)
    comments = _load_comments(db_path, world_id, limit)
    merged = sorted(posts + comments, key=lambda x: x["created_at"], reverse=True)[:limit]
    display: list[dict] = []
    seen: list[dict] = []
    for item in merged:
        if "post_id" in item and "comment_id" not in item:
            display.append({
                "type": "post",
                "id": item["post_id"],
                "author": item["author"],
                "content": item["content"],
            })
            seen.append(_seen_item_for_post(item))
        else:
            display.append({
                "type": "comment",
                "id": item["comment_id"],
                "post_id": item["post_id"],
                "parent_comment_id": item["parent_comment_id"],
                "author": item["author"],
                "content": item["content"],
            })
            seen.append(_seen_item_for_comment(item))
    return display, seen


def _seen_item_for_post(post: dict) -> dict:
    return {
        "post_id": post["post_id"],
        "author_id": post.get("author_id"),
        "concept_id": post.get("concept_id"),
        "stance": post.get("stance"),
        "likes": post.get("heat", 0),
        "content": post.get("content", ""),
    }


def _seen_item_for_comment(comment: dict) -> dict:
    return {
        "comment_id": comment["comment_id"],
        "author_id": comment.get("author_id"),
        "concept_id": comment.get("concept_id"),
        "stance": comment.get("stance"),
        "likes": comment.get("heat", 0),
        "content": comment.get("content", ""),
    }


def _get_post(db_path: Path, world_id: str, post_id: str) -> dict | None:
    conn = _connect(db_path)
    try:
        row = conn.execute(
            """
            SELECT p.post_id, p.concept_id, p.agent_id AS author_id, p.user_id,
                   p.content, p.stance, p.comment_count, p.is_hot, p.heat, p.created_at,
                   COALESCE(a.handle, CASE WHEN p.user_id IS NOT NULL THEN '用户' ELSE 'unknown' END) AS author
            FROM posts p LEFT JOIN agents a ON a.agent_id = p.agent_id
            WHERE p.world_id = ? AND p.post_id = ?
            """,
            (world_id, post_id),
        ).fetchone()
        return dict(row) if row else None
    finally:
        conn.close()


def _get_comment(db_path: Path, comment_id: str) -> dict | None:
    conn = _connect(db_path)
    try:
        row = conn.execute(
            "SELECT comment_id, post_id, agent_id, user_id, content, stance, relation, thread_path, created_at FROM comments WHERE comment_id = ?",
            (comment_id,),
        ).fetchone()
        return dict(row) if row else None
    finally:
        conn.close()


def _op_candidates(db_path: Path, world_id: str, since: str) -> list[dict]:
    """Comments on agent-authored posts created after the last tick."""
    conn = _connect(db_path)
    try:
        rows = conn.execute(
            """
            SELECT c.comment_id, c.post_id, c.agent_id, c.user_id, c.stance, c.relation,
                   c.parent_comment_id, c.content, c.created_at,
                   p.agent_id AS op_id, p.content AS post_content, p.concept_id,
                   pc.agent_id AS parent_author,
                   COALESCE(a.handle, CASE WHEN c.user_id IS NOT NULL THEN '用户' ELSE 'unknown' END) AS author
            FROM comments c
            JOIN posts p ON p.post_id = c.post_id
            LEFT JOIN comments pc ON pc.comment_id = c.parent_comment_id
            LEFT JOIN agents a ON a.agent_id = c.agent_id
            WHERE p.world_id = ? AND p.agent_id IS NOT NULL AND c.created_at > ?
            ORDER BY c.created_at ASC LIMIT 20
            """,
            (world_id, since),
        ).fetchall()
        return [dict(r) for r in rows]
    finally:
        conn.close()


def _op_already_replied(db_path: Path, comment_id: str, op_id: str) -> bool:
    conn = sqlite3.connect(db_path)
    try:
        row = conn.execute(
            "SELECT 1 FROM comments WHERE parent_comment_id = ? AND agent_id = ? LIMIT 1",
            (comment_id, op_id),
        ).fetchone()
        return row is not None
    finally:
        conn.close()


def _insert_post(
    db_path: Path,
    world_id: str,
    concept_id: str,
    agent_id: str,
    content: str,
    stance: str,
    *,
    created_at: str | None = None,
    post_status: str = "active",
) -> str:
    post_id = str(uuid.uuid4())
    conn = sqlite3.connect(db_path)
    try:
        conn.execute(
            """
            INSERT INTO posts (post_id, world_id, concept_id, agent_id, user_id, shadow_entry_id,
                               content, stance, post_status, is_hot, comment_count, heat, created_at)
            VALUES (?, ?, ?, ?, NULL, NULL, ?, ?, ?, 0, 0, 0, ?)
            """,
            (post_id, world_id, concept_id, agent_id, content, stance, post_status, created_at or now_iso()),
        )
        conn.execute("UPDATE agents SET post_count = post_count + 1 WHERE agent_id = ?", (agent_id,))
        conn.commit()
    finally:
        conn.close()
    return post_id


def _insert_comment(
    db_path: Path,
    post_id: str,
    agent_id: str,
    content: str,
    stance: str,
    relation: str,
    parent_comment_id: str | None = None,
    *,
    batch_id: str | None = None,
    created_at: str | None = None,
) -> tuple[str, str]:
    """Insert one comment, maintaining thread_path (depth ≤ 3) and counters."""
    comment_id = str(uuid.uuid4())
    conn = _connect(db_path)
    try:
        parent_path = None
        if parent_comment_id:
            row = conn.execute(
                "SELECT thread_path FROM comments WHERE comment_id = ?", (parent_comment_id,)
            ).fetchone()
            if row is None:
                parent_comment_id = None
            else:
                parent_path = row[0]
        if parent_comment_id:
            parts = parent_path.split("/")
            if len(parts) >= 3:
                # Re-attach to the depth-2 ancestor so this lands at depth 3.
                ancestor_path = "/".join(parts[:2])
                row = conn.execute(
                    "SELECT comment_id, thread_path FROM comments WHERE post_id = ? AND thread_path = ?",
                    (post_id, ancestor_path),
                ).fetchone()
                parent_comment_id, parent_path = row[0], row[1]
            idx = conn.execute(
                "SELECT COUNT(*) FROM comments WHERE post_id = ? AND parent_comment_id = ?",
                (post_id, parent_comment_id),
            ).fetchone()[0] + 1
            thread_path = f"{parent_path}/{idx}"
        else:
            idx = conn.execute(
                "SELECT COUNT(*) FROM comments WHERE post_id = ? AND parent_comment_id IS NULL",
                (post_id,),
            ).fetchone()[0] + 1
            thread_path = str(idx)
        conn.execute(
            """
            INSERT INTO comments (comment_id, post_id, parent_comment_id, agent_id, user_id,
                                  content, stance, relation, thread_path, batch_id, heat, created_at)
            VALUES (?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, 0, ?)
            """,
            (comment_id, post_id, parent_comment_id, agent_id, content, stance, relation,
             thread_path, batch_id, created_at or now_iso()),
        )
        conn.execute("UPDATE posts SET comment_count = comment_count + 1 WHERE post_id = ?", (post_id,))
        conn.execute("UPDATE agents SET comment_count = comment_count + 1 WHERE agent_id = ?", (agent_id,))
        conn.commit()
    finally:
        conn.close()
    return comment_id, thread_path


def _insert_reaction(
    db_path: Path,
    target_type: str,
    target_id: str,
    agent_id: str,
    reaction_type: str,
    *,
    created_at: str | None = None,
) -> bool:
    """Upsert a reaction and recalc heat; returns True for a brand-new row."""
    conn = _connect(db_path)
    try:
        existing = conn.execute(
            "SELECT reaction_id, reaction_type FROM reactions WHERE target_type = ? AND target_id = ? AND agent_id = ?",
            (target_type, target_id, agent_id),
        ).fetchone()
        if existing:
            conn.execute(
                "UPDATE reactions SET reaction_type = ? WHERE reaction_id = ?",
                (reaction_type, existing[0]),
            )
            inserted = False
        else:
            conn.execute(
                "INSERT INTO reactions (reaction_id, target_type, target_id, agent_id, reaction_type, created_at) VALUES (?, ?, ?, ?, ?, ?)",
                (str(uuid.uuid4()), target_type, target_id, agent_id, reaction_type, created_at or now_iso()),
            )
            inserted = True
        likes = conn.execute(
            "SELECT COUNT(*) FROM reactions WHERE target_type = ? AND target_id = ? AND reaction_type = 'like'",
            (target_type, target_id),
        ).fetchone()[0]
        dislikes = conn.execute(
            "SELECT COUNT(*) FROM reactions WHERE target_type = ? AND target_id = ? AND reaction_type = 'dislike'",
            (target_type, target_id),
        ).fetchone()[0]
        heat = max(0, likes * 12 - dislikes * 8)
        table = "posts" if target_type == "post" else "comments"
        conn.execute(f"UPDATE {table} SET heat = ? WHERE {table[:-1]}_id = ?", (heat, target_id))
        if inserted:
            author = conn.execute(
                f"SELECT agent_id FROM {table} WHERE {table[:-1]}_id = ?", (target_id,)
            ).fetchone()
            if author and author[0]:
                karma = 1 if reaction_type == "like" else -1
                conn.execute("UPDATE agents SET karma = karma + ? WHERE agent_id = ?", (karma, author[0]))
        conn.commit()
    finally:
        conn.close()
    return inserted


def _save_belief(db_path: Path, agent_id: str, belief: BeliefState) -> None:
    conn = sqlite3.connect(db_path)
    try:
        conn.execute(
            "UPDATE agents SET belief_json = ? WHERE agent_id = ?",
            (json.dumps(belief.to_dict(), ensure_ascii=False), agent_id),
        )
        conn.commit()
    finally:
        conn.close()


def _maybe_mark_hot(db_path: Path, post_id: str) -> bool:
    conn = sqlite3.connect(db_path)
    try:
        row = conn.execute(
            "SELECT comment_count, is_hot FROM posts WHERE post_id = ?", (post_id,)
        ).fetchone()
        if row and not row[1] and row[0] >= HOT_COMMENT_THRESHOLD:
            conn.execute("UPDATE posts SET is_hot = 1 WHERE post_id = ?", (post_id,))
            conn.commit()
            return True
        return False
    finally:
        conn.close()


def _log_event(
    db_path: Path,
    world_id: str,
    tick_num: int,
    phase: str,
    agent_id: str | None,
    action: str,
    payload: dict,
) -> None:
    conn = sqlite3.connect(db_path)
    try:
        conn.execute(
            "INSERT INTO events (world_id, round, phase, agent_id, action, payload_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
            (world_id, tick_num, phase, agent_id, action, json.dumps(payload, ensure_ascii=False), now_iso()),
        )
        conn.commit()
    finally:
        conn.close()


# ---------------------------------------------------------------------------
# Timestamp helpers
# ---------------------------------------------------------------------------


def _iso(dt: datetime) -> str:
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.isoformat()


def _parse_ts(value: Any) -> datetime | None:
    if value is None:
        return None
    if isinstance(value, datetime):
        return value if value.tzinfo else value.replace(tzinfo=timezone.utc)
    try:
        dt = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError:
        return None
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def _coerce_dt(value: Any) -> datetime | None:
    return _parse_ts(value)
