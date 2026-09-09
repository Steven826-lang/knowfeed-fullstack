import dataclasses
import random

from personas import Persona, generate_personas, stance_bias_for_traits


def test_generate_personas_count():
    personas = generate_personas("AI 入门", count=25)
    assert len(personas) == 25
    assert len({p.handle for p in personas}) == 25
    assert all(p.to_prompt() for p in personas)


def test_names_and_handles_unique_beyond_name_pool():
    personas = generate_personas("AI 入门", count=40, rng=random.Random(7))
    assert len(personas) == 40
    assert len({p.handle for p in personas}) == 40
    assert len({p.display_name for p in personas}) == 40
    assert len({p.agent_id for p in personas}) == 40


def test_stance_bias_for_traits_mapping():
    assert stance_bias_for_traits(["杠精", "悲观"]) < 0
    assert stance_bias_for_traits(["乐观", "随和"]) > 0
    assert stance_bias_for_traits([]) == 0.0
    assert stance_bias_for_traits(["不存在的性格"]) == 0.0
    for traits in (["杠精", "悲观", "固执", "较真"], ["乐观", "随和", "幽默", "好奇"]):
        assert -1.0 <= stance_bias_for_traits(traits) <= 1.0


def test_generated_personas_carry_community_fields():
    personas = generate_personas("AI 入门", count=20, rng=random.Random(11))
    for p in personas:
        assert 0.0 <= p.activity_level <= 1.0
        assert -1.0 <= p.stance_bias <= 1.0
        assert p.relations == []
        assert p.to_json()["stance_bias"] == p.stance_bias


def test_persona_json_roundtrip_with_new_fields():
    persona = generate_personas("AI 入门", count=20, rng=random.Random(3))[0]
    persona = dataclasses.replace(
        persona,
        relations=[{"agent_id": "x", "handle": "data_guy", "kind": "rival"}],
    )
    clone = Persona(**persona.to_json())
    assert clone == persona
    assert clone.relations[0]["kind"] == "rival"


def test_to_prompt_mentions_activity_and_relations():
    persona = generate_personas("AI 入门", count=20, rng=random.Random(5))[0]
    persona = dataclasses.replace(
        persona,
        activity_level=0.9,
        relations=[
            {"agent_id": "a", "handle": "skeptic_99", "kind": "rival"},
            {"agent_id": "b", "handle": "tl_dr", "kind": "buddy"},
        ],
    )
    prompt = persona.to_prompt()
    assert f"@{persona.handle}" in prompt
    assert persona.catchphrase in prompt
    assert "活跃度" in prompt
    assert "@skeptic_99" in prompt and "对头" in prompt
    assert "@tl_dr" in prompt and "熟人" in prompt


def test_to_prompt_without_relations_stays_unchanged_shape():
    persona = generate_personas("AI 入门", count=20, rng=random.Random(6))[0]
    prompt = persona.to_prompt()
    assert "对头" not in prompt
    assert "熟人" not in prompt
    assert prompt.endswith("会像真实网友一样轻松随意地发言。")
