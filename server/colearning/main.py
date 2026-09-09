"""FastAPI app for the co-learning engine."""

import importlib.util
import json
import os
import sqlite3
import sys
import uuid
from contextlib import asynccontextmanager
from dataclasses import asdict, is_dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from fastapi import BackgroundTasks, FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware

from agent_manager import build_world_roster, load_roster
from db import init_db, create_world, get_world, list_worlds, insert_agent, now_iso
from models import (
    CreateWorldRequest,
    CreateWorldResponse,
    AgentOut,
    FeedResponse,
    FeedPostOut,
    PostDetailResponse,
    CommentOut,
    ShadowEntryRequest,
    ShadowEntryResponse,
    AdvanceRequest,
    StatusResponse,
    AgentCommentItem,
    AgentPostItem,
    AgentProfileResponse,
    CommunityCommentOut,
    CommunityFeedPost,
    CommunityFeedRequest,
    CommunityFeedResponse,
    CommunityPostDetailResponse,
    CommunityStatusResponse,
    CreateCommunityWorldRequest,
    CreateCommunityWorldResponse,
    FollowRequest,
    FollowResponse,
    InitResponse,
    NewCommentRequest,
    NewCommentResponse,
    NewPostRequest,
    NewPostResponse,
    ReactionRequest,
    ReactionResponse,
    TickResponse,
)
from personas import generate_personas
from recommender import UserContext, get_feed as recommend_feed
from scheduler import Scheduler

DB_PATH = Path(os.environ.get("COLEARNING_DB_PATH", "./colearning.db"))


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db(DB_PATH)
    app.state.scheduler = Scheduler(DB_PATH)
    yield


app = FastAPI(title="KnowFeed Co-Learning Engine", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_methods=["*"],
    allow_headers=["*"],
)


def _agent_out(row: dict) -> AgentOut:
    return AgentOut(
        agent_id=row["agent_id"],
        display_name=row["display_name"],
        handle=row["handle"],
        bio=row["bio"],
    )


@app.post("/api/colearning/worlds", response_model=CreateWorldResponse)
async def create_world_endpoint(req: CreateWorldRequest):
    world_id = create_world(
        DB_PATH,
        req.session_key,
        req.topic_id,
        req.topic_title,
        req.current_concept_id,
    )
    personas = generate_personas(req.topic_title, count=25)
    for persona in personas:
        insert_agent(DB_PATH, world_id, persona)

    # Seed initial posts for the current concept
    scheduler: Scheduler = app.state.scheduler
    await scheduler.advance(
        world_id,
        req.topic_title,
        req.current_concept_id or "concept-1",
        req.concept_title or req.topic_title,
        personas,
        lesson_snippet=None,
    )

    agents = [{"agent_id": p.agent_id, "display_name": p.display_name, "handle": p.handle, "bio": p.bio} for p in personas[:8]]
    return CreateWorldResponse(world_id=world_id, agents=[_agent_out(a) for a in agents])


@app.get("/api/colearning/worlds/{world_id}/feed", response_model=FeedResponse)
async def get_feed(world_id: str, concept_id: str | None = None):
    import sqlite3
    world = get_world(DB_PATH, world_id)
    if not world:
        raise HTTPException(status_code=404, detail="World not found")
    target_concept = concept_id or world["current_concept_id"]
    if not target_concept:
        raise HTTPException(status_code=400, detail="No concept specified")

    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    try:
        rows = conn.execute(
            """
            SELECT p.*, a.display_name, a.handle, a.bio,
                   (SELECT COUNT(*) FROM comments WHERE post_id = p.post_id) as comment_count,
                   (SELECT COUNT(*) FROM reactions WHERE target_type = 'post' AND target_id = p.post_id AND reaction_type = 'like') as like_count,
                   (SELECT COUNT(*) FROM reactions WHERE target_type = 'post' AND target_id = p.post_id AND reaction_type = 'dislike') as dislike_count
            FROM posts p
            LEFT JOIN agents a ON p.agent_id = a.agent_id
            WHERE p.world_id = ? AND p.concept_id = ?
            ORDER BY p.heat DESC, p.created_at DESC
            """,
            (world_id, target_concept),
        ).fetchall()
    finally:
        conn.close()

    posts = []
    for row in rows:
        author = None
        if row["agent_id"]:
            author = AgentOut(agent_id=row["agent_id"], display_name=row["display_name"], handle=row["handle"], bio=row["bio"])
        posts.append(FeedPostOut(
            post_id=row["post_id"],
            concept_id=row["concept_id"],
            agent_id=row["agent_id"],
            author=author,
            content=row["content"],
            stance=row["stance"],
            heat=row["heat"],
            comment_count=row["comment_count"],
            like_count=row["like_count"],
            dislike_count=row["dislike_count"],
            created_at=row["created_at"],
        ))
    return FeedResponse(world_id=world_id, concept_id=target_concept, posts=posts)


@app.get("/api/colearning/posts/{post_id}", response_model=PostDetailResponse)
async def get_post(post_id: str):
    import sqlite3
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    try:
        post_row = conn.execute(
            """
            SELECT p.*, a.display_name, a.handle, a.bio,
                   (SELECT COUNT(*) FROM reactions WHERE target_type = 'post' AND target_id = p.post_id AND reaction_type = 'like') as like_count,
                   (SELECT COUNT(*) FROM reactions WHERE target_type = 'post' AND target_id = p.post_id AND reaction_type = 'dislike') as dislike_count
            FROM posts p LEFT JOIN agents a ON p.agent_id = a.agent_id
            WHERE p.post_id = ?
            """,
            (post_id,),
        ).fetchone()
        if not post_row:
            raise HTTPException(status_code=404, detail="Post not found")

        comment_rows = conn.execute(
            """
            SELECT c.*, a.display_name, a.handle, a.bio,
                   (SELECT COUNT(*) FROM reactions WHERE target_type = 'comment' AND target_id = c.comment_id AND reaction_type = 'like') as like_count,
                   (SELECT COUNT(*) FROM reactions WHERE target_type = 'comment' AND target_id = c.comment_id AND reaction_type = 'dislike') as dislike_count
            FROM comments c LEFT JOIN agents a ON c.agent_id = a.agent_id
            WHERE c.post_id = ?
            ORDER BY c.heat DESC, c.created_at ASC
            """,
            (post_id,),
        ).fetchall()
    finally:
        conn.close()

    def build_comment(row):
        author = None
        if row["agent_id"]:
            author = AgentOut(agent_id=row["agent_id"], display_name=row["display_name"], handle=row["handle"], bio=row["bio"])
        return CommentOut(
            comment_id=row["comment_id"],
            parent_comment_id=row["parent_comment_id"],
            agent_id=row["agent_id"],
            author=author,
            content=row["content"],
            stance=row["stance"],
            relation=row["relation"],
            heat=row["heat"],
            like_count=row["like_count"],
            dislike_count=row["dislike_count"],
            created_at=row["created_at"],
            replies=[],
        )

    comment_map = {row["comment_id"]: build_comment(row) for row in comment_rows}
    top_level = []
    for c in comment_map.values():
        if c.parent_comment_id and c.parent_comment_id in comment_map:
            comment_map[c.parent_comment_id].replies.append(c)
        else:
            top_level.append(c)

    post_author = None
    if post_row["agent_id"]:
        post_author = AgentOut(agent_id=post_row["agent_id"], display_name=post_row["display_name"], handle=post_row["handle"], bio=post_row["bio"])
    return PostDetailResponse(
        post_id=post_row["post_id"],
        concept_id=post_row["concept_id"],
        agent_id=post_row["agent_id"],
        author=post_author,
        content=post_row["content"],
        stance=post_row["stance"],
        heat=post_row["heat"],
        like_count=post_row["like_count"],
        dislike_count=post_row["dislike_count"],
        created_at=post_row["created_at"],
        comments=top_level,
    )


@app.post("/api/colearning/worlds/{world_id}/shadow", response_model=ShadowEntryResponse)
async def submit_shadow(world_id: str, req: ShadowEntryRequest):
    import sqlite3, uuid
    from db import now_iso
    entry_id = str(uuid.uuid4())
    conn = sqlite3.connect(DB_PATH)
    try:
        conn.execute(
            "INSERT INTO shadow_entries (entry_id, world_id, concept_id, user_id, content, status, created_at) VALUES (?, ?, ?, ?, ?, 'live', ?)",
            (entry_id, world_id, req.concept_id, req.user_id, req.content, now_iso()),
        )
        conn.commit()
    finally:
        conn.close()
    return ShadowEntryResponse(entry_id=entry_id, status="live")


@app.post("/api/colearning/worlds/{world_id}/advance")
async def advance_world(world_id: str, req: AdvanceRequest):
    world = get_world(DB_PATH, world_id)
    if not world:
        raise HTTPException(status_code=404, detail="World not found")
    scheduler: Scheduler = app.state.scheduler
    result = await scheduler.advance(
        world_id,
        world["topic_title"],
        req.concept_id or world["current_concept_id"],
        req.concept_title or world["topic_title"],
        [],  # personas loaded inside scheduler from DB
        req.lesson_snippet,
    )
    return {"world_id": world_id, "created": result}


@app.get("/api/colearning/worlds/{world_id}/status", response_model=StatusResponse)
async def world_status(world_id: str):
    import sqlite3
    world = get_world(DB_PATH, world_id)
    if not world:
        raise HTTPException(status_code=404, detail="World not found")
    conn = sqlite3.connect(DB_PATH)
    try:
        agent_count = conn.execute("SELECT COUNT(*) FROM agents WHERE world_id = ?", (world_id,)).fetchone()[0]
        post_count = conn.execute("SELECT COUNT(*) FROM posts WHERE world_id = ?", (world_id,)).fetchone()[0]
        comment_count = conn.execute(
            "SELECT COUNT(*) FROM comments WHERE post_id IN (SELECT post_id FROM posts WHERE world_id = ?)",
            (world_id,),
        ).fetchone()[0]
    finally:
        conn.close()
    return StatusResponse(
        world_id=world_id,
        topic_id=world["topic_id"],
        current_concept_id=world["current_concept_id"],
        status=world["status"],
        agent_count=agent_count,
        post_count=post_count,
        comment_count=comment_count,
    )


# ---------------------------------------------------------------------------
# Learning community routes (spec section 9)
#
# tick_engine.py and world_init.py ship from a parallel workstream. Their
# real signatures (imported lazily so the app boots without them; all call
# sites go through the wrappers below so a signature drift is a one-line fix):
#   tick_engine.catchup_mode(last_tick_at: str, now) -> str
#       "none" | "normal" | "condensed" | "deep"   (spec 6.4 tiers)
#   tick_engine.run_tick(db_path, world_id) -> TickResult            (async)
#   tick_engine.run_mini_tick(db_path, world_id, target_post_id, *,
#                             user_comment_id=None) -> MiniTickResult (async)
#   tick_engine.run_catchup(db_path, world_id) -> CatchupResult      (async;
#       the >24h "deep" tier runs its 1-3 condensed ticks internally and
#       carries the "while you were away" briefing, spec 6.4)
#   tick_engine._get_lock(world_id) -> asyncio.Lock: lock-state probe behind
#       the tick_already_running guard (tick_lock(world_id) is the blocking
#       async CM the engine itself acquires, spec 6.5)
#   world_init.needs_initialization(db_path, world_id) -> bool
#   world_init.initialize_world(db_path, world_id, topic, concept_ids) -> InitResult  (async)
# ---------------------------------------------------------------------------

MAX_COMMENT_DEPTH = 3  # spec section 13: comment nesting capped at 3 levels


def _optional_module(name: str) -> Any:
    """Return an importable module by name, or None when it has not landed yet."""
    if name in sys.modules:
        return sys.modules[name]
    try:
        if importlib.util.find_spec(name) is None:
            return None
    except (ImportError, ValueError):
        return None
    try:
        return importlib.import_module(name)
    except ImportError:
        return None


def _tick_engine() -> Any:
    return _optional_module("tick_engine")


def _world_init() -> Any:
    return _optional_module("world_init")


@asynccontextmanager
async def _world_tick_lock(tick_engine: Any, world_id: str):
    """Non-blocking entry guard on tick_engine's per-world tick lock.

    Yields True when no tick is running for this world and the caller may
    start one; False means another tick is already running and the caller
    should serve current state instead of duplicating work (spec 6.5).
    run_tick / run_catchup acquire the real asyncio lock themselves, so the
    guard only covers the entry decision — never hold it across an engine
    call, or the engine would see its own lock as busy and no-op.
    """
    lock = tick_engine._get_lock(world_id)
    yield not lock.locked()


async def _run_mini_tick_bg(
    db_path: Path,
    world_id: str,
    target_post_id: str | None = None,
    user_comment_id: str | None = None,
) -> None:
    """BackgroundTasks entry point: resolve tick_engine lazily, then mini-tick.

    Starlette awaits async background tasks, and tick_engine.run_mini_tick is
    a coroutine taking (db_path, world_id, target_post_id, *,
    user_comment_id=None) — calling it without await would silently drop the
    mini-tick, so this wrapper is a coroutine just like _initialize_world_bg.
    """
    tick_engine = _tick_engine()
    if tick_engine is None:
        return
    await tick_engine.run_mini_tick(
        db_path, world_id, target_post_id, user_comment_id=user_comment_id
    )


async def _initialize_world_bg(db_path: Path, world_id: str) -> None:
    """BackgroundTasks entry point: resolve world_init lazily, then initialize.

    Starlette awaits async background tasks, and world_init.initialize_world
    is a coroutine taking (db_path, world_id, topic, concept_ids).
    """
    world_init = _world_init()
    if world_init is None:
        return
    world = get_world(db_path, world_id)
    if not world:
        return
    concept_ids = [world["current_concept_id"]] if world["current_concept_id"] else []
    await world_init.initialize_world(db_path, world_id, world["topic_title"], concept_ids)


def _touch_world_updated(db_path: Path, world_id: str) -> None:
    """Stamp worlds.updated_at; it doubles as the last-tick marker (spec 6.4)."""
    conn = sqlite3.connect(db_path)
    try:
        conn.execute("UPDATE worlds SET updated_at = ? WHERE world_id = ?", (now_iso(), world_id))
        conn.commit()
    finally:
        conn.close()


async def _tick_on_entry(db_path: Path, world: dict) -> tuple[bool, str | None, dict | None]:
    """Run the tick / catch-up implied by a feed entry (spec 6.1, 6.4).

    Returns (ticked, mode, briefing). Never raises: a failing or busy tick
    must not take the feed down — the user keeps browsing current content.
    """
    tick_engine = _tick_engine()
    if tick_engine is None:
        return False, None, None
    world_id = world["world_id"]
    try:
        mode = tick_engine.catchup_mode(world["updated_at"], datetime.now(timezone.utc)) or "none"
    except Exception:
        return False, None, None
    if mode not in ("normal", "condensed", "deep"):
        return False, mode, None
    async with _world_tick_lock(tick_engine, world_id) as acquired:
        if not acquired:
            return False, mode, None
        try:
            briefing = None
            if mode == "normal":
                await tick_engine.run_tick(db_path, world_id)
            else:
                # run_catchup re-derives the tier from the idle gap itself;
                # the >24h "deep" tier runs its 1-3 condensed ticks
                # internally and returns the briefing (spec 6.4).
                result = await tick_engine.run_catchup(db_path, world_id)
                briefing = getattr(result, "briefing", None) or None
            _touch_world_updated(db_path, world_id)
            return True, mode, briefing
        except Exception:
            return False, mode, None


def _ensure_community_schema(db_path: Path) -> None:
    """Patch the reactions table to the spec 3.1 shape when needed.

    The current db.py schema has reactions.agent_id NOT NULL and no user_id
    column, so user reactions cannot be stored yet. db.py is owned by a
    parallel workstream; until its migration lands, patch the table here the
    same way agent_manager.ensure_agent_schema does. Idempotent.
    """
    new_table_ddl = """
        CREATE TABLE reactions_new (
            reaction_id TEXT PRIMARY KEY,
            target_type TEXT NOT NULL CHECK(target_type IN ('post', 'comment')),
            target_id TEXT NOT NULL,
            agent_id TEXT REFERENCES agents(agent_id) ON DELETE CASCADE,
            user_id TEXT,
            reaction_type TEXT NOT NULL CHECK(reaction_type IN ('like', 'dislike')),
            created_at TEXT NOT NULL
        );
    """
    conn = sqlite3.connect(db_path)
    try:
        info = conn.execute("PRAGMA table_info(reactions)").fetchall()
        if not info:
            conn.execute(new_table_ddl.replace("reactions_new", "reactions"))
            conn.commit()
            return
        columns = {row[1] for row in info}
        if "user_id" not in columns:
            conn.execute("ALTER TABLE reactions ADD COLUMN user_id TEXT")
        agent_notnull = any(row[1] == "agent_id" and row[3] for row in info)
        if agent_notnull:
            # SQLite cannot drop a NOT NULL constraint via ALTER; rebuild.
            conn.executescript(
                new_table_ddl
                + """
                INSERT INTO reactions_new (reaction_id, target_type, target_id, agent_id, user_id, reaction_type, created_at)
                    SELECT reaction_id, target_type, target_id, agent_id, user_id, reaction_type, created_at FROM reactions;
                DROP TABLE reactions;
                ALTER TABLE reactions_new RENAME TO reactions;
                """
            )
        conn.commit()
    finally:
        conn.close()


def _comment_depth(conn: sqlite3.Connection, comment_id: str) -> int:
    """Depth of an existing comment (1 = top level), walking parent links."""
    depth = 1
    current = comment_id
    for _ in range(8):  # hop cap guards against a parent cycle
        row = conn.execute(
            "SELECT parent_comment_id FROM comments WHERE comment_id = ?", (current,)
        ).fetchone()
        if not row or not row["parent_comment_id"]:
            return depth
        current = row["parent_comment_id"]
        depth += 1
    return depth


def _next_thread_path(conn: sqlite3.Connection, post_id: str, parent: Any) -> str:
    """1-based sibling index appended to the parent's path ("1/3/2" style)."""
    if parent is None:
        siblings = conn.execute(
            "SELECT COUNT(*) FROM comments WHERE post_id = ? AND parent_comment_id IS NULL",
            (post_id,),
        ).fetchone()[0]
        return str(siblings + 1)
    siblings = conn.execute(
        "SELECT COUNT(*) FROM comments WHERE parent_comment_id = ?", (parent["comment_id"],)
    ).fetchone()[0]
    base = parent["thread_path"] or parent["comment_id"]
    return f"{base}/{siblings + 1}"


def _count_targets(conn: sqlite3.Connection, world_id: str) -> dict[str, int]:
    """Aggregate counters for the community status endpoint."""
    agent_count = conn.execute("SELECT COUNT(*) FROM agents WHERE world_id = ?", (world_id,)).fetchone()[0]
    post_count = conn.execute("SELECT COUNT(*) FROM posts WHERE world_id = ?", (world_id,)).fetchone()[0]
    comment_count = conn.execute(
        "SELECT COUNT(*) FROM comments c JOIN posts p ON c.post_id = p.post_id WHERE p.world_id = ?",
        (world_id,),
    ).fetchone()[0]
    reaction_count = conn.execute(
        """
        SELECT COUNT(*) FROM reactions r
        WHERE (r.target_type = 'post' AND r.target_id IN (SELECT post_id FROM posts WHERE world_id = ?))
           OR (r.target_type = 'comment' AND r.target_id IN (
                SELECT c.comment_id FROM comments c JOIN posts p ON c.post_id = p.post_id WHERE p.world_id = ?))
        """,
        (world_id, world_id),
    ).fetchone()[0]
    follow_count = conn.execute(
        "SELECT COUNT(*) FROM follows f JOIN agents a ON f.followee_id = a.agent_id WHERE a.world_id = ?",
        (world_id,),
    ).fetchone()[0]
    return {
        "agent_count": agent_count,
        "post_count": post_count,
        "comment_count": comment_count,
        "reaction_count": reaction_count,
        "follow_count": follow_count,
    }


@app.post("/api/community/worlds", response_model=CreateCommunityWorldResponse)
def create_community_world(req: CreateCommunityWorldRequest, background_tasks: BackgroundTasks):
    """Create a community world, or restore the existing one for session+topic.

    A fresh world gets its 25-30 agent roster synchronously (local, no LLM)
    and historical content initialization scheduled in the background when
    world_init says it is still needed (spec 6.1, 12 step 7).
    """
    existing = next(
        (w for w in list_worlds(DB_PATH, req.session_key) if w["topic_id"] == req.topic_id),
        None,
    )
    restored = existing is not None
    if restored:
        world_id = existing["world_id"]
        status = existing["status"]
    else:
        world_id = create_world(
            DB_PATH, req.session_key, req.topic_id, req.topic_title, req.current_concept_id
        )
        concept_ids = req.concept_ids or ([req.current_concept_id] if req.current_concept_id else [])
        build_world_roster(DB_PATH, world_id, req.topic_title, concept_ids)
        status = "active"

    initialization_scheduled = False
    world_init = _world_init()
    if world_init is not None:
        try:
            if world_init.needs_initialization(DB_PATH, world_id):
                background_tasks.add_task(_initialize_world_bg, DB_PATH, world_id)
                initialization_scheduled = True
        except Exception:
            initialization_scheduled = False

    return CreateCommunityWorldResponse(
        world_id=world_id,
        restored=restored,
        agent_count=len(load_roster(DB_PATH, world_id)),
        initialization_scheduled=initialization_scheduled,
        status=status,
    )


@app.post("/api/community/worlds/{world_id}/feed", response_model=CommunityFeedResponse)
async def community_feed(world_id: str, req: CommunityFeedRequest):
    """Ranked feed with reason tags (spec 7).

    Entry triggers the due tick/catch-up first (spec 6.1, 6.4); a >24h
    catch-up also returns the "while you were away" briefing card.
    """
    world = get_world(DB_PATH, world_id)
    if not world:
        raise HTTPException(status_code=404, detail="World not found")

    ticked, tick_mode, briefing = await _tick_on_entry(DB_PATH, world)

    user_ctx = UserContext(
        background=req.background,
        goal=req.goal,
        motivation=req.motivation,
        known_areas=req.known_areas,
        avoided_styles=req.avoided_styles,
        review_queue=req.review_queue,
        current_concept_id=req.current_concept_id,
        seen_post_ids=set(req.seen_post_ids),
        preferences=req.preferences,
    )
    page = recommend_feed(DB_PATH, world_id, user_ctx, limit=req.limit, cursor=req.cursor)
    if page is None:  # world deleted between the checks; treat as missing
        raise HTTPException(status_code=404, detail="World not found")
    return CommunityFeedResponse(
        world_id=world_id,
        posts=page["posts"],
        next_cursor=page["next_cursor"],
        briefing=briefing,
        ticked=ticked,
        tick_mode=tick_mode,
    )


@app.get("/api/community/posts/{post_id}", response_model=CommunityPostDetailResponse)
def community_post_detail(post_id: str):
    """Post plus its full comment tree, pruned to 3 nesting levels (spec 8.2, 13)."""
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    try:
        post_row = conn.execute(
            """
            SELECT p.*, a.display_name, a.handle, a.bio,
                   (SELECT COUNT(*) FROM reactions WHERE target_type = 'post' AND target_id = p.post_id AND reaction_type = 'like') as like_count,
                   (SELECT COUNT(*) FROM reactions WHERE target_type = 'post' AND target_id = p.post_id AND reaction_type = 'dislike') as dislike_count,
                   (SELECT COUNT(*) FROM comments WHERE post_id = p.post_id) as live_comment_count
            FROM posts p LEFT JOIN agents a ON p.agent_id = a.agent_id
            WHERE p.post_id = ?
            """,
            (post_id,),
        ).fetchone()
        if not post_row:
            raise HTTPException(status_code=404, detail="Post not found")

        comment_rows = conn.execute(
            """
            SELECT c.*, a.display_name, a.handle, a.bio,
                   (SELECT COUNT(*) FROM reactions WHERE target_type = 'comment' AND target_id = c.comment_id AND reaction_type = 'like') as like_count,
                   (SELECT COUNT(*) FROM reactions WHERE target_type = 'comment' AND target_id = c.comment_id AND reaction_type = 'dislike') as dislike_count
            FROM comments c LEFT JOIN agents a ON c.agent_id = a.agent_id
            WHERE c.post_id = ?
            ORDER BY c.created_at ASC
            """,
            (post_id,),
        ).fetchall()
    finally:
        conn.close()

    def build_comment(row) -> CommunityCommentOut:
        author = None
        if row["agent_id"]:
            author = AgentOut(
                agent_id=row["agent_id"],
                display_name=row["display_name"],
                handle=row["handle"],
                bio=row["bio"],
            )
        return CommunityCommentOut(
            comment_id=row["comment_id"],
            parent_comment_id=row["parent_comment_id"],
            agent_id=row["agent_id"],
            user_id=row["user_id"],
            author=author,
            content=row["content"],
            stance=row["stance"],
            relation=row["relation"],
            thread_path=row["thread_path"],
            heat=row["heat"],
            like_count=row["like_count"],
            dislike_count=row["dislike_count"],
            is_op=bool(post_row["agent_id"]) and row["agent_id"] == post_row["agent_id"],
            created_at=row["created_at"],
            replies=[],
        )

    comment_map = {row["comment_id"]: build_comment(row) for row in comment_rows}

    depths: dict[str, int] = {}

    def depth_of(comment_id: str) -> int:
        if comment_id in depths:
            return depths[comment_id]
        node = comment_map[comment_id]
        parent_id = node.parent_comment_id
        depth = depth_of(parent_id) + 1 if parent_id and parent_id in comment_map else 1
        depths[comment_id] = depth
        return depth

    top_level: list[CommunityCommentOut] = []
    for comment_id, node in comment_map.items():
        if depth_of(comment_id) > MAX_COMMENT_DEPTH:
            continue  # prune anything below 3 levels (spec section 13)
        parent_id = node.parent_comment_id
        if parent_id and parent_id in comment_map and depth_of(parent_id) <= MAX_COMMENT_DEPTH:
            comment_map[parent_id].replies.append(node)
        else:
            top_level.append(node)
    # comment_map iterates in created_at ASC order, so replies are chronological;
    # top level surfaces heated threads first.
    top_level.sort(key=lambda c: (-c.heat, c.created_at))

    post_author = None
    if post_row["agent_id"]:
        post_author = AgentOut(
            agent_id=post_row["agent_id"],
            display_name=post_row["display_name"],
            handle=post_row["handle"],
            bio=post_row["bio"],
        )
    return CommunityPostDetailResponse(
        post_id=post_row["post_id"],
        world_id=post_row["world_id"],
        concept_id=post_row["concept_id"],
        agent_id=post_row["agent_id"],
        user_id=post_row["user_id"],
        author=post_author,
        content=post_row["content"],
        stance=post_row["stance"],
        post_status=post_row["post_status"],
        is_hot=bool(post_row["is_hot"]),
        heat=post_row["heat"],
        comment_count=post_row["live_comment_count"],
        like_count=post_row["like_count"],
        dislike_count=post_row["dislike_count"],
        created_at=post_row["created_at"],
        comments=top_level,
    )


@app.post("/api/community/posts", response_model=NewPostResponse)
def create_user_post(req: NewPostRequest, background_tasks: BackgroundTasks):
    """Persist a user post and schedule an asynchronous mini-tick (spec 6.3)."""
    world = get_world(DB_PATH, req.world_id)
    if not world:
        raise HTTPException(status_code=404, detail="World not found")
    concept_id = req.concept_id or world["current_concept_id"]
    if not concept_id:
        raise HTTPException(status_code=400, detail="concept_id required")

    post_id = str(uuid.uuid4())
    ts = now_iso()
    conn = sqlite3.connect(DB_PATH)
    try:
        conn.execute(
            """
            INSERT INTO posts (post_id, world_id, concept_id, agent_id, user_id, content, stance, post_status, is_hot, comment_count, heat, created_at)
            VALUES (?, ?, ?, NULL, ?, ?, ?, 'user', 0, 0, 0, ?)
            """,
            (post_id, req.world_id, concept_id, req.user_id, req.content, req.stance, ts),
        )
        conn.commit()
    finally:
        conn.close()

    background_tasks.add_task(_run_mini_tick_bg, DB_PATH, req.world_id, target_post_id=post_id)
    return NewPostResponse(
        post_id=post_id, world_id=req.world_id, status="awaiting_responses", created_at=ts
    )


@app.post("/api/community/comments", response_model=NewCommentResponse)
def create_user_comment(req: NewCommentRequest, background_tasks: BackgroundTasks):
    """Persist a user comment (max 3 nesting levels) and schedule a mini-tick."""
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    try:
        post = conn.execute(
            "SELECT post_id, world_id FROM posts WHERE post_id = ?", (req.post_id,)
        ).fetchone()
        if not post:
            raise HTTPException(status_code=404, detail="Post not found")

        parent = None
        if req.parent_comment_id:
            parent = conn.execute(
                "SELECT comment_id, post_id, thread_path FROM comments WHERE comment_id = ?",
                (req.parent_comment_id,),
            ).fetchone()
            if not parent:
                raise HTTPException(status_code=404, detail="Parent comment not found")
            if parent["post_id"] != req.post_id:
                raise HTTPException(status_code=400, detail="Parent comment belongs to another post")
            if _comment_depth(conn, req.parent_comment_id) >= MAX_COMMENT_DEPTH:
                raise HTTPException(status_code=400, detail="评论嵌套最多 3 层")

        comment_id = str(uuid.uuid4())
        ts = now_iso()
        thread_path = _next_thread_path(conn, req.post_id, parent)
        conn.execute(
            """
            INSERT INTO comments (comment_id, post_id, parent_comment_id, agent_id, user_id, content, stance, relation, thread_path, batch_id, heat, created_at)
            VALUES (?, ?, ?, NULL, ?, ?, ?, '补充', ?, NULL, 0, ?)
            """,
            (
                comment_id,
                req.post_id,
                req.parent_comment_id,
                req.user_id,
                req.content,
                req.stance,
                thread_path,
                ts,
            ),
        )
        conn.execute(
            "UPDATE posts SET comment_count = comment_count + 1 WHERE post_id = ?", (req.post_id,)
        )
        conn.commit()
    finally:
        conn.close()

    background_tasks.add_task(
        _run_mini_tick_bg, DB_PATH, post["world_id"], target_post_id=req.post_id, user_comment_id=comment_id
    )
    return NewCommentResponse(
        comment_id=comment_id,
        post_id=req.post_id,
        thread_path=thread_path,
        status="awaiting_responses",
        created_at=ts,
    )


@app.post("/api/community/reactions", response_model=ReactionResponse)
def create_reaction(req: ReactionRequest):
    """Upsert a user like/dislike; re-sending the same reaction is a no-op."""
    _ensure_community_schema(DB_PATH)
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    try:
        if req.target_type == "post":
            target = conn.execute("SELECT post_id AS id FROM posts WHERE post_id = ?", (req.target_id,)).fetchone()
        else:
            target = conn.execute("SELECT comment_id AS id FROM comments WHERE comment_id = ?", (req.target_id,)).fetchone()
        if not target:
            raise HTTPException(status_code=404, detail=f"{req.target_type.capitalize()} not found")

        existing = conn.execute(
            "SELECT reaction_id, reaction_type FROM reactions WHERE target_type = ? AND target_id = ? AND user_id = ?",
            (req.target_type, req.target_id, req.user_id),
        ).fetchone()
        if existing and existing["reaction_type"] == req.reaction_type:
            pass  # idempotent re-send: nothing changes
        elif existing:
            conn.execute(
                "UPDATE reactions SET reaction_type = ?, created_at = ? WHERE reaction_id = ?",
                (req.reaction_type, now_iso(), existing["reaction_id"]),
            )
        else:
            conn.execute(
                "INSERT INTO reactions (reaction_id, target_type, target_id, agent_id, user_id, reaction_type, created_at) VALUES (?, ?, ?, NULL, ?, ?, ?)",
                (str(uuid.uuid4()), req.target_type, req.target_id, req.user_id, req.reaction_type, now_iso()),
            )
        conn.commit()

        like_count = conn.execute(
            "SELECT COUNT(*) FROM reactions WHERE target_type = ? AND target_id = ? AND reaction_type = 'like'",
            (req.target_type, req.target_id),
        ).fetchone()[0]
        dislike_count = conn.execute(
            "SELECT COUNT(*) FROM reactions WHERE target_type = ? AND target_id = ? AND reaction_type = 'dislike'",
            (req.target_type, req.target_id),
        ).fetchone()[0]
    finally:
        conn.close()

    return ReactionResponse(
        ok=True,
        target_type=req.target_type,
        target_id=req.target_id,
        user_reaction=req.reaction_type,
        like_count=like_count,
        dislike_count=dislike_count,
    )


@app.post("/api/community/worlds/{world_id}/tick", response_model=TickResponse)
async def manual_tick(world_id: str):
    """Manual "refresh community": run one tick, guarded by the world tick lock."""
    world = get_world(DB_PATH, world_id)
    if not world:
        raise HTTPException(status_code=404, detail="World not found")
    tick_engine = _tick_engine()
    if tick_engine is None:
        raise HTTPException(status_code=503, detail="Tick engine unavailable")

    async with _world_tick_lock(tick_engine, world_id) as acquired:
        if not acquired:
            return TickResponse(world_id=world_id, ticked=False, reason="tick_already_running")
        try:
            result = await tick_engine.run_tick(DB_PATH, world_id)
        except Exception as exc:
            raise HTTPException(status_code=503, detail=f"Tick failed: {exc}") from exc
        _touch_world_updated(DB_PATH, world_id)
    payload = asdict(result) if is_dataclass(result) else result
    return TickResponse(
        world_id=world_id,
        ticked=True,
        result=payload if isinstance(payload, dict) else {"summary": str(payload)},
    )


@app.post("/api/community/worlds/{world_id}/initialize", response_model=InitResponse)
def initialize_community_world(world_id: str, background_tasks: BackgroundTasks):
    """Schedule historical content fill in the background (spec 5.1, 12 step 7)."""
    world = get_world(DB_PATH, world_id)
    if not world:
        raise HTTPException(status_code=404, detail="World not found")
    world_init = _world_init()
    if world_init is None:
        raise HTTPException(status_code=503, detail="World initializer unavailable")
    if not world_init.needs_initialization(DB_PATH, world_id):
        return InitResponse(world_id=world_id, scheduled=False, already_initialized=True)
    background_tasks.add_task(_initialize_world_bg, DB_PATH, world_id)
    return InitResponse(world_id=world_id, scheduled=True, already_initialized=False)


@app.get("/api/community/agents/{agent_id}", response_model=AgentProfileResponse)
def community_agent_profile(agent_id: str):
    """Agent persona card: karma, counters and recent activity (spec 8.3)."""
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    try:
        agent = conn.execute("SELECT * FROM agents WHERE agent_id = ?", (agent_id,)).fetchone()
        if not agent:
            raise HTTPException(status_code=404, detail="Agent not found")
        post_count = conn.execute("SELECT COUNT(*) FROM posts WHERE agent_id = ?", (agent_id,)).fetchone()[0]
        comment_count = conn.execute("SELECT COUNT(*) FROM comments WHERE agent_id = ?", (agent_id,)).fetchone()[0]
        follower_count = conn.execute("SELECT COUNT(*) FROM follows WHERE followee_id = ?", (agent_id,)).fetchone()[0]
        recent_posts = conn.execute(
            "SELECT post_id, content, stance, created_at FROM posts WHERE agent_id = ? ORDER BY created_at DESC LIMIT 5",
            (agent_id,),
        ).fetchall()
        recent_comments = conn.execute(
            "SELECT comment_id, post_id, content, stance, created_at FROM comments WHERE agent_id = ? ORDER BY created_at DESC LIMIT 5",
            (agent_id,),
        ).fetchall()
    finally:
        conn.close()

    try:
        persona = json.loads(agent["persona_json"] or "{}")
    except json.JSONDecodeError:
        persona = {}
    return AgentProfileResponse(
        agent_id=agent["agent_id"],
        display_name=agent["display_name"],
        handle=agent["handle"],
        bio=agent["bio"],
        persona=persona,
        karma=agent["karma"] or 0,
        post_count=post_count,
        comment_count=comment_count,
        follower_count=follower_count,
        is_ai=True,
        last_active_at=agent["last_active_at"],
        created_at=agent["created_at"],
        recent_posts=[AgentPostItem(**dict(row)) for row in recent_posts],
        recent_comments=[AgentCommentItem(**dict(row)) for row in recent_comments],
    )


@app.post("/api/community/follows", response_model=FollowResponse)
def follow_agent(req: FollowRequest):
    """Follow/unfollow an agent; both directions are idempotent."""
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    try:
        agent = conn.execute("SELECT agent_id FROM agents WHERE agent_id = ?", (req.agent_id,)).fetchone()
        if not agent:
            raise HTTPException(status_code=404, detail="Agent not found")
        existing = conn.execute(
            "SELECT COUNT(*) FROM follows WHERE follower_type = 'user' AND follower_id = ? AND followee_id = ?",
            (req.user_id, req.agent_id),
        ).fetchone()[0]
        if req.follow and existing == 0:
            conn.execute(
                "INSERT INTO follows (follower_type, follower_id, followee_id, created_at) VALUES ('user', ?, ?, ?)",
                (req.user_id, req.agent_id, now_iso()),
            )
        elif not req.follow and existing > 0:
            conn.execute(
                "DELETE FROM follows WHERE follower_type = 'user' AND follower_id = ? AND followee_id = ?",
                (req.user_id, req.agent_id),
            )
        conn.commit()
        follower_count = conn.execute(
            "SELECT COUNT(*) FROM follows WHERE followee_id = ?", (req.agent_id,)
        ).fetchone()[0]
    finally:
        conn.close()
    return FollowResponse(ok=True, followed=req.follow, follower_count=follower_count)


@app.get("/api/community/worlds/{world_id}/status", response_model=CommunityStatusResponse)
def community_world_status(world_id: str):
    """World counters plus tick/initialization state for the client chrome."""
    world = get_world(DB_PATH, world_id)
    if not world:
        raise HTTPException(status_code=404, detail="World not found")
    conn = sqlite3.connect(DB_PATH)
    try:
        counts = _count_targets(conn, world_id)
    finally:
        conn.close()

    needs_initialization = None
    world_init = _world_init()
    if world_init is not None:
        try:
            needs_initialization = bool(world_init.needs_initialization(DB_PATH, world_id))
        except Exception:
            needs_initialization = None
    catchup_mode = None
    tick_engine = _tick_engine()
    if tick_engine is not None:
        try:
            catchup_mode = tick_engine.catchup_mode(world["updated_at"], datetime.now(timezone.utc))
        except Exception:
            catchup_mode = None

    return CommunityStatusResponse(
        world_id=world_id,
        topic_id=world["topic_id"],
        topic_title=world["topic_title"],
        current_concept_id=world["current_concept_id"],
        status=world["status"],
        last_tick_at=world["updated_at"],
        needs_initialization=needs_initialization,
        catchup_mode=catchup_mode,
        **counts,
    )
