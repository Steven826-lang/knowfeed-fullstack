import json
import random
import sqlite3
from datetime import datetime, timedelta, timezone

from db import init_db, create_world
from agent_manager import (
    MAX_AGENTS,
    MIN_AGENTS,
    build_world_roster,
    ensure_agent_schema,
    load_roster,
    pick_active_agents,
    touch_active,
)

TOPIC = "大模型入门"
CONCEPT_IDS = ["c-attention", "c-pretrain", "c-finetune"]


def _make_world(tmp_path):
    """Temp DB built with the current (old) db.py schema, like production."""
    db_path = tmp_path / "test.db"
    init_db(db_path)
    world_id = create_world(db_path, "s1", "t1", TOPIC, CONCEPT_IDS[0])
    return db_path, world_id


def _set_last_active(db_path, agent_id, ts):
    conn = sqlite3.connect(db_path)
    conn.execute("UPDATE agents SET last_active_at = ? WHERE agent_id = ?", (ts, agent_id))
    conn.commit()
    conn.close()


def test_roster_count_is_clamped_to_spec_bounds(tmp_path):
    db_path = tmp_path / "test.db"
    init_db(db_path)
    w_small = create_world(db_path, "s1", "t1", TOPIC)
    w_big = create_world(db_path, "s1", "t1", TOPIC)
    w_default = create_world(db_path, "s1", "t1", TOPIC)
    small = build_world_roster(db_path, w_small, TOPIC, CONCEPT_IDS, count=10, rng=random.Random(1))
    big = build_world_roster(db_path, w_big, TOPIC, CONCEPT_IDS, count=99, rng=random.Random(1))
    default = build_world_roster(db_path, w_default, TOPIC, CONCEPT_IDS, rng=random.Random(1))
    assert len(small) == MIN_AGENTS == 25
    assert len(big) == MAX_AGENTS == 30
    assert len(default) == 28


def test_roster_names_and_handles_are_unique(tmp_path):
    db_path, world_id = _make_world(tmp_path)
    roster = build_world_roster(db_path, world_id, TOPIC, CONCEPT_IDS, rng=random.Random(2))
    names = [a["display_name"] for a in roster]
    handles = [a["handle"] for a in roster]
    assert len(set(names)) == len(names)
    assert len(set(handles)) == len(handles)
    assert len({a["agent_id"] for a in roster}) == len(roster)
    assert all(handles)


def test_belief_state_initialized_per_concept(tmp_path):
    db_path, world_id = _make_world(tmp_path)
    roster = build_world_roster(db_path, world_id, TOPIC, CONCEPT_IDS, rng=random.Random(3))
    for agent in roster:
        belief = agent["belief"]
        assert set(belief["positions"].keys()) == set(CONCEPT_IDS)
        assert all(-1.0 <= v <= 1.0 for v in belief["positions"].values())
        assert set(belief["confidence"].keys()) == set(CONCEPT_IDS)
        assert all(0.0 <= v <= 1.0 for v in belief["confidence"].values())
        # Persona-level stance prior survives the roundtrip into persona_json.
        assert -1.0 <= agent["persona"]["stance_bias"] <= 1.0


def test_relations_are_lightweight_mutual_and_stored_in_persona_json(tmp_path):
    db_path, world_id = _make_world(tmp_path)
    roster = build_world_roster(db_path, world_id, TOPIC, CONCEPT_IDS, rng=random.Random(4))
    by_id = {a["agent_id"]: a for a in roster}
    kinds = set()
    for agent in roster:
        relations = agent["persona"]["relations"]
        assert 2 <= len(relations) <= 4
        for rel in relations:
            assert rel["agent_id"] in by_id
            assert rel["agent_id"] != agent["agent_id"]
            assert rel["kind"] in {"rival", "buddy"}
            assert rel["handle"] == by_id[rel["agent_id"]]["handle"]
            kinds.add(rel["kind"])
            # Edges are mutual and agree on the kind.
            back = [r for r in by_id[rel["agent_id"]]["persona"]["relations"] if r["agent_id"] == agent["agent_id"]]
            assert len(back) == 1
            assert back[0]["kind"] == rel["kind"]
    assert kinds == {"rival", "buddy"}


def test_roster_persists_and_reloads(tmp_path):
    db_path, world_id = _make_world(tmp_path)
    built = build_world_roster(db_path, world_id, TOPIC, CONCEPT_IDS, rng=random.Random(5))
    loaded = load_roster(db_path, world_id)
    assert len(loaded) == len(built)
    agent = loaded[0]
    assert json.loads(agent["persona_json"]) == agent["persona"]
    assert json.loads(agent["belief_json"]) == agent["belief"]
    assert agent["post_count"] == 0
    assert agent["comment_count"] == 0
    assert isinstance(agent["karma"], int)
    assert agent["last_active_at"]
    # ensure_agent_schema is idempotent on an existing (old-schema) table.
    ensure_agent_schema(db_path)
    ensure_agent_schema(db_path)
    cols = {row[1] for row in sqlite3.connect(db_path).execute("PRAGMA table_info(agents)")}
    assert {"belief_json", "post_count", "comment_count", "karma", "last_active_at"} <= cols


def test_build_world_roster_is_idempotent(tmp_path):
    db_path, world_id = _make_world(tmp_path)
    first = build_world_roster(db_path, world_id, TOPIC, CONCEPT_IDS, rng=random.Random(6))
    second = build_world_roster(db_path, world_id, TOPIC, CONCEPT_IDS, rng=random.Random(7))
    assert {a["agent_id"] for a in first} == {a["agent_id"] for a in second}
    assert len(load_roster(db_path, world_id)) == len(first)


def test_roster_works_on_bare_database(tmp_path):
    # No init_db at all: agent_manager must self-provision its table/columns.
    db_path = tmp_path / "bare.db"
    roster = build_world_roster(db_path, "world-bare", TOPIC, CONCEPT_IDS, rng=random.Random(10))
    assert len(roster) == 28
    assert len(load_roster(db_path, "world-bare")) == 28


def test_pick_active_agents_prefers_recently_active(tmp_path):
    db_path, world_id = _make_world(tmp_path)
    roster = build_world_roster(db_path, world_id, TOPIC, CONCEPT_IDS, rng=random.Random(8))
    now = datetime.now(timezone.utc)
    recent_ids = {a["agent_id"] for a in roster[:6]}
    stale = (now - timedelta(days=7)).isoformat()
    for agent in roster:
        _set_last_active(db_path, agent["agent_id"], now.isoformat() if agent["agent_id"] in recent_ids else stale)
    picked = pick_active_agents(db_path, world_id, 4, random.Random(11))
    assert len(picked) == 4
    assert {a["agent_id"] for a in picked} <= recent_ids


def test_pick_active_agents_deterministic_with_seeded_rng_and_caps_n(tmp_path):
    db_path, world_id = _make_world(tmp_path)
    roster = build_world_roster(db_path, world_id, TOPIC, CONCEPT_IDS, rng=random.Random(12))
    first = pick_active_agents(db_path, world_id, 5, random.Random(42))
    second = pick_active_agents(db_path, world_id, 5, random.Random(42))
    assert [a["agent_id"] for a in first] == [a["agent_id"] for a in second]
    assert len(pick_active_agents(db_path, world_id, 999, random.Random(1))) == len(roster)
    assert pick_active_agents(db_path, world_id, 0, random.Random(1)) == []


def test_touch_active_stamps_now(tmp_path):
    db_path, world_id = _make_world(tmp_path)
    roster = build_world_roster(db_path, world_id, TOPIC, CONCEPT_IDS, rng=random.Random(9))
    agent_id = roster[0]["agent_id"]
    _set_last_active(db_path, agent_id, (datetime.now(timezone.utc) - timedelta(days=3)).isoformat())
    touch_active(db_path, agent_id)
    agent = next(a for a in load_roster(db_path, world_id) if a["agent_id"] == agent_id)
    delta = datetime.now(timezone.utc) - datetime.fromisoformat(agent["last_active_at"])
    assert delta < timedelta(minutes=1)
    # After touching, the agent becomes a strong pick candidate again.
    others = [a for a in roster if a["agent_id"] != agent_id]
    stale = (datetime.now(timezone.utc) - timedelta(days=7)).isoformat()
    for other in others:
        _set_last_active(db_path, other["agent_id"], stale)
    picked = pick_active_agents(db_path, world_id, 1, random.Random(13))
    assert picked[0]["agent_id"] == agent_id
