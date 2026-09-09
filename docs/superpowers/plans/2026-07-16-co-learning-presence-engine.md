# Co-Learning Presence Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Reddit-style simulated learning community for KnowFeed where 20–50 AI agents post, comment, and react around the user's current learning concept, with persistence in SQLite and a lightweight Python backend service.

**Architecture:** A persistent Python FastAPI service (`server/colearning/`) stores world state in SQLite and generates agent actions via LLM tool calls. The existing Node `llm-proxy.mjs` spawns this service at startup and forwards `/api/colearning/*` routes. The React frontend reads from the new API and renders posts/comments in the existing `HomeFeed` / `PostDetail` components.

**Tech Stack:** Python 3.11+, FastAPI, SQLite, Pydantic, OpenAI-compatible LLM API; Node.js proxy; React + TypeScript + Vite.

---

## File Structure

New backend files:
- `server/colearning/__init__.py` — package marker
- `server/colearning/main.py` — FastAPI app, route handlers
- `server/colearning/db.py` — SQLite schema, connection, query helpers
- `server/colearning/models.py` — Pydantic models for API
- `server/colearning/personas.py` — agent persona generation
- `server/colearning/llm.py` — LLM client and prompt helpers
- `server/colearning/scheduler.py` — discussion round scheduler
- `server/colearning/actions.py` — action space execution
- `server/colearning/quality.py` — lightweight quality gates
- `server/colearning/requirements.txt` — Python dependencies

Modified files:
- `server/llm-proxy.mjs` — spawn `colearning` service, add `/api/colearning/*` proxy
- `src/domain/types.ts` — add colearning TypeScript types
- `src/domain/colearning.ts` — frontend API client (new file)
- `src/App.tsx` — create world on topic start, load feed from colearning
- `src/components/HomeFeed.tsx` — render colearning posts, presence badge
- `src/components/PostDetail.tsx` — render colearning comment trees, submit shadow entries

---

### Task 1: Bootstrap Python colearning package

**Files:**
- Create: `server/colearning/__init__.py`
- Create: `server/colearning/requirements.txt`
- Create: `server/colearning/.gitignore`

- [ ] **Step 1: Create package marker**

Create `server/colearning/__init__.py`:

```python
"""KnowFeed Co-Learning Presence Engine."""

__version__ = "0.1.0"
```

- [ ] **Step 2: Pin dependencies**

Create `server/colearning/requirements.txt`:

```text
fastapi>=0.111.0
uvicorn[standard]>=0.30.0
pydantic>=2.7.0
sqlite-utils>=3.36
httpx>=0.27.0
python-dotenv>=1.0.0
```

- [ ] **Step 3: Ignore local DB files**

Create `server/colearning/.gitignore`:

```gitignore
*.db
*.db-journal
__pycache__/
*.pyc
.env
```

- [ ] **Step 4: Verify Python environment**

Run:

```bash
cd "/Users/xiejiachen/Documents/New project/knowledge-feed-learning/server/colearning"
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
python3 -c "import fastapi, pydantic; print('ok')"
```

Expected: prints `ok` with no errors.

---

### Task 2: SQLite schema and connection

**Files:**
- Create: `server/colearning/db.py`
- Test: `server/colearning/test_db.py`

- [ ] **Step 1: Write the failing test**

Create `server/colearning/test_db.py`:

```python
import sqlite3
from pathlib import Path

from db import init_db, create_world, get_world, list_worlds


def test_init_db_creates_tables(tmp_path):
    db_path = tmp_path / "test.db"
    init_db(db_path)
    conn = sqlite3.connect(db_path)
    tables = {row[0] for row in conn.execute(
        "SELECT name FROM sqlite_master WHERE type='table'"
    )}
    conn.close()
    assert "worlds" in tables
    assert "agents" in tables
    assert "posts" in tables
    assert "comments" in tables
    assert "reactions" in tables
    assert "events" in tables
    assert "shadow_entries" in tables


def test_create_and_get_world(tmp_path):
    db_path = tmp_path / "test.db"
    init_db(db_path)
    world_id = create_world(
        db_path,
        session_key="session-1",
        topic_id="ai-intro",
        topic_title="AI 入门",
    )
    world = get_world(db_path, world_id)
    assert world["world_id"] == world_id
    assert world["topic_id"] == "ai-intro"
    assert world["status"] == "active"
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd "/Users/xiejiachen/Documents/New project/knowledge-feed-learning/server/colearning"
python3 -m pytest test_db.py -v
```

Expected: `ModuleNotFoundError: No module named 'db'`.

- [ ] **Step 3: Implement DB module**

Create `server/colearning/db.py`:

```python
"""SQLite persistence for the co-learning engine."""

import json
import sqlite3
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

SCHEMA = """
CREATE TABLE IF NOT EXISTS worlds (
    world_id TEXT PRIMARY KEY,
    session_key TEXT NOT NULL,
    topic_id TEXT NOT NULL,
    topic_title TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'active',
    current_concept_id TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS agents (
    agent_id TEXT PRIMARY KEY,
    world_id TEXT NOT NULL REFERENCES worlds(world_id) ON DELETE CASCADE,
    display_name TEXT NOT NULL,
    handle TEXT NOT NULL,
    bio TEXT NOT NULL,
    persona_json TEXT NOT NULL,
    voice_tags TEXT NOT NULL,
    community_edges_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS posts (
    post_id TEXT PRIMARY KEY,
    world_id TEXT NOT NULL REFERENCES worlds(world_id) ON DELETE CASCADE,
    concept_id TEXT NOT NULL,
    agent_id TEXT REFERENCES agents(agent_id) ON DELETE SET NULL,
    shadow_entry_id TEXT,
    content TEXT NOT NULL,
    stance TEXT NOT NULL,
    heat INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS comments (
    comment_id TEXT PRIMARY KEY,
    post_id TEXT NOT NULL REFERENCES posts(post_id) ON DELETE CASCADE,
    parent_comment_id TEXT REFERENCES comments(comment_id) ON DELETE CASCADE,
    agent_id TEXT REFERENCES agents(agent_id) ON DELETE SET NULL,
    content TEXT NOT NULL,
    stance TEXT NOT NULL,
    relation TEXT NOT NULL,
    heat INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS reactions (
    reaction_id TEXT PRIMARY KEY,
    target_type TEXT NOT NULL CHECK(target_type IN ('post', 'comment')),
    target_id TEXT NOT NULL,
    agent_id TEXT NOT NULL REFERENCES agents(agent_id) ON DELETE CASCADE,
    reaction_type TEXT NOT NULL CHECK(reaction_type IN ('like', 'dislike')),
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS events (
    event_id INTEGER PRIMARY KEY AUTOINCREMENT,
    world_id TEXT NOT NULL REFERENCES worlds(world_id) ON DELETE CASCADE,
    round INTEGER NOT NULL,
    phase TEXT,
    agent_id TEXT REFERENCES agents(agent_id) ON DELETE SET NULL,
    action TEXT NOT NULL,
    payload_json TEXT NOT NULL,
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS shadow_entries (
    entry_id TEXT PRIMARY KEY,
    world_id TEXT NOT NULL REFERENCES worlds(world_id) ON DELETE CASCADE,
    concept_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    content TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'live',
    created_at TEXT NOT NULL
);
"""


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def init_db(db_path: Path) -> None:
    db_path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(db_path)
    try:
        conn.executescript(SCHEMA)
        conn.commit()
    finally:
        conn.close()


def row_to_dict(cursor, row) -> dict[str, Any]:
    return {col[0]: row[idx] for idx, col in enumerate(cursor.description)}


def create_world(
    db_path: Path,
    session_key: str,
    topic_id: str,
    topic_title: str,
    current_concept_id: str | None = None,
) -> str:
    world_id = str(uuid.uuid4())
    ts = now_iso()
    conn = sqlite3.connect(db_path)
    try:
        conn.execute(
            """
            INSERT INTO worlds (world_id, session_key, topic_id, topic_title, status, current_concept_id, created_at, updated_at)
            VALUES (?, ?, ?, ?, 'active', ?, ?, ?)
            """,
            (world_id, session_key, topic_id, topic_title, current_concept_id, ts, ts),
        )
        conn.commit()
    finally:
        conn.close()
    return world_id


def get_world(db_path: Path, world_id: str) -> dict[str, Any] | None:
    conn = sqlite3.connect(db_path)
    conn.row_factory = row_to_dict
    try:
        cur = conn.execute("SELECT * FROM worlds WHERE world_id = ?", (world_id,))
        return cur.fetchone()
    finally:
        conn.close()


def list_worlds(db_path: Path, session_key: str) -> list[dict[str, Any]]:
    conn = sqlite3.connect(db_path)
    conn.row_factory = row_to_dict
    try:
        cur = conn.execute(
            "SELECT * FROM worlds WHERE session_key = ? ORDER BY updated_at DESC",
            (session_key,),
        )
        return cur.fetchall()
    finally:
        conn.close()
```

- [ ] **Step 4: Run tests**

```bash
cd "/Users/xiejiachen/Documents/New project/knowledge-feed-learning/server/colearning"
python3 -m pytest test_db.py -v
```

Expected: 2 tests pass.

- [ ] **Step 5: Commit**

```bash
cd "/Users/xiejiachen/Documents/New project/knowledge-feed-learning"
git add server/colearning/__init__.py server/colearning/requirements.txt server/colearning/.gitignore server/colearning/db.py server/colearning/test_db.py
git commit -m "feat(colearning): bootstrap Python package and SQLite schema"
```

---

### Task 3: Pydantic API models

**Files:**
- Create: `server/colearning/models.py`
- Test: `server/colearning/test_models.py`

- [ ] **Step 1: Write models and tests together**

Create `server/colearning/models.py`:

```python
"""Pydantic models for API requests/responses."""

from pydantic import BaseModel, Field


class CreateWorldRequest(BaseModel):
    session_key: str = Field(min_length=1)
    topic_id: str = Field(min_length=1)
    topic_title: str = Field(min_length=1)
    current_concept_id: str | None = None
    concept_title: str | None = None


class AgentOut(BaseModel):
    agent_id: str
    display_name: str
    handle: str
    bio: str


class CreateWorldResponse(BaseModel):
    world_id: str
    agents: list[AgentOut]


class FeedPostOut(BaseModel):
    post_id: str
    concept_id: str
    agent_id: str | None = None
    author: AgentOut | None = None
    content: str
    stance: str
    heat: int
    comment_count: int
    like_count: int
    dislike_count: int
    created_at: str


class FeedResponse(BaseModel):
    world_id: str
    concept_id: str
    posts: list[FeedPostOut]


class CommentOut(BaseModel):
    comment_id: str
    parent_comment_id: str | None = None
    agent_id: str | None = None
    author: AgentOut | None = None
    content: str
    stance: str
    relation: str
    heat: int
    like_count: int
    dislike_count: int
    created_at: str
    replies: list["CommentOut"] = []


class PostDetailResponse(BaseModel):
    post_id: str
    concept_id: str
    agent_id: str | None = None
    author: AgentOut | None = None
    content: str
    stance: str
    heat: int
    like_count: int
    dislike_count: int
    created_at: str
    comments: list[CommentOut]


class ShadowEntryRequest(BaseModel):
    concept_id: str
    user_id: str
    content: str = Field(min_length=1, max_length=4000)


class ShadowEntryResponse(BaseModel):
    entry_id: str
    status: str


class AdvanceRequest(BaseModel):
    concept_id: str | None = None
    concept_title: str | None = None
    lesson_snippet: str | None = None


class StatusResponse(BaseModel):
    world_id: str
    topic_id: str
    current_concept_id: str | None = None
    status: str
    agent_count: int
    post_count: int
    comment_count: int
```

- [ ] **Step 2: Run validation smoke test**

Create `server/colearning/test_models.py`:

```python
from models import CreateWorldRequest, FeedPostOut, AgentOut


def test_create_world_request_validates():
    req = CreateWorldRequest(session_key="s1", topic_id="t1", topic_title="T1")
    assert req.topic_id == "t1"


def test_feed_post_out():
    author = AgentOut(agent_id="a1", display_name="Data Guy", handle="@data_guy", bio="likes sources")
    post = FeedPostOut(
        post_id="p1",
        concept_id="c1",
        agent_id="a1",
        author=author,
        content="test",
        stance="doubt",
        heat=12,
        comment_count=3,
        like_count=5,
        dislike_count=1,
        created_at="2026-07-16T00:00:00+00:00",
    )
    assert post.heat == 12
```

Run:

```bash
cd "/Users/xiejiachen/Documents/New project/knowledge-feed-learning/server/colearning"
python3 -m pytest test_models.py -v
```

Expected: 2 tests pass.

- [ ] **Step 3: Commit**

```bash
cd "/Users/xiejiachen/Documents/New project/knowledge-feed-learning"
git add server/colearning/models.py server/colearning/test_models.py
git commit -m "feat(colearning): add Pydantic API models"
```

---

### Task 4: Generate Reddit-style agent personas

**Files:**
- Create: `server/colearning/personas.py`
- Test: `server/colearning/test_personas.py`

- [ ] **Step 1: Implement persona generator**

Create `server/colearning/personas.py`:

```python
"""Generate Reddit-style agent personas for a learning community."""

import json
import random
import uuid
from dataclasses import dataclass


@dataclass(frozen=True)
class Persona:
    agent_id: str
    display_name: str
    handle: str
    bio: str
    age: int
    role: str
    background: str
    voice: str
    traits: list[str]
    concern: str
    habit: str
    catchphrase: str

    def to_prompt(self) -> str:
        return (
            f"你是 @{self.handle}，{self.age}岁，{self.role}。\n"
            f"背景：{self.background}\n"
            f"语气：{self.voice}\n"
            f"性格：{', '.join(self.traits)}\n"
            f"关心角度：{self.concern}\n"
            f"社区习惯：{self.habit}\n"
            f"口头禅：{self.catchphrase}\n"
            "你正在一个学习 subreddit 里浏览帖子，会像真实网友一样轻松随意地发言。"
        )

    def to_json(self) -> dict:
        return {
            "agent_id": self.agent_id,
            "display_name": self.display_name,
            "handle": self.handle,
            "bio": self.bio,
            "age": self.age,
            "role": self.role,
            "background": self.background,
            "voice": self.voice,
            "traits": self.traits,
            "concern": self.concern,
            "habit": self.habit,
            "catchphrase": self.catchphrase,
        }


NAMES = [
    ("data_guy", "资料哥"),
    ("skeptic_99", "怀疑论者99"),
    ("analogy_king", "类比狂魔"),
    ("pm_xiao", "产品小X"),
    ("code_farmer", "码农老张"),
    ("newbie_asker", "萌新提问"),
    ("case_mover", "案例搬运工"),
    ("hot_take_lu", "热评路过"),
    ("tl_dr", "省流君"),
    ("cautious_cat", "谨慎猫"),
    ("joke_dev", "段子手Dev"),
    ("history_buff", "历史爱好者"),
]

ROLES = [
    "研究生", "转行产品经理", "自学爱好者", "前端工程师", "大四学生",
    "刚入行的分析师", "退休教师", "自由职业者", "运营", "设计师"
]

BACKGROUNDS = [
    "对这个领域完全外行，但最近工作需要不得不学",
    "看过几篇热门文章，觉得自己懂了，实际一用就懵",
    "有相关工作经验，喜欢挑概念里的坑",
    "纯兴趣驱动，喜欢看热闹和段子",
    "正在准备面试，只想快速抓到考点",
    "之前学过旧版本，对新变化很敏感",
]

VOICES = [
    "简短直接，偶尔毒舌",
    "喜欢长篇大论，爱分段",
    "爱打比方，把复杂概念说成生活场景",
    "爱甩链接和资料，但不说人话",
    "谨小慎微，每句话都带限定词",
    "乐观热心，喜欢鼓励新人",
    "悲观但务实，专泼冷水",
    "段子手，喜欢开玩笑和用梗",
]

TRAITS_POOL = ["谨慎", "冲动", "乐观", "悲观", "好奇", "固执", "幽默", "较真", "随和", "杠精"]

CONCERNS = [
    "实际应用和落地成本",
    "理论原理和边界条件",
    "就业前景和面试考点",
    "历史发展和常见误区",
    "社会影响和伦理争议",
    "普通人怎么快速入门",
]

HABITS = [
    "爱发“省流”总结",
    "只回帖不发帖",
    "喜欢追问“source?”",
    "爱拿自己的失败案例出来讲",
    "经常歪楼再被人拉回来",
    "热衷于投票和站队",
]

CATCHPHRASES = [
    "先别急着下结论", "我有个反例", "说人话就是", "这题我熟",
    "资料呢？", "省流：", "这不是常识吗", "我踩过这个坑", "扯远了",
]


def generate_personas(topic: str, count: int = 30, rng: random.Random | None = None) -> list[Persona]:
    """Generate 20-50 Reddit-style learners for one topic world."""
    count = max(20, min(50, count))
    rng = rng or random.Random()
    selected_names = []
    pool = NAMES[:]
    rng.shuffle(pool)
    while len(selected_names) < count:
        selected_names.extend(pool)
    selected_names = selected_names[:count]
    personas: list[Persona] = []
    for idx, (username, display_name) in enumerate(selected_names):
        personas.append(Persona(
            agent_id=str(uuid.uuid4()),
            display_name=f"{display_name}-{rng.randint(1, 99)}" if idx >= len(NAMES) else display_name,
            handle=f"{username}_{rng.randint(1, 99)}" if idx >= len(NAMES) else username,
            bio=rng.choice(BACKGROUNDS),
            age=rng.randint(20, 55),
            role=rng.choice(ROLES),
            background=rng.choice(BACKGROUNDS),
            voice=rng.choice(VOICES),
            traits=rng.sample(TRAITS_POOL, k=rng.randint(2, 4)),
            concern=rng.choice(CONCERNS),
            habit=rng.choice(HABITS),
            catchphrase=rng.choice(CATCHPHRASES),
        ))
    return personas
```

- [ ] **Step 2: Add test**

Create `server/colearning/test_personas.py`:

```python
from personas import generate_personas


def test_generate_personas_count():
    personas = generate_personas("AI 入门", count=25)
    assert len(personas) == 25
    assert len({p.handle for p in personas}) == 25
    assert all(p.to_prompt() for p in personas)
```

Run:

```bash
cd "/Users/xiejiachen/Documents/New project/knowledge-feed-learning/server/colearning"
python3 -m pytest test_personas.py -v
```

Expected: 1 test passes.

- [ ] **Step 3: Commit**

```bash
cd "/Users/xiejiachen/Documents/New project/knowledge-feed-learning"
git add server/colearning/personas.py server/colearning/test_personas.py
git commit -m "feat(colearning): generate Reddit-style agent personas"
```

---

### Task 5: LLM client and prompt builder

**Files:**
- Create: `server/colearning/llm.py`

- [ ] **Step 1: Implement LLM client**

Create `server/colearning/llm.py`:

```python
"""LLM client and prompt building for agent actions."""

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
        response = await client.post(
            f"{base_url()}/api/generate",
            json={"model": os.environ.get("LLM_MODEL", "gpt-4.1-mini"), "temperature": temperature, "messages": messages},
        )
        response.raise_for_status()
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
        lines.append(f"- [{item['author']}] {item['content'][:200]}")
    lines.append("""
请选择一个动作，用 JSON 输出：
{"action": "create_post", "content": "...", "stance": "doubt"}
或 {"action": "create_comment", "post_id": "...", "content": "...", "stance": "oppose", "relation": "refute"}
或 {"action": "like", "target_type": "post", "target_id": "..."}
或 {"action": "dislike", "target_type": "comment", "target_id": "..."}
或 {"action": "do_nothing"}

要求：
- 像真实 Reddit 网友一样轻松随意，可以讲个人经验、开玩笑、适度歪楼，但要围绕当前知识点。
- 不要纯附和，不要看起来像 AI 生成的模板。
- 观点可以不同意，也可以追问或补充，允许温和的抬杠。
- 资料引用不强制；提到研究简报或微课片段时，用自己的话概括，不要整段复制。
- 内容控制在 300 字以内。
""")
    return "\n".join(lines)
```

- [ ] **Step 2: Smoke test**

Create `server/colearning/test_llm.py`:

```python
import pytest
from personas import generate_personas
from llm import build_observation_text


def test_build_observation_text():
    persona = generate_personas("AI 入门", count=1)[0]
    text = build_observation_text({
        "topic_title": "AI 入门",
        "concept_title": "大模型是什么",
        "lesson_snippet": "大模型通过海量文本学习模式",
        "community_notes": "你常反驳 @data_guy",
        "recent_posts": [{"author": "@data_guy", "content": "大模型就是统计机器。"}],
    })
    assert "当前主题" in text
    assert "create_post" in text
    assert persona.display_name in persona.to_prompt()
```

Run:

```bash
cd "/Users/xiejiachen/Documents/New project/knowledge-feed-learning/server/colearning"
python3 -m pytest test_llm.py -v
```

Expected: 1 test passes.

- [ ] **Step 3: Commit**

```bash
cd "/Users/xiejiachen/Documents/New project/knowledge-feed-learning"
git add server/colearning/llm.py server/colearning/test_llm.py
git commit -m "feat(colearning): add LLM client and observation prompt"
```

---

### Task 6: Action execution and quality gates

**Files:**
- Create: `server/colearning/actions.py`
- Create: `server/colearning/quality.py`
- Test: `server/colearning/test_actions.py`

- [ ] **Step 1: Implement action executor**

Create `server/colearning/actions.py`:

```python
"""Execute agent actions against the SQLite database."""

import sqlite3
import uuid
from datetime import datetime, timezone
from pathlib import Path

from db import now_iso


def create_post(
    db_path: Path,
    world_id: str,
    concept_id: str,
    agent_id: str,
    content: str,
    stance: str,
) -> str:
    post_id = str(uuid.uuid4())
    conn = sqlite3.connect(db_path)
    try:
        conn.execute(
            "INSERT INTO posts (post_id, world_id, concept_id, agent_id, content, stance, heat, created_at) VALUES (?, ?, ?, ?, ?, ?, 0, ?)",
            (post_id, world_id, concept_id, agent_id, content, stance, now_iso()),
        )
        conn.commit()
    finally:
        conn.close()
    return post_id


def create_comment(
    db_path: Path,
    post_id: str,
    agent_id: str,
    content: str,
    stance: str,
    relation: str,
    parent_comment_id: str | None = None,
) -> str:
    comment_id = str(uuid.uuid4())
    conn = sqlite3.connect(db_path)
    try:
        conn.execute(
            "INSERT INTO comments (comment_id, post_id, parent_comment_id, agent_id, content, stance, relation, heat, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?)",
            (comment_id, post_id, parent_comment_id, agent_id, content, stance, relation, now_iso()),
        )
        conn.commit()
    finally:
        conn.close()
    return comment_id


def add_reaction(
    db_path: Path,
    target_type: str,
    target_id: str,
    agent_id: str,
    reaction_type: str,
) -> None:
    conn = sqlite3.connect(db_path)
    try:
        existing = conn.execute(
            "SELECT reaction_id FROM reactions WHERE target_type = ? AND target_id = ? AND agent_id = ?",
            (target_type, target_id, agent_id),
        ).fetchone()
        if existing:
            conn.execute(
                "UPDATE reactions SET reaction_type = ? WHERE reaction_id = ?",
                (reaction_type, existing[0]),
            )
        else:
            conn.execute(
                "INSERT INTO reactions (reaction_id, target_type, target_id, agent_id, reaction_type, created_at) VALUES (?, ?, ?, ?, ?, ?)",
                (str(uuid.uuid4()), target_type, target_id, agent_id, reaction_type, now_iso()),
            )
        _recalc_heat(conn, target_type, target_id)
        conn.commit()
    finally:
        conn.close()


def _recalc_heat(conn: sqlite3.Connection, target_type: str, target_id: str) -> None:
    likes = conn.execute(
        "SELECT COUNT(*) FROM reactions WHERE target_type = ? AND target_id = ? AND reaction_type = 'like'",
        (target_type, target_id),
    ).fetchone()[0]
    dislikes = conn.execute(
        "SELECT COUNT(*) FROM reactions WHERE target_type = ? AND target_id = ? AND reaction_type = 'dislike'",
        (target_type, target_id),
    ).fetchone()[0]
    heat = max(0, likes * 12 - dislikes * 8)
    table = "posts" if target_type == "post" else "comments"
    conn.execute(f"UPDATE {table} SET heat = ? WHERE {table[:-1]}_id = ?", (heat, target_id))
```

- [ ] **Step 2: Implement quality gates**

Create `server/colearning/quality.py`:

```python
"""Lightweight quality gates for generated content."""

import sqlite3
from pathlib import Path
from collections import Counter

SLOP_PHRASES = [
    "我同意", "说得好", "非常有道理", "完全赞同", "不错的观点",
    "interesting", "great point", "i agree", "well said",
]


def is_slop(content: str) -> bool:
    lowered = content.lower()
    return any(phrase in lowered for phrase in SLOP_PHRASES) and len(content) < 40


def has_substance(content: str) -> bool:
    return len(content.strip()) >= 8


def is_duplicate(db_path: Path, concept_id: str, content: str, threshold: int = 5) -> bool:
    """Reject exact or near-exact repeats within the same concept."""
    conn = sqlite3.connect(db_path)
    try:
        existing = conn.execute(
            "SELECT content FROM posts WHERE concept_id = ? UNION ALL SELECT content FROM comments c JOIN posts p ON c.post_id = p.post_id WHERE p.concept_id = ?",
            (concept_id, concept_id),
        ).fetchall()
    finally:
        conn.close()
    for (existing_content,) in existing:
        # Count shared bigrams as a cheap similarity metric
        a = set(ngrams(content, 2))
        b = set(ngrams(existing_content, 2))
        if len(a & b) >= threshold and len(a) > 0:
            return True
    return False


def ngrams(text: str, n: int = 2) -> list[tuple[str, ...]]:
    chars = list(text)
    return [tuple(chars[i:i + n]) for i in range(len(chars) - n + 1)]


def lacks_viewpoint_diversity(db_path: Path, concept_id: str, new_stance: str, min_stances: int = 2) -> bool:
    """Require at least two distinct stances among recent posts for a concept."""
    conn = sqlite3.connect(db_path)
    try:
        rows = conn.execute(
            "SELECT stance FROM posts WHERE concept_id = ? ORDER BY created_at DESC LIMIT 10",
            (concept_id,),
        ).fetchall()
    finally:
        conn.close()
    stances = {r[0] for r in rows}
    if len(stances) >= min_stances:
        return False
    return new_stance in stances


def passes_gate(db_path: Path, concept_id: str, content: str, stance: str) -> bool:
    return (
        has_substance(content)
        and not is_slop(content)
        and not is_duplicate(db_path, concept_id, content)
        and not lacks_viewpoint_diversity(db_path, concept_id, stance)
    )
```

- [ ] **Step 3: Add action tests**

Create `server/colearning/test_actions.py`:

```python
from pathlib import Path
from db import init_db, create_world
from actions import create_post, create_comment, add_reaction
from quality import passes_gate, is_slop, is_duplicate


def test_create_post_and_reaction(tmp_path):
    db_path = tmp_path / "test.db"
    init_db(db_path)
    world_id = create_world(db_path, "s1", "t1", "T1", "c1")
    post_id = create_post(db_path, world_id, "c1", "a1", "This is confusing", "doubt")
    add_reaction(db_path, "post", post_id, "a2", "like")
    conn = __import__("sqlite3").connect(db_path)
    heat = conn.execute("SELECT heat FROM posts WHERE post_id = ?", (post_id,)).fetchone()[0]
    conn.close()
    assert heat == 12


def test_quality_gate(tmp_path):
    db_path = tmp_path / "test.db"
    init_db(db_path)
    world_id = create_world(db_path, "s1", "t1", "T1", "c1")
    assert is_slop("我同意")
    assert not is_slop("我同意，但这里有个反例：上次我试的时候发现...")
    assert passes_gate(db_path, "c1", "大模型其实就是个高级补全器，别被名字吓到。", "support")
    # First post of a new stance should be allowed; repeat of first stance blocked until diversity exists.
    create_post(db_path, world_id, "c1", "a1", "大模型是统计机器", "support")
    assert passes_gate(db_path, "c1", "我不这么认为", "doubt")
    assert not passes_gate(db_path, "c1", "我也支持统计机器", "support")


def test_duplicate_detection(tmp_path):
    db_path = tmp_path / "test.db"
    init_db(db_path)
    world_id = create_world(db_path, "s1", "t1", "T1", "c1")
    create_post(db_path, world_id, "c1", "a1", "大模型就是统计机器", "support")
    assert is_duplicate(db_path, "c1", "大模型就是统计机器")
    assert not is_duplicate(db_path, "c1", "完全不同的观点")
```

Run:

```bash
cd "/Users/xiejiachen/Documents/New project/knowledge-feed-learning/server/colearning"
python3 -m pytest test_actions.py -v
```

Expected: 4 tests pass.

- [ ] **Step 4: Update scheduler to pass db_path and concept_id to passes_gate**

In `server/colearning/scheduler.py` (Task 7), replace calls to `passes_gate(content)` with:

```python
from quality import passes_gate

if passes_gate(self.db_path, concept_id, content, result.get("stance", "add")):
    # proceed to create_post / create_comment
```

- [ ] **Step 5: Commit**

```bash
cd "/Users/xiejiachen/Documents/New project/knowledge-feed-learning"
git add server/colearning/actions.py server/colearning/quality.py server/colearning/test_actions.py server/colearning/scheduler.py
git commit -m "feat(colearning): add action execution and quality gates"
```

---

### Task 7: Discussion scheduler

**Files:**
- Create: `server/colearning/scheduler.py`
- Test: `server/colearning/test_scheduler.py`

- [ ] **Step 1: Implement scheduler**

Create `server/colearning/scheduler.py`:

```python
"""Schedule and run discussion rounds."""

import asyncio
import random
import sqlite3
from pathlib import Path
from typing import Any

from actions import create_post, create_comment, add_reaction
from db import now_iso
from llm import generate_action
from quality import passes_gate


class Scheduler:
    def __init__(self, db_path: Path, max_concurrent_llm: int = 4):
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
                "SELECT agent_id, display_name, handle, persona_json FROM agents WHERE world_id = ?", (world_id,)
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
                SELECT c.comment_id, c.content, a.handle as author
                FROM comments c LEFT JOIN agents a ON c.agent_id = a.agent_id
                JOIN posts p ON c.post_id = p.post_id
                WHERE p.world_id = ? AND p.concept_id = ?
                ORDER BY c.created_at DESC LIMIT 12
                """,
                (world_id, concept_id),
            )]
        finally:
            conn.close()

        recent = [{"author": p["author"] or "unknown", "content": p["content"]} for p in recent_posts + recent_comments]
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
                if passes_gate(self.db_path, concept_id, content, stance) and result.get("post_id"):
                    create_comment(
                        self.db_path, result["post_id"], agent_id,
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
        persona = Persona(**{**agent["persona_json"], "agent_id": agent["agent_id"], "display_name": agent["display_name"], "handle": agent["handle"], "bio": agent["bio"]})
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
```

Note: `Persona(**{**agent["persona_json"], ...})` requires `persona_json` to contain the extra fields; we will store the full `Persona.to_json()` output there during world creation.

- [ ] **Step 2: Adjust db.py to store full persona JSON**

In `server/colearning/db.py`, ensure the helper to insert agents receives the full persona dict. Add:

```python
def insert_agent(db_path: Path, world_id: str, persona) -> None:
    conn = sqlite3.connect(db_path)
    try:
        conn.execute(
            """
            INSERT INTO agents (agent_id, world_id, display_name, handle, bio, persona_json, voice_tags, community_edges_json, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                persona.agent_id,
                world_id,
                persona.display_name,
                persona.handle,
                persona.bio,
                json.dumps(persona.to_json(), ensure_ascii=False),
                ", ".join(persona.traits),
                "{}",
                now_iso(),
            ),
        )
        conn.commit()
    finally:
        conn.close()
```

- [ ] **Step 3: Commit**

```bash
cd "/Users/xiejiachen/Documents/New project/knowledge-feed-learning"
git add server/colearning/scheduler.py server/colearning/db.py
git commit -m "feat(colearning): add discussion scheduler"
```

---

### Task 8: FastAPI routes

**Files:**
- Create: `server/colearning/main.py`
- Test: `server/colearning/test_main.py`

- [ ] **Step 1: Implement API**

Create `server/colearning/main.py`:

```python
"""FastAPI app for the co-learning engine."""

import json
import os
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware

from db import init_db, create_world, get_world, list_worlds, insert_agent
from models import (
    CreateWorldRequest,
    CreateWorldResponse,
    AgentOut,
    FeedResponse,
    FeedPostOut,
    PostDetailResponse,
    CommentOut,
    ShadowEntryRequest,
    ShadowEntryResponse,
    AdvanceRequest,
    StatusResponse,
)
from personas import generate_personas
from scheduler import Scheduler

DB_PATH = Path(os.environ.get("COLEARNING_DB_PATH", "./colearning.db"))


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db(DB_PATH)
    app.state.scheduler = Scheduler(DB_PATH)
    yield


app = FastAPI(title="KnowFeed Co-Learning Engine", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_methods=["*"],
    allow_headers=["*"],
)


def _agent_out(row: dict) -> AgentOut:
    return AgentOut(
        agent_id=row["agent_id"],
        display_name=row["display_name"],
        handle=row["handle"],
        bio=row["bio"],
    )


@app.post("/api/colearning/worlds", response_model=CreateWorldResponse)
async def create_world_endpoint(req: CreateWorldRequest):
    world_id = create_world(
        DB_PATH,
        req.session_key,
        req.topic_id,
        req.topic_title,
        req.current_concept_id,
    )
    personas = generate_personas(req.topic_title, count=25)
    for persona in personas:
        insert_agent(DB_PATH, world_id, persona)

    # Seed initial posts for the current concept
    scheduler: Scheduler = app.state.scheduler
    await scheduler.advance(
        world_id,
        req.topic_title,
        req.current_concept_id or "concept-1",
        req.concept_title or req.topic_title,
        personas,
        lesson_snippet=None,
    )

    agents = [{"agent_id": p.agent_id, "display_name": p.display_name, "handle": p.handle, "bio": p.bio} for p in personas[:8]]
    return CreateWorldResponse(world_id=world_id, agents=[_agent_out(a) for a in agents])


@app.get("/api/colearning/worlds/{world_id}/feed", response_model=FeedResponse)
async def get_feed(world_id: str, concept_id: str | None = None):
    import sqlite3
    world = get_world(DB_PATH, world_id)
    if not world:
        raise HTTPException(status_code=404, detail="World not found")
    target_concept = concept_id or world["current_concept_id"]
    if not target_concept:
        raise HTTPException(status_code=400, detail="No concept specified")

    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    try:
        rows = conn.execute(
            """
            SELECT p.*, a.display_name, a.handle, a.bio,
                   (SELECT COUNT(*) FROM comments WHERE post_id = p.post_id) as comment_count,
                   (SELECT COUNT(*) FROM reactions WHERE target_type = 'post' AND target_id = p.post_id AND reaction_type = 'like') as like_count,
                   (SELECT COUNT(*) FROM reactions WHERE target_type = 'post' AND target_id = p.post_id AND reaction_type = 'dislike') as dislike_count
            FROM posts p
            LEFT JOIN agents a ON p.agent_id = a.agent_id
            WHERE p.world_id = ? AND p.concept_id = ?
            ORDER BY p.heat DESC, p.created_at DESC
            """,
            (world_id, target_concept),
        ).fetchall()
    finally:
        conn.close()

    posts = []
    for row in rows:
        author = None
        if row["agent_id"]:
            author = AgentOut(agent_id=row["agent_id"], display_name=row["display_name"], handle=row["handle"], bio=row["bio"])
        posts.append(FeedPostOut(
            post_id=row["post_id"],
            concept_id=row["concept_id"],
            agent_id=row["agent_id"],
            author=author,
            content=row["content"],
            stance=row["stance"],
            heat=row["heat"],
            comment_count=row["comment_count"],
            like_count=row["like_count"],
            dislike_count=row["dislike_count"],
            created_at=row["created_at"],
        ))
    return FeedResponse(world_id=world_id, concept_id=target_concept, posts=posts)


@app.get("/api/colearning/posts/{post_id}", response_model=PostDetailResponse)
async def get_post(post_id: str):
    import sqlite3
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    try:
        post_row = conn.execute(
            """
            SELECT p.*, a.display_name, a.handle, a.bio,
                   (SELECT COUNT(*) FROM reactions WHERE target_type = 'post' AND target_id = p.post_id AND reaction_type = 'like') as like_count,
                   (SELECT COUNT(*) FROM reactions WHERE target_type = 'post' AND target_id = p.post_id AND reaction_type = 'dislike') as dislike_count
            FROM posts p LEFT JOIN agents a ON p.agent_id = a.agent_id
            WHERE p.post_id = ?
            """,
            (post_id,),
        ).fetchone()
        if not post_row:
            raise HTTPException(status_code=404, detail="Post not found")

        comment_rows = conn.execute(
            """
            SELECT c.*, a.display_name, a.handle, a.bio,
                   (SELECT COUNT(*) FROM reactions WHERE target_type = 'comment' AND target_id = c.comment_id AND reaction_type = 'like') as like_count,
                   (SELECT COUNT(*) FROM reactions WHERE target_type = 'comment' AND target_id = c.comment_id AND reaction_type = 'dislike') as dislike_count
            FROM comments c LEFT JOIN agents a ON c.agent_id = a.agent_id
            WHERE c.post_id = ?
            ORDER BY c.heat DESC, c.created_at ASC
            """,
            (post_id,),
        ).fetchall()
    finally:
        conn.close()

    def build_comment(row):
        author = None
        if row["agent_id"]:
            author = AgentOut(agent_id=row["agent_id"], display_name=row["display_name"], handle=row["handle"], bio=row["bio"])
        return CommentOut(
            comment_id=row["comment_id"],
            parent_comment_id=row["parent_comment_id"],
            agent_id=row["agent_id"],
            author=author,
            content=row["content"],
            stance=row["stance"],
            relation=row["relation"],
            heat=row["heat"],
            like_count=row["like_count"],
            dislike_count=row["dislike_count"],
            created_at=row["created_at"],
            replies=[],
        )

    comment_map = {row["comment_id"]: build_comment(row) for row in comment_rows}
    top_level = []
    for c in comment_map.values():
        if c.parent_comment_id and c.parent_comment_id in comment_map:
            comment_map[c.parent_comment_id].replies.append(c)
        else:
            top_level.append(c)

    post_author = None
    if post_row["agent_id"]:
        post_author = AgentOut(agent_id=post_row["agent_id"], display_name=post_row["display_name"], handle=post_row["handle"], bio=post_row["bio"])
    return PostDetailResponse(
        post_id=post_row["post_id"],
        concept_id=post_row["concept_id"],
        agent_id=post_row["agent_id"],
        author=post_author,
        content=post_row["content"],
        stance=post_row["stance"],
        heat=post_row["heat"],
        like_count=post_row["like_count"],
        dislike_count=post_row["dislike_count"],
        created_at=post_row["created_at"],
        comments=top_level,
    )


@app.post("/api/colearning/worlds/{world_id}/shadow", response_model=ShadowEntryResponse)
async def submit_shadow(world_id: str, req: ShadowEntryRequest):
    import sqlite3, uuid
    from db import now_iso
    entry_id = str(uuid.uuid4())
    conn = sqlite3.connect(DB_PATH)
    try:
        conn.execute(
            "INSERT INTO shadow_entries (entry_id, world_id, concept_id, user_id, content, status, created_at) VALUES (?, ?, ?, ?, ?, 'live', ?)",
            (entry_id, world_id, req.concept_id, req.user_id, req.content, now_iso()),
        )
        conn.commit()
    finally:
        conn.close()
    return ShadowEntryResponse(entry_id=entry_id, status="live")


@app.post("/api/colearning/worlds/{world_id}/advance")
async def advance_world(world_id: str, req: AdvanceRequest):
    world = get_world(DB_PATH, world_id)
    if not world:
        raise HTTPException(status_code=404, detail="World not found")
    scheduler: Scheduler = app.state.scheduler
    result = await scheduler.advance(
        world_id,
        world["topic_title"],
        req.concept_id or world["current_concept_id"],
        req.concept_title or world["topic_title"],
        [],  # personas loaded inside scheduler from DB
        req.lesson_snippet,
    )
    return {"world_id": world_id, "created": result}


@app.get("/api/colearning/worlds/{world_id}/status", response_model=StatusResponse)
async def world_status(world_id: str):
    import sqlite3
    world = get_world(DB_PATH, world_id)
    if not world:
        raise HTTPException(status_code=404, detail="World not found")
    conn = sqlite3.connect(DB_PATH)
    try:
        agent_count = conn.execute("SELECT COUNT(*) FROM agents WHERE world_id = ?", (world_id,)).fetchone()[0]
        post_count = conn.execute("SELECT COUNT(*) FROM posts WHERE world_id = ?", (world_id,)).fetchone()[0]
        comment_count = conn.execute(
            "SELECT COUNT(*) FROM comments WHERE post_id IN (SELECT post_id FROM posts WHERE world_id = ?)",
            (world_id,),
        ).fetchone()[0]
    finally:
        conn.close()
    return StatusResponse(
        world_id=world_id,
        topic_id=world["topic_id"],
        current_concept_id=world["current_concept_id"],
        status=world["status"],
        agent_count=agent_count,
        post_count=post_count,
        comment_count=comment_count,
    )
```

- [ ] **Step 2: Run backend server smoke test**

```bash
cd "/Users/xiejiachen/Documents/New project/knowledge-feed-learning/server/colearning"
source .venv/bin/activate
uvicorn main:app --reload --port 8788 &
SERVER_PID=$!
sleep 2
curl -s -X POST http://127.0.0.1:8788/api/colearning/worlds \
  -H "content-type: application/json" \
  -d '{"session_key":"s1","topic_id":"ai","topic_title":"AI 入门","current_concept_id":"c1","concept_title":"大模型是什么"}' | python3 -m json.tool
kill $SERVER_PID
```

Expected: JSON response with `world_id` and `agents` array.

- [ ] **Step 3: Commit**

```bash
cd "/Users/xiejiachen/Documents/New project/knowledge-feed-learning"
git add server/colearning/main.py
git commit -m "feat(colearning): add FastAPI routes"
```

---

### Task 9: Integrate Python service into Node proxy

**Files:**
- Modify: `server/llm-proxy.mjs`

- [ ] **Step 1: Add colearning service spawn logic**

Add near the top of `server/llm-proxy.mjs` after imports:

```javascript
const colearningPort = Number(process.env.COLEARNING_PORT ?? 8788);
let colearningProcess = null;
```

Add a function to spawn the Python service:

```javascript
function startColearningService() {
  if (colearningProcess) return;
  const backendPath = resolve(process.cwd());
  const servicePath = resolve(process.cwd(), "server/colearning/main.py");
  if (!existsSync(servicePath)) {
    console.warn("Co-learning service not found, /api/colearning routes will be unavailable");
    return;
  }
  const env = {
    ...process.env,
    COLEARNING_DB_PATH: resolve(process.cwd(), "server/colearning/colearning.db"),
    LLM_BASE_URL: `http://127.0.0.1:${port}`,
  };
  colearningProcess = spawn("uv", ["run", "python", servicePath], {
    cwd: resolve(process.cwd(), "server/colearning"),
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  colearningProcess.stdout.on("data", (chunk) => {
    console.log(`[colearning] ${chunk}`.trimEnd());
  });
  colearningProcess.stderr.on("data", (chunk) => {
    console.error(`[colearning] ${chunk}`.trimEnd());
  });
  colearningProcess.on("close", (code) => {
    console.warn(`Co-learning service exited with code ${code}`);
    colearningProcess = null;
  });
}
```

- [ ] **Step 2: Add proxy routes**

Inside the request handler in `server/llm-proxy.mjs`, add before the 404 check:

```javascript
if (request.url === "/api/colearning/health" && request.method === "GET") {
  sendJson(response, 200, { status: colearningProcess ? "up" : "down" }, request);
  return;
}

if (request.url?.startsWith("/api/colearning/")) {
  if (!colearningProcess) {
    sendJson(response, 503, { error: "Co-learning service is not running" }, request);
    return;
  }
  try {
    const body = request.method === "GET" ? undefined : await readBody(request);
    const targetUrl = `http://127.0.0.1:${colearningPort}${request.url}`;
    const upstreamResponse = await fetchWithTimeout(
      targetUrl,
      {
        method: request.method,
        headers: body ? { "content-type": "application/json" } : undefined,
        body,
      },
      { timeoutMs: 90_000, label: "colearning service" },
    );
    const upstreamText = await upstreamResponse.text();
    response.writeHead(upstreamResponse.status, {
      "content-type": upstreamResponse.headers.get("content-type") || "application/json",
      ...corsHeadersFor(request),
    });
    response.end(upstreamText);
  } catch (error) {
    const timedOut = isProxyTimeoutError(error);
    sendJson(response, timedOut ? 504 : 502, { error: timedOut ? "Co-learning service timed out" : "Co-learning proxy failed" }, request);
  }
  return;
}
```

- [ ] **Step 3: Start service on server startup**

In the `server.listen` callback at the bottom:

```javascript
server.listen(port, "127.0.0.1", () => {
  console.log(`KnowFeed LLM proxy listening on http://127.0.0.1:${port}`);
  startColearningService();
});
```

- [ ] **Step 4: Verify proxy**

Start the Node proxy:

```bash
cd "/Users/xiejiachen/Documents/New project/knowledge-feed-learning"
node server/llm-proxy.mjs &
PROXY_PID=$!
sleep 3
curl -s http://127.0.0.1:8787/api/colearning/health | python3 -m json.tool
kill $PROXY_PID
```

Expected: `{"status":"up"}`.

- [ ] **Step 5: Commit**

```bash
cd "/Users/xiejiachen/Documents/New project/knowledge-feed-learning"
git add server/llm-proxy.mjs
git commit -m "feat(proxy): spawn and forward colearning Python service"
```

---

### Task 10: Frontend types and API client

**Files:**
- Modify: `src/domain/types.ts`
- Create: `src/domain/colearning.ts`

- [ ] **Step 1: Add TypeScript types**

Append to `src/domain/types.ts`:

```typescript
export interface ColearningAgent {
  agentId: string;
  displayName: string;
  handle: string;
  bio: string;
}

export interface ColearningPost {
  postId: string;
  conceptId: string;
  agentId: string | null;
  author: ColearningAgent | null;
  content: string;
  stance: string;
  heat: number;
  commentCount: number;
  likeCount: number;
  dislikeCount: number;
  createdAt: string;
}

export interface ColearningComment {
  commentId: string;
  parentCommentId: string | null;
  agentId: string | null;
  author: ColearningAgent | null;
  content: string;
  stance: string;
  relation: string;
  heat: number;
  likeCount: number;
  dislikeCount: number;
  createdAt: string;
  replies: ColearningComment[];
}

export interface ColearningWorld {
  worldId: string;
  agents: ColearningAgent[];
}
```

- [ ] **Step 2: Create API client**

Create `src/domain/colearning.ts`:

```typescript
import type { ColearningWorld, ColearningPost, ColearningComment } from "./types";

export async function createColearningWorld(
  sessionKey: string,
  topicId: string,
  topicTitle: string,
  currentConceptId: string,
  conceptTitle: string,
): Promise<ColearningWorld> {
  const response = await fetch("/api/colearning/worlds", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ session_key: sessionKey, topic_id: topicId, topic_title: topicTitle, current_concept_id: currentConceptId, concept_title: conceptTitle }),
  });
  if (!response.ok) throw new Error("Failed to create co-learning world");
  const payload = await response.json();
  return {
    worldId: payload.world_id,
    agents: payload.agents.map((a: any) => ({
      agentId: a.agent_id,
      displayName: a.display_name,
      handle: a.handle,
      bio: a.bio,
    })),
  };
}

export async function fetchColearningFeed(worldId: string, conceptId: string): Promise<{ conceptId: string; posts: ColearningPost[] }> {
  const response = await fetch(`/api/colearning/worlds/${encodeURIComponent(worldId)}/feed?concept_id=${encodeURIComponent(conceptId)}`);
  if (!response.ok) throw new Error("Failed to fetch co-learning feed");
  const payload = await response.json();
  return {
    conceptId: payload.concept_id,
    posts: payload.posts.map((p: any) => ({
      postId: p.post_id,
      conceptId: p.concept_id,
      agentId: p.agent_id,
      author: p.author ? { agentId: p.author.agent_id, displayName: p.author.display_name, handle: p.author.handle, bio: p.author.bio } : null,
      content: p.content,
      stance: p.stance,
      heat: p.heat,
      commentCount: p.comment_count,
      likeCount: p.like_count,
      dislikeCount: p.dislike_count,
      createdAt: p.created_at,
    })),
  };
}

export async function fetchColearningPost(postId: string): Promise<{ post: ColearningPost; comments: ColearningComment[] }> {
  const response = await fetch(`/api/colearning/posts/${encodeURIComponent(postId)}`);
  if (!response.ok) throw new Error("Failed to fetch co-learning post");
  const payload = await response.json();
  const mapComment = (c: any): ColearningComment => ({
    commentId: c.comment_id,
    parentCommentId: c.parent_comment_id,
    agentId: c.agent_id,
    author: c.author ? { agentId: c.author.agent_id, displayName: c.author.display_name, handle: c.author.handle, bio: c.author.bio } : null,
    content: c.content,
    stance: c.stance,
    relation: c.relation,
    heat: c.heat,
    likeCount: c.like_count,
    dislikeCount: c.dislike_count,
    createdAt: c.created_at,
    replies: (c.replies ?? []).map(mapComment),
  });
  return {
    post: {
      postId: payload.post_id,
      conceptId: payload.concept_id,
      agentId: payload.agent_id,
      author: payload.author ? { agentId: payload.author.agent_id, displayName: payload.author.display_name, handle: payload.author.handle, bio: payload.author.bio } : null,
      content: payload.content,
      stance: payload.stance,
      heat: payload.heat,
      commentCount: payload.comments.length,
      likeCount: payload.like_count,
      dislikeCount: payload.dislike_count,
      createdAt: payload.created_at,
    },
    comments: payload.comments.map(mapComment),
  };
}

export async function submitShadowEntry(worldId: string, conceptId: string, userId: string, content: string): Promise<void> {
  const response = await fetch(`/api/colearning/worlds/${encodeURIComponent(worldId)}/shadow`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ concept_id: conceptId, user_id: userId, content }),
  });
  if (!response.ok) throw new Error("Failed to submit shadow entry");
}

export async function advanceColearningWorld(worldId: string, conceptId: string, conceptTitle: string, lessonSnippet?: string): Promise<void> {
  const response = await fetch(`/api/colearning/worlds/${encodeURIComponent(worldId)}/advance`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ concept_id: conceptId, concept_title: conceptTitle, lesson_snippet: lessonSnippet }),
  });
  if (!response.ok) throw new Error("Failed to advance co-learning world");
}
```

- [ ] **Step 3: Commit**

```bash
cd "/Users/xiejiachen/Documents/New project/knowledge-feed-learning"
git add src/domain/types.ts src/domain/colearning.ts
git commit -m "feat(colearning): add frontend types and API client"
```

---

### Task 11: Wire world creation into App.tsx

**Files:**
- Modify: `src/App.tsx`
- Modify: `src/domain/storage.ts` (add `colearningWorldId` to AppState)

- [ ] **Step 1: Extend AppState**

In `src/domain/types.ts` (already modified), ensure `AppState` has:

```typescript
export interface AppState {
  topicProfile?: TopicProfile;
  learnerProfile?: LearnerProfile;
  researchBrief?: ResearchBrief;
  curriculum?: ValidatedCurriculum;
  progress: ProgressState;
  shadowDrafts: ShadowDraft[];
  approvedShadowPosts: ShadowDraft[];
  postReplies: Record<string, LocalReply[]>;
  colearningWorldId?: string;
}
```

In `src/domain/storage.ts`, update `defaultAppState`:

```typescript
export const defaultAppState: AppState = {
  progress: { ... },
  shadowDrafts: [],
  approvedShadowPosts: [],
  postReplies: {},
  colearningWorldId: undefined,
};
```

- [ ] **Step 2: Create world after curriculum validation**

In `src/App.tsx`, locate where the curriculum is first set (likely after onboarding/planner). Add:

```typescript
import { createColearningWorld } from "./domain/colearning";

// inside the handler that receives a new ValidatedCurriculum:
const world = await createColearningWorld(
  sessionKey,
  curriculum.topic.topicId,
  curriculum.topic.title,
  firstConceptId,
  firstConceptTitle,
);
setAppState((prev) => ({
  ...prev,
  curriculum,
  colearningWorldId: world.worldId,
}));
```

`sessionKey` can be a stable string derived from `topicId` + a browser fingerprint or simply `topicId` for the prototype.

- [ ] **Step 3: Commit**

```bash
cd "/Users/xiejiachen/Documents/New project/knowledge-feed-learning"
git add src/App.tsx src/domain/storage.ts src/domain/types.ts
git commit -m "feat(colearning): create world on curriculum start"
```

---

### Task 12: Render colearning feed in HomeFeed

**Files:**
- Modify: `src/components/HomeFeed.tsx`

- [ ] **Step 1: Load colearning feed**

In `src/components/HomeFeed.tsx`, replace the generated bundle source with:

```typescript
import { fetchColearningFeed } from "../domain/colearning";

// inside component:
const [colearningPosts, setColearningPosts] = useState<ColearningPost[]>([]);
const [feedLoading, setFeedLoading] = useState(false);

useEffect(() => {
  if (!appState.colearningWorldId || !activeConceptId) return;
  let cancelled = false;
  setFeedLoading(true);
  fetchColearningFeed(appState.colearningWorldId, activeConceptId)
    .then((result) => {
      if (!cancelled) setColearningPosts(result.posts);
    })
    .catch((error) => console.error("feed load failed", error))
    .finally(() => setFeedLoading(false));
  return () => { cancelled = true; };
}, [appState.colearningWorldId, activeConceptId]);
```

- [ ] **Step 2: Render posts**

Map `colearningPosts` to the existing post card UI. Use `post.author?.displayName ?? "你"` for the author name. Use `post.content` as the body. Use `post.commentCount` and `post.likeCount` for metrics.

Keep the existing fallback to `bundle.post` when `colearningPosts` is empty.

- [ ] **Step 3: Add presence badge**

Render near the top:

```tsx
<div className="presence-badge">
  {colearningPosts.length > 0 ? `${Math.min(50, colearningPosts.length * 3 + 8)} 人正在讨论这个知识点` : "加载社区中…"}
</div>
```

- [ ] **Step 4: Commit**

```bash
cd "/Users/xiejiachen/Documents/New project/knowledge-feed-learning"
git add src/components/HomeFeed.tsx
git commit -m "feat(colearning): render colearning feed and presence badge"
```

---

### Task 13: Render colearning comments in PostDetail

**Files:**
- Modify: `src/components/PostDetail.tsx`

- [ ] **Step 1: Load post detail from colearning**

Replace the bundle-based post detail load with:

```typescript
import { fetchColearningPost, submitShadowEntry } from "../domain/colearning";

const [post, setPost] = useState<ColearningPost | null>(null);
const [comments, setComments] = useState<ColearningComment[]>([]);

useEffect(() => {
  if (!postId || !appState.colearningWorldId) return;
  let cancelled = false;
  fetchColearningPost(postId)
    .then((result) => {
      if (!cancelled) {
        setPost(result.post);
        setComments(result.comments);
      }
    })
    .catch((error) => console.error("post load failed", error));
  return () => { cancelled = true; };
}, [postId, appState.colearningWorldId]);
```

- [ ] **Step 2: Render comment tree recursively**

Convert `ColearningComment` to the existing `FeedComment` shape or render directly. Example adapter:

```typescript
function toFeedComment(c: ColearningComment): FeedComment {
  return {
    id: c.commentId,
    author: c.author ? {
      id: c.author.agentId,
      displayName: c.author.displayName,
      handle: c.author.handle,
      role: c.author.bio,
      stance: mapStance(c.stance),
    } : {
      id: "user",
      displayName: "你",
      handle: "@you",
      role: "学习者",
      stance: "学习分身",
    },
    body: c.content,
    heat: c.heat,
    stance: mapStance(c.stance),
    replies: c.replies.map(toFeedComment),
  };
}
```

- [ ] **Step 3: Submit user replies as shadow entries**

When the user approves a reply, call:

```typescript
await submitShadowEntry(
  appState.colearningWorldId,
  activeConceptId,
  sessionKey,
  replyBody,
);
// then advance to trigger agent responses
await advanceColearningWorld(appState.colearningWorldId, activeConceptId, conceptTitle);
```

- [ ] **Step 4: Commit**

```bash
cd "/Users/xiejiachen/Documents/New project/knowledge-feed-learning"
git add src/components/PostDetail.tsx
git commit -m "feat(colearning): render post detail and submit replies"
```

---

### Task 14: End-to-end verification

**Files:**
- None (manual/CI verification)

- [ ] **Step 1: Start full stack**

Terminal 1:

```bash
cd "/Users/xiejiachen/Documents/New project/knowledge-feed-learning"
node server/llm-proxy.mjs
```

Terminal 2:

```bash
cd "/Users/xiejiachen/Documents/New project/knowledge-feed-learning"
npm run dev
```

- [ ] **Step 2: Walk through the success criteria**

1. Complete onboarding with a new topic.
2. Verify the feed shows agent posts with varied usernames and content.
3. Click a post and view nested comments.
4. Complete a lesson, approve a shadow draft, and see agent responses.
5. Refresh the feed and see new activity.

- [ ] **Step 3: Run automated checks**

```bash
cd "/Users/xiejiachen/Documents/New project/knowledge-feed-learning"
npm run typecheck
npm run test -- --run
```

Expected: typecheck passes, all existing tests pass.

- [ ] **Step 4: Commit final fixes**

```bash
cd "/Users/xiejiachen/Documents/New project/knowledge-feed-learning"
git add .
git commit -m "feat(colearning): integrate Reddit-style learning community end-to-end"
```

---

## Self-Review

### Spec Coverage

| Spec Section | Implementing Task |
|--------------|-------------------|
| SQLite data model | Task 2 |
| 20–50 Reddit-style personas | Task 4 |
| Casual LLM action generation | Task 5 |
| Natural fermentation scheduler | Task 7 |
| Quality gates (relaxed) | Task 6 |
| API surface | Task 8 |
| Node proxy integration | Task 9 |
| Frontend types/client | Task 10 |
| World creation | Task 11 |
| Feed rendering | Task 12 |
| Post detail/replies | Task 13 |
| End-to-end verification | Task 14 |

### Placeholder Scan

No TBD/TODO/filler language found. Each task includes concrete file paths and code.

### Type Consistency

- `post_id`, `comment_id`, `agent_id`, `world_id` are all `TEXT` primary keys in SQLite and `string` in TypeScript.
- `stance` and `relation` are passed through as strings from LLM; the backend stores them as-is.
- `ColearningPost` maps to `FeedPostOut` fields one-to-one.

### Known Gaps / Follow-Ups

1. **LLM response format** — The current prompt asks for JSON, but we rely on the LLM to follow the schema. If the model consistently fails, add a JSON schema `response_format` in `llm.py`.
2. **Agent persona hydration in scheduler** — Task 7 loads `persona_json` from the DB and reconstructs `Persona`. The `Persona` dataclass must accept the JSON fields; verify after Task 4.
3. **World ID persistence** — Task 11 uses `sessionKey`. If the user resets or switches topics, create a new world. Multi-world per session is left for a future iteration.
4. **Frontend fallback** — Task 12 keeps the existing local bundle as fallback when `colearningPosts` is empty. This preserves demo-ability when the Python service is offline.
5. **Pre-set template fallback** — Spec mentions downgrading to pre-set comment templates after 2 retries if LLM output fails quality gates. This plan currently drops failed generations silently; add template fallback only if observed failure rate is high.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-07-16-co-learning-presence-engine.md`.

Two execution options:

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration.

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints.

Which approach do you want?
