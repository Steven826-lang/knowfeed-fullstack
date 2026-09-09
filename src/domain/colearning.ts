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
    agents: payload.agents.map((a: { agent_id: string; display_name: string; handle: string; bio: string }) => ({
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
    posts: payload.posts.map((p: {
      post_id: string;
      concept_id: string;
      agent_id: string | null;
      author: { agent_id: string; display_name: string; handle: string; bio: string } | null;
      content: string;
      stance: string;
      heat: number;
      comment_count: number;
      like_count: number;
      dislike_count: number;
      created_at: string;
    }) => ({
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
  const mapComment = (c: unknown): ColearningComment => {
    const raw = c as {
      comment_id: string;
      parent_comment_id: string | null;
      agent_id: string | null;
      author: { agent_id: string; display_name: string; handle: string; bio: string } | null;
      content: string;
      stance: string;
      relation: string;
      heat: number;
      like_count: number;
      dislike_count: number;
      created_at: string;
      replies?: unknown[];
    };
    return {
      commentId: raw.comment_id,
      parentCommentId: raw.parent_comment_id,
      agentId: raw.agent_id,
      author: raw.author ? { agentId: raw.author.agent_id, displayName: raw.author.display_name, handle: raw.author.handle, bio: raw.author.bio } : null,
      content: raw.content,
      stance: raw.stance,
      relation: raw.relation,
      heat: raw.heat,
      likeCount: raw.like_count,
      dislikeCount: raw.dislike_count,
      createdAt: raw.created_at,
      replies: (raw.replies ?? []).map(mapComment),
    };
  };
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
    comments: (payload.comments as unknown[]).map(mapComment),
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
