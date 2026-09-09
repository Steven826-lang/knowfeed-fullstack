"""Tests for the five-signal recommender (spec section 7).

The temporary databases are built with the current init_db plus the spec 3.1
ALTER/CREATE DDL applied inline, so these tests do not depend on the schema
migration landing in db.py.
"""

import json
import sqlite3
import uuid
from datetime import datetime, timedelta, timezone

import pytest

from db import init_db
from recommender import (
    EXPLORATION_EVERY,
    PostCandidate,
    UserContext,
    diversity_score,
    freshness_score,
    get_feed,
    interest_score,
    learning_value_score,
    popularity_raw,
    popularity_score,
    reason_for_post,
    rerank_with_diversity,
    time_decay,
)

NOW = datetime(2026, 7, 16, 12, 0, 0, tzinfo=timezone.utc)

# Spec 3.1 schema delta on top of the original db.py schema. Each ALTER is
# applied individually and duplicate-column errors are ignored, so the fixture
# works whether or not db.py already ships the new columns.
SPEC_31_ALTERATIONS = [
    "ALTER TABLE posts ADD COLUMN user_id TEXT",
    "ALTER TABLE posts ADD COLUMN post_status TEXT DEFAULT 'new'",
    "ALTER TABLE posts ADD COLUMN is_hot BOOLEAN DEFAULT 0",
    "ALTER TABLE posts ADD COLUMN comment_count INTEGER DEFAULT 0",
    "ALTER TABLE comments ADD COLUMN user_id TEXT",
    "ALTER TABLE comments ADD COLUMN thread_path TEXT",
    "ALTER TABLE comments ADD COLUMN batch_id TEXT",
]

SPEC_31_NEW_TABLES = """
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
"""


def make_db(tmp_path):
    db_path = tmp_path / "test.db"
    init_db(db_path)
    conn = sqlite3.connect(db_path)
    try:
        for statement in SPEC_31_ALTERATIONS:
            try:
                conn.execute(statement)
            except sqlite3.OperationalError as exc:
                if "duplicate column name" not in str(exc):
                    raise
        conn.executescript(SPEC_31_NEW_TABLES)
        conn.execute(
            "INSERT INTO worlds (world_id, session_key, topic_id, topic_title, status, current_concept_id, created_at, updated_at) "
            "VALUES ('w1', 's1', 't1', 'AI 入门', 'active', 'c1', ?, ?)",
            (NOW.isoformat(), NOW.isoformat()),
        )
        conn.commit()
    finally:
        conn.close()
    return db_path


def add_agent(db_path, agent_id, name="资料哥", handle="data_guy"):
    conn = sqlite3.connect(db_path)
    try:
        conn.execute(
            "INSERT INTO agents (agent_id, world_id, display_name, handle, bio, persona_json, voice_tags, community_edges_json, created_at) "
            "VALUES (?, 'w1', ?, ?, 'bio', '{}', '', '{}', ?)",
            (agent_id, name, handle, NOW.isoformat()),
        )
        conn.commit()
    finally:
        conn.close()


def add_post(
    db_path,
    post_id,
    agent_id="a1",
    user_id=None,
    concept_id="c1",
    content="大模型其实就是个高级补全器，别被名字吓到。",
    stance="neutral",
    heat=0,
    is_hot=0,
    age_hours=1.0,
):
    created = (NOW - timedelta(hours=age_hours)).isoformat()
    conn = sqlite3.connect(db_path)
    try:
        conn.execute(
            "INSERT INTO posts (post_id, world_id, concept_id, agent_id, user_id, content, stance, heat, is_hot, created_at) "
            "VALUES (?, 'w1', ?, ?, ?, ?, ?, ?, ?, ?)",
            (post_id, concept_id, agent_id, user_id, content, stance, heat, is_hot, created),
        )
        conn.commit()
    finally:
        conn.close()


def add_comment(db_path, post_id, comment_id, agent_id="a2", content="这里有个追问", stance="question", relation="追问", parent=None):
    conn = sqlite3.connect(db_path)
    try:
        conn.execute(
            "INSERT INTO comments (comment_id, post_id, parent_comment_id, agent_id, content, stance, relation, heat, created_at) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?)",
            (comment_id, post_id, parent, agent_id, content, stance, relation, NOW.isoformat()),
        )
        conn.commit()
    finally:
        conn.close()


def add_reaction(db_path, target_id, agent_id, reaction_type):
    conn = sqlite3.connect(db_path)
    try:
        conn.execute(
            "INSERT INTO reactions (reaction_id, target_type, target_id, agent_id, reaction_type, created_at) "
            "VALUES (?, 'post', ?, ?, ?, ?)",
            (str(uuid.uuid4()), target_id, agent_id, reaction_type, NOW.isoformat()),
        )
        conn.commit()
    finally:
        conn.close()


def add_delta_event(db_path, payload):
    conn = sqlite3.connect(db_path)
    try:
        conn.execute(
            "INSERT INTO events (world_id, round, agent_id, action, payload_json, created_at) "
            "VALUES ('w1', 1, ?, 'delta', ?, ?)",
            (payload.get("agent_id"), json.dumps(payload, ensure_ascii=False), NOW.isoformat()),
        )
        conn.commit()
    finally:
        conn.close()


def make_candidate(**overrides):
    base = dict(
        post_id="p1",
        world_id="w1",
        concept_id="c1",
        agent_id="a1",
        user_id=None,
        content="大模型其实就是个高级补全器，别被名字吓到。",
        stance="neutral",
        heat=0,
        is_hot=False,
        created_at=NOW - timedelta(hours=1),
        author_name="资料哥",
        author_handle="data_guy",
        like_count=0,
        dislike_count=0,
        comment_count=0,
        comment_stances=set(),
        has_delta=False,
        has_qa=False,
    )
    base.update(overrides)
    return PostCandidate(**base)


# ---------------------------------------------------------------------------
# Pure signal functions
# ---------------------------------------------------------------------------


def test_time_decay_half_life():
    assert time_decay(0) == 1.0
    assert time_decay(24) == pytest.approx(0.5)
    assert time_decay(48) == pytest.approx(0.25)
    assert time_decay(-5) == 1.0  # clock skew never amplifies


def test_popularity_raw_formula():
    post = make_candidate(
        like_count=10,
        dislike_count=5,
        comment_count=8,
        is_hot=True,
        created_at=NOW - timedelta(hours=12),
    )
    # (10 - 5*0.8 + 8*2 + 20) * 0.5**(12/24) = 42 * ~0.7071
    assert popularity_raw(post, NOW) == pytest.approx(42 * 0.5**0.5, rel=1e-4)


def test_popularity_raw_never_negative():
    post = make_candidate(like_count=0, dislike_count=50, comment_count=0)
    assert popularity_raw(post, NOW) == 0.0


def test_popularity_score_saturates_between_zero_and_one():
    cold = make_candidate()
    hot = make_candidate(like_count=200, comment_count=100, is_hot=True)
    assert popularity_score(cold, NOW) == 0.0
    assert 0.0 < popularity_score(hot, NOW) < 1.0
    assert popularity_score(hot, NOW) > popularity_score(
        make_candidate(like_count=10, comment_count=5), NOW
    )


def test_freshness_seen_posts_score_zero():
    post = make_candidate(post_id="p-seen")
    ctx = UserContext(seen_post_ids={"p-seen"})
    assert freshness_score(post, ctx, NOW) == 0.0


def test_freshness_decays_with_age():
    fresh = make_candidate(created_at=NOW)
    day_old = make_candidate(created_at=NOW - timedelta(hours=24))
    ctx = UserContext()
    assert freshness_score(fresh, ctx, NOW) == pytest.approx(1.0)
    assert freshness_score(day_old, ctx, NOW) < freshness_score(fresh, ctx, NOW)


def test_interest_current_concept_match():
    post = make_candidate(concept_id="c1")
    ctx = UserContext(current_concept_id="c1")
    assert interest_score(post, ctx) == pytest.approx(0.50)
    other = make_candidate(concept_id="c-other")
    assert interest_score(other, ctx) == 0.0


def test_interest_review_queue_match():
    post = make_candidate(concept_id="c9")
    ctx = UserContext(review_queue=["c9"])
    assert interest_score(post, ctx) == pytest.approx(0.35)
    ctx_titled = UserContext(review_queue=[{"concept_id": "c9", "title": "注意力机制"}])
    assert interest_score(post, ctx_titled) == pytest.approx(0.35)


def test_interest_profile_keyword_overlap():
    post = make_candidate(concept_id="c-other", content="前端工程师转型做 AI 应用的几点建议")
    ctx = UserContext(background="我是前端工程师，想转型", known_areas=["前端"])
    # 前端 / 端工 / 工程 / 程师 bigrams overlap between content and profile
    assert 0.0 < interest_score(post, ctx) <= 0.30


def test_interest_dislike_stance_and_avoided_style_penalties():
    post = make_candidate(stance="opposing", content="这个吐槽风格我不喜欢")
    ctx = UserContext(
        current_concept_id="c1",
        avoided_styles=["吐槽"],
        preferences=[{"preference_type": "dislike_stance", "target_value": "opposing", "strength": 1.0}],
    )
    # 0.50 - min(0.5, 0.25 avoided style + 0.30 disliked stance) = 0.0
    assert interest_score(post, ctx) == pytest.approx(0.0)


def test_interest_single_disliked_stance_penalty():
    post = make_candidate(stance="opposing")
    ctx = UserContext(
        current_concept_id="c1",
        preferences=[{"preference_type": "dislike_stance", "target_value": "opposing", "strength": 1.0}],
    )
    assert interest_score(post, ctx) == pytest.approx(0.20)


def test_interest_like_author_boost():
    post = make_candidate(agent_id="a1", author_handle="data_guy")
    ctx = UserContext(
        current_concept_id="c1",
        preferences=[{"preference_type": "like_author", "target_value": "data_guy", "strength": 1.0}],
    )
    assert interest_score(post, ctx) == pytest.approx(0.75)


def test_learning_value_components():
    plain = make_candidate()
    assert learning_value_score(plain, UserContext()) == 0.0
    explainer = make_candidate(
        stance="sharing",
        content="省流：注意力机制就是让模型学会看重点。" * 6,  # >= 80 chars
    )
    assert learning_value_score(explainer, UserContext()) == pytest.approx(0.25)
    sourced = make_candidate(content="来源：arxiv 上一篇论文讲得很清楚")
    assert learning_value_score(sourced, UserContext()) == pytest.approx(0.25)
    qa = make_candidate(has_qa=True)
    assert learning_value_score(qa, UserContext()) == pytest.approx(0.25)
    delta = make_candidate(has_delta=True)
    assert learning_value_score(delta, UserContext()) == pytest.approx(0.35)
    everything = make_candidate(
        stance="sharing",
        content="来源：论文。" * 20,
        has_qa=True,
        has_delta=True,
    )
    assert learning_value_score(everything, UserContext()) == 1.0  # clamped


def test_diversity_score_penalizes_repeats():
    a1_post = make_candidate(post_id="x", agent_id="a1", stance="supportive")
    placed = [make_candidate(post_id="y", agent_id="a2", stance="neutral"), a1_post]
    same_author = make_candidate(post_id="z", agent_id="a1", stance="opposing")
    assert diversity_score(same_author, placed) == pytest.approx(0.4)
    stance_run = make_candidate(post_id="z2", agent_id="a9", stance="supportive")
    placed_run = [
        make_candidate(post_id="q1", agent_id="a2", stance="supportive"),
        make_candidate(post_id="q2", agent_id="a3", stance="supportive"),
    ]
    assert diversity_score(stance_run, placed_run) == pytest.approx(0.6)


# ---------------------------------------------------------------------------
# Diversity rerank
# ---------------------------------------------------------------------------


def _scored(pairs):
    return [(make_candidate(post_id=pid, **kw), score) for pid, score, kw in pairs]


def test_rerank_repairs_author_and_stance_runs():
    scored = _scored(
        [
            ("p1", 1.00, {"agent_id": "a1", "stance": "supportive"}),
            ("p2", 0.95, {"agent_id": "a1", "stance": "supportive"}),
            ("p3", 0.90, {"agent_id": "a1", "stance": "supportive"}),
            ("p4", 0.50, {"agent_id": "a2", "stance": "neutral"}),
            ("p5", 0.40, {"agent_id": "a3", "stance": "opposing"}),
            ("p6", 0.30, {"agent_id": "a4", "stance": "neutral"}),
        ]
    )
    ctx = UserContext(current_concept_id="c1")
    ranked = rerank_with_diversity(scored, ctx)
    assert len(ranked) == 6
    for i in range(1, len(ranked)):
        assert not (
            ranked[i].agent_id
            and ranked[i].agent_id == ranked[i - 1].agent_id
        ), f"author repeats at {i}"
        if i >= 2:
            assert not (
                ranked[i - 2].stance == ranked[i - 1].stance == ranked[i].stance
            ), f"stance run at {i}"


def test_rerank_injects_exploration_post_every_five_slots():
    stances = ["supportive", "neutral", "opposing", "sharing", "supportive"]
    scored = _scored(
        [
            (f"main-{i}", 1.0 - i * 0.01, {"agent_id": f"a{i}", "stance": stances[i]})
            for i in range(5)
        ]
    )
    controversial = make_candidate(
        post_id="contro",
        agent_id="a9",
        stance="opposing",
        like_count=10,
        dislike_count=4,
    )
    scored.append((controversial, 0.01))
    ctx = UserContext(current_concept_id="c1")
    ranked = rerank_with_diversity(scored, ctx)
    assert ranked[EXPLORATION_EVERY - 1].post_id == "contro"


# ---------------------------------------------------------------------------
# Reason tags
# ---------------------------------------------------------------------------


def test_reason_followed_author():
    post = make_candidate(agent_id="a1", author_name="资料哥", author_handle="data_guy")
    ctx = UserContext(
        preferences=[{"preference_type": "like_author", "target_value": "data_guy", "strength": 1.0}]
    )
    label, code = reason_for_post(post, ctx, NOW, 0.0)
    assert code == "followed_author"
    assert label == "👤 来自你关注的 资料哥"


def test_reason_current_concept_and_review():
    post = make_candidate(concept_id="c1")
    label, code = reason_for_post(post, UserContext(current_concept_id="c1"), NOW, 0.0)
    assert code == "concept"
    assert "c1" in label
    review_post = make_candidate(concept_id="c9")
    ctx = UserContext(review_queue=[{"concept_id": "c9", "title": "注意力机制"}])
    label, code = reason_for_post(review_post, ctx, NOW, 0.0)
    assert code == "review"
    assert label == "🔄 复习一下“注意力机制”"


def test_reason_hot_and_new():
    hot_post = make_candidate(is_hot=True)
    label, code = reason_for_post(hot_post, UserContext(), NOW, 0.9)
    assert code == "hot"
    assert label == "🔥 热帖 · 讨论很激烈"
    new_post = make_candidate(created_at=NOW - timedelta(minutes=30))
    label, code = reason_for_post(new_post, UserContext(), NOW, 0.0)
    assert code == "new"
    assert label == "🆕 新帖 · 刚发 30 分钟"


# ---------------------------------------------------------------------------
# get_feed end to end
# ---------------------------------------------------------------------------


@pytest.fixture
def feed_db(tmp_path):
    db_path = make_db(tmp_path)
    for agent_id, name, handle in [
        ("a1", "资料哥", "data_guy"),
        ("a2", "怀疑论者99", "skeptic_99"),
        ("a3", "萌新提问", "newbie_asker"),
    ]:
        add_agent(db_path, agent_id, name, handle)
    # Hot post on the current concept with a delta moment.
    add_post(db_path, "p-hot", agent_id="a1", concept_id="c1", is_hot=1, age_hours=30)
    for i in range(6):
        add_reaction(db_path, "p-hot", f"r{i}", "like")
    add_reaction(db_path, "p-hot", "r6", "dislike")
    add_comment(db_path, "p-hot", "cm1", agent_id="a2", content="这里有个追问", stance="question", relation="追问")
    add_comment(db_path, "p-hot", "cm2", agent_id="a1", content="补充回答一下", stance="neutral", relation="补充", parent="cm1")
    add_delta_event(db_path, {"agent_id": "a1", "concept_id": "c1", "post_id": "p-hot"})
    # A brand new post from a followed author on another concept.
    add_post(db_path, "p-new", agent_id="a2", concept_id="c2", age_hours=0.5, stance="sharing")
    # A post on a concept in the review queue.
    add_post(db_path, "p-review", agent_id="a3", concept_id="c9", age_hours=50, stance="neutral")
    # A user-authored question post.
    add_post(db_path, "p-user", agent_id=None, user_id="me", concept_id="c3", age_hours=2, stance="question")
    add_comment(db_path, "p-user", "cm3", agent_id="a1", content="我来回答这个问题", stance="neutral", relation="补充")
    # An old cold post far from everything.
    add_post(db_path, "p-old", agent_id="a3", concept_id="c4", age_hours=200, stance="sharing")
    return db_path


def feed_ctx():
    return UserContext(
        background="我是前端工程师，想转型做 AI",
        goal="掌握大模型基础",
        motivation="换工作",
        known_areas=["前端"],
        avoided_styles=[],
        review_queue=[{"concept_id": "c9", "title": "注意力机制"}],
        current_concept_id="c1",
        seen_post_ids=set(),
        preferences=[{"preference_type": "like_author", "target_value": "skeptic_99", "strength": 1.0}],
    )


def test_get_feed_returns_none_for_unknown_world(feed_db):
    assert get_feed(feed_db, "no-such-world", feed_ctx(), now=NOW) is None


def test_get_feed_orders_and_labels(feed_db):
    result = get_feed(feed_db, "w1", feed_ctx(), limit=10, now=NOW)
    assert result["world_id"] == "w1"
    posts = {p["post_id"]: p for p in result["posts"]}
    assert set(posts) == {"p-hot", "p-new", "p-review", "p-user", "p-old"}

    hot = posts["p-hot"]
    assert hot["like_count"] == 6
    assert hot["dislike_count"] == 1
    assert hot["comment_count"] == 2
    assert hot["reason_code"] == "concept"  # current concept outranks hot label
    assert hot["signals"]["learning"] > 0.5  # delta + Q&A
    assert hot["author"] == {"display_name": "资料哥", "handle": "data_guy"}

    assert posts["p-new"]["reason_code"] == "followed_author"
    assert posts["p-review"]["reason_code"] == "review"
    assert posts["p-user"]["author"] is None
    assert posts["p-user"]["user_id"] == "me"
    # The two strongest matches lead the feed.
    assert result["posts"][0]["post_id"] in {"p-hot", "p-new"}


def test_get_feed_excludes_seen_posts(feed_db):
    ctx = feed_ctx()
    ctx.seen_post_ids = {"p-hot", "p-new"}
    result = get_feed(feed_db, "w1", ctx, limit=10, now=NOW)
    ids = {p["post_id"] for p in result["posts"]}
    assert "p-hot" not in ids
    assert "p-new" not in ids
    assert ids == {"p-review", "p-user", "p-old"}


def test_get_feed_cursor_paging_is_stable_and_complete(feed_db):
    ctx = feed_ctx()
    page1 = get_feed(feed_db, "w1", ctx, limit=2, now=NOW)
    assert page1["next_cursor"]
    page2 = get_feed(feed_db, "w1", ctx, limit=2, cursor=page1["next_cursor"])
    page3 = get_feed(feed_db, "w1", ctx, limit=2, cursor=page2["next_cursor"])
    assert page3["next_cursor"] is None
    ids = [p["post_id"] for page in (page1, page2, page3) for p in page["posts"]]
    assert len(ids) == len(set(ids)) == 5
    # Paging replays the same snapshot as one big page pinned at the same time.
    full = get_feed(feed_db, "w1", ctx, limit=10, now=NOW)
    assert ids == [p["post_id"] for p in full["posts"]]


def test_get_feed_is_read_only(feed_db):
    def snapshot():
        conn = sqlite3.connect(feed_db)
        try:
            schema = conn.execute(
                "SELECT type, name, sql FROM sqlite_master ORDER BY name"
            ).fetchall()
            posts = conn.execute("SELECT COUNT(*) FROM posts").fetchone()[0]
            reactions = conn.execute("SELECT COUNT(*) FROM reactions").fetchone()[0]
            events = conn.execute("SELECT COUNT(*) FROM events").fetchone()[0]
            return schema, posts, reactions, events
        finally:
            conn.close()

    before = snapshot()
    get_feed(feed_db, "w1", feed_ctx(), limit=10, now=NOW)
    assert snapshot() == before
