"""Agent belief state: positions, confidence, trust, and echo-chamber suppression.

Pure heuristic model (spec section 3.2): updated after each tick round without
LLM calls. Zero external dependencies; persistence goes through agents.belief_json.
"""

import hashlib
from dataclasses import dataclass
from typing import Any, Iterable

POSITION_MIN = -1.0
POSITION_MAX = 1.0
CONFIDENCE_CAP = 0.85      # hard cap: an agent always keeps room to be persuaded
TRUST_NEUTRAL = 0.5        # default trust toward unknown agents
TRUST_REGRESSION = 0.02    # per round, untouched trust drifts 2% toward 0.5
EXPOSURE_CAP = 2000        # max remembered content hashes
READ_INFLUENCE = 0.08      # base position pull per unseen post
SOCIAL_PROOF_LIKES = 20    # like count at which social proof saturates
LIKE_CONFIDENCE = 0.02     # confidence gain per like on own content
DISLIKE_CONFIDENCE = 0.03  # confidence loss per dislike on own content

STANCE_VALUES = {
    "supportive": 1.0,
    "support": 1.0,
    "opposing": -1.0,
    "oppose": -1.0,
    "doubt": -0.5,
    "neutral": 0.0,
    "question": 0.0,
    "sharing": 0.0,
    "add": 0.0,
}

TRUST_DELTAS = {
    "like": 0.05,
    "follow": 0.10,
    "dislike": -0.05,
    "mute": -0.15,
}


@dataclass
class BeliefState:
    """Persistent belief state of one community agent (spec section 3.2)."""

    positions: dict[str, float]      # concept_id -> stance -1.0 ~ +1.0
    confidence: dict[str, float]     # concept_id -> certainty 0.0 ~ 0.85
    trust: dict[str, float]          # agent_id -> trust 0.0 ~ 1.0
    exposure_history: set[str]       # hashes of content already read (dedup)
    recent_reflection: str           # latest self-reflection text

    def __post_init__(self) -> None:
        # Agents interacted with since the last round update; these are exempt
        # from that round's trust regression. Transient, never serialized.
        self._trust_touched: set[str] = set()

    @classmethod
    def from_profile(cls, agent_config: Any, topics: list[Any]) -> "BeliefState":
        """Build the initial BeliefState for a freshly generated agent.

        agent_config: persona object or dict carrying an agent_id (or id).
        topics: concept ids (str) or dicts with a concept_id key.
        Initial positions (-0.6 ~ +0.6) and confidence (0.3 ~ 0.6) derive
        deterministically from (agent_id, concept_id) so worlds are reproducible.
        """
        agent_id = _agent_id_of(agent_config)
        positions: dict[str, float] = {}
        confidence: dict[str, float] = {}
        for topic in topics:
            concept_id = str(topic.get("concept_id")) if isinstance(topic, dict) else str(topic)
            seed = _stable_hash(f"{agent_id}:{concept_id}")
            positions[concept_id] = round((seed % 1201) / 1000 - 0.6, 3)
            confidence[concept_id] = round(0.3 + ((seed // 1201) % 301) / 1000, 3)
        return cls(
            positions=positions,
            confidence=confidence,
            trust={},
            exposure_history=set(),
            recent_reflection="",
        )

    def update_from_round(
        self,
        posts_seen: list[dict[str, Any]],
        own_engagement: dict[str, Any],
        round_num: int,
    ) -> list[dict[str, Any]]:
        """Heuristic per-round update after a tick, no LLM calls.

        posts_seen: items the agent read this round. Each item may carry:
            post_id / comment_id / content_id / id   (stable identity for dedup)
            content                                  (hashed when no id given)
            author_id / agent_id                     (trust lookup)
            concept_id                               (which position to nudge)
            stance                                   (float -1..1 or a stance label)
            likes / like_count / heat                (social proof)
        Reading a post nudges the position toward the post stance by
        author trust x social proof (likes) x novelty; already-seen content
        is skipped entirely.

        own_engagement: reactions to the agent's own content, either
            {"likes_received": n, "dislikes_received": m, "concept_id": "..."}
        or  {"<concept_id>": {"likes_received": n, "dislikes_received": m}, ...}
        Likes raise confidence, dislikes lower it, hard-capped at 0.85.

        Returns delta events (position sign flips) so the tick engine can log
        them to the events table as a learning-value signal.
        """
        deltas: list[dict[str, Any]] = []
        interacted: set[str] = set(self._trust_touched)

        for item in posts_seen or []:
            exposure_key = _exposure_key(item)
            if exposure_key in self.exposure_history:
                continue
            self._remember(exposure_key)

            concept_id = item.get("concept_id")
            if not concept_id:
                continue
            concept_id = str(concept_id)
            author = item.get("author_id") or item.get("agent_id")
            if author:
                author = str(author)
                interacted.add(author)
            stance = _stance_value(item.get("stance"))
            if stance is None:
                continue

            trust = self.trust.get(author, TRUST_NEUTRAL) if author else TRUST_NEUTRAL
            likes = item.get("likes", item.get("like_count", item.get("heat", 0))) or 0
            social_proof = 0.3 + 0.7 * min(max(int(likes), 0), SOCIAL_PROOF_LIKES) / SOCIAL_PROOF_LIKES
            pull = READ_INFLUENCE * trust * social_proof

            old = self.positions.get(concept_id, 0.0)
            new = round(_clamp(old + pull * (stance - old), POSITION_MIN, POSITION_MAX), 4)
            self.positions[concept_id] = new
            if old != 0.0 and new != 0.0 and (old < 0) != (new < 0):
                deltas.append({
                    "concept_id": concept_id,
                    "old_position": old,
                    "new_position": new,
                    "round": round_num,
                })

        if deltas:
            last = deltas[-1]
            self.recent_reflection = (
                f"第{round_num}轮：我在 {last['concept_id']} 上的立场从 "
                f"{last['old_position']:+.2f} 变成了 {last['new_position']:+.2f}，被大家的讨论说服了。"
            )

        self._update_confidence(own_engagement)
        self._regress_trust(except_agents=interacted)
        self._trust_touched.clear()
        return deltas

    def update_trust(self, other_agent_id: str, action: str) -> float:
        """Adjust trust toward another agent after an interaction.

        like +0.05, follow +0.10, dislike -0.05, mute -0.15, clamped to [0, 1].
        Agents updated here are exempt from this round's trust regression.
        Returns the new trust value.
        """
        key = str(other_agent_id)
        current = self.trust.get(key, TRUST_NEUTRAL)
        updated = round(_clamp(current + TRUST_DELTAS.get(action, 0.0), 0.0, 1.0), 4)
        self.trust[key] = updated
        self._trust_touched.add(key)
        return updated

    def pick_counter_exposure(self, candidates: Iterable[dict[str, Any]]) -> dict[str, Any] | None:
        """Pick the candidate post most opposed to this agent's own position.

        Anti-echo-chamber helper (spec section 3.2): the tick engine uses it to
        assign at least one opposing-stance post per round. candidates are dicts
        with concept_id and stance (label or -1..1 float). Returns the candidate
        with the strongest disagreement, or None when nothing opposes.
        """
        best: dict[str, Any] | None = None
        best_gap = 0.0
        for candidate in candidates or []:
            concept_id = candidate.get("concept_id")
            stance = _stance_value(candidate.get("stance"))
            if not concept_id or stance is None or stance == 0.0:
                continue
            own = self.positions.get(str(concept_id), 0.0)
            if own == 0.0 or (own < 0) == (stance < 0):
                continue
            gap = abs(stance - own)
            if gap > best_gap:
                best_gap = gap
                best = candidate
        return best

    def to_prompt_text(self) -> str:
        """Render the belief state as Chinese prompt context for LLM calls."""
        lines = ["你的当前信念状态："]
        if self.positions:
            lines.append("立场（-1 反对 ~ +1 支持）：")
            for concept_id, value in sorted(self.positions.items()):
                conf = self.confidence.get(concept_id, 0.5)
                lines.append(f"- {concept_id}: {value:+.2f}（确信度 {conf:.2f}）")
        else:
            lines.append("- 还没有形成明确立场。")
        if self.trust:
            trusted = sorted(self.trust.items(), key=lambda kv: kv[1], reverse=True)[:5]
            lines.append("你比较信任的 agent：" + "、".join(f"{aid}({v:.2f})" for aid, v in trusted))
        if self.recent_reflection:
            lines.append(f"最近反思：{self.recent_reflection}")
        return "\n".join(lines)

    def to_dict(self) -> dict[str, Any]:
        """Serialize to a JSON-safe dict for agents.belief_json."""
        return {
            "positions": dict(self.positions),
            "confidence": dict(self.confidence),
            "trust": dict(self.trust),
            "exposure_history": sorted(self.exposure_history),
            "recent_reflection": self.recent_reflection,
        }

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "BeliefState":
        """Restore from a dict produced by to_dict(); tolerates missing keys."""
        data = data or {}
        return cls(
            positions={str(k): float(v) for k, v in (data.get("positions") or {}).items()},
            confidence={str(k): float(v) for k, v in (data.get("confidence") or {}).items()},
            trust={str(k): float(v) for k, v in (data.get("trust") or {}).items()},
            exposure_history=set(data.get("exposure_history") or []),
            recent_reflection=str(data.get("recent_reflection") or ""),
        )

    def _update_confidence(self, own_engagement: dict[str, Any]) -> None:
        """Own content liked: confidence up; disliked: down. Hard cap 0.85."""
        if not own_engagement:
            return
        entries: list[tuple[str | None, int, int]] = []
        if "likes_received" in own_engagement or "dislikes_received" in own_engagement:
            entries.append((
                own_engagement.get("concept_id"),
                int(own_engagement.get("likes_received", 0) or 0),
                int(own_engagement.get("dislikes_received", 0) or 0),
            ))
        else:
            for concept_id, counts in own_engagement.items():
                if not isinstance(counts, dict):
                    continue
                entries.append((
                    str(concept_id),
                    int(counts.get("likes_received", counts.get("likes", 0)) or 0),
                    int(counts.get("dislikes_received", counts.get("dislikes", 0)) or 0),
                ))
        for concept_id, likes, dislikes in entries:
            targets = [concept_id] if concept_id else list(self.confidence)
            for target in targets:
                if target is None:
                    continue
                current = self.confidence.get(target, 0.5)
                updated = current + LIKE_CONFIDENCE * likes - DISLIKE_CONFIDENCE * dislikes
                self.confidence[target] = round(_clamp(updated, 0.0, CONFIDENCE_CAP), 4)

    def _regress_trust(self, except_agents: set[str]) -> None:
        """Cool relationships not touched this round: 2% drift toward 0.5."""
        for other, value in list(self.trust.items()):
            if other in except_agents:
                continue
            self.trust[other] = round(value + (TRUST_NEUTRAL - value) * TRUST_REGRESSION, 4)

    def _remember(self, exposure_key: str) -> None:
        """Record a content hash, evicting deterministic victims beyond the cap."""
        if len(self.exposure_history) >= EXPOSURE_CAP:
            excess = len(self.exposure_history) - EXPOSURE_CAP + 1
            for victim in sorted(self.exposure_history)[:excess]:
                self.exposure_history.discard(victim)
        self.exposure_history.add(exposure_key)


def _clamp(value: float, low: float, high: float) -> float:
    return max(low, min(high, value))


def _stable_hash(text: str) -> int:
    return int(hashlib.sha256(text.encode("utf-8")).hexdigest(), 16)


def _stance_value(stance: Any) -> float | None:
    """Normalize a stance label or numeric stance to -1.0 ~ +1.0."""
    if stance is None:
        return None
    if isinstance(stance, (int, float)) and not isinstance(stance, bool):
        return _clamp(float(stance), POSITION_MIN, POSITION_MAX)
    return STANCE_VALUES.get(str(stance).strip().lower())


def _exposure_key(item: dict[str, Any]) -> str:
    """Stable identity of a seen item: explicit id preferred, content hash otherwise."""
    for key in ("content_id", "post_id", "comment_id", "id"):
        if item.get(key):
            return str(item[key])
    return "sha256:" + hashlib.sha256(str(item.get("content", "")).encode("utf-8")).hexdigest()


def _agent_id_of(agent_config: Any) -> str:
    if isinstance(agent_config, dict):
        return str(agent_config.get("agent_id") or agent_config.get("id") or "unknown")
    return str(getattr(agent_config, "agent_id", None) or getattr(agent_config, "id", None) or "unknown")
