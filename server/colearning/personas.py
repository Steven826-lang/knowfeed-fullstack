"""Generate Reddit-style agent personas for a learning community."""

import json
import random
import uuid
from dataclasses import dataclass, field


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
    # Community behaviour extensions (spec §4): all defaulted so persona_json
    # written by older versions still deserializes via Persona(**data).
    activity_level: float = 0.5  # 0.0-1.0, higher means posts/comments more often
    stance_bias: float = 0.0  # -1.0-1.0, prior lean derived from traits
    relations: list[dict[str, str]] = field(default_factory=list)  # rivalry/buddy edges

    def to_prompt(self) -> str:
        lines = [
            f"你是 @{self.handle}，{self.age}岁，{self.role}。",
            f"背景：{self.background}",
            f"语气：{self.voice}",
            f"性格：{', '.join(self.traits)}",
            f"关心角度：{self.concern}",
            f"社区习惯：{self.habit}",
            f"口头禅：{self.catchphrase}",
            f"发言活跃度：{self._activity_desc()}",
        ]
        buddies = [r["handle"] for r in self.relations if r.get("kind") == "buddy"]
        rivals = [r["handle"] for r in self.relations if r.get("kind") == "rival"]
        if buddies:
            lines.append(f"你的熟人：{'、'.join('@' + h for h in buddies)}，互动时自然一些")
        if rivals:
            lines.append(f"你的对头：{'、'.join('@' + h for h in rivals)}，观点常相左，见面容易抬杠")
        lines.append("你正在一个学习 subreddit 里浏览帖子，会像真实网友一样轻松随意地发言。")
        return "\n".join(lines)

    def _activity_desc(self) -> str:
        if self.activity_level >= 0.65:
            return "高，经常在社区里发言"
        if self.activity_level <= 0.35:
            return "低，大部分时间在潜水，偶尔冒泡"
        return "一般，有想法才发言"

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
            "activity_level": self.activity_level,
            "stance_bias": self.stance_bias,
            "relations": self.relations,
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

# Prior stance lean per trait, averaged into Persona.stance_bias and used as
# the seed for BeliefState initial positions (negative = 倾向质疑/反对).
STANCE_LEAN_BY_TRAIT = {
    "杠精": -0.6,
    "悲观": -0.4,
    "固执": -0.3,
    "较真": -0.2,
    "冲动": -0.2,
    "谨慎": -0.1,
    "幽默": 0.2,
    "好奇": 0.2,
    "随和": 0.3,
    "乐观": 0.4,
}


def stance_bias_for_traits(traits: list[str]) -> float:
    """Map a persona's traits to an initial stance lean in [-1.0, 1.0]."""
    if not traits:
        return 0.0
    bias = sum(STANCE_LEAN_BY_TRAIT.get(t, 0.0) for t in traits) / len(traits)
    return max(-1.0, min(1.0, round(bias, 3)))


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
    used_names: set[str] = set()
    used_handles: set[str] = set()
    for username, display_name in selected_names:
        name, handle = display_name, username
        if name in used_names or handle in used_handles:
            suffix = 2
            while f"{display_name}-{suffix}" in used_names or f"{username}_{suffix}" in used_handles:
                suffix += 1
            name = f"{display_name}-{suffix}"
            handle = f"{username}_{suffix}"
        used_names.add(name)
        used_handles.add(handle)
        traits = rng.sample(TRAITS_POOL, k=rng.randint(2, 4))
        personas.append(Persona(
            agent_id=str(uuid.uuid4()),
            display_name=name,
            handle=handle,
            bio=rng.choice(BACKGROUNDS),
            age=rng.randint(20, 55),
            role=rng.choice(ROLES),
            background=rng.choice(BACKGROUNDS),
            voice=rng.choice(VOICES),
            traits=traits,
            concern=rng.choice(CONCERNS),
            habit=rng.choice(HABITS),
            catchphrase=rng.choice(CATCHPHRASES),
            activity_level=round(rng.uniform(0.2, 0.9), 2),
            stance_bias=stance_bias_for_traits(traits),
        ))
    return personas
