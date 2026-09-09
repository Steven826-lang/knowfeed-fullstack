"""SQLite persistence for the co-learning engine."""

import json
import sqlite3
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

SCHEMA = """
CREATE TABLE IF NOT EXISTS worlds (
    world_id TEXT PRIMARY KEY,
    session_key TEXT NOT NULL,
    topic_id TEXT NOT NULL,
    topic_title TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'active',
    current_concept_id TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS agents (
    agent_id TEXT PRIMARY KEY,
    world_id TEXT NOT NULL REFERENCES worlds(world_id) ON DELETE CASCADE,
    display_name TEXT NOT NULL,
    handle TEXT NOT NULL,
    bio TEXT NOT NULL,
    persona_json TEXT NOT NULL,
    belief_json TEXT NOT NULL DEFAULT '{}',
    voice_tags TEXT NOT NULL,
    community_edges_json TEXT NOT NULL DEFAULT '{}',
    post_count INTEGER DEFAULT 0,
    comment_count INTEGER DEFAULT 0,
    karma INTEGER DEFAULT 0,
    last_active_at TEXT,
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS posts (
    post_id TEXT PRIMARY KEY,
    world_id TEXT NOT NULL REFERENCES worlds(world_id) ON DELETE CASCADE,
    concept_id TEXT NOT NULL,
    agent_id TEXT REFERENCES agents(agent_id) ON DELETE SET NULL,
    user_id TEXT,
    shadow_entry_id TEXT,
    content TEXT NOT NULL,
    stance TEXT NOT NULL,
    post_status TEXT DEFAULT 'new',
    is_hot BOOLEAN DEFAULT FALSE,
    comment_count INTEGER DEFAULT 0,
    heat INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS comments (
    comment_id TEXT PRIMARY KEY,
    post_id TEXT NOT NULL REFERENCES posts(post_id) ON DELETE CASCADE,
    parent_comment_id TEXT REFERENCES comments(comment_id) ON DELETE CASCADE,
    agent_id TEXT REFERENCES agents(agent_id) ON DELETE SET NULL,
    user_id TEXT,
    content TEXT NOT NULL,
    stance TEXT NOT NULL,
    relation TEXT NOT NULL,
    thread_path TEXT,
    batch_id TEXT,
    heat INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS reactions (
    reaction_id TEXT PRIMARY KEY,
    target_type TEXT NOT NULL CHECK(target_type IN ('post', 'comment')),
    target_id TEXT NOT NULL,
    agent_id TEXT NOT NULL REFERENCES agents(agent_id) ON DELETE CASCADE,
    reaction_type TEXT NOT NULL CHECK(reaction_type IN ('like', 'dislike')),
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS follows (
    follower_type TEXT NOT NULL,
    follower_id TEXT NOT NULL,
    followee_id TEXT NOT NULL REFERENCES agents(agent_id) ON DELETE CASCADE,
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS user_preferences (
    user_id TEXT NOT NULL,
    preference_type TEXT NOT NULL,
    target_value TEXT NOT NULL,
    strength REAL DEFAULT 1.0,
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS user_views (
    user_id TEXT NOT NULL,
    post_id TEXT NOT NULL,
    view_duration_ms INTEGER DEFAULT 0,
    interacted BOOLEAN DEFAULT FALSE,
    viewed_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS events (
    event_id INTEGER PRIMARY KEY AUTOINCREMENT,
    world_id TEXT NOT NULL REFERENCES worlds(world_id) ON DELETE CASCADE,
    round INTEGER NOT NULL,
    phase TEXT,
    agent_id TEXT REFERENCES agents(agent_id) ON DELETE SET NULL,
    action TEXT NOT NULL,
    payload_json TEXT NOT NULL,
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS shadow_entries (
    entry_id TEXT PRIMARY KEY,
    world_id TEXT NOT NULL REFERENCES worlds(world_id) ON DELETE CASCADE,
    concept_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    content TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'live',
    created_at TEXT NOT NULL
);
"""

# Columns added after the original schema shipped (spec section 3.1).
# CREATE TABLE IF NOT EXISTS never alters an existing table, so migrate()
# patches older dev databases with these. Keep in sync with SCHEMA above.
NEW_COLUMNS: dict[str, dict[str, str]] = {
    "agents": {
        "belief_json": "TEXT NOT NULL DEFAULT '{}'",
        "post_count": "INTEGER DEFAULT 0",
        "comment_count": "INTEGER DEFAULT 0",
        "karma": "INTEGER DEFAULT 0",
        "last_active_at": "TEXT",
    },
    "posts": {
        "user_id": "TEXT",
        "post_status": "TEXT DEFAULT 'new'",
        "is_hot": "BOOLEAN DEFAULT FALSE",
        "comment_count": "INTEGER DEFAULT 0",
    },
    "comments": {
        "user_id": "TEXT",
        "thread_path": "TEXT",
        "batch_id": "TEXT",
    },
}


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def init_db(db_path: Path) -> None:
    db_path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(db_path)
    try:
        conn.executescript(SCHEMA)
        conn.commit()
    finally:
        conn.close()
    migrate(db_path)


def migrate(db_path: Path) -> None:
    """Add NEW_COLUMNS to databases created before those columns existed.

    CREATE TABLE IF NOT EXISTS leaves old tables untouched, so check
    PRAGMA table_info and ALTER TABLE ADD COLUMN for anything missing.
    Idempotent: safe to run on every startup.
    """
    conn = sqlite3.connect(db_path)
    try:
        existing_tables = {
            row[0] for row in conn.execute("SELECT name FROM sqlite_master WHERE type='table'")
        }
        for table, columns in NEW_COLUMNS.items():
            if table not in existing_tables:
                continue
            present = {row[1] for row in conn.execute(f"PRAGMA table_info({table})")}
            for name, ddl in columns.items():
                if name not in present:
                    conn.execute(f"ALTER TABLE {table} ADD COLUMN {name} {ddl}")
        conn.commit()
    finally:
        conn.close()


def row_to_dict(cursor, row) -> dict[str, Any]:
    return {col[0]: row[idx] for idx, col in enumerate(cursor.description)}


def create_world(
    db_path: Path,
    session_key: str,
    topic_id: str,
    topic_title: str,
    current_concept_id: str | None = None,
) -> str:
    world_id = str(uuid.uuid4())
    ts = now_iso()
    conn = sqlite3.connect(db_path)
    try:
        conn.execute(
            """
            INSERT INTO worlds (world_id, session_key, topic_id, topic_title, status, current_concept_id, created_at, updated_at)
            VALUES (?, ?, ?, ?, 'active', ?, ?, ?)
            """,
            (world_id, session_key, topic_id, topic_title, current_concept_id, ts, ts),
        )
        conn.commit()
    finally:
        conn.close()
    return world_id


def get_world(db_path: Path, world_id: str) -> dict[str, Any] | None:
    conn = sqlite3.connect(db_path)
    conn.row_factory = row_to_dict
    try:
        cur = conn.execute("SELECT * FROM worlds WHERE world_id = ?", (world_id,))
        return cur.fetchone()
    finally:
        conn.close()


def list_worlds(db_path: Path, session_key: str) -> list[dict[str, Any]]:
    conn = sqlite3.connect(db_path)
    conn.row_factory = row_to_dict
    try:
        cur = conn.execute(
            "SELECT * FROM worlds WHERE session_key = ? ORDER BY updated_at DESC",
            (session_key,),
        )
        return cur.fetchall()
    finally:
        conn.close()


def insert_agent(db_path: Path, world_id: str, persona, belief: Any = None) -> None:
    """Insert one agent row.

    belief: optional initial BeliefState (object with to_dict()) or plain dict;
    stored into belief_json. Counters and last_active_at use schema defaults.
    """
    belief_json = "{}"
    if belief is not None:
        payload = belief.to_dict() if hasattr(belief, "to_dict") else belief
        belief_json = json.dumps(payload, ensure_ascii=False)
    conn = sqlite3.connect(db_path)
    try:
        conn.execute(
            """
            INSERT INTO agents (agent_id, world_id, display_name, handle, bio, persona_json, belief_json, voice_tags, community_edges_json, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                persona.agent_id,
                world_id,
                persona.display_name,
                persona.handle,
                persona.bio,
                json.dumps(persona.to_json(), ensure_ascii=False),
                belief_json,
                ", ".join(persona.traits),
                "{}",
                now_iso(),
            ),
        )
        conn.commit()
    finally:
        conn.close()
