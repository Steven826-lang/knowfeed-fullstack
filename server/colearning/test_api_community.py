"""API tests for the /api/community/* routes (spec section 9).

Runs against FastAPI's TestClient with a temp DB. LLM-touching paths
(mini-tick background tasks, ticks, world initialization) are fenced off
with fake tick_engine / world_init modules injected into sys.modules, so
no real LLM call can happen. BackgroundTasks run synchronously under
TestClient, so a scheduled task shows up as a recorded call on the fake.

The fakes mirror the real modules' signatures (async tick functions,
two-argument catchup_mode, none/normal/condensed/deep tiers, lock-state
probe), so these tests assert the real integration contract rather than
paths that would be swallowed by the API layer's defensive try/except.
"""

import random
import sqlite3
import sys
import types
import uuid
from dataclasses import dataclass

import pytest
from fastapi.testclient import TestClient

import main
from agent_manager import build_world_roster
from db import create_world, init_db, now_iso

TOPIC = "大模型入门"
CONCEPT_IDS = ["c-attention", "c-pretrain", "c-finetune"]


@pytest.fixture
def env(tmp_path, monkeypatch):
    """TestClient bound to a temp DB, with no tick_engine/world_init modules."""
    db_path = tmp_path / "test.db"
    init_db(db_path)
    monkeypatch.setattr(main, "DB_PATH", db_path)
    monkeypatch.delitem(sys.modules, "tick_engine", raising=False)
    monkeypatch.delitem(sys.modules, "world_init", raising=False)
    return TestClient(main.app), db_path


@dataclass
class FakeTickResult:
    """Mirror of tick_engine.TickResult: a dataclass, not a dict."""

    tick_num: int
    posts_created: int
    comments_created: int
    reactions_added: int


@dataclass
class FakeCatchupResult:
    """Mirror of tick_engine.CatchupResult: briefing rides on the dataclass."""

    ticks_run: int
    briefing: dict


class _LockProbe:
    """Mirror of the per-world lock state behind tick_engine._get_lock."""

    def __init__(self):
        self.is_locked = False

    def locked(self):
        return self.is_locked


def _install_fake_tick_engine(monkeypatch, mode="none"):
    """Fake tick_engine recording every call; no LLM anywhere behind it.

    Mirrors the real module: catchup_mode(last_tick_at, now) is sync and its
    tiers are none/normal/condensed/deep; run_tick / run_mini_tick /
    run_catchup are async; run_mini_tick takes (db_path, world_id,
    target_post_id, *, user_comment_id); run_catchup has no ticks kwarg and
    the >24h "deep" tier carries the briefing; the tick lock state is probed
    via _get_lock(world_id).locked(). Flip mod.lock_probe.is_locked to
    simulate a tick already running.
    """
    calls = {"run_tick": [], "run_mini_tick": [], "run_catchup": []}
    mod = types.ModuleType("tick_engine")
    mod.lock_probe = _LockProbe()
    mod._get_lock = lambda world_id: mod.lock_probe
    mod.catchup_mode = lambda last_tick_at, now: mode

    async def run_tick(db_path, world_id):
        calls["run_tick"].append({"db_path": db_path, "world_id": world_id})
        return FakeTickResult(tick_num=1, posts_created=1, comments_created=2, reactions_added=1)

    async def run_mini_tick(db_path, world_id, target_post_id=None, *, user_comment_id=None):
        calls["run_mini_tick"].append(
            {
                "db_path": db_path,
                "world_id": world_id,
                "target_post_id": target_post_id,
                "user_comment_id": user_comment_id,
            }
        )
        return None

    async def run_catchup(db_path, world_id):
        calls["run_catchup"].append({"db_path": db_path, "world_id": world_id})
        briefing = (
            {"new_hot_posts": 3, "relevant_discussions": 1, "delta_moments": 1}
            if mode == "deep"
            else {}
        )
        return FakeCatchupResult(ticks_run=1, briefing=briefing)

    mod.run_tick = run_tick
    mod.run_mini_tick = run_mini_tick
    mod.run_catchup = run_catchup
    monkeypatch.setitem(sys.modules, "tick_engine", mod)
    return calls, mod


def _install_fake_world_init(monkeypatch, needs=True):
    """Fake world_init with a flippable needs_initialization flag.

    Mirrors the real module: needs_initialization is sync, initialize_world
    is async and takes (db_path, world_id, topic, concept_ids).
    """
    state = {"needs": needs}
    calls = []
    mod = types.ModuleType("world_init")
    mod.needs_initialization = lambda db_path, world_id: state["needs"]

    async def initialize_world(db_path, world_id, topic, concept_ids):
        calls.append(
            {"db_path": db_path, "world_id": world_id, "topic": topic, "concept_ids": concept_ids}
        )
        return {"posts_created": 8}

    mod.initialize_world = initialize_world
    monkeypatch.setitem(sys.modules, "world_init", mod)
    return calls, state


def _world_with_roster(db_path):
    world_id = create_world(db_path, "s1", "t1", TOPIC, CONCEPT_IDS[0])
    roster = build_world_roster(db_path, world_id, TOPIC, CONCEPT_IDS, count=25, rng=random.Random(7))
    return world_id, roster


def _seed_post(db_path, world_id, agent_id=None, user_id=None, concept_id=CONCEPT_IDS[0],
               content="注意力机制到底解决了什么问题？我用查字典来打个比方讲讲。",
               stance="neutral", heat=0, post_status="historical", created_at=None):
    post_id = str(uuid.uuid4())
    conn = sqlite3.connect(db_path)
    conn.execute(
        """
        INSERT INTO posts (post_id, world_id, concept_id, agent_id, user_id, content, stance, post_status, is_hot, comment_count, heat, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, 0, ?, ?)
        """,
        (post_id, world_id, concept_id, agent_id, user_id, content, stance, post_status,
         heat, created_at or now_iso()),
    )
    conn.commit()
    conn.close()
    return post_id


def _seed_comment(db_path, post_id, agent_id=None, user_id=None, parent_comment_id=None,
                  content="补充一个我自己的理解，供参考。", stance="neutral", relation="补充",
                  thread_path=None, created_at=None):
    comment_id = str(uuid.uuid4())
    conn = sqlite3.connect(db_path)
    conn.execute(
        """
        INSERT INTO comments (comment_id, post_id, parent_comment_id, agent_id, user_id, content, stance, relation, thread_path, heat, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)
        """,
        (comment_id, post_id, parent_comment_id, agent_id, user_id, content, stance, relation,
         thread_path, created_at or now_iso()),
    )
    conn.commit()
    conn.close()
    return comment_id


def _seed_agent_reaction(db_path, target_type, target_id, agent_id, reaction_type="like"):
    conn = sqlite3.connect(db_path)
    conn.execute(
        "INSERT INTO reactions (reaction_id, target_type, target_id, agent_id, reaction_type, created_at) VALUES (?, ?, ?, ?, ?, ?)",
        (str(uuid.uuid4()), target_type, target_id, agent_id, reaction_type, now_iso()),
    )
    conn.commit()
    conn.close()


# ---------------------------------------------------------------------------
# POST /api/community/worlds
# ---------------------------------------------------------------------------


def test_create_world_builds_roster_and_schedules_initialization(env, monkeypatch):
    client, db_path = env
    init_calls, _state = _install_fake_world_init(monkeypatch, needs=True)
    resp = client.post(
        "/api/community/worlds",
        json={
            "session_key": "s1",
            "topic_id": "t1",
            "topic_title": TOPIC,
            "current_concept_id": CONCEPT_IDS[0],
            "concept_ids": CONCEPT_IDS,
        },
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["restored"] is False
    assert body["status"] == "active"
    assert 25 <= body["agent_count"] <= 30
    assert body["initialization_scheduled"] is True
    # BackgroundTasks run under TestClient, so the fake initializer already ran.
    assert init_calls == [
        {
            "db_path": db_path,
            "world_id": body["world_id"],
            "topic": TOPIC,
            "concept_ids": [CONCEPT_IDS[0]],
        }
    ]

    conn = sqlite3.connect(db_path)
    persisted = conn.execute(
        "SELECT COUNT(*) FROM agents WHERE world_id = ?", (body["world_id"],)
    ).fetchone()[0]
    conn.close()
    assert persisted == body["agent_count"]


def test_create_world_restores_existing_world_for_session_and_topic(env, monkeypatch):
    client, db_path = env
    _init_calls, state = _install_fake_world_init(monkeypatch, needs=True)
    payload = {"session_key": "s1", "topic_id": "t1", "topic_title": TOPIC, "concept_ids": CONCEPT_IDS}
    first = client.post("/api/community/worlds", json=payload).json()
    assert first["restored"] is False

    state["needs"] = False  # initialization done; restore must not re-run it
    second = client.post("/api/community/worlds", json=payload).json()
    assert second["restored"] is True
    assert second["world_id"] == first["world_id"]
    assert second["agent_count"] == first["agent_count"]
    assert second["initialization_scheduled"] is False

    other_topic = client.post(
        "/api/community/worlds", json={**payload, "topic_id": "t2"}
    ).json()
    assert other_topic["restored"] is False
    assert other_topic["world_id"] != first["world_id"]


# ---------------------------------------------------------------------------
# POST /api/community/worlds/{id}/feed
# ---------------------------------------------------------------------------


def test_feed_404_for_unknown_world(env):
    client, _ = env
    resp = client.post(f"/api/community/worlds/{uuid.uuid4()}/feed", json={})
    assert resp.status_code == 404


def test_feed_returns_ranked_posts_with_reason_tags(env, monkeypatch):
    client, db_path = env
    calls, _mod = _install_fake_tick_engine(monkeypatch, mode="none")
    world_id, roster = _world_with_roster(db_path)
    author = roster[0]
    post_id = _seed_post(db_path, world_id, agent_id=author["agent_id"])

    resp = client.post(
        f"/api/community/worlds/{world_id}/feed",
        json={"current_concept_id": CONCEPT_IDS[0], "limit": 10},
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["world_id"] == world_id
    assert body["ticked"] is False
    assert body["briefing"] is None
    assert len(body["posts"]) == 1
    post = body["posts"][0]
    assert post["post_id"] == post_id
    assert post["reason_code"] == "concept"  # matches the current concept (spec 7.3)
    assert post["reason"]
    assert post["author"]["handle"] == author["handle"]
    assert set(post["signals"]) == {"interest", "popularity", "freshness", "learning"}
    # "none" mode: no tick work at all
    assert calls["run_tick"] == [] and calls["run_catchup"] == []


def test_feed_runs_normal_tick_on_entry(env, monkeypatch):
    client, db_path = env
    calls, _mod = _install_fake_tick_engine(monkeypatch, mode="normal")
    world_id, _roster = _world_with_roster(db_path)
    _seed_post(db_path, world_id)

    body = client.post(f"/api/community/worlds/{world_id}/feed", json={}).json()
    assert body["ticked"] is True
    assert body["tick_mode"] == "normal"
    assert calls["run_tick"] == [{"db_path": db_path, "world_id": world_id}]
    assert calls["run_catchup"] == []


def test_feed_runs_condensed_catchup(env, monkeypatch):
    client, db_path = env
    calls, _mod = _install_fake_tick_engine(monkeypatch, mode="condensed")
    world_id, _roster = _world_with_roster(db_path)

    body = client.post(f"/api/community/worlds/{world_id}/feed", json={}).json()
    assert body["ticked"] is True
    assert body["tick_mode"] == "condensed"
    assert calls["run_catchup"] == [{"db_path": db_path, "world_id": world_id}]
    assert body["briefing"] is None  # no briefing for the 30min-24h tier


def test_feed_returns_briefing_after_long_absence(env, monkeypatch):
    client, db_path = env
    calls, _mod = _install_fake_tick_engine(monkeypatch, mode="deep")
    world_id, _roster = _world_with_roster(db_path)

    body = client.post(f"/api/community/worlds/{world_id}/feed", json={}).json()
    assert body["ticked"] is True
    assert body["tick_mode"] == "deep"
    assert calls["run_catchup"] == [{"db_path": db_path, "world_id": world_id}]
    assert body["briefing"]["new_hot_posts"] == 3
    assert body["briefing"]["delta_moments"] == 1


def test_feed_cursor_paging_returns_each_post_once(env, monkeypatch):
    client, db_path = env
    _install_fake_tick_engine(monkeypatch, mode="none")
    world_id, roster = _world_with_roster(db_path)
    post_ids = [
        _seed_post(db_path, world_id, agent_id=roster[i]["agent_id"], heat=10 - i)
        for i in range(3)
    ]

    page1 = client.post(
        f"/api/community/worlds/{world_id}/feed", json={"limit": 2}
    ).json()
    assert len(page1["posts"]) == 2
    assert page1["next_cursor"]

    page2 = client.post(
        f"/api/community/worlds/{world_id}/feed",
        json={"limit": 2, "cursor": page1["next_cursor"]},
    ).json()
    assert len(page2["posts"]) == 1
    assert page2["next_cursor"] is None

    seen = [p["post_id"] for p in page1["posts"] + page2["posts"]]
    assert sorted(seen) == sorted(post_ids)


def test_feed_degrades_when_tick_engine_missing(env, monkeypatch):
    client, db_path = env
    monkeypatch.setattr(main, "_optional_module", lambda name: None)
    world_id, _roster = _world_with_roster(db_path)
    _seed_post(db_path, world_id)

    body = client.post(f"/api/community/worlds/{world_id}/feed", json={}).json()
    assert body["ticked"] is False
    assert body["tick_mode"] is None
    assert len(body["posts"]) == 1  # content still served


# ---------------------------------------------------------------------------
# GET /api/community/posts/{id}
# ---------------------------------------------------------------------------


def test_post_detail_returns_comment_tree_capped_at_three_levels(env):
    client, db_path = env
    world_id, roster = _world_with_roster(db_path)
    op = roster[0]
    post_id = _seed_post(db_path, world_id, agent_id=op["agent_id"])
    c1 = _seed_comment(db_path, post_id, agent_id=roster[1]["agent_id"], thread_path="1")
    c2 = _seed_comment(db_path, post_id, agent_id=op["agent_id"], parent_comment_id=c1, thread_path="1/1")
    c3 = _seed_comment(db_path, post_id, agent_id=roster[2]["agent_id"], parent_comment_id=c2, thread_path="1/1/1")
    _c4 = _seed_comment(db_path, post_id, agent_id=op["agent_id"], parent_comment_id=c3, thread_path="1/1/1/1")

    resp = client.get(f"/api/community/posts/{post_id}")
    assert resp.status_code == 200
    body = resp.json()
    assert body["post_id"] == post_id
    assert body["comment_count"] == 4  # pruned comments still count
    assert body["author"]["handle"] == op["handle"]
    assert len(body["comments"]) == 1

    level1 = body["comments"][0]
    assert level1["comment_id"] == c1
    assert level1["is_op"] is False
    level2 = level1["replies"][0]
    assert level2["comment_id"] == c2
    assert level2["is_op"] is True  # OP reply gets the badge (spec 8.2)
    level3 = level2["replies"][0]
    assert level3["comment_id"] == c3
    assert level3["replies"] == []  # depth 4 pruned (spec section 13)


def test_post_detail_marks_user_posts_without_author(env):
    client, db_path = env
    world_id, _roster = _world_with_roster(db_path)
    post_id = _seed_post(db_path, world_id, user_id="u1", post_status="user")

    body = client.get(f"/api/community/posts/{post_id}").json()
    assert body["user_id"] == "u1"
    assert body["author"] is None
    assert body["post_status"] == "user"


def test_post_detail_404_for_unknown_post(env):
    client, _ = env
    assert client.get(f"/api/community/posts/{uuid.uuid4()}").status_code == 404


# ---------------------------------------------------------------------------
# POST /api/community/posts
# ---------------------------------------------------------------------------


def test_user_post_persists_and_schedules_mini_tick(env, monkeypatch):
    client, db_path = env
    calls, _mod = _install_fake_tick_engine(monkeypatch)
    world_id, _roster = _world_with_roster(db_path)

    resp = client.post(
        "/api/community/posts",
        json={
            "world_id": world_id,
            "user_id": "u1",
            "content": "我刚学完注意力机制，有个疑问想听听大家的看法。",
            "stance": "question",
        },
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["world_id"] == world_id
    assert body["status"] == "awaiting_responses"

    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    row = conn.execute("SELECT * FROM posts WHERE post_id = ?", (body["post_id"],)).fetchone()
    conn.close()
    assert row["user_id"] == "u1"
    assert row["agent_id"] is None
    assert row["post_status"] == "user"
    assert row["concept_id"] == CONCEPT_IDS[0]  # fell back to the world's current concept
    assert row["stance"] == "question"

    assert calls["run_mini_tick"] == [
        {
            "db_path": db_path,
            "world_id": world_id,
            "target_post_id": body["post_id"],
            "user_comment_id": None,
        }
    ]


def test_user_post_404_for_unknown_world(env):
    client, _ = env
    resp = client.post(
        "/api/community/posts",
        json={"world_id": str(uuid.uuid4()), "user_id": "u1", "content": "随便发点什么内容试试"},
    )
    assert resp.status_code == 404


def test_user_post_rejects_invalid_stance(env):
    client, db_path = env
    world_id, _roster = _world_with_roster(db_path)
    resp = client.post(
        "/api/community/posts",
        json={"world_id": world_id, "user_id": "u1", "content": "测试一下非法立场", "stance": "rude"},
    )
    assert resp.status_code == 422


# ---------------------------------------------------------------------------
# POST /api/community/comments
# ---------------------------------------------------------------------------


def test_user_comment_threads_and_schedules_mini_tick(env, monkeypatch):
    client, db_path = env
    calls, _mod = _install_fake_tick_engine(monkeypatch)
    world_id, _roster = _world_with_roster(db_path)
    post_id = _seed_post(db_path, world_id)

    first = client.post(
        "/api/community/comments",
        json={"post_id": post_id, "user_id": "u1", "content": "第一层楼，说一下我的理解。"},
    ).json()
    assert first["thread_path"] == "1"

    second = client.post(
        "/api/community/comments",
        json={
            "post_id": post_id,
            "user_id": "u1",
            "content": "回复自己一楼，再补充一点。",
            "parent_comment_id": first["comment_id"],
        },
    ).json()
    assert second["thread_path"] == "1/1"
    assert second["status"] == "awaiting_responses"

    conn = sqlite3.connect(db_path)
    count = conn.execute("SELECT comment_count FROM posts WHERE post_id = ?", (post_id,)).fetchone()[0]
    conn.close()
    assert count == 2

    assert calls["run_mini_tick"][-1] == {
        "db_path": db_path,
        "world_id": world_id,
        "target_post_id": post_id,
        "user_comment_id": second["comment_id"],
    }


def test_user_comment_enforces_three_level_nesting(env, monkeypatch):
    client, db_path = env
    # Mini-ticks really run now; fence the engine off from any LLM call.
    _install_fake_tick_engine(monkeypatch)
    world_id, _roster = _world_with_roster(db_path)
    post_id = _seed_post(db_path, world_id)

    parent = None
    for _ in range(3):
        body = client.post(
            "/api/community/comments",
            json={
                "post_id": post_id,
                "user_id": "u1",
                "content": "嵌套一层，继续讨论。",
                "parent_comment_id": parent,
            },
        ).json()
        parent = body["comment_id"]

    too_deep = client.post(
        "/api/community/comments",
        json={"post_id": post_id, "user_id": "u1", "content": "第四层应该被拒绝。", "parent_comment_id": parent},
    )
    assert too_deep.status_code == 400


def test_user_comment_validates_post_and_parent(env):
    client, db_path = env
    world_id, _roster = _world_with_roster(db_path)
    post_id = _seed_post(db_path, world_id)
    other_post = _seed_post(db_path, world_id)
    foreign = _seed_comment(db_path, other_post)

    assert client.post(
        "/api/community/comments",
        json={"post_id": str(uuid.uuid4()), "user_id": "u1", "content": "帖子不存在"},
    ).status_code == 404
    assert client.post(
        "/api/community/comments",
        json={"post_id": post_id, "user_id": "u1", "content": "父评论不存在", "parent_comment_id": str(uuid.uuid4())},
    ).status_code == 404
    assert client.post(
        "/api/community/comments",
        json={"post_id": post_id, "user_id": "u1", "content": "父评论在别的帖子下", "parent_comment_id": foreign},
    ).status_code == 400


# ---------------------------------------------------------------------------
# POST /api/community/reactions
# ---------------------------------------------------------------------------


def test_reaction_is_idempotent_and_toggles(env):
    client, db_path = env
    world_id, roster = _world_with_roster(db_path)
    post_id = _seed_post(db_path, world_id, agent_id=roster[0]["agent_id"])
    # Pre-existing agent reaction must survive the defensive schema rebuild.
    _seed_agent_reaction(db_path, "post", post_id, roster[0]["agent_id"])

    payload = {"target_type": "post", "target_id": post_id, "user_id": "u1", "reaction_type": "like"}
    first = client.post("/api/community/reactions", json=payload).json()
    assert first["ok"] is True
    assert first["like_count"] == 2  # agent's like + user's like
    assert first["dislike_count"] == 0

    again = client.post("/api/community/reactions", json=payload).json()
    assert again["like_count"] == 2  # idempotent re-send

    toggled = client.post(
        "/api/community/reactions", json={**payload, "reaction_type": "dislike"}
    ).json()
    assert toggled["user_reaction"] == "dislike"
    assert toggled["like_count"] == 1
    assert toggled["dislike_count"] == 1

    conn = sqlite3.connect(db_path)
    rows = conn.execute("SELECT COUNT(*) FROM reactions WHERE target_id = ?", (post_id,)).fetchone()[0]
    conn.close()
    assert rows == 2  # one row per reactor, never duplicated


def test_reaction_on_comment_and_unknown_target(env):
    client, db_path = env
    world_id, _roster = _world_with_roster(db_path)
    post_id = _seed_post(db_path, world_id)
    comment_id = _seed_comment(db_path, post_id)

    body = client.post(
        "/api/community/reactions",
        json={"target_type": "comment", "target_id": comment_id, "user_id": "u1", "reaction_type": "like"},
    ).json()
    assert body["like_count"] == 1

    assert client.post(
        "/api/community/reactions",
        json={"target_type": "post", "target_id": str(uuid.uuid4()), "user_id": "u1", "reaction_type": "like"},
    ).status_code == 404
    assert client.post(
        "/api/community/reactions",
        json={"target_type": "comment", "target_id": str(uuid.uuid4()), "user_id": "u1", "reaction_type": "dislike"},
    ).status_code == 404


# ---------------------------------------------------------------------------
# POST /api/community/worlds/{id}/tick
# ---------------------------------------------------------------------------


def test_manual_tick_runs_once_under_lock(env, monkeypatch):
    client, db_path = env
    calls, mod = _install_fake_tick_engine(monkeypatch)
    world_id, _roster = _world_with_roster(db_path)

    # Simulate a tick already in progress via the per-world lock state.
    mod.lock_probe.is_locked = True
    busy = client.post(f"/api/community/worlds/{world_id}/tick").json()
    mod.lock_probe.is_locked = False
    assert busy["ticked"] is False
    assert busy["reason"] == "tick_already_running"
    assert calls["run_tick"] == []

    done = client.post(f"/api/community/worlds/{world_id}/tick").json()
    assert done["ticked"] is True
    # The engine's TickResult dataclass is serialized as a plain dict.
    assert done["result"] == {
        "tick_num": 1,
        "posts_created": 1,
        "comments_created": 2,
        "reactions_added": 1,
    }
    assert calls["run_tick"] == [{"db_path": db_path, "world_id": world_id}]


def test_manual_tick_404_and_503(env, monkeypatch):
    client, db_path = env
    assert client.post(f"/api/community/worlds/{uuid.uuid4()}/tick").status_code == 404

    monkeypatch.setattr(main, "_optional_module", lambda name: None)
    world_id, _roster = _world_with_roster(db_path)
    assert client.post(f"/api/community/worlds/{world_id}/tick").status_code == 503


# ---------------------------------------------------------------------------
# POST /api/community/worlds/{id}/initialize
# ---------------------------------------------------------------------------


def test_initialize_schedules_only_when_needed(env, monkeypatch):
    client, db_path = env
    init_calls, state = _install_fake_world_init(monkeypatch, needs=True)
    world_id, _roster = _world_with_roster(db_path)

    first = client.post(f"/api/community/worlds/{world_id}/initialize").json()
    assert first == {"world_id": world_id, "scheduled": True, "already_initialized": False}
    assert init_calls == [
        {
            "db_path": db_path,
            "world_id": world_id,
            "topic": TOPIC,
            "concept_ids": [CONCEPT_IDS[0]],
        }
    ]

    state["needs"] = False
    second = client.post(f"/api/community/worlds/{world_id}/initialize").json()
    assert second == {"world_id": world_id, "scheduled": False, "already_initialized": True}
    assert len(init_calls) == 1


def test_initialize_404_and_503(env, monkeypatch):
    client, db_path = env
    assert client.post(f"/api/community/worlds/{uuid.uuid4()}/initialize").status_code == 404

    monkeypatch.setattr(main, "_optional_module", lambda name: None)
    world_id, _roster = _world_with_roster(db_path)
    assert client.post(f"/api/community/worlds/{world_id}/initialize").status_code == 503


# ---------------------------------------------------------------------------
# GET /api/community/agents/{id}
# ---------------------------------------------------------------------------


def test_agent_profile_returns_persona_karma_and_activity(env):
    client, db_path = env
    world_id, roster = _world_with_roster(db_path)
    agent = roster[0]
    post_id = _seed_post(db_path, world_id, agent_id=agent["agent_id"])
    _seed_comment(db_path, post_id, agent_id=agent["agent_id"])

    resp = client.get(f"/api/community/agents/{agent['agent_id']}")
    assert resp.status_code == 200
    body = resp.json()
    assert body["display_name"] == agent["display_name"]
    assert body["handle"] == agent["handle"]
    assert body["bio"] == agent["bio"]
    assert body["is_ai"] is True  # fixed AI-resident badge (spec 8.5)
    assert body["karma"] == agent["karma"]
    assert body["post_count"] == 1
    assert body["comment_count"] == 1
    assert body["follower_count"] == 0
    assert body["persona"]["catchphrase"] == agent["persona"]["catchphrase"]
    assert body["recent_posts"][0]["post_id"] == post_id
    assert body["recent_comments"][0]["post_id"] == post_id


def test_agent_profile_404(env):
    client, _ = env
    assert client.get(f"/api/community/agents/{uuid.uuid4()}").status_code == 404


# ---------------------------------------------------------------------------
# POST /api/community/follows
# ---------------------------------------------------------------------------


def test_follow_and_unfollow_are_idempotent(env):
    client, db_path = env
    world_id, roster = _world_with_roster(db_path)
    agent_id = roster[0]["agent_id"]

    payload = {"user_id": "u1", "agent_id": agent_id}
    first = client.post("/api/community/follows", json=payload).json()
    assert first["followed"] is True
    assert first["follower_count"] == 1

    again = client.post("/api/community/follows", json=payload).json()
    assert again["follower_count"] == 1  # no duplicate row

    conn = sqlite3.connect(db_path)
    rows = conn.execute("SELECT COUNT(*) FROM follows WHERE followee_id = ?", (agent_id,)).fetchone()[0]
    conn.close()
    assert rows == 1

    off = client.post("/api/community/follows", json={**payload, "follow": False}).json()
    assert off["followed"] is False
    assert off["follower_count"] == 0
    off_again = client.post("/api/community/follows", json={**payload, "follow": False}).json()
    assert off_again["follower_count"] == 0


def test_follow_404_for_unknown_agent(env):
    client, _ = env
    resp = client.post(
        "/api/community/follows", json={"user_id": "u1", "agent_id": str(uuid.uuid4())}
    )
    assert resp.status_code == 404


# ---------------------------------------------------------------------------
# GET /api/community/worlds/{id}/status
# ---------------------------------------------------------------------------


def test_world_status_reports_counters_and_tick_state(env, monkeypatch):
    client, db_path = env
    _install_fake_tick_engine(monkeypatch, mode="condensed")
    _install_fake_world_init(monkeypatch, needs=False)
    world_id, roster = _world_with_roster(db_path)
    post_id = _seed_post(db_path, world_id, agent_id=roster[0]["agent_id"])
    _seed_post(db_path, world_id, user_id="u1", post_status="user")
    comment_id = _seed_comment(db_path, post_id, agent_id=roster[1]["agent_id"])
    client.post(
        "/api/community/reactions",
        json={"target_type": "comment", "target_id": comment_id, "user_id": "u1", "reaction_type": "like"},
    )
    client.post("/api/community/follows", json={"user_id": "u1", "agent_id": roster[0]["agent_id"]})

    resp = client.get(f"/api/community/worlds/{world_id}/status")
    assert resp.status_code == 200
    body = resp.json()
    assert body["topic_id"] == "t1"
    assert body["topic_title"] == TOPIC
    assert body["current_concept_id"] == CONCEPT_IDS[0]
    assert body["agent_count"] == 25
    assert body["post_count"] == 2
    assert body["comment_count"] == 1
    assert body["reaction_count"] == 1
    assert body["follow_count"] == 1
    assert body["last_tick_at"]
    assert body["needs_initialization"] is False
    assert body["catchup_mode"] == "condensed"


def test_world_status_404(env):
    client, _ = env
    assert client.get(f"/api/community/worlds/{uuid.uuid4()}/status").status_code == 404


# ---------------------------------------------------------------------------
# Guardrail: pre-existing colearning routes keep working
# ---------------------------------------------------------------------------


def test_existing_colearning_routes_still_work(env):
    client, db_path = env
    world_id = create_world(db_path, "s1", "t1", TOPIC, CONCEPT_IDS[0])
    resp = client.get(f"/api/colearning/worlds/{world_id}/status")
    assert resp.status_code == 200
    body = resp.json()
    assert body["world_id"] == world_id
    assert body["post_count"] == 0
