import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildFallbackBundle } from "./fallbackGenerator";
import { loadAppState, loadGeneratedBundle, saveGeneratedBundle, saveAppState } from "./storage";
import { defaultAppState } from "./storage";

const bundleStorageKey = "knowfeed.prototype.generated-bundles.v1";
const curriculumId = "sample-web3-curriculum";
const conceptId = "wallet";

describe("generated bundle storage", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("rehydrates a cache entry only when the curriculum and concept bindings match", () => {
    const bundle = buildFallbackBundle(defaultAppState, conceptId);

    saveGeneratedBundle(curriculumId, conceptId, bundle);

    expect(loadGeneratedBundle(curriculumId, conceptId)?.post.conceptId).toBe(conceptId);
    expect(loadGeneratedBundle("other-curriculum", conceptId)).toBeUndefined();
  });

  it("rejects legacy or internally mismatched generated bundle cache entries", () => {
    const bundle = buildFallbackBundle(defaultAppState, conceptId);
    window.localStorage.setItem(
      bundleStorageKey,
      JSON.stringify({
        [`${curriculumId}:${conceptId}`]: bundle,
        [`${curriculumId}:gas`]: {
          ...bundle,
          cacheSchemaVersion: 2,
          curriculumId,
          conceptId: "gas",
          post: { ...bundle.post, conceptId },
          shadowDraft: { ...bundle.shadowDraft, conceptId: "gas" }
        }
      })
    );

    expect(loadGeneratedBundle(curriculumId, conceptId)).toBeUndefined();
    expect(loadGeneratedBundle(curriculumId, "gas")).toBeUndefined();
  });
});

describe("app state storage", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("does not restore the legacy Web3 sample seed as a first-use curriculum", () => {
    window.localStorage.setItem(
      "knowfeed.prototype.state.v1",
      JSON.stringify({
        ...defaultAppState,
        curriculum: {
          curriculumId: "sample-web3-curriculum",
          source: "sample-seed",
          title: "Web3 入门：看懂链上世界的争论",
          concepts: [],
          lessons: []
        }
      })
    );
    window.localStorage.setItem(bundleStorageKey, JSON.stringify({ stale: true }));

    expect(loadAppState()).toEqual(defaultAppState);
    expect(window.localStorage.getItem("knowfeed.prototype.state.v1")).toBeNull();
    expect(window.localStorage.getItem(bundleStorageKey)).toBeNull();
  });

  it("deep-merges progress so newly added default fields are preserved", () => {
    window.localStorage.setItem(
      "knowfeed.prototype.state.v1",
      JSON.stringify({
        progress: {
          activeTopic: "ai",
          xp: 100
        }
      })
    );

    const state = loadAppState();
    expect(state.progress.activeTopic).toBe("ai");
    expect(state.progress.xp).toBe(100);
    expect(state.progress.streak).toBe(defaultAppState.progress.streak);
    expect(state.progress.completedLessonIds).toEqual(defaultAppState.progress.completedLessonIds);
    expect(state.progress.conceptMastery).toEqual(defaultAppState.progress.conceptMastery);
    expect(state.progress.reviewQueue).toEqual(defaultAppState.progress.reviewQueue);
    expect(state.shadowDrafts).toEqual(defaultAppState.shadowDrafts);
    expect(state.approvedShadowPosts).toEqual(defaultAppState.approvedShadowPosts);
  });

  it("swallows QuotaExceededError when saving app state", () => {
    const setItem = vi.spyOn(window.localStorage, "setItem").mockImplementation(() => {
      throw new DOMException("Quota exceeded", "QuotaExceededError");
    });

    expect(() => saveAppState(defaultAppState)).not.toThrow();

    setItem.mockRestore();
  });
});

describe("generated bundle storage edge cases", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("handles corrupted bundle cache JSON when saving a new bundle", () => {
    window.localStorage.setItem(bundleStorageKey, "not-json");

    const bundle = buildFallbackBundle(defaultAppState, conceptId);
    expect(() => saveGeneratedBundle(curriculumId, conceptId, bundle)).not.toThrow();
    expect(loadGeneratedBundle(curriculumId, conceptId)?.post.conceptId).toBe(conceptId);
  });

  it("cleans up bundle cache entries with mismatched schema version on save", () => {
    const bundle = buildFallbackBundle(defaultAppState, conceptId);
    const staleKey = `${curriculumId}:stale`;
    window.localStorage.setItem(
      bundleStorageKey,
      JSON.stringify({
        [`${curriculumId}:${conceptId}`]: {
          ...bundle,
          cacheSchemaVersion: 2,
          curriculumId,
          post: { ...bundle.post, conceptId },
          shadowDraft: { ...bundle.shadowDraft, conceptId }
        },
        [staleKey]: {
          ...bundle,
          cacheSchemaVersion: 1,
          curriculumId,
          conceptId: "stale",
          post: { ...bundle.post, conceptId: "stale" },
          shadowDraft: { ...bundle.shadowDraft, conceptId: "stale" }
        }
      })
    );

    saveGeneratedBundle(curriculumId, conceptId, bundle);

    const raw = window.localStorage.getItem(bundleStorageKey);
    expect(raw).toBeTruthy();
    const cache = JSON.parse(raw!);
    expect(cache[staleKey]).toBeUndefined();
    expect(cache[`${curriculumId}:${conceptId}`]).toBeDefined();
  });

  it("swallows QuotaExceededError when saving a generated bundle", () => {
    const setItem = vi.spyOn(window.localStorage, "setItem").mockImplementation(() => {
      throw new DOMException("Quota exceeded", "QuotaExceededError");
    });

    const bundle = buildFallbackBundle(defaultAppState, conceptId);
    expect(() => saveGeneratedBundle(curriculumId, conceptId, bundle)).not.toThrow();

    setItem.mockRestore();
  });
});
