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
