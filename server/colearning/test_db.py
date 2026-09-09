import json
import sqlite3
from pathlib import Path

from belief_state import BeliefState
from db import init_db, migrate, create_world, get_world, list_worlds, insert_agent
from personas import Persona

# Schema as it existed before the learning-community expansion (spec 3.1),
# used to verify migrate() upgrades old dev databases in place.
OLD_SCHEMA = """
CREATE TABLE worlds (
    world_id TEXT PRIMARY KEY,
    session_key TEXT NOT NULL,
    topic_id TEXT NOT NULL,
    topic_title TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'active',
    current_concept_id TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE agents (
    agent_id TEXT PRIMARY KEY,
    world_id TEXT NOT NULL REFERENCES worlds(world_id) ON DELETE CASCADE,
    display_name TEXT NOT NULL,
    handle TEXT NOT NULL,
    bio TEXT NOT NULL,
    persona_json TEXT NOT NULL,
    voice_tags TEXT NOT NULL,
    community_edges_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL
);

CREATE TABLE posts (
    post_id TEXT PRIMARY KEY,
    world_id TEXT NOT NULL REFERENCES worlds(world_id) ON DELETE CASCADE,
    concept_id TEXT NOT NULL,
    agent_id TEXT REFERENCES agents(agent_id) ON DELETE SET NULL,
    shadow_entry_id TEXT,
    content TEXT NOT NULL,
    stance TEXT NOT NULL,
    heat INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
);

CREATE TABLE comments (
    comment_id TEXT PRIMARY KEY,
    post_id TEXT NOT NULL REFERENCES posts(post_id) ON DELETE CASCADE,
    parent_comment_id TEXT REFERENCES comments(comment_id) ON DELETE CASCADE,
    agent_id TEXT REFERENCES agents(agent_id) ON DELETE SET NULL,
    content TEXT NOT NULL,
    stance TEXT NOT NULL,
    relation TEXT NOT NULL,
    heat INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
);
"""


def _columns(db_path, table):
    conn = sqlite3.connect(db_path)
    rows = conn.execute(f"PRAGMA table_info({table})").fetchall()
    conn.close()
    return {row[1] for row in rows}


def _persona() -> Persona:
    return Persona(
        agent_id="agent-1",
        display_name="资料哥",
        handle="data_guy",
        bio="爱甩资料",
        age=30,
        role="研究生",
        background="纯兴趣驱动，喜欢看热闹",
        voice="简短直接，偶尔毒舌",
        traits=["较真", "好奇"],
        concern="理论原理和边界条件",
        habit="喜欢追问“source?”",
        catchphrase="资料呢？",
    )


def test_init_db_creates_tables(tmp_path):
    db_path = tmp_path / "test.db"
    init_db(db_path)
    conn = sqlite3.connect(db_path)
    tables = {row[0] for row in conn.execute(
        "SELECT name FROM sqlite_master WHERE type='table'"
    )}
    conn.close()
    assert "worlds" in tables
    assert "agents" in tables
    assert "posts" in tables
    assert "comments" in tables
    assert "reactions" in tables
    assert "events" in tables
    assert "shadow_entries" in tables
    assert "follows" in tables
    assert "user_preferences" in tables
    assert "user_views" in tables


def test_create_and_get_world(tmp_path):
    db_path = tmp_path / "test.db"
    init_db(db_path)
    world_id = create_world(
        db_path,
        session_key="session-1",
        topic_id="ai-intro",
        topic_title="AI 入门",
    )
    world = get_world(db_path, world_id)
    assert world["world_id"] == world_id
    assert world["topic_id"] == "ai-intro"
    assert world["status"] == "active"


def test_new_columns_exist(tmp_path):
    db_path = tmp_path / "test.db"
    init_db(db_path)
    assert {"belief_json", "post_count", "comment_count", "karma", "last_active_at"} <= _columns(db_path, "agents")
    assert {"user_id", "post_status", "is_hot", "comment_count"} <= _columns(db_path, "posts")
    assert {"user_id", "thread_path", "batch_id"} <= _columns(db_path, "comments")


def test_migrate_is_idempotent(tmp_path):
    db_path = tmp_path / "test.db"
    init_db(db_path)
    migrate(db_path)
    migrate(db_path)
    assert "belief_json" in _columns(db_path, "agents")
    assert "post_status" in _columns(db_path, "posts")
    assert "thread_path" in _columns(db_path, "comments")


def test_migrate_upgrades_old_database(tmp_path):
    db_path = tmp_path / "old.db"
    conn = sqlite3.connect(db_path)
    conn.executescript(OLD_SCHEMA)
    conn.execute(
        "INSERT INTO agents (agent_id, world_id, display_name, handle, bio, persona_json, voice_tags, community_edges_json, created_at)"
        " VALUES ('a1', 'w1', '资料哥', 'data_guy', '爱甩资料', '{}', '较真', '{}', '2026-01-01T00:00:00+00:00')"
    )
    conn.execute(
        "INSERT INTO posts (post_id, world_id, concept_id, agent_id, content, stance, heat, created_at)"
        " VALUES ('p1', 'w1', 'c1', 'a1', '升级前就存在的老帖子内容', 'support', 3, '2026-01-01T00:00:00+00:00')"
    )
    conn.execute(
        "INSERT INTO comments (comment_id, post_id, agent_id, content, stance, relation, heat, created_at)"
        " VALUES ('cm1', 'p1', 'a1', '升级前的老评论内容', 'support', 'add', 1, '2026-01-01T00:00:00+00:00')"
    )
    conn.commit()
    conn.close()

    init_db(db_path)

    assert {"belief_json", "post_count", "comment_count", "karma", "last_active_at"} <= _columns(db_path, "agents")
    assert {"user_id", "post_status", "is_hot", "comment_count"} <= _columns(db_path, "posts")
    assert {"user_id", "thread_path", "batch_id"} <= _columns(db_path, "comments")

    conn = sqlite3.connect(db_path)
    # Old rows survive and pick up the column defaults.
    assert conn.execute(
        "SELECT belief_json, post_count, comment_count, karma, last_active_at FROM agents WHERE agent_id = 'a1'"
    ).fetchone() == ("{}", 0, 0, 0, None)
    assert conn.execute(
        "SELECT post_status, is_hot, comment_count, heat FROM posts WHERE post_id = 'p1'"
    ).fetchone() == ("new", 0, 0, 3)
    assert conn.execute(
        "SELECT user_id, thread_path, batch_id, heat FROM comments WHERE comment_id = 'cm1'"
    ).fetchone() == (None, None, None, 1)
    # New tables are created for old databases too.
    tables = {row[0] for row in conn.execute("SELECT name FROM sqlite_master WHERE type='table'")}
    conn.close()
    assert {"follows", "user_preferences", "user_views"} <= tables


def test_insert_agent_defaults_new_columns(tmp_path):
    db_path = tmp_path / "test.db"
    init_db(db_path)
    world_id = create_world(db_path, "s1", "t1", "T1", "c1")
    insert_agent(db_path, world_id, _persona())
    conn = sqlite3.connect(db_path)
    row = conn.execute(
        "SELECT belief_json, post_count, comment_count, karma, last_active_at FROM agents WHERE agent_id = 'agent-1'"
    ).fetchone()
    conn.close()
    assert json.loads(row[0]) == {}
    assert row[1:] == (0, 0, 0, None)


def test_insert_agent_stores_belief_dict(tmp_path):
    db_path = tmp_path / "test.db"
    init_db(db_path)
    world_id = create_world(db_path, "s1", "t1", "T1", "c1")
    belief = {"positions": {"c1": 0.5}, "confidence": {"c1": 0.4}, "trust": {}, "exposure_history": [], "recent_reflection": ""}
    insert_agent(db_path, world_id, _persona(), belief=belief)
    conn = sqlite3.connect(db_path)
    stored = conn.execute("SELECT belief_json FROM agents WHERE agent_id = 'agent-1'").fetchone()[0]
    conn.close()
    assert json.loads(stored) == belief


def test_insert_agent_stores_belief_state(tmp_path):
    db_path = tmp_path / "test.db"
    init_db(db_path)
    world_id = create_world(db_path, "s1", "t1", "T1", "c1")
    belief = BeliefState.from_profile({"agent_id": "agent-1"}, ["c1", "c2"])
    insert_agent(db_path, world_id, _persona(), belief=belief)
    conn = sqlite3.connect(db_path)
    stored = conn.execute("SELECT belief_json FROM agents WHERE agent_id = 'agent-1'").fetchone()[0]
    conn.close()
    restored = BeliefState.from_dict(json.loads(stored))
    assert restored.positions == belief.positions
    assert restored.confidence == belief.confidence
