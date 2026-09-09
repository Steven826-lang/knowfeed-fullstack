"""Execute agent actions against the SQLite database."""

import sqlite3
import uuid
from datetime import datetime, timezone
from pathlib import Path

from db import now_iso


def create_post(
    db_path: Path,
    world_id: str,
    concept_id: str,
    agent_id: str,
    content: str,
    stance: str,
) -> str:
    post_id = str(uuid.uuid4())
    conn = sqlite3.connect(db_path)
    try:
        conn.execute(
            "INSERT INTO posts (post_id, world_id, concept_id, agent_id, content, stance, heat, created_at) VALUES (?, ?, ?, ?, ?, ?, 0, ?)",
            (post_id, world_id, concept_id, agent_id, content, stance, now_iso()),
        )
        conn.commit()
    finally:
        conn.close()
    return post_id


def create_comment(
    db_path: Path,
    post_id: str,
    agent_id: str,
    content: str,
    stance: str,
    relation: str,
    parent_comment_id: str | None = None,
) -> str:
    comment_id = str(uuid.uuid4())
    conn = sqlite3.connect(db_path)
    try:
        conn.execute(
            "INSERT INTO comments (comment_id, post_id, parent_comment_id, agent_id, content, stance, relation, heat, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?)",
            (comment_id, post_id, parent_comment_id, agent_id, content, stance, relation, now_iso()),
        )
        conn.commit()
    finally:
        conn.close()
    return comment_id


def add_reaction(
    db_path: Path,
    target_type: str,
    target_id: str,
    agent_id: str,
    reaction_type: str,
) -> None:
    conn = sqlite3.connect(db_path)
    try:
        existing = conn.execute(
            "SELECT reaction_id FROM reactions WHERE target_type = ? AND target_id = ? AND agent_id = ?",
            (target_type, target_id, agent_id),
        ).fetchone()
        if existing:
            conn.execute(
                "UPDATE reactions SET reaction_type = ? WHERE reaction_id = ?",
                (reaction_type, existing[0]),
            )
        else:
            conn.execute(
                "INSERT INTO reactions (reaction_id, target_type, target_id, agent_id, reaction_type, created_at) VALUES (?, ?, ?, ?, ?, ?)",
                (str(uuid.uuid4()), target_type, target_id, agent_id, reaction_type, now_iso()),
            )
        _recalc_heat(conn, target_type, target_id)
        conn.commit()
    finally:
        conn.close()


def _recalc_heat(conn: sqlite3.Connection, target_type: str, target_id: str) -> None:
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
