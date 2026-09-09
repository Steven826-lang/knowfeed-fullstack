"""Tests for tick_engine. All HTTP is mocked; no real LLM calls."""

import asyncio
import json
import random
import re
import sqlite3
import uuid
from datetime import datetime, timedelta, timezone

import httpx
import pytest

import agent_manager
import tick_engine
from db import create_world, init_db, now_iso
from tick_engine import (
    catchup_mode,
    run_catchup,
    run_mini_tick,
    run_tick,
)

TOPIC = "大模型入门"
CONCEPTS = ["c-attention", "c-pretrain"]

REAL_ASYNC_CLIENT = httpx.AsyncClient


# --- fixtures ---------------------------------------------------------------

def _make_world(tmp_path):
    db_path = tmp_path / "test.db"
    init_db(db_path)
    world_id = create_world(db_path, "s1", "t1", TOPIC, CONCEPTS[0])
    roster = agent_manager.build_world_roster(db_path, world_id, TOPIC, CONCEPTS, rng=random.Random(7))
    return db_path, world_id, roster


def _seed_post(db_path, world_id, *, agent_id=None, user_id=None, content, stance,
               concept_id=CONCEPTS[0], created_at=None, comment_count=0, heat=0, is_hot=0):
    post_id = str(uuid.uuid4())
    conn = sqlite3.connect(db_path)
    try:
        conn.execute(
            """
            INSERT INTO posts (post_id, world_id, concept_id, agent_id, user_id, shadow_entry_id,
                               content, stance, post_status, is_hot, comment_count, heat, created_at)
            VALUES (?, ?, ?, ?, ?, NULL, ?, ?, 'active', ?, ?, ?, ?)
            """,
            (post_id, world_id, concept_id, agent_id, user_id, content, stance,
             is_hot, comment_count, heat, created_at or now_iso()),
        )
        conn.commit()
    finally:
        conn.close()
    return post_id


def _seed_comment(db_path, post_id, *, agent_id=None, user_id=None, content, stance="neutral",
                  relation="补充", parent_comment_id=None, thread_path="1", created_at=None):
    comment_id = str(uuid.uuid4())
    conn = sqlite3.connect(db_path)
    try:
        conn.execute(
            """
            INSERT INTO comments (comment_id, post_id, parent_comment_id, agent_id, user_id,
                                  content, stance, relation, thread_path, batch_id, heat, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, 0, ?)
            """,
            (comment_id, post_id, parent_comment_id, agent_id, user_id, content, stance,
             relation, thread_path, created_at or now_iso()),
        )
        conn.commit()
    finally:
        conn.close()
    return comment_id


def _seed_event(db_path, world_id, *, created_at, tick_round=1):
    conn = sqlite3.connect(db_path)
    try:
        conn.execute(
            "INSERT INTO events (world_id, round, phase, agent_id, action, payload_json, created_at) VALUES (?, ?, 'tick', NULL, 'tick_done', '{}', ?)",
            (world_id, tick_round, created_at),
        )
        conn.commit()
    finally:
        conn.close()


def _set_belief(db_path, agent_id, *, positions, confidence, trust):
    payload = {
        "positions": positions,
        "confidence": confidence,
        "trust": trust,
        "exposure_history": [],
        "recent_reflection": "",
    }
    conn = sqlite3.connect(db_path)
    try:
        conn.execute(
            "UPDATE agents SET belief_json = ? WHERE agent_id = ?",
            (json.dumps(payload, ensure_ascii=False), agent_id),
        )
        conn.commit()
    finally:
        conn.close()


def _get_belief(db_path, agent_id):
    conn = sqlite3.connect(db_path)
    try:
        row = conn.execute("SELECT belief_json FROM agents WHERE agent_id = ?", (agent_id,)).fetchone()
        return json.loads(row[0])
    finally:
        conn.close()


def _query(db_path, sql, params=()):
    conn = sqlite3.connect(db_path)
    try:
        return conn.execute(sql, params).fetchall()
    finally:
        conn.close()


def patch_llm(monkeypatch, handler):
    """Route tick_engine's httpx transport through a MockTransport handler."""
    transport = httpx.MockTransport(handler)
    monkeypatch.setattr(
        httpx, "AsyncClient",
        lambda **kwargs: REAL_ASYNC_CLIENT(transport=transport, timeout=60.0),
    )


def fake_picks(monkeypatch, agents):
    """Force pick_active_agents to return a fixed agent subset."""
    monkeypatch.setattr(
        agent_manager, "pick_active_agents",
        lambda db_path, world_id, n, rng=None: list(agents),
    )


def disable_op(monkeypatch):
    monkeypatch.setattr(tick_engine, "OP_REPLY_PROB", 0.0)
    monkeypatch.setattr(tick_engine, "OP_QUESTION_REPLY_PROB", 0.0)
    monkeypatch.setattr(tick_engine, "OP_SUMMARY_PROB", 0.0)


def force_op(monkeypatch):
    monkeypatch.setattr(tick_engine, "OP_REPLY_PROB", 1.0)
    monkeypatch.setattr(tick_engine, "OP_QUESTION_REPLY_PROB", 1.0)
    monkeypatch.setattr(tick_engine, "OP_SUMMARY_PROB", 1.0)


def handle_of(system_prompt):
    return re.search(r"你是 @(\w+)", system_prompt).group(1)


def json_response(payload):
    return httpx.Response(200, json={"content": json.dumps(payload, ensure_ascii=False)})


# --- catchup_mode buckets ---------------------------------------------------

def test_catchup_mode_buckets():
    now = datetime(2026, 7, 16, 12, 0, tzinfo=timezone.utc)

    def iso(dt):
        return dt.isoformat()

    assert catchup_mode(iso(now - timedelta(minutes=2)), now) == "none"
    assert catchup_mode(iso(now - timedelta(minutes=10)), now) == "normal"
    assert catchup_mode(iso(now - timedelta(minutes=29)), now) == "normal"
    assert catchup_mode(iso(now - timedelta(minutes=30)), now) == "condensed"
    assert catchup_mode(iso(now - timedelta(hours=23)), now) == "condensed"
    assert catchup_mode(iso(now - timedelta(days=2)), now) == "deep"
    assert catchup_mode("not-a-date", now) == "normal"
    # now may also be passed as an ISO string
    assert catchup_mode(iso(now - timedelta(hours=2)), now.isoformat()) == "condensed"


# --- regular tick: action execution ------------------------------------------

def test_run_tick_executes_decided_actions(tmp_path, monkeypatch):
    db_path, world_id, roster = _make_world(tmp_path)
    p1 = _seed_post(db_path, world_id, agent_id=roster[10]["agent_id"], stance="supportive",
                    content="我觉得注意力机制最关键的就是学会取舍，什么该看什么该忽略。")
    p2 = _seed_post(db_path, world_id, agent_id=roster[11]["agent_id"], stance="opposing",
                    content="别急着吹注意力，小数据集上它经常打不过简单的卷积结构。")
    active = roster[:6]
    fake_picks(monkeypatch, active)
    disable_op(monkeypatch)

    plan = {
        roster[0]["handle"]: {"action": "create_post", "stance": "question",
                              "content": "问个基础问题：多头注意力里的头数是不是越多越好？我试到头数翻倍效果反而变差了。"},
        roster[1]["handle"]: {"action": "create_comment", "post_id": p1, "stance": "supportive",
                              "relation": "补充", "content": "补充一个细节：取舍之外，残差连接才是让深层注意力训得动的关键。"},
        roster[2]["handle"]: {"action": "create_comment", "post_id": p2, "stance": "neutral",
                              "relation": "追问", "content": "追问一下，你说的小数据是大概什么量级，有没有具体的对比实验数据？"},
        roster[3]["handle"]: {"action": "like", "target_type": "post", "target_id": p1},
        roster[4]["handle"]: {"action": "do_nothing"},
        roster[5]["handle"]: {"action": "do_nothing"},
    }
    requests = []

    def handler(request):
        body = json.loads(request.content)
        requests.append(body)
        handle = handle_of(body["messages"][0]["content"])
        return json_response(plan[handle])

    patch_llm(monkeypatch, handler)

    result = asyncio.run(run_tick(db_path, world_id, rng=random.Random(5), force_counter_exposure=False))

    assert result.tick_num == 1
    assert result.posts_created == 1
    assert result.comments_created == 2
    assert result.reactions_added == 1
    assert len(result.actions) == 6
    kinds = [a["action"] for a in result.actions]
    assert kinds.count("do_nothing") == 2
    assert kinds.count("create_post") == 1
    assert kinds.count("create_comment") == 2
    assert kinds.count("like") == 1
    assert all(a["ok"] for a in result.actions)

    assert len(requests) == 6  # one decision call per active agent

    assert _query(db_path, "SELECT COUNT(*) FROM posts WHERE world_id = ?", (world_id,))[0][0] == 3
    comments = _query(db_path, "SELECT post_id, agent_id, batch_id, thread_path FROM comments")
    assert len(comments) == 2
    assert {c[0] for c in comments} == {p1, p2}
    assert all(c[2] == "tick-1" for c in comments)
    assert _query(db_path, "SELECT COUNT(*) FROM reactions WHERE target_id = ?", (p1,))[0][0] == 1
    # comment counters were maintained
    assert _query(db_path, "SELECT comment_count FROM posts WHERE post_id = ?", (p1,))[0][0] == 1
    # events for this tick were logged
    actions_logged = {r[0] for r in _query(db_path, "SELECT action FROM events WHERE world_id = ? AND round = 1", (world_id,))}
    assert {"create_post", "create_comment", "like", "tick_done"} <= actions_logged
    # the new agent post is marked active
    assert _query(db_path, "SELECT post_status FROM posts WHERE agent_id = ?", (roster[0]["agent_id"],))[0][0] == "active"


def test_run_tick_rejects_slop_content(tmp_path, monkeypatch):
    db_path, world_id, roster = _make_world(tmp_path)
    fake_picks(monkeypatch, roster[:1])
    disable_op(monkeypatch)

    def handler(request):
        return json_response({"action": "create_post", "content": "顶", "stance": "supportive"})

    patch_llm(monkeypatch, handler)

    result = asyncio.run(run_tick(db_path, world_id, rng=random.Random(1), force_counter_exposure=False))
    assert result.posts_created == 0
    assert result.actions[0]["ok"] is False
    assert _query(db_path, "SELECT COUNT(*) FROM posts WHERE world_id = ?", (world_id,))[0][0] == 0
    assert _query(db_path, "SELECT COUNT(*) FROM events WHERE action = 'create_post_rejected'")[0][0] == 1


def test_run_tick_uses_agent_manager_activity_picks(tmp_path, monkeypatch):
    """Without monkeypatching, 3-6 agents are picked via agent_manager."""
    db_path, world_id, roster = _make_world(tmp_path)
    requests = []

    def handler(request):
        requests.append(json.loads(request.content))
        return json_response({"action": "do_nothing"})

    patch_llm(monkeypatch, handler)

    result = asyncio.run(run_tick(db_path, world_id, rng=random.Random(12), force_counter_exposure=False))
    assert 3 <= len(result.actions) <= 6
    assert len(requests) == len(result.actions)
    assert all(a["action"] == "do_nothing" for a in result.actions)
    assert result.posts_created == 0 and result.comments_created == 0


# --- OP engagement -----------------------------------------------------------

def test_op_engagement_replies_to_user_comment(tmp_path, monkeypatch):
    db_path, world_id, roster = _make_world(tmp_path)
    op = roster[0]
    p = _seed_post(db_path, world_id, agent_id=op["agent_id"], stance="supportive",
                   content="预训练本质上就是拿海量文本让模型学会语言的统计规律。")
    _seed_post(db_path, world_id, agent_id=roster[2]["agent_id"], stance="opposing",
               content="我持保留意见，统计规律这个说法太容易让人低估涌现能力了。")
    user_c = _seed_comment(db_path, p, user_id="local-user", stance="question", relation="追问",
                           content="用户提问：那预训练和微调之间的边界到底该怎么划分？")
    fake_picks(monkeypatch, roster[3:4])  # one idling agent, OP is not active
    force_op(monkeypatch)

    def handler(request):
        body = json.loads(request.content)
        user_msg = body["messages"][1]["content"]
        if "你的帖子收到了新评论" in user_msg:
            return json_response({"content": "楼主回应：边界其实不在方法而在目标，微调是让它学会你要的具体任务。",
                                  "stance": "neutral", "relation": "补充"})
        return json_response({"action": "do_nothing"})

    patch_llm(monkeypatch, handler)

    result = asyncio.run(run_tick(db_path, world_id, rng=random.Random(3), force_counter_exposure=False))

    op_rows = _query(
        db_path,
        "SELECT parent_comment_id, relation FROM comments WHERE post_id = ? AND agent_id = ?",
        (p, op["agent_id"]),
    )
    assert len(op_rows) == 1
    assert op_rows[0][0] == user_c  # reply is threaded under the user comment
    assert any(a["action"] == "op_reply" for a in result.actions)
    assert result.comments_created == 1


def test_op_engagement_milestone_summary(tmp_path, monkeypatch):
    db_path, world_id, roster = _make_world(tmp_path)
    op = roster[0]
    commenter = roster[1]
    p = _seed_post(db_path, world_id, agent_id=op["agent_id"], stance="supportive",
                   comment_count=4,
                   content="注意力头数这事我倾向于够用就好，堆太多反而稀释了表达能力。")
    _seed_post(db_path, world_id, agent_id=roster[2]["agent_id"], stance="opposing",
               content="反对，头数不够的时候长距离依赖根本学不出来，亲测。")
    fake_picks(monkeypatch, [commenter])
    force_op(monkeypatch)

    def handler(request):
        body = json.loads(request.content)
        system = body["messages"][0]["content"]
        user_msg = body["messages"][1]["content"]
        if "总结陈词" in user_msg:
            return json_response({"content": "楼主总结：看下来大家分歧主要在任务规模上，小任务少头确实够了。",
                                  "stance": "neutral", "relation": "总结"})
        if "你的帖子收到了新评论" in user_msg:
            return json_response({"content": "楼主回应：你这个反例挺好的，回头我也在小模型上验证一下头数的影响。",
                                  "stance": "neutral", "relation": "补充"})
        assert handle_of(system) == commenter["handle"]
        return json_response({"action": "create_comment", "post_id": p, "stance": "neutral",
                              "relation": "补充", "content": "插一句，头数选择还跟序列长度强相关，长文本建议先保头数。"})

    patch_llm(monkeypatch, handler)

    result = asyncio.run(run_tick(db_path, world_id, rng=random.Random(4), force_counter_exposure=False))

    # 4 -> 5 comments crossed the milestone: OP posted a summary plus a reply.
    summaries = _query(
        db_path,
        "SELECT relation, parent_comment_id FROM comments WHERE post_id = ? AND agent_id = ? AND relation = '总结'",
        (p, op["agent_id"]),
    )
    assert len(summaries) == 1
    assert summaries[0][1] is None  # milestone summary is top-level
    assert any(a["action"] == "op_summary" for a in result.actions)
    assert _query(db_path, "SELECT comment_count FROM posts WHERE post_id = ?", (p,))[0][0] == 7


# --- forced counter exposure -------------------------------------------------

def test_forced_counter_exposure(tmp_path, monkeypatch):
    db_path, world_id, roster = _make_world(tmp_path)
    a = roster[0]
    p_opp = _seed_post(db_path, world_id, agent_id=roster[1]["agent_id"], stance="opposing",
                       content="反对盲目上大模型，绝大多数业务场景一个小模型加规则就够了。")
    _seed_post(db_path, world_id, agent_id=roster[2]["agent_id"], stance="supportive",
               content="支持大模型路线，参数量上去之后很多任务直接零样本解决了。")
    _set_belief(db_path, a["agent_id"], positions={CONCEPTS[0]: 0.8},
                confidence={CONCEPTS[0]: 0.6}, trust={})
    fake_picks(monkeypatch, [a])
    disable_op(monkeypatch)

    def handler(request):
        body = json.loads(request.content)
        user_msg = body["messages"][1]["content"]
        if "立场相反" in user_msg:
            return json_response({"content": "我不完全同意你的结论，不过你说的小模型加规则在客服场景确实够用了。",
                                  "stance": "neutral", "relation": "反驳"})
        return json_response({"action": "do_nothing"})

    patch_llm(monkeypatch, handler)

    result = asyncio.run(run_tick(db_path, world_id, rng=random.Random(6)))

    counter = [x for x in result.actions if x["action"] == "counter_exposure"]
    assert len(counter) == 1
    assert counter[0]["post_id"] == p_opp
    row = _query(db_path, "SELECT relation FROM comments WHERE post_id = ? AND agent_id = ?",
                 (p_opp, a["agent_id"]))
    assert len(row) == 1
    # the opposing post was recorded as seen and nudged the agent's position
    belief = _get_belief(db_path, a["agent_id"])
    assert p_opp in belief["exposure_history"]
    assert belief["positions"][CONCEPTS[0]] < 0.8


def test_counter_exposure_can_be_disabled(tmp_path, monkeypatch):
    db_path, world_id, roster = _make_world(tmp_path)
    a = roster[0]
    _seed_post(db_path, world_id, agent_id=roster[1]["agent_id"], stance="opposing",
               content="反对声音：微调在数据少的时候根本不稳定，别轻易上。")
    _seed_post(db_path, world_id, agent_id=roster[2]["agent_id"], stance="supportive",
               content="支持派：LoRA 之后微调成本低到可以随便玩了。")
    _set_belief(db_path, a["agent_id"], positions={CONCEPTS[0]: 0.8},
                confidence={CONCEPTS[0]: 0.6}, trust={})
    fake_picks(monkeypatch, [a])
    disable_op(monkeypatch)
    requests = []

    def handler(request):
        requests.append(request)
        return json_response({"action": "do_nothing"})

    patch_llm(monkeypatch, handler)

    result = asyncio.run(run_tick(db_path, world_id, rng=random.Random(6), force_counter_exposure=False))
    assert not [x for x in result.actions if x["action"] == "counter_exposure"]
    assert len(requests) == 1  # only the decision call happened
    assert _query(db_path, "SELECT COUNT(*) FROM comments")[0][0] == 0


# --- belief round-trip -------------------------------------------------------

def test_run_tick_updates_beliefs_and_persists(tmp_path, monkeypatch):
    db_path, world_id, roster = _make_world(tmp_path)
    a, b = roster[0], roster[1]
    p = _seed_post(db_path, world_id, agent_id=b["agent_id"], stance="supportive", heat=25,
                   content="微调这件事我的经验是先看数据质量再谈方法，垃圾数据怎么调都没用。")
    _seed_post(db_path, world_id, agent_id=roster[2]["agent_id"], stance="opposing",
               content="不同意，方法选对了小数据也能出效果，不能全怪数据。")
    _set_belief(db_path, b["agent_id"], positions={CONCEPTS[0]: 0.5},
                confidence={CONCEPTS[0]: 0.5}, trust={})
    fake_picks(monkeypatch, [a])
    disable_op(monkeypatch)

    def handler(request):
        return json_response({"action": "like", "target_type": "post", "target_id": p})

    patch_llm(monkeypatch, handler)

    result = asyncio.run(run_tick(db_path, world_id, rng=random.Random(8), force_counter_exposure=False))
    assert result.reactions_added == 1

    belief_a = _get_belief(db_path, a["agent_id"])
    # liking B's post raised A's trust toward B (0.5 + 0.05)
    assert belief_a["trust"][b["agent_id"]] == pytest.approx(0.55)
    # the timeline post was recorded in A's exposure history
    assert p in belief_a["exposure_history"]
    # B's confidence grew from the received like (0.5 + 0.02)
    belief_b = _get_belief(db_path, b["agent_id"])
    assert belief_b["confidence"][CONCEPTS[0]] == pytest.approx(0.52)
    # participants were stamped active
    last_active = _query(db_path, "SELECT last_active_at FROM agents WHERE agent_id = ?", (a["agent_id"],))[0][0]
    assert datetime.now(timezone.utc) - datetime.fromisoformat(last_active) < timedelta(minutes=1)


def test_run_tick_logs_delta_events(tmp_path, monkeypatch):
    db_path, world_id, roster = _make_world(tmp_path)
    a, b = roster[0], roster[1]
    # A is slightly against the concept and fully trusts B; B's supportive post
    # has saturated social proof, so reading it flips A's position sign.
    _set_belief(db_path, a["agent_id"], positions={CONCEPTS[0]: -0.01},
                confidence={CONCEPTS[0]: 0.5}, trust={b["agent_id"]: 1.0})
    _seed_post(db_path, world_id, agent_id=b["agent_id"], stance="supportive", heat=25,
               content="其实预训练的价值被低估了，它给下游任务提供了真正的语义底座。")
    _seed_post(db_path, world_id, agent_id=roster[2]["agent_id"], stance="opposing",
               content="唱个反调，语义底座这个词太玄乎了，很多场景特征工程就够。")
    fake_picks(monkeypatch, [a])
    disable_op(monkeypatch)

    def handler(request):
        return json_response({"action": "do_nothing"})

    patch_llm(monkeypatch, handler)

    result = asyncio.run(run_tick(db_path, world_id, rng=random.Random(9), force_counter_exposure=False))

    assert len(result.deltas) == 1
    assert result.deltas[0]["agent_id"] == a["agent_id"]
    assert result.deltas[0]["concept_id"] == CONCEPTS[0]
    assert result.deltas[0]["old_position"] < 0 < result.deltas[0]["new_position"]
    rows = _query(db_path, "SELECT payload_json FROM events WHERE world_id = ? AND action = 'delta'", (world_id,))
    assert len(rows) == 1
    payload = json.loads(rows[0][0])
    assert payload["concept_id"] == CONCEPTS[0]


# --- tick lock ---------------------------------------------------------------

def test_duplicate_tick_returns_current_state(tmp_path, monkeypatch):
    db_path, world_id, roster = _make_world(tmp_path)
    requests = []

    def handler(request):
        requests.append(request)
        return json_response({"action": "do_nothing"})

    patch_llm(monkeypatch, handler)

    async def main():
        async with tick_engine.tick_lock(world_id):
            result = await run_tick(db_path, world_id, rng=random.Random(1))
            assert result.posts_created == 0
            assert result.comments_created == 0
            assert result.actions == []

    asyncio.run(main())
    assert requests == []  # no LLM call happened while the lock was held


def test_tick_lock_mutual_exclusion():
    order = []

    async def main():
        async def holder():
            async with tick_engine.tick_lock("lock-test-world"):
                order.append("a-in")
                await asyncio.sleep(0.05)
                order.append("a-out")

        async def waiter():
            await asyncio.sleep(0.01)
            async with tick_engine.tick_lock("lock-test-world"):
                order.append("b-in")

        await asyncio.gather(holder(), waiter())

    asyncio.run(main())
    assert order == ["a-in", "a-out", "b-in"]


# --- mini-tick ---------------------------------------------------------------

def test_mini_tick_guarantees_direct_reply(tmp_path, monkeypatch):
    db_path, world_id, roster = _make_world(tmp_path)
    user_post = _seed_post(db_path, world_id, user_id="local-user", stance="question",
                           content="用户：刚学完注意力机制还是有点迷糊，mask 到底是干嘛用的？")
    _seed_post(db_path, world_id, agent_id=roster[5]["agent_id"], stance="supportive",
               content="mask 就是防止作弊的， decoder 不能偷看未来的 token。")
    _seed_post(db_path, world_id, agent_id=roster[6]["agent_id"], stance="opposing",
               content="不同意楼上太简化了，mask 还有 padding 场景，别混为一谈。")
    fake_picks(monkeypatch, roster[:3])

    contents = [
        "萌新握爪，mask 的核心作用就是挡住未来信息，我当初也卡在这一步很久。",
        "补充一个视角：从矩阵运算看，mask 是把注意力分数置成负无穷再 softmax。",
        "追问一句，你说的迷糊是指训练时的因果 mask 还是推理时的 padding mask？",
    ]
    requests = []

    def handler(request):
        body = json.loads(request.content)
        requests.append(body)
        i = len(requests) - 1
        return json_response({"content": contents[i % 3], "stance": "neutral", "relation": "补充"})

    patch_llm(monkeypatch, handler)

    result = asyncio.run(run_mini_tick(db_path, world_id, user_post, rng=random.Random(3)))

    assert 2 <= len(result.replies) <= 3
    assert sum(1 for r in result.replies if r["reply_to_user"]) >= 1
    assert 2 <= result.reactions_added <= 3
    # single-comment generation only: no batch comment-tree prompt was used
    assert all("内容导演" not in r["messages"][0]["content"] for r in requests)
    assert len(requests) == len(result.replies)
    # replies landed in the DB with a shared mini batch id
    rows = _query(db_path, "SELECT batch_id, agent_id FROM comments WHERE post_id = ?", (user_post,))
    assert len(rows) == len(result.replies)
    assert len({r[0] for r in rows}) == 1
    assert rows[0][0].startswith("mini-")
    # likes were scattered
    assert _query(db_path, "SELECT COUNT(*) FROM reactions")[0][0] == result.reactions_added


def test_mini_tick_replies_to_user_comment(tmp_path, monkeypatch):
    db_path, world_id, roster = _make_world(tmp_path)
    p = _seed_post(db_path, world_id, agent_id=roster[5]["agent_id"], stance="supportive",
                   content="causal LM 就是只看左边预测下一个词， GPT 全家都是这个套路。")
    _seed_post(db_path, world_id, agent_id=roster[6]["agent_id"], stance="opposing",
               content="补充反面：BERT 那种 masked LM 才叫双向，别把所有 LM 都当 GPT。")
    user_c = _seed_comment(db_path, p, user_id="local-user", stance="question", relation="追问",
                           content="用户评论：那 prefix LM 和 causal LM 的区别到底在哪里？")
    fake_picks(monkeypatch, roster[:2])

    contents = [
        "好问题：前者是前半段可以双向看上下文，后者从头到尾只能顺着左边读。",
        "补充一句：做理解类任务时，带编码器的结构通常比纯生成结构更占便宜。",
    ]
    requests = []

    def handler(request):
        requests.append(json.loads(request.content))
        i = len(requests) - 1
        return json_response({"content": contents[i % 2], "stance": "neutral", "relation": "补充"})

    patch_llm(monkeypatch, handler)

    result = asyncio.run(run_mini_tick(db_path, world_id, p, user_comment_id=user_c, rng=random.Random(4)))

    direct = [r for r in result.replies if r["reply_to_user"]]
    assert len(direct) >= 1
    assert direct[0]["parent_comment_id"] == user_c
    # the direct reply is threaded under the user's comment
    row = _query(db_path, "SELECT parent_comment_id, thread_path FROM comments WHERE comment_id = ?",
                 (direct[0]["comment_id"],))
    assert row[0][0] == user_c
    assert row[0][1].startswith("1/")


def test_mini_tick_falls_back_until_direct_reply_lands(tmp_path, monkeypatch):
    db_path, world_id, roster = _make_world(tmp_path)
    user_post = _seed_post(db_path, world_id, user_id="local-user", stance="question",
                           content="用户：零基础学大模型，应该先看 transformer 还是直接上手调 API？")
    _seed_post(db_path, world_id, agent_id=roster[5]["agent_id"], stance="supportive",
               content="建议先调 API 找感觉，再回去啃原理，正反馈更快。")
    _seed_post(db_path, world_id, agent_id=roster[6]["agent_id"], stance="opposing",
               content="反对速成，不理解注意力机制，后面全是黑盒调参。")
    fake_picks(monkeypatch, roster[:2])

    # First (direct) reply is slop and must be rejected by the quality gate;
    # the engine must keep trying until some agent lands a direct reply.
    contents = [
        "顶",
        "个人觉得可以两条腿走路：白天调 API 做 demo，晚上补 transformer 原理。",
        "零基础直接看论文容易劝退，建议先跟着教程跑通一个最小 demo 再说。",
    ]
    requests = []

    def handler(request):
        requests.append(json.loads(request.content))
        i = len(requests) - 1
        return json_response({"content": contents[i % 3], "stance": "neutral", "relation": "补充"})

    patch_llm(monkeypatch, handler)

    result = asyncio.run(run_mini_tick(db_path, world_id, user_post, rng=random.Random(5)))

    direct = [r for r in result.replies if r["reply_to_user"]]
    assert len(direct) == 1
    assert direct[0]["content"] != "顶"
    assert len(requests) == 3  # rejected direct + ambient + fallback direct


# --- catch-up ----------------------------------------------------------------

def _condensed_handler(requests, comment_texts):
    """Handler that answers the condensed-tick prompt with evolving comments."""
    def handler(request):
        body = json.loads(request.content)
        requests.append(body)
        user_msg = body["messages"][1]["content"]
        agents = re.findall(r"agent_id=([0-9a-f-]+)", user_msg)
        posts = re.findall(r"post_id=([0-9a-f-]+)", user_msg)
        n = len(requests) - 1
        payload = {
            "comments": [
                {"post_id": posts[0], "agent_id": agents[0],
                 "content": comment_texts[(2 * n) % len(comment_texts)],
                 "stance": "neutral", "relation": "补充"},
                {"post_id": posts[0], "agent_id": agents[1 % len(agents)],
                 "content": comment_texts[(2 * n + 1) % len(comment_texts)],
                 "stance": "opposing", "relation": "反驳"},
            ],
            "likes": [{"post_id": posts[0], "agent_id": agents[1 % len(agents)], "reaction_type": "like"}],
        }
        return json_response(payload)
    return handler


DISTINCT_TEXTS = [
    "迟到的补充：这个问题我后来翻到一篇工程博客，核心结论是要先盯住命中率再谈优化。",
    "回头看这楼，反方提到的成本问题在小流量场景基本可以忽略，不必过度设计。",
    "补一个亲身经历：我们线上环境当初就是因为没做预热，冷启动直接把库打穿了。",
    "歪个楼，看到大家争论突然想起我去年踩过的坑，监控告警一定要先于优化上线。",
    "从理论角度补一句：局部性原理才是这一切的根基，时空局部性缺一不可。",
    "换个视角看，与其纠结方案，不如先把基线延迟测出来，数据自然会给出答案。",
]


def test_run_catchup_fresh_world_does_nothing(tmp_path, monkeypatch):
    db_path, world_id, roster = _make_world(tmp_path)
    requests = []
    patch_llm(monkeypatch, lambda request: requests.append(request) or json_response({}))

    result = asyncio.run(run_catchup(db_path, world_id, rng=random.Random(1)))
    assert result.ticks_run == 0
    assert result.briefing == {}
    assert requests == []


def test_run_catchup_normal_runs_single_tick(tmp_path, monkeypatch):
    db_path, world_id, roster = _make_world(tmp_path)
    fixed_now = datetime.now(timezone.utc)
    _seed_event(db_path, world_id, created_at=(fixed_now - timedelta(minutes=10)).isoformat())

    def handler(request):
        return json_response({"action": "do_nothing"})

    patch_llm(monkeypatch, handler)

    result = asyncio.run(run_catchup(db_path, world_id, now=fixed_now, rng=random.Random(2)))
    assert result.ticks_run == 1
    assert result.briefing == {}
    # the regular tick ran and logged its marker
    assert _query(db_path, "SELECT COUNT(*) FROM events WHERE world_id = ? AND round = 2 AND action = 'tick_done'",
                  (world_id,))[0][0] == 1


def test_run_catchup_condensed_single_call(tmp_path, monkeypatch):
    db_path, world_id, roster = _make_world(tmp_path)
    p1 = _seed_post(db_path, world_id, agent_id=roster[0]["agent_id"], stance="supportive",
                    comment_count=3,
                    content="缓存这事我是支持的，命中率上来之后数据库压力直接腰斩。")
    p2 = _seed_post(db_path, world_id, agent_id=roster[1]["agent_id"], stance="opposing",
                    comment_count=2,
                    content="反对乱用缓存，一致性搞不好就是线上事故的温床。")
    fixed_now = datetime.now(timezone.utc)
    last = fixed_now - timedelta(hours=2)
    _seed_event(db_path, world_id, created_at=last.isoformat())
    requests = []
    patch_llm(monkeypatch, _condensed_handler(requests, DISTINCT_TEXTS))

    result = asyncio.run(run_catchup(db_path, world_id, now=fixed_now, rng=random.Random(8)))

    assert result.ticks_run == 1
    assert result.briefing == {}
    assert len(requests) == 1  # one batched LLM call for the whole condensed tick
    assert "内容导演" in requests[0]["messages"][0]["content"]

    rows = _query(db_path, "SELECT post_id, created_at, batch_id FROM comments")
    assert len(rows) == 2
    for post_id, ts, batch_id in rows:
        dt = datetime.fromisoformat(ts)
        assert last <= dt <= fixed_now  # timestamps spread inside the idle gap
        assert batch_id.startswith("catchup-")
    assert {r[0] for r in rows} == {p1}  # handler targeted the hottest post
    assert _query(db_path, "SELECT comment_count FROM posts WHERE post_id = ?", (p1,))[0][0] == 5
    assert _query(db_path, "SELECT COUNT(*) FROM reactions WHERE target_id = ?", (p1,))[0][0] == 1
    phases = {r[0] for r in _query(db_path, "SELECT phase FROM events WHERE world_id = ? AND round = 2", (world_id,))}
    assert phases == {"catchup"}


def test_run_catchup_deep_runs_ticks_with_briefing(tmp_path, monkeypatch):
    db_path, world_id, roster = _make_world(tmp_path)
    p1 = _seed_post(db_path, world_id, agent_id=roster[0]["agent_id"], stance="supportive",
                    comment_count=6,
                    content="预训练加微调这条路我觉得已经收敛了，剩下的都是工程细节。")
    _seed_post(db_path, world_id, agent_id=roster[1]["agent_id"], stance="opposing",
               comment_count=1,
               content="不同意，RLHF 之后整个范式又洗牌了一次，谈不上收敛。")
    fixed_now = datetime.now(timezone.utc)
    last = fixed_now - timedelta(days=3)
    _seed_event(db_path, world_id, created_at=last.isoformat())
    requests = []
    patch_llm(monkeypatch, _condensed_handler(requests, DISTINCT_TEXTS))

    result = asyncio.run(run_catchup(db_path, world_id, now=fixed_now, rng=random.Random(9)))

    assert result.ticks_run == 3  # 3 idle days -> 3 condensed ticks
    assert len(requests) == 3
    briefing = result.briefing
    # p1 crossed the hot threshold (6 -> 8 comments) during catch-up
    assert briefing["new_hot_posts"] == 1
    assert _query(db_path, "SELECT is_hot FROM posts WHERE post_id = ?", (p1,))[0][0] == 1
    # p1 is on the world's current concept, so it counts as a relevant discussion
    assert briefing["relevant_discussions"] == 1
    assert isinstance(briefing["delta_moments"], int) and briefing["delta_moments"] >= 0
    assert "你不在的时候" in briefing["summary"]
    assert str(briefing["new_hot_posts"]) in briefing["summary"]
    # comment timestamps stay inside the 3-day window
    for (ts,) in _query(db_path, "SELECT created_at FROM comments"):
        assert last <= datetime.fromisoformat(ts) <= fixed_now
