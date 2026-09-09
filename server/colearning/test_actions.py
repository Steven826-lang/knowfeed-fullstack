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
    assert passes_gate(db_path, "c1", "我不太同意这个观点", "doubt")
    assert not passes_gate(db_path, "c1", "我也支持统计机器", "support")


def test_duplicate_detection(tmp_path):
    db_path = tmp_path / "test.db"
    init_db(db_path)
    world_id = create_world(db_path, "s1", "t1", "T1", "c1")
    create_post(db_path, world_id, "c1", "a1", "大模型就是统计机器", "support")
    assert is_duplicate(db_path, "c1", "大模型就是统计机器")
    assert not is_duplicate(db_path, "c1", "完全不同的观点")


def test_comment_duplicate_detection_relaxes_within_post(tmp_path):
    db_path = tmp_path / "test.db"
    init_db(db_path)
    world_id = create_world(db_path, "s1", "t1", "T1", "c1")
    post_a = create_post(db_path, world_id, "c1", "a1", "大模型就是统计机器", "support")
    post_b = create_post(db_path, world_id, "c1", "a2", "另一个帖子", "support")
    create_comment(db_path, post_a, "a1", "我觉得这个观点很有意思", "support", "add")
    # Same comment text on a different post should not be considered a duplicate.
    assert not is_duplicate(db_path, "c1", "我觉得这个观点很有意思", post_id=post_b)
    # Repeating the exact same comment on the same post should still be flagged.
    assert is_duplicate(db_path, "c1", "我觉得这个观点很有意思", post_id=post_a)
    # Posts continue to check against comments across the concept.
    assert is_duplicate(db_path, "c1", "我觉得这个观点很有意思")
