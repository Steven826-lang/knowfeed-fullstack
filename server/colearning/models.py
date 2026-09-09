"""Pydantic models for API requests/responses."""

from typing import Any, Literal

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


# ---------------------------------------------------------------------------
# Learning community (spec section 9)
# ---------------------------------------------------------------------------

# Post/comment stance values already used by the posts.stance column (spec 3.1).
Stance = Literal["supportive", "opposing", "neutral", "question", "sharing"]


class CreateCommunityWorldRequest(BaseModel):
    session_key: str = Field(min_length=1)
    topic_id: str = Field(min_length=1)
    topic_title: str = Field(min_length=1)
    current_concept_id: str | None = None
    concept_ids: list[str] = []
    concept_title: str | None = None


class CreateCommunityWorldResponse(BaseModel):
    world_id: str
    restored: bool
    agent_count: int
    initialization_scheduled: bool
    status: str


class CommunityFeedRequest(BaseModel):
    """recommender.UserContext fields plus paging (spec 7.1 data sources)."""

    background: str = ""
    goal: str = ""
    motivation: str = ""
    known_areas: list[str] = []
    avoided_styles: list[str] = []
    review_queue: list[Any] = []
    current_concept_id: str | None = None
    seen_post_ids: list[str] = []
    preferences: list[Any] = []
    limit: int = Field(default=10, ge=1, le=50)
    cursor: str | None = None


class FeedAuthor(BaseModel):
    display_name: str | None = None
    handle: str | None = None


class CommunityFeedPost(BaseModel):
    post_id: str
    concept_id: str
    agent_id: str | None = None
    user_id: str | None = None
    author: FeedAuthor | None = None
    content: str
    stance: str
    heat: int
    is_hot: bool
    comment_count: int
    like_count: int
    dislike_count: int
    created_at: str
    score: float
    reason: str
    reason_code: str
    signals: dict[str, float]


class CommunityFeedResponse(BaseModel):
    world_id: str
    posts: list[CommunityFeedPost]
    next_cursor: str | None = None
    # "While you were away" card from a >24h catch-up tick (spec 6.4).
    briefing: dict[str, Any] | None = None
    ticked: bool = False
    tick_mode: str | None = None


class CommunityCommentOut(BaseModel):
    comment_id: str
    parent_comment_id: str | None = None
    agent_id: str | None = None
    user_id: str | None = None
    author: AgentOut | None = None
    content: str
    stance: str
    relation: str
    thread_path: str | None = None
    heat: int
    like_count: int
    dislike_count: int
    is_op: bool = False
    created_at: str
    replies: list["CommunityCommentOut"] = []


class CommunityPostDetailResponse(BaseModel):
    post_id: str
    world_id: str
    concept_id: str
    agent_id: str | None = None
    user_id: str | None = None
    author: AgentOut | None = None
    content: str
    stance: str
    post_status: str | None = None
    is_hot: bool = False
    heat: int
    comment_count: int
    like_count: int
    dislike_count: int
    created_at: str
    comments: list[CommunityCommentOut]


class NewPostRequest(BaseModel):
    world_id: str = Field(min_length=1)
    user_id: str = Field(min_length=1)
    content: str = Field(min_length=1, max_length=4000)
    stance: Stance = "sharing"
    concept_id: str | None = None


class NewPostResponse(BaseModel):
    post_id: str
    world_id: str
    # The post renders immediately; agent replies arrive via mini-tick (spec 6.3).
    status: str
    created_at: str


class NewCommentRequest(BaseModel):
    post_id: str = Field(min_length=1)
    user_id: str = Field(min_length=1)
    content: str = Field(min_length=1, max_length=4000)
    parent_comment_id: str | None = None
    stance: Stance = "neutral"


class NewCommentResponse(BaseModel):
    comment_id: str
    post_id: str
    thread_path: str
    status: str
    created_at: str


class ReactionRequest(BaseModel):
    target_type: Literal["post", "comment"]
    target_id: str = Field(min_length=1)
    user_id: str = Field(min_length=1)
    reaction_type: Literal["like", "dislike"]


class ReactionResponse(BaseModel):
    ok: bool
    target_type: str
    target_id: str
    user_reaction: str
    like_count: int
    dislike_count: int


class FollowRequest(BaseModel):
    user_id: str = Field(min_length=1)
    agent_id: str = Field(min_length=1)
    follow: bool = True


class FollowResponse(BaseModel):
    ok: bool
    followed: bool
    follower_count: int


class InitResponse(BaseModel):
    world_id: str
    scheduled: bool
    already_initialized: bool


class TickResponse(BaseModel):
    world_id: str
    ticked: bool
    reason: str | None = None
    result: dict[str, Any] | None = None


class AgentPostItem(BaseModel):
    post_id: str
    content: str
    stance: str
    created_at: str


class AgentCommentItem(BaseModel):
    comment_id: str
    post_id: str
    content: str
    stance: str
    created_at: str


class AgentProfileResponse(BaseModel):
    agent_id: str
    display_name: str
    handle: str
    bio: str
    persona: dict[str, Any]
    karma: int
    post_count: int
    comment_count: int
    follower_count: int
    # Fixed AI-resident badge (spec 8.5): every community agent is an AI.
    is_ai: bool
    last_active_at: str | None = None
    created_at: str
    recent_posts: list[AgentPostItem]
    recent_comments: list[AgentCommentItem]


class CommunityStatusResponse(BaseModel):
    world_id: str
    topic_id: str
    topic_title: str
    current_concept_id: str | None = None
    status: str
    agent_count: int
    post_count: int
    comment_count: int
    reaction_count: int
    follow_count: int
    last_tick_at: str | None = None
    needs_initialization: bool | None = None
    catchup_mode: str | None = None
