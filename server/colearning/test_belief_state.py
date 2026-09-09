import json

import pytest

from belief_state import (
    CONFIDENCE_CAP,
    EXPOSURE_CAP,
    BeliefState,
)


def _state() -> BeliefState:
    return BeliefState(
        positions={"c1": 0.0},
        confidence={"c1": 0.5},
        trust={"author-1": 1.0},
        exposure_history=set(),
        recent_reflection="",
    )


def test_from_profile_seeds_positions_deterministically():
    topics = ["c1", "c2", "c3"]
    b1 = BeliefState.from_profile({"agent_id": "a1"}, topics)
    b2 = BeliefState.from_profile({"agent_id": "a1"}, topics)
    assert b1.positions == b2.positions
    assert b1.confidence == b2.confidence
    assert set(b1.positions) == set(topics)
    for topic in topics:
        assert -1.0 <= b1.positions[topic] <= 1.0
        assert 0.0 <= b1.confidence[topic] <= CONFIDENCE_CAP
    assert b1.trust == {}
    assert b1.exposure_history == set()
    assert b1.recent_reflection == ""


def test_from_profile_accepts_object_and_topic_dicts():
    class AgentConfig:
        agent_id = "a2"

    state = BeliefState.from_profile(AgentConfig(), [{"concept_id": "c9"}])
    assert set(state.positions) == {"c9"}
    other = BeliefState.from_profile({"agent_id": "a3"}, [{"concept_id": "c9"}])
    assert state.positions != other.positions or state.confidence != other.confidence


def test_reading_unseen_post_nudges_position_toward_stance():
    state = _state()
    post = {"post_id": "p1", "concept_id": "c1", "author_id": "author-1", "stance": 1.0, "likes": 20}
    deltas = state.update_from_round([post], {}, round_num=1)
    assert 0.0 < state.positions["c1"] <= 1.0
    assert deltas == []
    assert "p1" in state.exposure_history


def test_reading_stance_labels_work():
    state = _state()
    post = {"post_id": "p1", "concept_id": "c1", "author_id": "author-1", "stance": "opposing", "likes": 5}
    state.update_from_round([post], {}, round_num=1)
    assert state.positions["c1"] < 0.0


def test_seen_post_is_not_counted_twice():
    state = _state()
    post = {"post_id": "p1", "concept_id": "c1", "author_id": "author-1", "stance": 1.0, "likes": 20}
    state.update_from_round([post], {}, round_num=1)
    after_first = state.positions["c1"]
    state.update_from_round([post], {}, round_num=2)
    assert state.positions["c1"] == after_first


def test_social_proof_amplifies_influence():
    liked = _state()
    unliked = _state()
    base = {"post_id": "p1", "concept_id": "c1", "author_id": "author-1", "stance": 1.0}
    liked.update_from_round([{**base, "likes": 20}], {}, round_num=1)
    unliked.update_from_round([{**base, "likes": 0}], {}, round_num=1)
    assert liked.positions["c1"] > unliked.positions["c1"] > 0.0


def test_trusted_author_influences_more():
    high_trust = _state()
    low_trust = _state()
    low_trust.trust["author-1"] = 0.1
    post = {"post_id": "p1", "concept_id": "c1", "author_id": "author-1", "stance": 1.0, "likes": 10}
    high_trust.update_from_round([post], {}, round_num=1)
    low_trust.update_from_round([post], {}, round_num=1)
    assert high_trust.positions["c1"] > low_trust.positions["c1"]


def test_position_is_clamped_to_range():
    state = _state()
    state.positions["c1"] = 0.99
    posts = [
        {"post_id": f"p{i}", "concept_id": "c1", "author_id": "author-1", "stance": 5.0, "likes": 20}
        for i in range(10)
    ]
    state.update_from_round(posts, {}, round_num=1)
    assert state.positions["c1"] <= 1.0


def test_likes_raise_confidence_dislikes_lower_it():
    state = _state()
    state.update_from_round([], {"c1": {"likes_received": 5, "dislikes_received": 0}}, round_num=1)
    boosted = state.confidence["c1"]
    assert boosted > 0.5
    state.update_from_round([], {"c1": {"likes_received": 0, "dislikes_received": 10}}, round_num=2)
    assert state.confidence["c1"] < boosted


def test_flat_engagement_form_supported():
    state = _state()
    state.update_from_round([], {"likes_received": 3, "dislikes_received": 0, "concept_id": "c1"}, round_num=1)
    assert state.confidence["c1"] == pytest.approx(0.5 + 3 * 0.02)


def test_confidence_hard_capped_at_085():
    state = _state()
    for round_num in range(1, 20):
        state.update_from_round([], {"c1": {"likes_received": 50}}, round_num=round_num)
    assert state.confidence["c1"] == CONFIDENCE_CAP


def test_confidence_never_below_zero():
    state = _state()
    for round_num in range(1, 20):
        state.update_from_round([], {"c1": {"dislikes_received": 50}}, round_num=round_num)
    assert state.confidence["c1"] == 0.0


def test_trust_regresses_toward_neutral_each_round():
    state = _state()
    state.update_from_round([], {}, round_num=1)
    assert state.trust["author-1"] == pytest.approx(0.99)
    state.trust["a2"] = 0.1
    state.update_from_round([], {}, round_num=2)
    assert state.trust["a2"] == pytest.approx(0.108)


def test_author_seen_this_round_skips_trust_regression():
    state = _state()
    post = {"post_id": "p1", "concept_id": "c1", "author_id": "author-1", "stance": 1.0, "likes": 0}
    state.update_from_round([post], {}, round_num=1)
    assert state.trust["author-1"] == 1.0


def test_update_trust_actions_and_clamping():
    state = _state()
    assert state.update_trust("a2", "follow") == pytest.approx(0.6)
    assert state.update_trust("a2", "like") == pytest.approx(0.65)
    assert state.update_trust("a2", "mute") == pytest.approx(0.5)
    assert state.update_trust("a2", "unknown_action") == pytest.approx(0.5)
    state.trust["a3"] = 0.98
    assert state.update_trust("a3", "follow") == 1.0
    state.trust["a4"] = 0.02
    assert state.update_trust("a4", "mute") == 0.0


def test_update_trust_exempts_that_rounds_regression():
    state = _state()
    state.update_trust("a2", "follow")
    state.update_from_round([], {}, round_num=1)
    assert state.trust["a2"] == pytest.approx(0.6)
    # Untouched relationships still cool down in the same round.
    assert state.trust["author-1"] == pytest.approx(0.99)
    # Next round the exemption is cleared.
    state.update_from_round([], {}, round_num=2)
    assert state.trust["a2"] == pytest.approx(0.6 + (0.5 - 0.6) * 0.02)


def test_position_flip_returns_delta_event():
    state = _state()
    state.positions["c1"] = 0.05
    post = {"post_id": "p1", "concept_id": "c1", "author_id": "author-1", "stance": -1.0, "likes": 20}
    deltas = state.update_from_round([post], {}, round_num=7)
    assert state.positions["c1"] < 0.0
    assert len(deltas) == 1
    assert deltas[0]["concept_id"] == "c1"
    assert deltas[0]["round"] == 7
    assert deltas[0]["old_position"] == 0.05
    assert deltas[0]["new_position"] == state.positions["c1"]
    assert "c1" in state.recent_reflection


def test_no_flip_no_delta():
    state = _state()
    state.positions["c1"] = 0.5
    post = {"post_id": "p1", "concept_id": "c1", "author_id": "author-1", "stance": 1.0, "likes": 20}
    deltas = state.update_from_round([post], {}, round_num=1)
    assert deltas == []
    assert state.recent_reflection == ""


def test_exposure_history_capped():
    state = _state()
    posts = [
        {"post_id": f"p{i}", "concept_id": "c1", "stance": 1.0, "likes": 0}
        for i in range(EXPOSURE_CAP + 100)
    ]
    state.update_from_round(posts, {}, round_num=1)
    assert len(state.exposure_history) == EXPOSURE_CAP
    assert f"p{EXPOSURE_CAP + 99}" in state.exposure_history


def test_exposure_key_falls_back_to_content_hash():
    state = _state()
    item = {"concept_id": "c1", "content": "没有 id 的内容", "stance": 1.0, "likes": 0}
    state.update_from_round([item], {}, round_num=1)
    assert any(key.startswith("sha256:") for key in state.exposure_history)


def test_pick_counter_exposure_selects_strongest_opposition():
    state = _state()
    state.positions = {"c1": 0.6, "c2": -0.4}
    candidates = [
        {"post_id": "same-side", "concept_id": "c1", "stance": "supportive"},
        {"post_id": "mild", "concept_id": "c1", "stance": -0.2},
        {"post_id": "strong", "concept_id": "c1", "stance": "opposing"},
        {"post_id": "neutral", "concept_id": "c1", "stance": "neutral"},
        {"post_id": "agree-negative", "concept_id": "c2", "stance": "opposing"},
    ]
    chosen = state.pick_counter_exposure(candidates)
    assert chosen is not None
    assert chosen["post_id"] == "strong"


def test_pick_counter_exposure_returns_none_without_opposition():
    state = _state()
    state.positions = {"c1": 0.6}
    assert state.pick_counter_exposure([{"post_id": "x", "concept_id": "c1", "stance": "supportive"}]) is None
    assert state.pick_counter_exposure([]) is None


def test_to_dict_from_dict_round_trip():
    state = _state()
    state.exposure_history.update({"p1", "p2"})
    state.recent_reflection = "我改变了看法"
    payload = json.dumps(state.to_dict(), ensure_ascii=False)
    restored = BeliefState.from_dict(json.loads(payload))
    assert restored.positions == state.positions
    assert restored.confidence == state.confidence
    assert restored.trust == state.trust
    assert restored.exposure_history == state.exposure_history
    assert restored.recent_reflection == state.recent_reflection


def test_from_dict_tolerates_missing_keys():
    state = BeliefState.from_dict({})
    assert state.positions == {}
    assert state.confidence == {}
    assert state.trust == {}
    assert state.exposure_history == set()
    assert state.recent_reflection == ""


def test_to_prompt_text_mentions_state():
    state = _state()
    state.recent_reflection = "我改变了看法"
    text = state.to_prompt_text()
    assert "c1" in text
    assert "author-1" in text
    assert "我改变了看法" in text
