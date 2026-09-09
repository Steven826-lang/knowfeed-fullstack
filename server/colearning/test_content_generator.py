"""Tests for content_generator. All HTTP is mocked; no real LLM calls."""

import asyncio
import json
import random
import re
from types import SimpleNamespace

import httpx
import pytest

import content_generator as cg
import quality
from content_generator import (
    ContentGenerationError,
    generate_comment_tree,
    parse_comment_tree,
)
from personas import generate_personas

TOPIC = "后端架构入门"
CONCEPT = "缓存为什么能提速"
POST_CONTENT = "最近在研究缓存，发现加了 Redis 之后接口快了一个数量级，但听说缓存也有很多坑，想听听大家的实战经验。"

REAL_ASYNC_CLIENT = httpx.AsyncClient


def make_personas(count=20, seed=3):
    return generate_personas(TOPIC, count=count, rng=random.Random(seed))


def sample_payload(agent_ids):
    """A spec-shaped tree: 3 top-level stances, nested replies, one 歪楼, one 总结."""
    a, b, c, d = agent_ids[:4]
    return {
        "comments": [
            {"id": "c1", "parent_id": None, "agent_id": a, "content": "支持楼主，缓存命中率确实是被低估的指标，我们项目里提升很明显。", "stance": "supportive", "relation": "补充", "likes": 40, "hours_ago": 50},
            {"id": "c2", "parent_id": "c1", "agent_id": b, "content": "追问一下，你们命中率提升是怎么统计的，有没有排除预热的干扰？", "stance": "question", "relation": "追问", "likes": 12, "hours_ago": 40},
            {"id": "c3", "parent_id": "c2", "agent_id": a, "content": "回楼上，我们是按自然流量分段统计的，预热流量单独剔除掉了。", "stance": "neutral", "relation": "补充", "likes": 8, "hours_ago": 30},
            {"id": "c4", "parent_id": None, "agent_id": c, "content": "我有个反例：我们上了缓存之后延迟反而更高，因为回源穿透根本没处理好。", "stance": "opposing", "relation": "反驳", "likes": 25, "hours_ago": 45},
            {"id": "c5", "parent_id": "c4", "agent_id": d, "content": "这是缓存穿透的经典坑，布隆过滤器或者空值缓存都能缓解这个问题。", "stance": "neutral", "relation": "补充", "likes": 18, "hours_ago": 35},
            {"id": "c6", "parent_id": "c4", "agent_id": a, "content": "被说服了，之前我只看命中率确实片面，穿透这块要单独加监控。", "stance": "neutral", "relation": "总结", "likes": 6, "hours_ago": 20},
            {"id": "c7", "parent_id": None, "agent_id": d, "content": "省流：缓存不是银弹，想清楚再上车。顺便说一句我家猫就叫缓存。", "stance": "sharing", "relation": "歪楼", "likes": 66, "hours_ago": 10},
        ]
    }


def make_report(kept, pass_rate, should_retry):
    return SimpleNamespace(
        kept=list(kept), dropped=[], pass_rate=pass_rate, should_retry_batch=should_retry
    )


def patch_quality_keep_all(monkeypatch):
    monkeypatch.setattr(
        quality, "check_batch",
        lambda items, kind: make_report(items, 1.0, False),
        raising=False,
    )


def patch_llm(monkeypatch, handler):
    """Route cg's httpx transport through a MockTransport handler."""
    transport = httpx.MockTransport(handler)
    monkeypatch.setattr(
        httpx, "AsyncClient",
        lambda **kwargs: REAL_ASYNC_CLIENT(transport=transport, timeout=60.0),
    )


def dynamic_handler(requests_log, status_codes=None):
    """Handler that answers with a tree built from the prompt's own roster."""
    def handler(request):
        body = json.loads(request.content)
        requests_log.append(body)
        if status_codes:
            code = status_codes[len(requests_log) - 1]
            if code != 200:
                return httpx.Response(code, json={"error": "rate limited"})
        roster = re.findall(r"agent_id=([0-9a-f-]+)", body["messages"][1]["content"])
        payload = json.dumps(sample_payload(roster), ensure_ascii=False)
        return httpx.Response(200, json={"content": payload})
    return handler


# --- prompt construction -------------------------------------------------

def test_build_tree_messages_covers_spec_requirements():
    personas = make_personas()[:8]
    messages = cg.build_tree_messages(POST_CONTENT, TOPIC, CONCEPT, personas)
    assert messages[0]["role"] == "system"
    assert messages[1]["role"] == "user"
    user = messages[1]["content"]
    assert POST_CONTENT in user
    assert TOPIC in user and CONCEPT in user
    for p in personas:
        assert p.agent_id in user
    assert "10–20 条评论" in user
    assert "一级评论" in user
    assert "歪楼" in user
    for stance in cg.STANCES:
        assert stance in user
    for relation in cg.RELATIONS:
        assert relation in user


# --- parsing / validation (no HTTP, no quality gate) ----------------------

def test_parse_links_threads_and_normalizes():
    personas = make_personas()
    ids = [p.agent_id for p in personas]
    raw = json.dumps(sample_payload(ids), ensure_ascii=False)
    comments = parse_comment_tree(raw, personas[:8], "batch-1")

    assert len(comments) == 7
    assert all(c.batch_id == "batch-1" for c in comments)
    paths = {c.comment_id: c.thread_path for c in comments}
    assert paths == {
        "c1": "1", "c2": "1/1", "c3": "1/1/1",
        "c4": "2", "c5": "2/1", "c6": "2/2", "c7": "3",
    }
    by_id = {c.comment_id: c for c in comments}
    for c in comments:
        if c.parent_comment_id:
            parent = by_id[c.parent_comment_id]
            assert c.thread_path.startswith(parent.thread_path + "/")
            assert c.time_offset_seconds < parent.time_offset_seconds
    assert by_id["c1"].parent_comment_id is None
    assert by_id["c2"].parent_comment_id == "c1"
    assert by_id["c7"].relation == "歪楼"
    assert all(c.agent_id in set(ids) for c in comments)


def test_parse_tolerates_markdown_fences():
    personas = make_personas()
    ids = [p.agent_id for p in personas]
    raw = "这是生成的结果：\n```json\n" + json.dumps(sample_payload(ids), ensure_ascii=False) + "\n```"
    comments = parse_comment_tree(raw, personas[:8], "batch-2")
    assert len(comments) == 7


def test_parse_drops_invalid_entries_and_normalizes_fields():
    personas = make_personas()
    ids = [p.agent_id for p in personas]
    payload = {"comments": [
        {"id": "ok1", "parent_id": None, "agent_id": ids[0], "content": "这是一条完全正常的评论，聊聊缓存的实战经验。", "stance": "supportive", "relation": "补充", "likes": 5, "hours_ago": 20},
        {"id": "bad-agent", "parent_id": None, "agent_id": "not-a-real-agent", "content": "agent 不在名单里，应该被丢弃。", "stance": "neutral", "relation": "补充", "likes": 1, "hours_ago": 10},
        {"id": "empty", "parent_id": None, "agent_id": ids[1], "content": "   ", "stance": "neutral", "relation": "补充", "likes": 1, "hours_ago": 10},
        {"id": "weird", "parent_id": "ghost-parent", "agent_id": ids[1], "content": "立场和 relation 都不合法，应该回落到默认值。", "stance": "hype", "relation": "抬杠", "likes": 9999, "hours_ago": 999},
    ]}
    comments = parse_comment_tree(json.dumps(payload, ensure_ascii=False), personas[:8], "b3")
    by_id = {c.comment_id: c for c in comments}
    assert set(by_id) == {"ok1", "weird"}
    weird = by_id["weird"]
    assert weird.parent_comment_id is None       # unknown parent → top-level
    assert weird.thread_path == "2"
    assert weird.stance == "neutral"
    assert weird.relation == "补充"
    assert weird.likes == cg.MAX_LIKES
    assert weird.time_offset_seconds == int(cg.MAX_HOURS_AGO * 3600)


def test_parse_caps_nesting_depth_at_three():
    personas = make_personas()
    ids = [p.agent_id for p in personas]
    chain = {"comments": [
        {"id": f"c{i}", "parent_id": None if i == 1 else f"c{i - 1}", "agent_id": ids[i % 4],
         "content": f"第 {i} 层回复，继续往下聊缓存穿透的细节问题。",
         "stance": "neutral", "relation": "追问", "likes": 1, "hours_ago": 60 - i}
        for i in range(1, 6)
    ]}
    comments = parse_comment_tree(json.dumps(chain, ensure_ascii=False), personas[:8], "b4")
    by_id = {c.comment_id: c for c in comments}
    for c in comments:
        assert len(c.thread_path.split("/")) <= 3
    assert by_id["c4"].parent_comment_id == "c2"   # re-attached to depth-2 ancestor
    assert by_id["c5"].parent_comment_id == "c2"
    assert len({c.thread_path for c in comments}) == 5


def test_parse_reply_cannot_be_older_than_parent():
    personas = make_personas()
    ids = [p.agent_id for p in personas]
    payload = {"comments": [
        {"id": "p", "parent_id": None, "agent_id": ids[0], "content": "父评论，五小时前发的，聊聊缓存预热。", "stance": "neutral", "relation": "补充", "likes": 1, "hours_ago": 5},
        {"id": "r", "parent_id": "p", "agent_id": ids[1], "content": "回复居然比父评论还早，时间要被修正。", "stance": "neutral", "relation": "追问", "likes": 1, "hours_ago": 10},
    ]}
    comments = parse_comment_tree(json.dumps(payload, ensure_ascii=False), personas[:8], "b5")
    by_id = {c.comment_id: c for c in comments}
    assert by_id["r"].time_offset_seconds < by_id["p"].time_offset_seconds


def test_parse_raises_on_garbage_and_on_empty_valid_set():
    personas = make_personas()
    with pytest.raises(ContentGenerationError):
        parse_comment_tree("这不是 JSON，模型跑飞了", personas[:8], "b6")
    payload = {"comments": [
        {"id": "x", "parent_id": None, "agent_id": "ghost", "content": "全部 agent 都不合法。", "stance": "neutral", "relation": "补充", "likes": 0, "hours_ago": 1},
    ]}
    with pytest.raises(ContentGenerationError):
        parse_comment_tree(json.dumps(payload, ensure_ascii=False), personas[:8], "b7")


# --- full generation flow (mocked HTTP + mocked quality gate) --------------

def test_generate_comment_tree_happy_path(monkeypatch):
    personas = make_personas()
    requests_log = []
    patch_llm(monkeypatch, dynamic_handler(requests_log))
    patch_quality_keep_all(monkeypatch)

    tree = asyncio.run(generate_comment_tree(
        POST_CONTENT, TOPIC, CONCEPT, personas,
        participant_count=8, rng=random.Random(7),
    ))

    assert len(requests_log) == 1
    body = requests_log[0]
    assert body["messages"][0]["role"] == "system"
    assert body["messages"][1]["role"] == "user"
    assert "model" in body and "temperature" in body

    assert not tree.retried
    assert tree.quality_pass_rate == 1.0
    assert len(tree.comments) == 7
    assert all(c.batch_id == tree.batch_id for c in tree.comments)
    top_level = [c for c in tree.comments if c.parent_comment_id is None]
    assert len(top_level) == 3
    assert len({c.stance for c in top_level}) == 3   # 一级评论立场各异
    assert any(c.relation == "歪楼" for c in tree.comments)
    offsets = [c.time_offset_seconds for c in tree.comments]
    assert all(int(cg.MIN_HOURS_AGO * 3600) <= o <= int(cg.MAX_HOURS_AGO * 3600) for o in offsets)


def test_generate_drops_gate_rejects_without_retry(monkeypatch):
    personas = make_personas()
    requests_log = []
    patch_llm(monkeypatch, dynamic_handler(requests_log))

    def fake_check_batch(items, kind):
        kept = [i for i in items if "布隆" not in i]
        return make_report(kept, len(kept) / len(items), False)
    monkeypatch.setattr(quality, "check_batch", fake_check_batch, raising=False)

    tree = asyncio.run(generate_comment_tree(
        POST_CONTENT, TOPIC, CONCEPT, personas, rng=random.Random(7),
    ))
    assert len(requests_log) == 1                    # 不逐条重试、不整批重试
    assert not tree.retried
    assert len(tree.comments) == 6
    assert all("布隆" not in c.content for c in tree.comments)


def test_generate_retries_once_with_new_personas(monkeypatch):
    personas = make_personas()
    requests_log = []
    patch_llm(monkeypatch, dynamic_handler(requests_log))

    gate_calls = []
    def fake_check_batch(items, kind):
        gate_calls.append(list(items))
        if len(gate_calls) == 1:
            return make_report(items[:2], 0.3, True)     # 整批通过率过低
        return make_report(items, 0.95, False)
    monkeypatch.setattr(quality, "check_batch", fake_check_batch, raising=False)

    tree = asyncio.run(generate_comment_tree(
        POST_CONTENT, TOPIC, CONCEPT, personas,
        participant_count=8, rng=random.Random(11),
    ))

    assert len(requests_log) == 2                    # 只重生成一次
    assert len(gate_calls) == 2
    assert tree.retried
    assert tree.quality_pass_rate == 0.95
    assert len(tree.comments) == 7
    roster1 = set(re.findall(r"agent_id=([0-9a-f-]+)", requests_log[0]["messages"][1]["content"]))
    roster2 = set(re.findall(r"agent_id=([0-9a-f-]+)", requests_log[1]["messages"][1]["content"]))
    assert roster1.isdisjoint(roster2)               # 换了一组 persona


def test_generate_accepts_second_batch_even_if_gate_still_unhappy(monkeypatch):
    personas = make_personas()
    requests_log = []
    patch_llm(monkeypatch, dynamic_handler(requests_log))
    monkeypatch.setattr(
        quality, "check_batch",
        lambda items, kind: make_report(items, 0.4, True),
        raising=False,
    )
    tree = asyncio.run(generate_comment_tree(
        POST_CONTENT, TOPIC, CONCEPT, personas, rng=random.Random(13),
    ))
    assert len(requests_log) == 2                    # 不会无限重试
    assert tree.retried
    assert len(tree.comments) == 7                   # 降低下限接受，不凑数放水


def test_generate_raises_on_unparseable_llm_output(monkeypatch):
    personas = make_personas()
    patch_llm(monkeypatch, lambda request: httpx.Response(200, json={"content": "模型返回了纯文本，没有 JSON"}))
    patch_quality_keep_all(monkeypatch)
    with pytest.raises(ContentGenerationError):
        asyncio.run(generate_comment_tree(POST_CONTENT, TOPIC, CONCEPT, personas))


def test_transport_retries_on_429(monkeypatch):
    personas = make_personas()
    requests_log = []
    patch_llm(monkeypatch, dynamic_handler(requests_log, status_codes=[429, 429, 200]))
    patch_quality_keep_all(monkeypatch)

    async def fake_sleep(_seconds):
        return None
    monkeypatch.setattr(asyncio, "sleep", fake_sleep)

    tree = asyncio.run(generate_comment_tree(
        POST_CONTENT, TOPIC, CONCEPT, personas, rng=random.Random(17),
    ))
    assert len(requests_log) == 3
    assert len(tree.comments) == 7


def test_generate_integrates_with_real_quality_check_batch(monkeypatch):
    """HTTP is still mocked, but the real quality.check_batch gates the batch."""
    personas = make_personas()
    requests_log = []
    patch_llm(monkeypatch, dynamic_handler(requests_log))
    assert hasattr(quality, "check_batch"), "quality.check_batch contract not implemented yet"

    tree = asyncio.run(generate_comment_tree(
        POST_CONTENT, TOPIC, CONCEPT, personas, rng=random.Random(19),
    ))
    assert len(requests_log) == 1                    # 整批通过，无需重生成
    assert not tree.retried
    assert tree.quality_pass_rate >= 0.7
    assert len(tree.comments) == 7                   # 样本评论全部通过真实质量门
