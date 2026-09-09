"""LLM client and prompt building for agent actions."""

import asyncio
import json
import os
from typing import Any

import httpx


def base_url() -> str:
    return os.environ.get("LLM_BASE_URL", "http://127.0.0.1:8787")


async def generate_action(persona, observation: dict[str, Any], temperature: float = 0.85) -> dict[str, Any]:
    """Ask the LLM to choose one action for this agent."""
    system = persona.to_prompt()
    user = build_observation_text(observation)
    messages = [
        {"role": "system", "content": system},
        {"role": "user", "content": user},
    ]
    async with httpx.AsyncClient(timeout=60.0) as client:
        backoff = [1, 2, 4]
        for attempt in range(3):
            response = await client.post(
                f"{base_url()}/api/generate",
                json={"model": os.environ.get("LLM_MODEL", "gpt-4.1-mini"), "temperature": temperature, "messages": messages},
            )
            if response.status_code == 429 and attempt < 2:
                await asyncio.sleep(backoff[attempt])
                continue
            response.raise_for_status()
            break
    payload = response.json()
    content = payload.get("content", "")
    try:
        return json.loads(content)
    except Exception:
        return {"action": "do_nothing", "reason": "parse failed"}


def build_observation_text(observation: dict[str, Any]) -> str:
    lines = [
        f"当前主题：{observation['topic_title']}",
        f"当前概念：{observation['concept_title']}",
    ]
    if observation.get("lesson_snippet"):
        lines.append(f"微课片段：{observation['lesson_snippet']}")
    if observation.get("community_notes"):
        lines.append(f"社区印象：{observation['community_notes']}")
    lines.append("最近帖子/评论：")
    for item in observation.get("recent_posts", []):
        item_type = item.get("type", "post")
        item_id = item.get("id", "")
        if item_type == "comment":
            parent = item.get("parent_comment_id")
            ref = f"comment_id={item_id}, post_id={item['post_id']}"
            if parent:
                ref += f", parent_comment_id={parent}"
            lines.append(f"- [评论 {ref}] [{item['author']}] {item['content'][:200]}")
        else:
            lines.append(f"- [帖子 post_id={item_id}] [{item['author']}] {item['content'][:200]}")
    lines.append("""
请选择一个动作，用 JSON 输出。回复/点赞时必须使用上方列出的精确 ID，不要编造 ID：
{"action": "create_post", "content": "...", "stance": "doubt"}
或 {"action": "create_comment", "post_id": "...", "content": "...", "stance": "oppose", "relation": "refute"}
或 {"action": "create_comment", "post_id": "...", "parent_comment_id": "...", "content": "...", "stance": "oppose", "relation": "refute"}
或 {"action": "like", "target_type": "post", "target_id": "..."}
或 {"action": "dislike", "target_type": "comment", "target_id": "..."}
或 {"action": "do_nothing"}

要求：
- 像真实 Reddit 网友一样轻松随意，可以讲个人经验、开玩笑、适度歪楼，但要围绕当前知识点。
- 不要纯附和，不要看起来像 AI 生成的模板。
- 观点可以不同意，也可以追问或补充，允许温和的抬杠。
- 资料引用不强制；提到研究简报或微课片段时，用自己的话概括，不要整段复制。
- 内容控制在 300 字以内。
- 必须对已有帖子/评论点赞或回复时，只能使用上面列出的精确 ID（post_id/comment_id）。
""")
    return "\n".join(lines)
