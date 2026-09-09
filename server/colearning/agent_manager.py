"""Build and manage the AI agent roster for a community world (spec §3.1, §4)."""

import json
import random
import sqlite3
from dataclasses import replace
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

from db import now_iso
from personas import Persona, generate_personas

try:  # belief_state.py lands from a parallel workstream; use it when present
    from belief_state import BeliefState
except ImportError:  # pragma: no cover
    BeliefState = None

MIN_AGENTS = 25
MAX_AGENTS = 30

# Fallback DDL so this module is self-sufficient on a bare database file;
# CREATE TABLE IF NOT EXISTS is a no-op once db.py owns the table.
AGENTS_TABLE_DDL = """
CREATE TABLE IF NOT EXISTS agents (
    agent_id TEXT PRIMARY KEY,
    world_id TEXT NOT NULL,
    display_name TEXT NOT NULL,
    handle TEXT NOT NULL,
    bio TEXT NOT NULL,
    persona_json TEXT NOT NULL,
    belief_json TEXT NOT NULL DEFAULT '{}',
    post_count INTEGER NOT NULL DEFAULT 0,
    comment_count INTEGER NOT NULL DEFAULT 0,
    karma INTEGER NOT NULL DEFAULT 0,
    last_active_at TEXT,
    created_at TEXT NOT NULL
);
"""

# Columns required by spec §3.1 that older db.py schemas may not have yet.
REQUIRED_AGENT_COLUMNS = {
    "belief_json": "TEXT NOT NULL DEFAULT '{}'",
    "post_count": "INTEGER NOT NULL DEFAULT 0",
    "comment_count": "INTEGER NOT NULL DEFAULT 0",
    "karma": "INTEGER NOT NULL DEFAULT 0",
    "last_active_at": "TEXT",
}


def ensure_agent_schema(db_path: Path) -> None:
    """Idempotently add the agents-table columns this module needs.

    db.py is being extended in parallel, so never rely on its version:
    create the table when missing and ALTER in any absent columns instead.
    """
    conn = sqlite3.connect(db_path)
    try:
        conn.execute(AGENTS_TABLE_DDL)
        existing = {row[1] for row in conn.execute("PRAGMA table_info(agents)")}
        for name, ddl in REQUIRED_AGENT_COLUMNS.items():
            if name not in existing:
                conn.execute(f"ALTER TABLE agents ADD COLUMN {name} {ddl}")
        conn.commit()
    finally:
        conn.close()


def build_world_roster(
    db_path: Path,
    world_id: str,
    topic: str,
    concept_ids: list[str],
    count: int = 28,
    rng: random.Random | None = None,
) -> list[dict[str, Any]]:
    """Create and persist the 25-30 agent roster for a world.

    Idempotent: a world that already has agents returns its existing roster.
    Each agent gets an initial BeliefState over the concept list (stored in
    belief_json) and 2-4 lightweight rivalry/buddy relations (stored inside
    persona_json). Returns the roster in the same shape as load_roster().
    """
    rng = rng or random.Random()
    ensure_agent_schema(db_path)
    existing = load_roster(db_path, world_id)
    if existing:
        return existing

    count = max(MIN_AGENTS, min(MAX_AGENTS, count))
    concept_ids = list(concept_ids)
    personas = generate_personas(topic, count=count, rng=rng)
    relations = _assign_relations(personas, rng)

    now = datetime.now(timezone.utc)
    conn = sqlite3.connect(db_path)
    try:
        columns = {row[1] for row in conn.execute("PRAGMA table_info(agents)")}
        for persona in personas:
            persona = replace(persona, relations=relations[persona.agent_id])
            belief_json = json.dumps(
                _initial_belief_dict(persona, topic, concept_ids, rng),
                ensure_ascii=False,
            )
            # Stagger past activity so the recency bias has signal from day one.
            last_active = (now - timedelta(hours=rng.uniform(0.5, 48))).isoformat()
            values = {
                "agent_id": persona.agent_id,
                "world_id": world_id,
                "display_name": persona.display_name,
                "handle": persona.handle,
                "bio": persona.bio,
                "persona_json": json.dumps(persona.to_json(), ensure_ascii=False),
                "voice_tags": ", ".join(persona.traits),
                "community_edges_json": json.dumps(persona.relations, ensure_ascii=False),
                "belief_json": belief_json,
                "post_count": 0,
                "comment_count": 0,
                "karma": rng.randint(5, 80),
                "last_active_at": last_active,
                "created_at": now_iso(),
            }
            # Only write columns that actually exist (old and new db.py schemas).
            cols = [c for c in values if c in columns]
            placeholders = ", ".join("?" for _ in cols)
            conn.execute(
                f"INSERT INTO agents ({', '.join(cols)}) VALUES ({placeholders})",
                [values[c] for c in cols],
            )
        conn.commit()
    finally:
        conn.close()
    return load_roster(db_path, world_id)


def load_roster(db_path: Path, world_id: str) -> list[dict[str, Any]]:
    """Load all agents of a world as row dicts.

    persona_json / belief_json are additionally parsed into the `persona` and
    `belief` keys for convenient access.
    """
    ensure_agent_schema(db_path)
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    try:
        rows = conn.execute(
            "SELECT * FROM agents WHERE world_id = ? ORDER BY created_at ASC, agent_id ASC",
            (world_id,),
        ).fetchall()
    finally:
        conn.close()
    roster: list[dict[str, Any]] = []
    for row in rows:
        agent = dict(row)
        agent["persona"] = json.loads(agent.get("persona_json") or "{}")
        agent["belief"] = json.loads(agent.get("belief_json") or "{}")
        roster.append(agent)
    return roster


def pick_active_agents(
    db_path: Path,
    world_id: str,
    n: int,
    rng: random.Random | None = None,
) -> list[dict[str, Any]]:
    """Pick n agents, biased toward recent last_active_at plus random jitter.

    Score = 1 / (1 + hours_since_last_active) + uniform(0, 0.5), so recently
    active agents almost always win while ties break randomly (spec §6.2).
    """
    rng = rng or random.Random()
    roster = load_roster(db_path, world_id)
    if not roster:
        return []
    n = max(0, min(n, len(roster)))
    now = datetime.now(timezone.utc)
    scored = []
    for agent in roster:
        recency = 1.0 / (1.0 + _hours_since(agent.get("last_active_at"), now))
        scored.append((recency + rng.uniform(0.0, 0.5), agent["agent_id"], agent))
    scored.sort(key=lambda item: (item[0], item[1]), reverse=True)
    return [agent for _, _, agent in scored[:n]]


def touch_active(db_path: Path, agent_id: str) -> None:
    """Stamp an agent's last_active_at as now."""
    ensure_agent_schema(db_path)
    conn = sqlite3.connect(db_path)
    try:
        conn.execute(
            "UPDATE agents SET last_active_at = ? WHERE agent_id = ?",
            (now_iso(), agent_id),
        )
        conn.commit()
    finally:
        conn.close()


def _assign_relations(
    personas: list[Persona],
    rng: random.Random,
) -> dict[str, list[dict[str, str]]]:
    """Give every agent 2-4 mutual rivalry/buddy edges with roster peers."""
    ids = [p.agent_id for p in personas]
    handle_of = {p.agent_id: p.handle for p in personas}
    target = {pid: rng.randint(2, 4) for pid in ids}
    edges: dict[str, list[dict[str, str]]] = {pid: [] for pid in ids}

    def linked(a: str, b: str) -> bool:
        return any(e["agent_id"] == b for e in edges[a])

    for pid in ids:
        while len(edges[pid]) < target[pid]:
            candidates = [
                other
                for other in ids
                if other != pid and not linked(pid, other) and len(edges[other]) < 4
            ]
            if not candidates:
                break
            other = rng.choice(candidates)
            kind = "rival" if rng.random() < 0.5 else "buddy"
            edges[pid].append({"agent_id": other, "handle": handle_of[other], "kind": kind})
            edges[other].append({"agent_id": pid, "handle": handle_of[pid], "kind": kind})
    return edges


def _initial_belief_dict(
    persona: Persona,
    topic: str,
    concept_ids: list[str],
    rng: random.Random,
) -> dict[str, Any]:
    """Initial BeliefState dict over the concept list.

    Uses belief_state.BeliefState.from_profile once that module is available;
    until then falls back to a local initialization with the same serialized
    shape (positions/confidence/trust/exposure_history/recent_reflection).
    """
    agent_config = {**persona.to_json(), "topic": topic}
    if BeliefState is not None:
        return BeliefState.from_profile(agent_config, concept_ids).to_dict()
    return {
        "positions": {
            cid: round(max(-1.0, min(1.0, persona.stance_bias * 0.6 + rng.uniform(-0.35, 0.35))), 3)
            for cid in concept_ids
        },
        "confidence": {cid: round(rng.uniform(0.3, 0.7), 3) for cid in concept_ids},
        "trust": {},
        "exposure_history": [],
        "recent_reflection": "",
    }


def _hours_since(iso_ts: str | None, now: datetime) -> float:
    """Hours between an ISO timestamp and now; missing/invalid means 7 days."""
    if not iso_ts:
        return 24.0 * 7
    try:
        ts = datetime.fromisoformat(iso_ts)
    except ValueError:
        return 24.0 * 7
    if ts.tzinfo is None:
        ts = ts.replace(tzinfo=timezone.utc)
    return max(0.0, (now - ts).total_seconds() / 3600)
