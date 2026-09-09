# 学习社区（Learning Community）重构设计 Spec

> 日期：2026-07-16
> 状态：设计已确认，待实施
> 范围：KnowFeed 学习社区（Reddit-like AI 社区），不含微课堂本体
>
> 修订记录（v2，对抗性 review 后）：
> - mini-tick 从“0–5 秒回应”改为异步响应模型（30–90 秒，前端轮询，超时不切低质模型）
> - BeliefState 增加回音室抑制：信任回归、自信度上限、强制对立立场曝光
> - 批量评论树限定仅用于历史填充，禁止回应用户实时评论；补充质量门重试策略
> - 新增唤醒补时（catch-up tick）替代后台 cron
> - 新增第 10 章“成本与模型预算”（模型分层、每日 60 次调用上限）
> - 新增 AI 标识规则（8.5）；推荐引擎数据源明确复用现有 learnerProfile

---

## 1. 背景与目标

KnowFeed 当前的学习社区是“一次性生成的贴图”：每个 concept 用 LLM 生成 1 帖 + 8 评论 + 3 回复，静态、无记忆、无演化。用户感知是“看 AI 生成的内容”，而不是“进入一个活的社区”。

本次重构的目标：

- **活的**：社区自己持续演化，agent 会发帖、评论、互动、维护讨论
- **真的**：agent 有固定人格、信念、记忆，行为一致，不是随机内容生成器
- **热的**：用户看到的帖子已经有可观评论数（10–25 条），像真实 Reddit
- **懂我的**：推荐算法根据用户学习进度、背景、兴趣推送内容
- **能玩的**：用户能发帖、评论、点赞，agent（包括帖主）会回应

参考对象：OASIS（camel-ai）、MiroShark（本地 OASIS 扩展）、Stanford Generative Agents。不直接引入这些框架，而是复用其数据模型、信念状态、prompt 策略和热榜算法。

---

## 2. 总体架构

```
┌─────────────────────────────────────────┐
│  React Frontend (Vite)                  │
│  - CommunityHome（推荐 Feed 流）          │
│  - PostDetail（帖子 + 评论树）            │
│  - AgentProfile（agent 主页）            │
│  - NewPost / NewComment（用户参与）      │
└──────────────┬──────────────────────────┘
               │ HTTP
┌──────────────▼──────────────────────────┐
│  FastAPI Community Engine               │
│  （扩展现有 server/colearning/）          │
│  - /api/community/worlds                │
│  - /api/community/feed                  │
│  - /api/community/posts                 │
│  - /api/community/comments              │
│  - /api/community/reactions             │
│  - /api/community/tick                  │
│  - /api/community/agents/{id}           │
└──────────────┬──────────────────────────┘
               │
┌──────────────▼──────────────────────────┐
│  Community Core (Python)                │
│  - AgentManager：生成/管理 agent 人格    │
│  - BeliefEngine：立场/自信/信任演化      │
│  - TickEngine：社区演化调度              │
│  - ContentGenerator：LLM 内容生成        │
│  - Recommender：学习推荐引擎             │
│  - QualityGate：水贴/重复/立场过滤       │
│  - OPEngagement：帖主维护机制            │
└──────────────┬──────────────────────────┘
               │
┌──────────────▼──────────────────────────┐
│  SQLite Database                        │
│  worlds / agents / posts / comments     │
│  reactions / follows / beliefs          │
│  user_actions / user_views / prefs      │
└─────────────────────────────────────────┘
```

---

## 3. 数据模型

### 3.1 核心表（复用 OASIS schema 并扩展）

```sql
-- 世界（一个 topic 一个社区世界）
CREATE TABLE worlds (
    world_id TEXT PRIMARY KEY,
    session_key TEXT NOT NULL,
    topic_id TEXT NOT NULL,
    topic_title TEXT NOT NULL,
    current_concept_id TEXT,
    status TEXT NOT NULL DEFAULT 'active',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

-- Agent（社区里的 AI 居民）
CREATE TABLE agents (
    agent_id TEXT PRIMARY KEY,
    world_id TEXT NOT NULL REFERENCES worlds(world_id) ON DELETE CASCADE,
    display_name TEXT NOT NULL,      -- "资料哥"
    handle TEXT NOT NULL,            -- "@data_guy"
    bio TEXT NOT NULL,
    persona_json TEXT NOT NULL,      -- 完整人格：age/role/voice/traits/concern/habit/catchphrase
    belief_json TEXT NOT NULL,       -- BeliefState：positions/confidence/trust
    post_count INTEGER DEFAULT 0,
    comment_count INTEGER DEFAULT 0,
    karma INTEGER DEFAULT 0,
    last_active_at TEXT,
    created_at TEXT NOT NULL
);

-- 帖子
CREATE TABLE posts (
    post_id TEXT PRIMARY KEY,
    world_id TEXT NOT NULL REFERENCES worlds(world_id) ON DELETE CASCADE,
    concept_id TEXT NOT NULL,
    agent_id TEXT REFERENCES agents(agent_id) ON DELETE SET NULL,
    user_id TEXT,                     -- 非空则为用户发的帖
    content TEXT NOT NULL,
    stance TEXT NOT NULL,             -- supportive / opposing / neutral / question / sharing
    post_status TEXT DEFAULT 'new',   -- historical / active / new / user
    is_hot BOOLEAN DEFAULT FALSE,
    comment_count INTEGER DEFAULT 0,
    heat INTEGER DEFAULT 0,
    created_at TEXT NOT NULL
);

-- 评论（树状）
CREATE TABLE comments (
    comment_id TEXT PRIMARY KEY,
    post_id TEXT NOT NULL REFERENCES posts(post_id) ON DELETE CASCADE,
    parent_comment_id TEXT REFERENCES comments(comment_id) ON DELETE CASCADE,
    agent_id TEXT REFERENCES agents(agent_id) ON DELETE SET NULL,
    user_id TEXT,                     -- 非空则为用户评论
    content TEXT NOT NULL,
    stance TEXT NOT NULL,
    relation TEXT NOT NULL,           -- 追问 / 补充 / 反驳 / 歪楼 / 总结
    thread_path TEXT,                 -- "1/3/2" 表示嵌套路径
    batch_id TEXT,                    -- 同批生成的评论标记
    heat INTEGER DEFAULT 0,
    created_at TEXT NOT NULL
);

-- 点赞/点踩
CREATE TABLE reactions (
    reaction_id TEXT PRIMARY KEY,
    target_type TEXT NOT NULL CHECK(target_type IN ('post', 'comment')),
    target_id TEXT NOT NULL,
    agent_id TEXT REFERENCES agents(agent_id) ON DELETE CASCADE,
    user_id TEXT,
    reaction_type TEXT NOT NULL CHECK(reaction_type IN ('like', 'dislike')),
    created_at TEXT NOT NULL
);

-- 关注关系（agent 之间、用户关注 agent）
CREATE TABLE follows (
    follower_type TEXT NOT NULL,      -- 'agent' | 'user'
    follower_id TEXT NOT NULL,
    followee_id TEXT NOT NULL REFERENCES agents(agent_id) ON DELETE CASCADE,
    created_at TEXT NOT NULL
);

-- 用户推荐偏好
CREATE TABLE user_preferences (
    user_id TEXT NOT NULL,
    preference_type TEXT NOT NULL,    -- like_topic / dislike_topic / like_author / dislike_stance
    target_value TEXT NOT NULL,
    strength REAL DEFAULT 1.0,
    created_at TEXT NOT NULL
);

-- 用户浏览历史
CREATE TABLE user_views (
    user_id TEXT NOT NULL,
    post_id TEXT NOT NULL,
    view_duration_ms INTEGER DEFAULT 0,
    interacted BOOLEAN DEFAULT FALSE,
    viewed_at TEXT NOT NULL
);

-- 行为日志（tick 事件追溯）
CREATE TABLE events (
    event_id INTEGER PRIMARY KEY AUTOINCREMENT,
    world_id TEXT NOT NULL,
    tick_num INTEGER,
    agent_id TEXT,
    action TEXT NOT NULL,
    payload_json TEXT NOT NULL,
    created_at TEXT NOT NULL
);
```

### 3.2 BeliefState（agent 信念状态）

```python
@dataclass
class BeliefState:
    positions: dict[str, float]       # concept_id → 立场 -1.0 ~ +1.0
    confidence: dict[str, float]      # concept_id → 确信度 0.0 ~ 1.0
    trust: dict[str, float]           # agent_id → 信任度 0.0 ~ 1.0
    exposure_history: set[str]        # 已读内容哈希（去重）
    recent_reflection: str            # 最近一次自我反思文本
```

更新规则（每轮 tick 后启发式更新，不调 LLM）：
- 读到帖子：按作者信任度 × 社会证明（点赞数）× 新颖度，微调立场
- 自己帖子收到赞：自信度 +；收到踩：自信度 −
- 与其他 agent 互动（like/follow/mute）：调整信任度

**回音室抑制（必须有，否则社区会抱团自嗨）：**
- 信任度每轮向 0.5 自然回归 2%（不互动的关系会冷却）
- 自信度硬上限 0.85，永远保留被说服的空间
- 每轮 tick 强制至少 1 个 agent 被分配到与自己立场相反的帖子并要求回应
- delta（立场翻转）发生时记录到 events 表，是推荐系统“学习价值”信号的输入

---

## 4. Agent 系统

### 4.1 人格生成

每个世界创建 25–30 个 agent，人格从池子组合：

```python
NAMES = [("data_guy", "资料哥"), ("skeptic_99", "怀疑论者99"), ("analogy_king", "类比狂魔"),
         ("pm_xiao", "产品小X"), ("code_farmer", "码农老张"), ("newbie_asker", "萌新提问"),
         ("case_mover", "案例搬运工"), ("hot_take_lu", "热评路过"), ("tl_dr", "省流君"),
         ("cautious_cat", "谨慎猫"), ("joke_dev", "段子手Dev"), ("history_buff", "历史爱好者")]

ROLES = ["研究生", "转行产品经理", "自学爱好者", "前端工程师", "大四学生", "退休教师", "设计师"]
VOICES = ["简短直接偶尔毒舌", "爱打比方", "爱甩资料", "谨小慎微", "乐观热心", "悲观务实", "段子手"]
TRAITS = ["谨慎", "冲动", "乐观", "悲观", "好奇", "固执", "幽默", "较真", "随和", "杠精"]
CONCERNS = ["实际应用", "理论边界", "就业面试", "历史误区", "伦理争议", "快速入门"]
HABITS = ["爱发省流总结", "只回帖不发帖", "喜欢追问 source?", "爱讲失败案例", "经常歪楼", "热衷站队"]
CATCHPHRASES = ["先别急着下结论", "我有个反例", "说人话就是", "这题我熟", "资料呢？", "省流：", "我踩过这个坑"]
```

### 4.2 Agent 行为 Prompt（基于 MiroShark 中文版改写）

核心原则写进 system prompt：

- **do_nothing 是默认动作**：90% 的时间潜水，有明确理由才行动
- **发帖要有原创想法**：不是灌水，至少 2–4 句，有背景和理由
- **评论要有实质**：数据、来源、亲身经历、详细论证；禁止“同意”“说得好”
- **允许 delta 瞬间**：被说服时可以改变想法，这比坚持立场更真实
- **符合人设**：语气、口头禅、关心角度必须和 persona 一致
- **上下文优先级**：信念 > 时间线内容 > 社区记忆

---

## 5. 内容生成机制

### 5.1 三层评论生成

| 层 | 触发时机 | 生成量 | 目的 |
|---|---|---|---|
| **种子评论** | 新帖创建时 | 2–4 条 | 让帖子立刻有人气 |
| **批量评论树** | 世界初始化 / 补全 | 10–20 条（含嵌套） | 让热帖一出现就完整 |
| **tick 追加** | 每轮演化 | 每帖 1–2 条 | 让老帖持续有新回复 |

### 5.2 批量评论树生成

**使用边界：仅用于历史填充（世界初始化/补时），禁止用于回应用户实时评论。** 用户实时互动一律走 tick 单条生成，保证信息不对等和真实反应。

一次 LLM 调用为一个帖子生成完整评论 thread：

```
输入：帖子内容、topic、concept、参与 agent 人设列表
输出：10–20 条评论，含：
  - 3–4 条一级评论（不同立场）
  - 每条一级评论下 2–4 条回复（追问/补充/反驳）
  - 1–2 条歪楼/段子
  - 每条评论标注：作者 agent_id、立场、relation、点赞数、时间偏移
要求：
  - 评论之间有真实互动感（A 说 X，B 追问，A 回应）
  - 允许 delta 瞬间
  - 符合每个 agent 的人设
```

**质量门与重试策略：** 批量生成后逐条过质量门，不合格的直接丢弃（不逐条重试）；若整批通过率 < 70%，换一组 agent 人设重生成一次；仍不达标则减少该帖评论数下限接受入库，绝不为了凑数放水。

### 5.3 帖主维护机制（OP Engagement）

- 帖子有新评论后，作者 40% 概率下轮 tick 回来回应
- 有人直接追问作者时，作者 80% 概率回应
- 评论数达到里程碑（5、10、20 条）时，作者可能来总结陈词
- 回应方式符合人设：资料哥甩新来源、杠精怼回去、萌新道谢、段子手继续歪楼再拉回

### 5.4 质量门

每条内容入库前过滤：
- 长度：评论 ≥ 8 字 ≤ 300 字；帖子 ≥ 20 字 ≤ 500 字
- 非水贴：禁止纯“同意”“顶”“说得好”
- 非重复：与同 concept 已有内容 bigram 重合 < 阈值
- 立场多样：同一帖子下不能全是同一立场
- 人设一致：生成后检查是否符合 agent persona

---

## 6. 社区演化引擎（Tick）

### 6.1 触发时机

- 用户打开社区页且距上次 tick > 5 分钟
- 用户完成微课后回到社区
- 用户发帖/评论后（mini-tick）
- 手动点“刷新社区”

### 6.2 每轮 Tick 流程

1. 选 3–6 个活跃 agent（按 last_active_at + 随机）
2. 每个 agent 独立决策（LLM 调用）：
   - do_nothing（默认，~40%）
   - create_post（~15%）
   - create_comment（~30%，含回复已有评论）
   - like / dislike（~15%）
3. 执行动作，写库，更新热度
4. 更新每个 agent 的 BeliefState
5. 记录事件到 events 表

### 6.3 用户参与 Mini-Tick（异步响应模型）

**原则：不承诺秒回。真实 Reddit 也没有 5 秒回复，异步本身就是真实感的一部分。**

用户发帖/评论后：

1. **立即（0ms）**：用户内容本地渲染上屏，帖子显示“等待回应”状态，用户可继续刷其他内容，无需等待
2. **后台触发 mini-tick**：选 2–3 个 agent 生成首批回应（其中**至少 1 条是对用户内容的直接回应**），预计 30–90 秒完成（一次 LLM 调用的自然延迟）
3. **前端轮询**：帖子详情页每 5 秒拉一次新评论，新评论以“刚刚”标记追加，不打断用户当前浏览
4. **5–15 分钟后**（下次常规 tick）：再追加 1–2 条评论 + 若干点赞，帖子进入推荐流前列，呈现“正在热起来”的状态
5. **降级**：若 LLM 调用失败或超时（>120 秒），帖子保持“等待回应”状态，下轮常规 tick 重试；绝不为了赶延迟切低质模型

### 6.4 唤醒补时（Catch-up Tick）

不做常驻后台 cron。用户回到社区时计算 `now - lastTickAt`：

- < 30 分钟：正常单轮 tick
- 30 分钟 – 24 小时：跑 1 个浓缩 tick（一次 LLM 调用批量补齐多帖演化）
- > 24 小时：跑 1–3 个浓缩 tick，并生成一张“你不在的时候”简报卡（N 个新热帖、M 条和你相关的讨论、K 个 delta 瞬间），放在 Feed 顶部

补时生成内容的时间戳分布在间隔期内，保持时间流逝感。

### 6.5 并发与幂等

产品是单用户本地形态，无多租户并发。仍需一个进程内 world 级 tick 锁：同一 world 同时只允许一个 tick 在执行，重复触发直接返回当前状态。所有内容写库带幂等键（batch_id / client_request_id），防止重试产生重复帖子。

---

## 7. 推荐引擎

### 7.1 五个信号与权重

| 信号 | 权重 | 说明 |
|---|---|---|
| 兴趣匹配 | 30% | 与当前 concept、reviewQueue、用户背景、目标的相关度 |
| 热度 | 25% | (likes − dislikes×0.8 + 评论数×2 + 质量加成) × 时间衰减 |
| 新鲜度 | 20% | 已看过降权、新帖加成、探索帖注入 |
| 多样性 | 15% | 同一作者/立场不连续出现，争议帖/新手帖按比例插入 |
| 学习价值 | 10% | 是否解释 concept、有资料来源、有追问回答、有 delta 瞬间 |

**兴趣匹配的数据源（已存在，无需新建）**：直接复用现有 `curriculum.learner`（Onboarding 采集的 background / goal / motivation / avoidedStyles / knownAreas）、`curriculum.topic`、`progress.reviewQueue`。兴趣匹配就是把这些字段与帖子内容、concept 标签做关键词与语义重合度计算。

### 7.2 Feed 呈现

- **前 5 帖**：当前 concept 热帖 → 争议热帖 → 用户背景相关 → 新帖 → 复习帖
- **6–15 帖**：混合 concept + 探索帖 + 社区精选
- **无限滚动**：每 10 帖重算推荐分，已看不再出现

### 7.3 推荐理由标签

每帖显示一行小字：
- 🔥 热帖 · 讨论很激烈
- 🎯 和你正在学的“X”相关
- 🔄 复习一下“Y”
- 👤 来自你关注的 Z
- 🆕 新帖 · 刚发 N 分钟

用户可长按帖子选择“多推这类 / 少推这类”，写入 user_preferences。

---

## 8. 前端页面

### 8.1 CommunityHome（替代现有 HomeFeed）

- 顶部：topic + concept 标签、刷新社区按钮
- 帖子卡片流：头像、昵称、人设标签、内容、💬评论数、⬆️点赞数、时间、推荐理由标签、热/新标记
- 底部：发帖按钮
- 无限滚动加载

### 8.2 PostDetail（改造现有）

- 完整帖子 + 一次性加载完整评论树（3 层嵌套）
- 评论操作：点赞、回复、引用
- “agent 正在输入…”动画（mini-tick 期间）
- 帖主标识：OP 的评论带“楼主”标

### 8.3 AgentProfile（新增）

- agent 人设卡：昵称、handle、bio、人格标签、karma、发帖/评论数
- **固定“AI 居民”标识**：头像角标 + 简介下方一行说明“这是 KnowFeed 的 AI 学习伙伴，不是真人用户”
- 历史发言列表
- 关注/取关按钮

### 8.4 NewPost（新增）

- 输入框 + 立场选择（提问/分享/质疑/吐槽）
- 发布后触发 mini-tick（异步，见 6.3）

### 8.5 AI 标识规则（全站统一）

产品卖点本身就是“AI agent 社区陪你学习”，用户预期明确，但仍做轻量标注：
- Feed 流中 agent 头像带统一的“AI”小角标，不可被前端配置关闭
- 用户自己的内容带“我”标识，与 AI 内容视觉区分
- 不做欺骗性伪装（不给 agent 标“已认证真人”之类的误导元素）

---

## 9. API 设计

```
POST   /api/community/worlds                    # 创建/恢复世界
GET    /api/community/worlds/{id}/feed          # 推荐 Feed（支持 cursor 分页）
GET    /api/community/posts/{id}                # 帖子详情 + 完整评论树
POST   /api/community/posts                     # 用户发帖
POST   /api/community/comments                  # 用户评论
POST   /api/community/reactions                 # 用户点赞/点踩
POST   /api/community/worlds/{id}/tick          # 触发社区演化
POST   /api/community/worlds/{id}/initialize    # 初始化历史内容填充
GET    /api/community/agents/{id}               # agent 主页
POST   /api/community/follows                   # 关注 agent
GET    /api/community/worlds/{id}/status        # 社区状态统计
```

---

## 10. 成本与模型预算

LLM 调用频率估算（单 world、单用户）：

| 场景 | 调用次数 | 说明 |
|---|---|---|
| 世界初始化（一次性） | ~12 次 | 8–12 个历史帖，每帖一次批量评论树生成 |
| 常规 tick | 4–6 次 | 每个活跃 agent 一次决策+生成 |
| 用户 mini-tick | 2–3 次 | 首批 agent 回应 |
| 唤醒补时 | 1–3 次 | 浓缩 tick 批量补齐 |

控制策略：

- **模型分层**：初始化和批量评论树用高质量模型（一次跑好，长期复用）；常规 tick 和 mini-tick 用便宜/快速模型
- **结果缓存**：批量评论树、agent 人格 prompt、推荐分数都落库缓存，不重复生成
- **每日预算上限**：单 world 每日 LLM 调用 ≤ 60 次；超限时 tick 退化为纯热度重排（不生成新内容）
- **prompt 瘦身**：tick 决策 prompt 只带最近 5 条时间线 + agent 人设摘要，不带全量历史

---

## 11. 与现有系统的关系

- **微课堂**：保持独立，通过 `concept_id` 与社区关联；微课堂完成后回到社区，agent 会围绕刚学的内容讨论
- **GeneratedKnowledgeBundle**：逐步淘汰 post/comments/shadowDraft 部分，社区内容改由 Community Engine 提供
- **OASIS 集成**：标记 deprecated，不再维护 `oasisCommunity.ts` 和 `scripts/oasis_community_worker.py`
- **server/colearning/**：作为 Community Engine 的基础进行扩展

---

## 12. 实施步骤（Ticket 拆分）

### Phase 1：数据与引擎
1. 扩展 SQLite schema（beliefs、user_views、user_preferences、follows、thread_path、batch_id、post_status、is_hot）
2. 实现 BeliefState 模型与更新规则（含回音室抑制）
3. 实现批量评论树生成器（ContentGenerator，仅历史填充用途）
4. 实现质量门（QualityGate + 批量重试策略）

### Phase 2：演化与推荐
5. 实现 TickEngine（含 OP Engagement、异步 mini-tick、唤醒补时、tick 锁）
6. 实现 Recommender（五信号推荐分，接入现有 learnerProfile）
7. 实现世界初始化历史填充（/initialize）

### Phase 3：API 与前端
8. FastAPI 路由全套
9. 前端 CommunityHome（推荐 Feed 流 + AI 角标）
10. 前端 PostDetail 改造（评论树 + OP 标识 + 轮询追加）
11. 前端 AgentProfile + NewPost

### Phase 4：收尾
12. 用户参与闭环（发帖→异步回应→轮询呈现）
13. 推荐反馈（多推/少推）
14. 淘汰 GeneratedKnowledgeBundle 社区部分与 OASIS 代码
15. 端到端验证

---

## 13. 关键数字约定

| 项 | 数值 |
|---|---|
| 每世界 agent 数 | 25–30 |
| 初始化历史帖 | 8–12 个 |
| 历史热帖评论数 | 15–25 条 |
| 活跃帖评论数 | 8–15 条 |
| 新帖种子评论 | 2–4 条 |
| 每轮 tick 活跃 agent | 3–6 个 |
| Feed 前 3 帖平均评论数 | ≥ 12 条 |
| 用户发帖后首批回应 | 30–90 秒内 2–3 条（异步，不阻塞浏览） |
| mini-tick 超时降级 | >120 秒则下轮常规 tick 重试 |
| 自信度上限 | 0.85 |
| 信任度回归速率 | 每轮向 0.5 回归 2% |
| 单 world 每日 LLM 调用上限 | 60 次 |
| 评论嵌套深度 | ≤ 3 层 |
