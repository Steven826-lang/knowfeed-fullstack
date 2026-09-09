"""Tests for world_init. All HTTP is mocked; no real LLM calls."""

import asyncio
import json
import random
import re
import sqlite3
from datetime import datetime, timedelta, timezone

import httpx
import pytest

import world_init
from content_generator import ContentGenerationError
from db import create_world, init_db
from personas import generate_personas
from world_init import (
    InitResult,
    initialize_world,
    needs_initialization,
    parse_posts,
)

TOPIC = "大模型入门"
CONCEPT_IDS = ["c-attention", "c-pretrain", "c-finetune"]

REAL_ASYNC_CLIENT = httpx.AsyncClient

# Distinct substantive Chinese posts (20-500 chars, varied angles) that pass
# the real quality.check_batch post gate without near-duplicate drops.
POST_CONTENTS = [
    "面试被问到注意力机制的计算复杂度，当场卡壳，回来整理了一份自己的理解，求各位帮忙挑错。",
    "分享一个笨办法：把每次微调前后的输出差异存下来对比，两周就能看出灾难性遗忘的苗头。",
    "我一直怀疑预训练数据质量比模型规模更关键，最近几个开源复现实验似乎也支持这个判断。",
    "新手提问：已经学过循环网络的情况下，迁移到注意力架构最应该先看懂哪一部分？",
    "踩坑记录：本地跑量化推理时没注意校准集分布，上线后准确率掉了八个点，血泪教训。",
    "类比一下，蒸馏就像让学霸把解题思路讲给同桌听，效率高但细节总会丢一些。",
    "搬运一个经典案例：某团队用合成语料扩充训练集，结果模型把编造的事实学得理直气壮。",
    "强烈反对一上来就堆参数的玩法，小数据场景下正则化和清洗样本的收益大得多。",
    "整理了十篇入门论文的阅读清单和每篇的踩坑提示，需要的同学自取，欢迎补充遗漏。",
    "吐槽：看了三周教程还是搞不懂位置编码，后来亲手画了一遍矩阵变换突然就通了。",
    "从工程落地角度聊聊推理成本，同样精度的模型，批处理策略不同，账单能差出三倍。",
    "历史视角：从感知机到注意力机制，每次范式转移都伴随着一次全面的工程重构。",
]


def _posts_payload(agent_ids, count=10):
    stances = ["supportive", "opposing", "neutral", "question", "sharing"]
    return {
        "posts": [
            {
                "id": f"p{i + 1}",
                "agent_id": agent_ids[i % len(agent_ids)],
                "concept_id": CONCEPT_IDS[i % len(CONCEPT_IDS)],
                "content": POST_CONTENTS[i % len(POST_CONTENTS)],
                "stance": stances[i % len(stances)],
                "likes": 20 + i * 7,
                "hours_ago": 30 + i * 5,
            }
            for i in range(count)
        ]
    }


def _tree_payload(agent_ids):
    """Spec-shaped tree that passes the real comment quality gate."""
    a, b, c, d = agent_ids[:4]
    return {
        "comments": [
            {"id": "c1", "parent_id": None, "agent_id": a, "content": "支持楼主，这个方向确实被低估了，我们项目里按这个思路改进效果很明显。", "stance": "supportive", "relation": "补充", "likes": 40, "hours_ago": 50},
            {"id": "c2", "parent_id": "c1", "agent_id": b, "content": "追问一下，你们的效果提升是怎么统计的，有没有排除其他因素的干扰？", "stance": "question", "relation": "追问", "likes": 12, "hours_ago": 40},
            {"id": "c3", "parent_id": "c2", "agent_id": a, "content": "回楼上，我们是按自然流量分段统计的，异常流量单独剔除掉了。", "stance": "neutral", "relation": "补充", "likes": 8, "hours_ago": 30},
            {"id": "c4", "parent_id": None, "agent_id": c, "content": "我有个反例：我们照做之后延迟反而更高，因为边界情况根本没处理好。", "stance": "opposing", "relation": "反驳", "likes": 25, "hours_ago": 45},
            {"id": "c5", "parent_id": "c4", "agent_id": d, "content": "这是典型的坑，加一层兜底策略或者降级方案都能缓解这个问题。", "stance": "neutral", "relation": "补充", "likes": 18, "hours_ago": 35},
            {"id": "c6", "parent_id": "c4", "agent_id": a, "content": "被说服了，之前我只看好的一面确实片面，边界情况要单独加监控。", "stance": "neutral", "relation": "总结", "likes": 6, "hours_ago": 20},
            {"id": "c7", "parent_id": None, "agent_id": d, "content": "省流：没有银弹，想清楚再上车。顺便说一句我家猫就叫向量。", "stance": "sharing", "relation": "歪楼", "likes": 66, "hours_ago": 10},
        ]
    }


def make_handler(requests_log, post_count=10):
    """Dispatch: the history-drafting prompt gets posts, tree prompts get trees."""
    def handler(request):
        body = json.loads(request.content)
        requests_log.append(body)
        user = body["messages"][1]["content"]
        roster = re.findall(r"agent_id=([0-9a-f-]+)", user)
        if "历史帖子" in user:
            payload = _posts_payload(roster, post_count)
        else:
            payload = _tree_payload(roster)
        return httpx.Response(200, json={"content": json.dumps(payload, ensure_ascii=False)})

    return handler


def patch_llm(monkeypatch, handler):
    """Route httpx transport through a MockTransport handler."""
    transport = httpx.MockTransport(handler)
    monkeypatch.setattr(
        httpx, "AsyncClient",
        lambda **kwargs: REAL_ASYNC_CLIENT(transport=transport, timeout=60.0),
    )


def _make_world(tmp_path):
    db_path = tmp_path / "test.db"
    init_db(db_path)
    world_id = create_world(db_path, "s1", "t1", TOPIC, CONCEPT_IDS[0])
    return db_path, world_id


def _rows(db_path, sql, args=()):
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    try:
        return conn.execute(sql, args).fetchall()
    finally:
        conn.close()


def _run(db_path, world_id, **kwargs):
    return asyncio.run(
        initialize_world(db_path, world_id, TOPIC, CONCEPT_IDS, rng=random.Random(7), **kwargs)
    )


def _initialized(tmp_path, monkeypatch, post_count=10):
    db_path, world_id = _make_world(tmp_path)
    requests_log = []
    patch_llm(monkeypatch, make_handler(requests_log, post_count))
    result = _run(db_path, world_id, posts_count=post_count)
    return db_path, world_id, result, requests_log


# --- needs_initialization ---------------------------------------------------

def test_needs_initialization_lifecycle(tmp_path):
    db_path, world_id = _make_world(tmp_path)
    assert needs_initialization(db_path, world_id)
    assert needs_initialization(db_path, "no-such-world")


def test_needs_initialization_on_bare_database(tmp_path):
    assert needs_initialization(tmp_path / "bare.db", "world-bare")


# --- happy path -------------------------------------------------------------

def test_initialize_creates_expected_counts(tmp_path, monkeypatch):
    db_path, world_id, result, requests_log = _initialized(tmp_path, monkeypatch)

    assert result == InitResult(world_id=world_id, agents_created=28, posts_created=10, comments_created=70)
    assert len(requests_log) == 11  # 1 history-drafting call + 10 comment trees

    agents = _rows(db_path, "SELECT * FROM agents WHERE world_id = ?", (world_id,))
    posts = _rows(db_path, "SELECT * FROM posts WHERE world_id = ?", (world_id,))
    comments = _rows(
        db_path,
        "SELECT c.* FROM comments c JOIN posts p ON c.post_id = p.post_id WHERE p.world_id = ?",
        (world_id,),
    )
    assert len(agents) == 28
    assert len(posts) == 10
    assert len(comments) == 70
    assert needs_initialization(db_path, world_id) is False


def test_posts_have_roster_authors_valid_concepts_and_diverse_stances(tmp_path, monkeypatch):
    db_path, world_id, _, _ = _initialized(tmp_path, monkeypatch)
    roster_ids = {r["agent_id"] for r in _rows(db_path, "SELECT agent_id FROM agents WHERE world_id = ?", (world_id,))}
    posts = _rows(db_path, "SELECT * FROM posts WHERE world_id = ?", (world_id,))
    assert {p["agent_id"] for p in posts} <= roster_ids
    assert {p["concept_id"] for p in posts} <= set(CONCEPT_IDS)
    assert len({p["stance"] for p in posts}) >= 3
    assert all(p["user_id"] is None for p in posts)


def test_comments_backdated_within_window_and_spread(tmp_path, monkeypatch):
    db_path, world_id, _, _ = _initialized(tmp_path, monkeypatch)
    now = datetime.now(timezone.utc)
    comments = _rows(
        db_path,
        "SELECT c.* FROM comments c JOIN posts p ON c.post_id = p.post_id WHERE p.world_id = ?",
        (world_id,),
    )
    times = [datetime.fromisoformat(c["created_at"]) for c in comments]
    oldest, newest = min(times), max(times)
    assert newest <= now + timedelta(seconds=5)
    assert oldest >= now - timedelta(hours=73)          # 过去 2–3 天回填窗口
    assert newest - oldest >= timedelta(hours=12)       # 时间有散布，不是同一秒

    posts = _rows(db_path, "SELECT * FROM posts WHERE world_id = ?", (world_id,))
    for post in posts:
        post_time = datetime.fromisoformat(post["created_at"])
        assert post_time >= now - timedelta(hours=97)
        child_times = [
            datetime.fromisoformat(c["created_at"])
            for c in comments if c["post_id"] == post["post_id"]
        ]
        assert all(post_time < t for t in child_times)  # 帖子比自己的评论都早

        # Replies are newer than their parents.
        by_id = {c["comment_id"]: c for c in comments}
        for c in comments:
            if c["parent_comment_id"]:
                parent = by_id[c["parent_comment_id"]]
                assert datetime.fromisoformat(c["created_at"]) > datetime.fromisoformat(parent["created_at"])


def test_thread_structure_depth_links_and_batch_ids(tmp_path, monkeypatch):
    db_path, world_id, _, _ = _initialized(tmp_path, monkeypatch)
    comments = _rows(
        db_path,
        "SELECT c.* FROM comments c JOIN posts p ON c.post_id = p.post_id WHERE p.world_id = ?",
        (world_id,),
    )
    by_id = {c["comment_id"]: c for c in comments}
    batch_ids = set()
    for c in comments:
        depth = len(c["thread_path"].split("/"))
        assert 1 <= depth <= world_init.MAX_DEPTH
        assert c["batch_id"]
        batch_ids.add(c["batch_id"])
        if depth > 1:
            parent = by_id[c["parent_comment_id"]]
            assert parent["post_id"] == c["post_id"]
            assert c["thread_path"].startswith(parent["thread_path"] + "/")
        else:
            assert c["parent_comment_id"] is None
    assert len(batch_ids) == 10  # one batch per post


def test_comment_count_matches_actual_rows(tmp_path, monkeypatch):
    db_path, world_id, _, _ = _initialized(tmp_path, monkeypatch)
    posts = _rows(db_path, "SELECT post_id, comment_count FROM posts WHERE world_id = ?", (world_id,))
    for post in posts:
        actual = _rows(db_path, "SELECT COUNT(*) AS n FROM comments WHERE post_id = ?", (post["post_id"],))[0]["n"]
        assert post["comment_count"] == actual == 7


def test_head_posts_marked_hot_and_statuses_assigned(tmp_path, monkeypatch):
    db_path, world_id, _, _ = _initialized(tmp_path, monkeypatch)
    posts = _rows(db_path, "SELECT * FROM posts WHERE world_id = ?", (world_id,))
    hot = [p for p in posts if p["is_hot"]]
    active = [p for p in posts if p["post_status"] == "active"]
    historical = [p for p in posts if p["post_status"] == "historical"]
    assert len(hot) == 3                      # top 30% of 10 posts
    assert len(active) == world_init.ACTIVE_TAIL
    assert len(historical) == 8
    assert all(p["post_status"] in {"active", "historical"} for p in posts)
    # Hot posts are the engagement leaders.
    ranked = sorted(posts, key=lambda p: (p["comment_count"], p["heat"]), reverse=True)
    assert {p["post_id"] for p in hot} == {p["post_id"] for p in ranked[:3]}


def test_agent_counters_and_karma_updated(tmp_path, monkeypatch):
    db_path, world_id, result, _ = _initialized(tmp_path, monkeypatch)
    agents = _rows(db_path, "SELECT * FROM agents WHERE world_id = ?", (world_id,))
    assert sum(a["post_count"] for a in agents) == result.posts_created
    assert sum(a["comment_count"] for a in agents) == result.comments_created
    for a in agents:
        posts = _rows(db_path, "SELECT COUNT(*) AS n FROM posts WHERE agent_id = ?", (a["agent_id"],))[0]["n"]
        comments = _rows(db_path, "SELECT COUNT(*) AS n FROM comments WHERE agent_id = ?", (a["agent_id"],))[0]["n"]
        assert a["post_count"] == posts
        assert a["comment_count"] == comments
    assert max(a["karma"] for a in agents) > 80  # initial karma tops out at 80


def test_reactions_sprinkled_with_distinct_voters(tmp_path, monkeypatch):
    db_path, world_id, _, _ = _initialized(tmp_path, monkeypatch)
    reactions = _rows(
        db_path,
        """
        SELECT r.* FROM reactions r
        JOIN agents a ON r.agent_id = a.agent_id
        WHERE a.world_id = ?
        """,
        (world_id,),
    )
    assert reactions
    assert all(r["reaction_type"] == "like" for r in reactions)
    posts = _rows(db_path, "SELECT post_id, agent_id FROM posts WHERE world_id = ?", (world_id,))
    comments = _rows(db_path, "SELECT comment_id, post_id, agent_id FROM comments", ())
    authors = {p["post_id"]: p["agent_id"] for p in posts}
    authors.update({c["comment_id"]: c["agent_id"] for c in comments})
    valid_targets = set(authors)
    pairs = set()
    for r in reactions:
        assert r["target_id"] in valid_targets
        assert r["agent_id"] != authors[r["target_id"]]      # 作者不给自己点赞
        pair = (r["target_id"], r["agent_id"])
        assert pair not in pairs                             # 每个 agent 每目标一票
        pairs.add(pair)
    # Every post got at least one like; reaction timestamps are sane.
    liked_posts = {r["target_id"] for r in reactions if r["target_type"] == "post"}
    assert liked_posts == {p["post_id"] for p in posts}
    now = datetime.now(timezone.utc)
    assert all(datetime.fromisoformat(r["created_at"]) <= now + timedelta(seconds=5) for r in reactions)


def test_world_timestamp_and_init_event_recorded(tmp_path, monkeypatch):
    db_path, world_id, _, _ = _initialized(tmp_path, monkeypatch)
    events = _rows(db_path, "SELECT * FROM events WHERE world_id = ? AND action = 'world_initialized'", (world_id,))
    assert len(events) == 1
    payload = json.loads(events[0]["payload_json"])
    assert payload == {"agents": 28, "posts": 10, "comments": 70}


# --- idempotency --------------------------------------------------------------

def test_initialize_is_idempotent_and_makes_no_extra_llm_calls(tmp_path, monkeypatch):
    db_path, world_id, first, requests_log = _initialized(tmp_path, monkeypatch)
    assert needs_initialization(db_path, world_id) is False

    def boom(request):  # any HTTP attempt on the second run fails the test
        raise AssertionError("second initialize_world call must not hit the LLM")

    patch_llm(monkeypatch, boom)
    second = _run(db_path, world_id)
    assert second == first

    assert _rows(db_path, "SELECT COUNT(*) AS n FROM posts WHERE world_id = ?", (world_id,))[0]["n"] == 10
    assert _rows(db_path, "SELECT COUNT(*) AS n FROM comments", ())[0]["n"] == 70
    assert _rows(db_path, "SELECT COUNT(*) AS n FROM agents WHERE world_id = ?", (world_id,))[0]["n"] == 28
    assert len(requests_log) == 11


# --- robustness ---------------------------------------------------------------

def test_comment_tree_failure_keeps_posts_without_comments(tmp_path, monkeypatch):
    db_path, world_id = _make_world(tmp_path)
    requests_log = []

    def handler(request):
        body = json.loads(request.content)
        requests_log.append(body)
        user = body["messages"][1]["content"]
        if "历史帖子" in user:
            roster = re.findall(r"agent_id=([0-9a-f-]+)", user)
            payload = json.dumps(_posts_payload(roster), ensure_ascii=False)
            return httpx.Response(200, json={"content": payload})
        return httpx.Response(200, json={"content": "模型跑飞了，没有 JSON"})

    patch_llm(monkeypatch, handler)
    result = _run(db_path, world_id)
    assert result.posts_created == 10
    assert result.comments_created == 0
    assert needs_initialization(db_path, world_id) is False
    posts = _rows(db_path, "SELECT comment_count FROM posts WHERE world_id = ?", (world_id,))
    assert all(p["comment_count"] == 0 for p in posts)


# --- parse_posts unit tests -----------------------------------------------------

def _personas(count=8):
    return generate_personas(TOPIC, count=count, rng=random.Random(1))


def test_parse_posts_normalizes_and_drops_invalid_entries():
    personas = _personas()
    ids = [p.agent_id for p in personas]
    payload = {"posts": [
        {"id": "ok", "agent_id": ids[0], "concept_id": CONCEPT_IDS[0], "content": "这是一个完全正常的帖子，聊聊自己的学习经历。", "stance": "supportive", "likes": 42, "hours_ago": 50},
        {"id": "bad-agent", "agent_id": "ghost", "concept_id": CONCEPT_IDS[0], "content": "作者不在花名册里，整条丢掉。", "stance": "neutral", "likes": 1, "hours_ago": 30},
        {"id": "bad-concept", "agent_id": ids[1], "concept_id": "c-nope", "content": "概念不在列表里，整条丢掉。", "stance": "neutral", "likes": 1, "hours_ago": 30},
        {"id": "empty", "agent_id": ids[1], "concept_id": CONCEPT_IDS[1], "content": "   ", "stance": "neutral", "likes": 1, "hours_ago": 30},
        {"id": "weird", "agent_id": ids[2], "concept_id": CONCEPT_IDS[2], "content": "立场不合法要回落，点赞和时间要截断到范围内。", "stance": "hype", "likes": 9999, "hours_ago": 999},
    ]}
    drafts = parse_posts(json.dumps(payload, ensure_ascii=False), personas, CONCEPT_IDS)
    assert [d.agent_id for d in drafts] == [ids[0], ids[2]]
    weird = drafts[1]
    assert weird.stance == "neutral"
    assert weird.likes == world_init.MAX_POST_LIKES
    assert weird.hours_ago == world_init.POST_MAX_HOURS_AGO


def test_parse_posts_tolerates_fences_and_raises_on_garbage():
    personas = _personas()
    ids = [p.agent_id for p in personas]
    payload = {"posts": [
        {"id": "p1", "agent_id": ids[0], "concept_id": CONCEPT_IDS[0], "content": " fence 包裹也能解析出来的正常帖子内容。", "stance": "neutral", "likes": 5, "hours_ago": 40},
    ]}
    raw = "生成结果如下：\n```json\n" + json.dumps(payload, ensure_ascii=False) + "\n```"
    drafts = parse_posts(raw, personas, CONCEPT_IDS)
    assert len(drafts) == 1

    with pytest.raises(ContentGenerationError):
        parse_posts("这不是 JSON", personas, CONCEPT_IDS)
    with pytest.raises(ContentGenerationError):
        parse_posts(json.dumps({"posts": [{"agent_id": "ghost", "concept_id": "x", "content": "全部无效"}]}), personas, CONCEPT_IDS)
