import type { AppState, GeneratedKnowledgeBundle } from "./types";

const storageKey = "knowfeed.prototype.state.v1";
const bundleStorageKey = "knowfeed.prototype.generated-bundles.v1";
const bundleCacheSchemaVersion = 2;
const maxCachedBundles = 16;
type CachedGeneratedKnowledgeBundle = GeneratedKnowledgeBundle & {
  cacheSchemaVersion: typeof bundleCacheSchemaVersion;
  curriculumId: string;
};

export const defaultAppState: AppState = {
  progress: {
    activeTopic: "",
    streak: 0,
    xp: 0,
    completedLessonIds: [],
    conceptMastery: {},
    reviewQueue: []
  },
  shadowDrafts: [],
  approvedShadowPosts: [],
  postReplies: {},
  colearningWorldId: undefined,
};

export function loadAppState(): AppState {
  if (typeof window === "undefined") return defaultAppState;

  try {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) return defaultAppState;
    const parsed = JSON.parse(raw) as Partial<AppState>;
    const state: AppState = {
      ...defaultAppState,
      ...parsed,
      progress: { ...defaultAppState.progress, ...parsed.progress },
      postReplies: parsed.postReplies ?? {}
    };
    if (isLegacySampleState(state)) {
      window.localStorage.removeItem(storageKey);
      window.localStorage.removeItem(bundleStorageKey);
      return defaultAppState;
    }
    return state;
  } catch {
    return defaultAppState;
  }
}

export function saveAppState(state: AppState): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(storageKey, JSON.stringify(state));
  } catch (error) {
    if (isQuotaExceededError(error)) return;
    throw error;
  }
}

export function resetAppState(): AppState {
  if (typeof window !== "undefined") {
    window.localStorage.removeItem(storageKey);
    window.localStorage.removeItem(bundleStorageKey);
  }
  return defaultAppState;
}

export function loadGeneratedBundle(
  curriculumId: string,
  conceptId: string
): GeneratedKnowledgeBundle | undefined {
  if (typeof window === "undefined") return undefined;

  try {
    const cache = loadBundleCache();
    const bundle = cache[generatedBundleKey(curriculumId, conceptId)];
    if (!isCachedGeneratedKnowledgeBundle(bundle, curriculumId, conceptId)) return undefined;
    return bundle;
  } catch {
    return undefined;
  }
}

export function saveGeneratedBundle(
  curriculumId: string,
  conceptId: string,
  bundle: GeneratedKnowledgeBundle
): void {
  if (typeof window === "undefined") return;
  if (bundle.conceptId !== conceptId) return;

  let cache: Record<string, CachedGeneratedKnowledgeBundle>;
  try {
    cache = loadBundleCache();
  } catch {
    cache = {};
  }

  cache[generatedBundleKey(curriculumId, conceptId)] = {
    ...bundle,
    cacheSchemaVersion: bundleCacheSchemaVersion,
    curriculumId
  };
  const trimmed = Object.fromEntries(
    Object.entries(cache)
      .filter((entry): entry is [string, CachedGeneratedKnowledgeBundle] =>
        isCachedGeneratedKnowledgeBundle(entry[1])
      )
      .sort(([, left], [, right]) => Date.parse(right.generatedAt) - Date.parse(left.generatedAt))
      .slice(0, maxCachedBundles)
  );
  try {
    window.localStorage.setItem(bundleStorageKey, JSON.stringify(trimmed));
  } catch (error) {
    if (isQuotaExceededError(error)) return;
    throw error;
  }
}

function generatedBundleKey(curriculumId: string, conceptId: string): string {
  return `${curriculumId}:${conceptId}`;
}

function isLegacySampleState(state: AppState): boolean {
  return state.curriculum?.source === "sample-seed" || state.curriculum?.curriculumId === "sample-web3-curriculum";
}

function loadBundleCache(): Record<string, CachedGeneratedKnowledgeBundle> {
  if (typeof window === "undefined") return {};
  const raw = window.localStorage.getItem(bundleStorageKey);
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return Object.fromEntries(
      Object.entries(parsed).filter((entry): entry is [string, CachedGeneratedKnowledgeBundle] =>
        isCachedGeneratedKnowledgeBundle(entry[1])
      )
    );
  } catch {
    return {};
  }
}

function isQuotaExceededError(error: unknown): boolean {
  return (
    error instanceof DOMException &&
    (error.name === "QuotaExceededError" || error.code === 22)
  );
}

function isCachedGeneratedKnowledgeBundle(
  value: unknown,
  expectedCurriculumId?: string,
  expectedConceptId?: string
): value is CachedGeneratedKnowledgeBundle {
  const bundle = value as CachedGeneratedKnowledgeBundle;
  if (
    !bundle ||
    bundle.cacheSchemaVersion !== bundleCacheSchemaVersion ||
    typeof bundle.curriculumId !== "string" ||
    (expectedCurriculumId && bundle.curriculumId !== expectedCurriculumId) ||
    !["research-llm", "llm", "fallback"].includes(bundle.source) ||
    typeof bundle.conceptId !== "string" ||
    (expectedConceptId && bundle.conceptId !== expectedConceptId) ||
    typeof bundle.generatedAt !== "string" ||
    !bundle.lesson ||
    typeof bundle.lesson.title !== "string" ||
    !bundle.post ||
    bundle.post.conceptId !== bundle.conceptId ||
    typeof bundle.post.body !== "string" ||
    !Array.isArray(bundle.comments) ||
    !bundle.shadowDraft ||
    bundle.shadowDraft.conceptId !== bundle.conceptId ||
    typeof bundle.shadowDraft.body !== "string"
  ) {
    return false;
  }

  const commentIds = new Set(bundle.comments.map((comment) => comment.id));
  return bundle.comments.every((comment) =>
    (comment.replies ?? []).every((reply) => reply.replyToCommentId === comment.id && commentIds.has(reply.replyToCommentId))
  );
}
