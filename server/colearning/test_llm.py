import pytest
from unittest.mock import AsyncMock, MagicMock, patch
from personas import generate_personas
from llm import build_observation_text, generate_action


def test_build_observation_text():
    persona = generate_personas("AI 入门", count=1)[0]
    text = build_observation_text({
        "topic_title": "AI 入门",
        "concept_title": "大模型是什么",
        "lesson_snippet": "大模型通过海量文本学习模式",
        "community_notes": "你常反驳 @data_guy",
        "recent_posts": [{"id": "p1", "type": "post", "author": "@data_guy", "content": "大模型就是统计机器。"}],
    })
    assert "当前主题" in text
    assert "create_post" in text
    assert "post_id=p1" in text
    assert persona.handle in persona.to_prompt()


@pytest.mark.asyncio
async def test_generate_action_retries_on_429():
    persona = generate_personas("AI 入门", count=1)[0]
    observation = {
        "topic_title": "AI 入门",
        "concept_title": "大模型是什么",
        "recent_posts": [],
    }
    responses = [
        AsyncMock(status_code=429, raise_for_status=MagicMock(), json=MagicMock(return_value={})),
        AsyncMock(status_code=429, raise_for_status=MagicMock(), json=MagicMock(return_value={})),
        AsyncMock(status_code=200, raise_for_status=MagicMock(), json=MagicMock(return_value={"content": '{"action": "do_nothing"}'})),
    ]
    mock_client = AsyncMock()
    mock_client.__aenter__ = AsyncMock(return_value=mock_client)
    mock_client.__aexit__ = AsyncMock(return_value=False)
    mock_client.post = AsyncMock(side_effect=responses)

    with patch("llm.httpx.AsyncClient", return_value=mock_client):
        result = await generate_action(persona, observation)

    assert result == {"action": "do_nothing"}
    assert mock_client.post.call_count == 3


@pytest.mark.asyncio
async def test_generate_action_raises_after_three_429s():
    persona = generate_personas("AI 入门", count=1)[0]
    observation = {
        "topic_title": "AI 入门",
        "concept_title": "大模型是什么",
        "recent_posts": [],
    }
    response = AsyncMock(status_code=429, raise_for_status=MagicMock(side_effect=Exception("rate limited")))
    response.json = MagicMock(return_value={})
    mock_client = AsyncMock()
    mock_client.__aenter__ = AsyncMock(return_value=mock_client)
    mock_client.__aexit__ = AsyncMock(return_value=False)
    mock_client.post = AsyncMock(return_value=response)

    with patch("llm.httpx.AsyncClient", return_value=mock_client):
        with pytest.raises(Exception):
            await generate_action(persona, observation)

    assert mock_client.post.call_count == 3
