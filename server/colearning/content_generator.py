"""Batch comment-tree generator (spec §5.2).

Generates a complete Reddit-style comment thread for one post in a single
LLM call. Usage boundary: historical content backfill (world initialization
/ catch-up) ONLY. Never use this to answer a user's live comment — realtime
interaction goes through tick-based single-comment generation instead.
"""

import asyncio
import json
import os
import random
import re
import uuid
from dataclasses import dataclass
from typing import Any

import httpx

import quality
from llm import base_url

STANCES = ("supportive", "opposing", "neutral", "question", "sharing")
RELATIONS = ("追问", "补充", "反驳", "歪楼", "总结")

MAX_DEPTH = 3               # spec §13: 评论嵌套深度 ≤ 3 层
MIN_HOURS_AGO = 0.5
MAX_HOURS_AGO = 96.0        # 相对时间偏移：过去数小时到数天
MAX_LIKES = 500


class ContentGenerationError(Exception):
    """Raised when the LLM response cannot be turned into a comment tree."""


@dataclass
class GeneratedComment:
    """One validated comment from a generated batch."""

    comment_id: str              # batch-local id assigned by the LLM ("c3")
    parent_comment_id: str | None
    thread_path: str             # "1/3/2" nesting path, assigned during linking
    batch_id: str
    agent_id: str
    content: str
    stance: str                  # one of STANCES
    relation: str                # one of RELATIONS
    likes: int
    time_offset_seconds: int     # how long before "now" this was posted

    def to_dict(self) -> dict[str, Any]:
        return {
            "comment_id": self.comment_id,
            "parent_comment_id": self.parent_comment_id,
            "thread_path": self.thread_path,
            "batch_id": self.batch_id,
            "agent_id": self.agent_id,
            "content": self.content,
            "stance": self.stance,
            "relation": self.relation,
            "likes": self.likes,
            "time_offset_seconds": self.time_offset_seconds,
        }


@dataclass
class CommentTree:
    """Result of one accepted batch: linked comments plus gate metadata."""

    batch_id: str
    comments: list[GeneratedComment]
    quality_pass_rate: float
    retried: bool                # True if a second batch was generated after gate failure

    def to_dict(self) -> dict[str, Any]:
        return {
            "batch_id": self.batch_id,
            "comments": [c.to_dict() for c in self.comments],
            "quality_pass_rate": self.quality_pass_rate,
            "retried": self.retried,
        }


async def generate_comment_tree(
    post_content: str,
    topic_title: str,
    concept_title: str,
    personas: list[Any],
    *,
    participant_count: int = 8,
    temperature: float = 0.85,
    model: str | None = None,
    rng: random.Random | None = None,
) -> CommentTree:
    """Generate one batch comment tree for a post. Historical backfill only.

    Runs the batch through quality.check_batch once; if the gate asks for a
    retry (pass rate below threshold) a single second batch is generated with
    a different persona subset, then accepted as-is per spec §5.2 — comments
    are dropped individually, never retried one by one, and a short batch is
    accepted rather than padded with filler.
    """
    rng = rng or random.Random()
    if not personas:
        raise ContentGenerationError("no personas available")

    participants = _pick_participants(personas, participant_count, rng, exclude=set())
    batch_id, comments = await _generate_batch(
        post_content, topic_title, concept_title, participants, temperature, model,
    )
    report = quality.check_batch([c.content for c in comments], "comment")

    retried = False
    if report.should_retry_batch:
        retried = True
        used = {p.agent_id for p in participants}
        participants = _pick_participants(personas, participant_count, rng, exclude=used)
        batch_id, comments = await _generate_batch(
            post_content, topic_title, concept_title, participants, temperature, model,
        )
        report = quality.check_batch([c.content for c in comments], "comment")

    kept_contents = set(report.kept)
    kept = [c for c in comments if c.content in kept_contents]
    return CommentTree(
        batch_id=batch_id,
        comments=kept,
        quality_pass_rate=report.pass_rate,
        retried=retried,
    )


async def _generate_batch(
    post_content: str,
    topic_title: str,
    concept_title: str,
    participants: list[Any],
    temperature: float,
    model: str | None,
) -> tuple[str, list[GeneratedComment]]:
    """One LLM call: prompt, transport, parse, validate, link."""
    batch_id = str(uuid.uuid4())
    messages = build_tree_messages(post_content, topic_title, concept_title, participants)
    raw = await _post_messages(messages, temperature=temperature, model=model)
    comments = parse_comment_tree(raw, participants, batch_id)
    return batch_id, comments


def _pick_participants(
    personas: list[Any],
    count: int,
    rng: random.Random,
    exclude: set[str],
) -> list[Any]:
    """Sample a participant subset, preferring personas not used last round."""
    pool = [p for p in personas if p.agent_id not in exclude]
    if len(pool) < min(count, 4):
        pool = list(personas)
    return rng.sample(pool, min(count, len(pool)))


def build_tree_messages(
    post_content: str,
    topic_title: str,
    concept_title: str,
    participants: list[Any],
) -> list[dict[str, str]]:
    """Chinese prompt per spec §4.2/§5.2: one full comment thread in one call."""
    system = (
        "你是一个学习社区的内容导演，负责为一个帖子编排一整条真实自然的评论讨论串。\n"
        "核心原则：\n"
        "- 评论要有实质：数据、来源、亲身经历、详细论证；禁止“同意”“说得好”这类水贴。\n"
        "- 评论之间要有真实互动感：A 说 X，B 追问，A 回头回应。\n"
        "- 允许 delta 瞬间：某个 agent 被说服后改变想法，这比坚持立场更真实。\n"
        "- 每个 agent 的语气、口头禅、关心角度必须严格符合其人设。\n"
        "- 只输出 JSON，不要输出任何解释。"
    )
    roster = "\n".join(_persona_summary(p) for p in participants)
    stances = " / ".join(STANCES)
    relations = " / ".join(RELATIONS)
    user = f"""主题：{topic_title}
概念：{concept_title}
帖子内容：
{post_content}

参与讨论的 agent 名单（agent_id 必须从这个名单里选，每人可以发言多条）：
{roster}

请为这个帖子生成 10–20 条评论，要求：
- 3–4 条一级评论（parent_id 为 null），立场各不相同。
- 每条一级评论下有 2–4 条嵌套回复，relation 为追问 / 补充 / 反驳。
- 其中 1–2 条歪楼/段子（relation 为“歪楼”），可以挂在任意楼层。
- 可以用 1 条“总结”陈词（relation 为“总结”）给某条子串收尾。
- 评论用中文，8–300 字，像真实 Reddit 网友一样轻松随意，围绕当前概念。
- likes 为预计点赞数（0–150，歪楼/段子可以更高）。
- hours_ago 为发布时间距现在的小时数（2–72，可带小数）；一级评论较早，回复必须晚于它回复的那条（hours_ago 更小）。

严格按以下 JSON 结构输出（不要加 markdown 代码围栏）：
{{"comments": [
  {{"id": "c1", "parent_id": null, "agent_id": "...", "content": "...", "stance": "supportive", "relation": "补充", "likes": 23, "hours_ago": 48}}
]}}
stance 只能是：{stances}；relation 只能是：{relations}。"""
    return [
        {"role": "system", "content": system},
        {"role": "user", "content": user},
    ]


def _persona_summary(persona: Any) -> str:
    traits = "/".join(persona.traits) if isinstance(persona.traits, list) else str(persona.traits)
    return (
        f"- agent_id={persona.agent_id} | {persona.display_name} (@{persona.handle}) | "
        f"{persona.role} | 语气：{persona.voice} | 性格：{traits} | "
        f"关心：{persona.concern} | 习惯：{persona.habit} | 口头禅：{persona.catchphrase}"
    )


def parse_comment_tree(raw: str, participants: list[Any], batch_id: str) -> list[GeneratedComment]:
    """Parse and validate the LLM JSON output into linked GeneratedComments.

    Drops structurally invalid entries (unknown agent, empty content),
    normalizes stance/relation, clamps likes and time offsets, re-links
    parents, caps nesting at MAX_DEPTH and assigns thread_path values.
    """
    data = _extract_json(raw)
    items = data.get("comments") if isinstance(data, dict) else data
    if not isinstance(items, list):
        raise ContentGenerationError("LLM output has no comment list")

    valid_agents = {p.agent_id for p in participants}
    comments: list[GeneratedComment] = []
    seen_ids: set[str] = set()
    for idx, item in enumerate(items):
        if not isinstance(item, dict):
            continue
        content = item.get("content")
        agent_id = item.get("agent_id")
        if not isinstance(content, str) or not content.strip():
            continue
        if agent_id not in valid_agents:
            continue
        comment_id = str(item.get("id") or item.get("comment_id") or f"c{idx + 1}")
        if comment_id in seen_ids:
            comment_id = f"{comment_id}-{idx + 1}"
        seen_ids.add(comment_id)
        parent = item.get("parent_id") or item.get("parent_comment_id") or None
        comments.append(GeneratedComment(
            comment_id=comment_id,
            parent_comment_id=str(parent) if parent else None,
            thread_path="",
            batch_id=batch_id,
            agent_id=agent_id,
            content=content.strip(),
            stance=item.get("stance") if item.get("stance") in STANCES else "neutral",
            relation=item.get("relation") if item.get("relation") in RELATIONS else "补充",
            likes=_clamp_int(item.get("likes"), 0, MAX_LIKES, default=0),
            time_offset_seconds=int(
                _clamp_float(item.get("hours_ago"), MIN_HOURS_AGO, MAX_HOURS_AGO, default=24.0) * 3600
            ),
        ))
    if not comments:
        raise ContentGenerationError("no valid comments in LLM output")

    _link_threads(comments)
    return comments


def _link_threads(comments: list[GeneratedComment]) -> None:
    """Fix parent links, cap depth, assign thread_path, order reply times."""
    by_id = {c.comment_id: c for c in comments}
    for c in comments:
        if c.parent_comment_id and (
            c.parent_comment_id not in by_id or c.parent_comment_id == c.comment_id
        ):
            c.parent_comment_id = None

    path_by_id: dict[str, str] = {}
    id_by_path: dict[str, str] = {}
    child_counters: dict[str, int] = {}
    top_counter = 0
    for c in comments:
        parent_path = path_by_id.get(c.parent_comment_id or "")
        if parent_path is None:
            # Top-level (also the fallback when the parent appears later or is unknown)
            top_counter += 1
            c.parent_comment_id = None
            c.thread_path = str(top_counter)
        else:
            if len(parent_path.split("/")) >= MAX_DEPTH:
                # Re-attach to the depth-2 ancestor so this lands at depth 3
                ancestor_path = "/".join(parent_path.split("/")[: MAX_DEPTH - 1])
                c.parent_comment_id = id_by_path[ancestor_path]
                parent_path = ancestor_path
            child_counters[parent_path] = child_counters.get(parent_path, 0) + 1
            c.thread_path = f"{parent_path}/{child_counters[parent_path]}"
        path_by_id[c.comment_id] = c.thread_path
        id_by_path[c.thread_path] = c.comment_id

    for c in comments:
        # A reply must be newer than its parent (smaller offset from now)
        parent = by_id.get(c.parent_comment_id or "")
        if parent and c.time_offset_seconds >= parent.time_offset_seconds:
            c.time_offset_seconds = max(
                int(MIN_HOURS_AGO * 3600), parent.time_offset_seconds - 3600
            )


def _extract_json(raw: str) -> Any:
    """Tolerate markdown fences and prose around the JSON payload."""
    text = raw.strip()
    candidates = [text]
    fenced = re.sub(r"^```(?:json)?\s*", "", text, flags=re.IGNORECASE)
    fenced = re.sub(r"\s*```$", "", fenced)
    candidates.append(fenced)
    for candidate in (text, fenced):
        start = candidate.find("{")
        end = candidate.rfind("}")
        if start != -1 and end > start:
            candidates.append(candidate[start : end + 1])
        start = candidate.find("[")
        end = candidate.rfind("]")
        if start != -1 and end > start:
            candidates.append(candidate[start : end + 1])
    for candidate in candidates:
        try:
            return json.loads(candidate)
        except Exception:
            continue
    raise ContentGenerationError("LLM output is not valid JSON")


def _clamp_int(value: Any, lo: int, hi: int, default: int) -> int:
    try:
        v = int(float(value))
    except (TypeError, ValueError):
        return default
    return max(lo, min(hi, v))


def _clamp_float(value: Any, lo: float, hi: float, default: float) -> float:
    try:
        v = float(value)
    except (TypeError, ValueError):
        return default
    return max(lo, min(hi, v))


async def _post_messages(
    messages: list[dict[str, str]],
    *,
    temperature: float,
    model: str | None,
) -> str:
    """POST to the LLM proxy, same transport pattern as llm.generate_action."""
    model = model or os.environ.get("LLM_MODEL_BATCH") or os.environ.get("LLM_MODEL", "gpt-4.1-mini")
    async with httpx.AsyncClient(timeout=60.0) as client:
        backoff = [1, 2, 4]
        for attempt in range(3):
            response = await client.post(
                f"{base_url()}/api/generate",
                json={"model": model, "temperature": temperature, "messages": messages},
            )
            if response.status_code == 429 and attempt < 2:
                await asyncio.sleep(backoff[attempt])
                continue
            response.raise_for_status()
            break
    return response.json().get("content", "")
