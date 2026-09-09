"""Schedule and run discussion rounds."""

import asyncio
import json
import random
import sqlite3
from pathlib import Path
from typing import Any

from actions import create_post, create_comment, add_reaction
from db import now_iso
from llm import generate_action
from quality import passes_gate


class Scheduler:
    def __init__(self, db_path: Path, max_concurrent_llm: int = 3):
        self.db_path = db_path
        self.semaphore = asyncio.Semaphore(max_concurrent_llm)

    async def advance(
        self,
        world_id: str,
        topic_title: str,
        concept_id: str,
        concept_title: str,
        personas: list[Any],
        lesson_snippet: str | None = None,
    ) -> dict[str, Any]:
        conn = sqlite3.connect(self.db_path)
        conn.row_factory = sqlite3.Row
        try:
            agents = [dict(row) for row in conn.execute(
                "SELECT agent_id, display_name, handle, bio, persona_json FROM agents WHERE world_id = ?", (world_id,)
            )]
            recent_posts = [dict(row) for row in conn.execute(
                """
                SELECT p.post_id, p.content, a.handle as author
                FROM posts p LEFT JOIN agents a ON p.agent_id = a.agent_id
                WHERE p.world_id = ? AND p.concept_id = ?
                ORDER BY p.created_at DESC LIMIT 12
                """,
                (world_id, concept_id),
            )]
            recent_comments = [dict(row) for row in conn.execute(
                """
                SELECT c.comment_id, c.post_id, c.parent_comment_id, c.content, a.handle as author
                FROM comments c LEFT JOIN agents a ON c.agent_id = a.agent_id
                JOIN posts p ON c.post_id = p.post_id
                WHERE p.world_id = ? AND p.concept_id = ?
                ORDER BY c.created_at DESC LIMIT 12
                """,
                (world_id, concept_id),
            )]
        finally:
            conn.close()

        recent = [
            {
                "id": p["post_id"],
                "type": "post",
                "author": p["author"] or "unknown",
                "content": p["content"],
            }
            for p in recent_posts
        ] + [
            {
                "id": c["comment_id"],
                "type": "comment",
                "post_id": c["post_id"],
                "parent_comment_id": c["parent_comment_id"],
                "author": c["author"] or "unknown",
                "content": c["content"],
            }
            for c in recent_comments
        ]
        agent_map = {a["agent_id"]: a for a in agents}
        active_agents = random.sample(agents, min(len(agents), 6))

        tasks = [
            self._agent_step(agent, world_id, topic_title, concept_id, concept_title, lesson_snippet, recent)
            for agent in active_agents
        ]
        results = await asyncio.gather(*tasks, return_exceptions=True)

        created = {"posts": 0, "comments": 0, "reactions": 0}
        for result in results:
            if isinstance(result, Exception):
                continue
            action = result.get("action")
            agent_id = result["agent_id"]
            if action == "create_post":
                content = result.get("content", "")
                stance = result.get("stance", "doubt")
                if passes_gate(self.db_path, concept_id, content, stance):
                    create_post(
                        self.db_path, world_id, concept_id, agent_id,
                        content, stance,
                    )
                    created["posts"] += 1
            elif action == "create_comment":
                content = result.get("content", "")
                stance = result.get("stance", "add")
                comment_post_id = result.get("post_id")
                if passes_gate(self.db_path, concept_id, content, stance, post_id=comment_post_id) and comment_post_id:
                    create_comment(
                        self.db_path, comment_post_id, agent_id,
                        content, stance, result.get("relation", "add"),
                        result.get("parent_comment_id"),
                    )
                    created["comments"] += 1
            elif action in ("like", "dislike"):
                if result.get("target_type") in ("post", "comment") and result.get("target_id"):
                    add_reaction(
                        self.db_path, result["target_type"], result["target_id"], agent_id, action,
                    )
                    created["reactions"] += 1

        return created

    async def _agent_step(self, agent, world_id, topic_title, concept_id, concept_title, lesson_snippet, recent):
        from personas import Persona
        persona_data = json.loads(agent["persona_json"])
        persona = Persona(**{**persona_data, "agent_id": agent["agent_id"], "display_name": agent["display_name"], "handle": agent["handle"], "bio": agent["bio"]})
        observation = {
            "topic_title": topic_title,
            "concept_title": concept_title,
            "lesson_snippet": lesson_snippet or "",
            "community_notes": f"你是这个 subreddit 的老用户，ID 是 @{agent['handle']}。",
            "recent_posts": recent[:10],
        }
        async with self.semaphore:
            action = await generate_action(persona, observation)
        action["agent_id"] = agent["agent_id"]
        return action
