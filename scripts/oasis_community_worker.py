#!/usr/bin/env python3
"""DEPRECATED: 已退役，由 server/colearning 的 /api/community/* 取代，保留仅为历史参考。

Run a small Wonderwall/OASIS Reddit-style community simulation.

The script is intentionally a JSON-lines worker. The Node dev server starts it,
reads each line, and exposes the growing snapshot to the React UI.
"""

from __future__ import annotations

import asyncio
import json
import os
import sqlite3
import sys
import tempfile
import traceback
from pathlib import Path
from typing import Any


def emit(message_type: str, **payload: Any) -> None:
    print(json.dumps({"type": message_type, **payload}, ensure_ascii=False), flush=True)


def read_payload() -> dict[str, Any]:
    try:
        raw = sys.stdin.read().strip()
        return json.loads(raw) if raw else {}
    except Exception:
        return {}


def safe_text(value: Any, fallback: str) -> str:
    text = str(value or "").strip()
    return text or fallback


def build_agent_profiles(topic: str) -> list[dict[str, Any]]:
    return [
        {
            "username": "liuduojukan",
            "display_name": "资料党阿刘",
            "bio": "爱翻原文，看到热帖会先问出处。",
            "persona": f"聊 {topic} 时，不急着下结论，先问原文、案例和会翻车的场景。",
            "mbti": "INTJ",
            "gender": "other",
            "age": 31,
            "country": "CN",
        },
        {
            "username": "chanpin_xiaom",
            "display_name": "产品小M",
            "bio": "会把大词拉回用户场景。",
            "persona": f"聊 {topic} 时，关注它在真实产品里到底改变了什么判断。",
            "mbti": "ENTP",
            "gender": "other",
            "age": 28,
            "country": "CN",
        },
        {
            "username": "chen_buxin",
            "display_name": "陈不太信",
            "bio": "对万能解释过敏。",
            "persona": f"聊 {topic} 时，会盯着过度包装、偷换概念和反例。",
            "mbti": "ISTP",
            "gender": "other",
            "age": 35,
            "country": "CN",
        },
        {
            "username": "kandao_yiban",
            "display_name": "看到一半",
            "bio": "常在评论里问最朴素的问题。",
            "persona": f"聊 {topic} 时，会把黑话拆成普通人也能追问的一句话。",
            "mbti": "ISFP",
            "gender": "other",
            "age": 24,
            "country": "CN",
        },
        {
            "username": "laowang_ops",
            "display_name": "老王在落地",
            "bio": "做过运营，习惯问谁负责。",
            "persona": f"聊 {topic} 时，会问落地成本、责任人和失败后果。",
            "mbti": "ESTJ",
            "gender": "other",
            "age": 38,
            "country": "CN",
        },
        {
            "username": "case_mover",
            "display_name": "案例搬运工",
            "bio": "喜欢拿具体例子泼冷水。",
            "persona": f"聊 {topic} 时，会用案例说明什么能学、什么不能套。",
            "mbti": "INFJ",
            "gender": "other",
            "age": 29,
            "country": "CN",
        },
        {
            "username": "zuowan_zaishuo",
            "display_name": "做完再说",
            "bio": "不爱吵，喜欢补下一步。",
            "persona": f"聊 {topic} 时，会把吵架点改成可以验证的小动作。",
            "mbti": "ISTJ",
            "gender": "other",
            "age": 33,
            "country": "CN",
        },
        {
            "username": "hotlist_lu",
            "display_name": "热榜路过",
            "bio": "看热度，也看大家在吵哪句话。",
            "persona": f"聊 {topic} 时，会观察哪种说法被放大、哪种疑问没人接。",
            "mbti": "ENFP",
            "gender": "other",
            "age": 27,
            "country": "CN",
        },
    ]


def scripted_steps(topic: str, goal: str) -> list[dict[str, Any]]:
    seed = (
        f"刷到好几贴都在讲 {topic}，我有点被绕晕了。"
        f"它到底是在解决哪个具体问题？有没有一个反例能说明这套说法什么时候会失效？"
    )
    return [
        {
            "round": 0,
            "label": "seed post",
            "actions": [
                {"agent": 0, "type": "CREATE_POST", "args": {"content": seed}},
            ],
        },
        {
            "round": 1,
            "label": "first replies",
            "actions": [
                {
                    "agent": 1,
                    "type": "CREATE_COMMENT",
                    "args": {
                        "post_id": 1,
                        "content": "我会先找原文或者具体案例。只说“很有用”但不给场景的，先别信太满。",
                    },
                },
                {
                    "agent": 2,
                    "type": "CREATE_COMMENT",
                    "args": {
                        "post_id": 1,
                        "content": "这词一火就容易变成万能解释。万能解释通常等于没解释。",
                    },
                },
                {
                    "agent": 3,
                    "type": "CREATE_COMMENT",
                    "args": {
                        "post_id": 1,
                        "content": "新手插一句：能不能先别上大词？我现在只想知道，看到一个结论时先问哪一句最管用。",
                    },
                },
            ],
        },
        {
            "round": 2,
            "label": "ranking signals",
            "actions": [
                {"agent": 4, "type": "LIKE_POST", "args": {"post_id": 1}},
                {"agent": 5, "type": "LIKE_COMMENT", "args": {"comment_id": 1}},
                {"agent": 6, "type": "LIKE_COMMENT", "args": {"comment_id": 3}},
                {
                    "agent": 4,
                    "type": "CREATE_COMMENT",
                    "args": {
                        "post_id": 1,
                        "content": f"落地看，先别急着追求“{goal}”。我会先问：谁会拿这个说法做决策？出错了谁负责？这个问题一问，很多漂亮解释就露底了。",
                    },
                },
            ],
        },
        {
            "round": 3,
            "label": "branch post",
            "actions": [
                {
                    "agent": 7,
                    "type": "CREATE_POST",
                    "args": {
                        "content": f"单开一楼问反面：{topic} 哪些场景下最好别这么解释？只讲成功案例真的看不出边界。",
                    },
                },
                {
                    "agent": 5,
                    "type": "CREATE_COMMENT",
                    "args": {
                        "post_id": 2,
                        "content": "比如拿一个成功产品的做法套所有产品，听着顺，其实样本太少。案例只能当线索，不能当判决书。",
                    },
                },
                {
                    "agent": 0,
                    "type": "CREATE_COMMENT",
                    "args": {
                        "post_id": 2,
                        "content": "我会把原帖结论改成一句能被打脸的话。改不出来，就说明它可能只是口号。",
                    },
                },
            ],
        },
    ]


def setup_import_path(backend_path: str) -> None:
    backend = Path(backend_path).expanduser().resolve()
    if not backend.exists():
        raise RuntimeError(f"MiroShark backend not found: {backend}")
    sys.path.insert(0, str(backend))
    (Path.cwd() / "log").mkdir(exist_ok=True)


def query_snapshot(db_path: Path, agents: list[dict[str, Any]], topic: str, mode: str) -> dict[str, Any]:
    connection = sqlite3.connect(db_path)
    connection.row_factory = sqlite3.Row
    try:
        posts = [dict(row) for row in connection.execute(
            """
            SELECT post_id, user_id, content, created_at, num_likes, num_dislikes, num_shares
            FROM post
            ORDER BY post_id
            """
        )]
        comments = [dict(row) for row in connection.execute(
            """
            SELECT comment_id, post_id, user_id, content, created_at, num_likes, num_dislikes
            FROM comment
            ORDER BY comment_id
            """
        )]
        traces = []
        for row in connection.execute(
            "SELECT rowid, user_id, created_at, action, info FROM trace ORDER BY rowid"
        ):
            info_raw = row["info"]
            try:
                info = json.loads(info_raw)
            except Exception:
                info = {"raw": info_raw}
            traces.append({
                "id": int(row["rowid"]),
                "userId": int(row["user_id"]),
                "createdAt": str(row["created_at"]),
                "action": str(row["action"]),
                "info": info,
            })
    finally:
        connection.close()

    return {
        "topic": topic,
        "mode": mode,
        "agents": [
            {
                "id": index,
                "username": agent["username"],
                "displayName": agent.get("display_name") or agent["username"].replace("_", " "),
                "bio": agent["bio"],
                "persona": agent["persona"],
            }
            for index, agent in enumerate(agents)
        ],
        "posts": [
            {
                "id": int(post["post_id"]),
                "agentId": int(post["user_id"]),
                "content": post["content"],
                "createdAt": str(post["created_at"]),
                "likes": int(post["num_likes"] or 0),
                "dislikes": int(post["num_dislikes"] or 0),
                "shares": int(post["num_shares"] or 0),
            }
            for post in posts
        ],
        "comments": [
            {
                "id": int(comment["comment_id"]),
                "postId": int(comment["post_id"]),
                "agentId": int(comment["user_id"]),
                "content": comment["content"],
                "createdAt": str(comment["created_at"]),
                "likes": int(comment["num_likes"] or 0),
                "dislikes": int(comment["num_dislikes"] or 0),
            }
            for comment in comments
        ],
        "traces": traces,
    }


def event_from_trace(trace: dict[str, Any], agents: list[dict[str, Any]], round_index: int) -> dict[str, Any]:
    info = trace.get("info") or {}
    user_id = int(trace.get("userId", 0))
    agent = agents[user_id] if 0 <= user_id < len(agents) else {}
    return {
        "id": trace["id"],
        "round": round_index,
        "action": trace["action"],
        "agentId": user_id,
        "agentName": agent.get("display_name") or agent.get("username", f"agent-{user_id}"),
        "content": info.get("content", ""),
        "postId": info.get("post_id"),
        "commentId": info.get("comment_id"),
        "createdAt": trace["createdAt"],
    }


async def run_worker(payload: dict[str, Any]) -> None:
    backend_path = os.environ.get("KNOWFEED_OASIS_BACKEND", "/Users/xiejiachen/Downloads/MiroShark/backend")
    setup_import_path(backend_path)

    import wonderwall

    topic = safe_text(payload.get("topic"), "RLHF 为什么会让 AI 助手变得礼貌但平")
    goal = safe_text(payload.get("goal"), "看懂评论区的争议")
    mode = safe_text(payload.get("mode"), "scripted")
    delay_ms = max(0, min(2500, int(payload.get("delayMs") or 700)))
    agent_profiles = build_agent_profiles(topic)

    with tempfile.TemporaryDirectory(prefix="knowfeed-oasis-") as tmpdir:
        tmp_path = Path(tmpdir)
        profile_path = tmp_path / "profiles.json"
        db_path = tmp_path / "community.db"
        profile_path.write_text(json.dumps(agent_profiles, ensure_ascii=False), encoding="utf-8")

        emit("status", status="starting", message="正在叫醒本地社区角色")
        agent_graph = await wonderwall.generate_reddit_agent_graph(
            profile_path=str(profile_path),
            model=None,
            available_actions=[
                wonderwall.ActionType.CREATE_POST,
                wonderwall.ActionType.CREATE_COMMENT,
                wonderwall.ActionType.LIKE_POST,
                wonderwall.ActionType.DISLIKE_POST,
                wonderwall.ActionType.LIKE_COMMENT,
                wonderwall.ActionType.DISLIKE_COMMENT,
                wonderwall.ActionType.DO_NOTHING,
            ],
        )
        env = wonderwall.make(
            agent_graph=agent_graph,
            platform=wonderwall.DefaultPlatformType.REDDIT,
            database_path=str(db_path),
            semaphore=4,
        )
        await env.reset()
        emit("status", status="running", message="评论区开始发酵")
        emit("snapshot", snapshot=query_snapshot(db_path, agent_profiles, topic, mode))

        seen_trace_ids: set[int] = set()
        for step in scripted_steps(topic, goal):
            actions: dict[Any, Any] = {}
            for item in step["actions"]:
                agent = env.agent_graph.get_agent(item["agent"])
                action_type = getattr(wonderwall.ActionType, item["type"])
                action = wonderwall.ManualAction(action_type=action_type, action_args=item["args"])
                if agent in actions:
                    existing = actions[agent]
                    actions[agent] = existing + [action] if isinstance(existing, list) else [existing, action]
                else:
                    actions[agent] = action

            emit("status", status="running", message=f"第 {step['round'] + 1} 轮：{step['label']}")
            await env.step(actions)
            snapshot = query_snapshot(db_path, agent_profiles, topic, mode)
            for trace in snapshot["traces"]:
                if trace["id"] not in seen_trace_ids:
                    seen_trace_ids.add(trace["id"])
                    emit("event", event=event_from_trace(trace, agent_profiles, step["round"]))
            emit("snapshot", snapshot=snapshot)
            if delay_ms:
                await asyncio.sleep(delay_ms / 1000)

        await env.close()
        emit("complete", snapshot=query_snapshot(db_path, agent_profiles, topic, mode))


def main() -> int:
    try:
        asyncio.run(run_worker(read_payload()))
        return 0
    except Exception as error:
        emit("error", error=str(error), traceback=traceback.format_exc(limit=12))
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
