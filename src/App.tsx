import { useEffect, useMemo, useRef, useState } from "react";
import { AgentProfile } from "./components/AgentProfile";
import { HomeFeed } from "./components/HomeFeed";
import { KnowledgeMap } from "./components/KnowledgeMap";
import { MicroLesson } from "./components/MicroLesson";
import { NewPost } from "./components/NewPost";
import { Onboarding, type BuildStageId } from "./components/Onboarding";
import { PathPreview } from "./components/PathPreview";
import { PhoneShell } from "./components/PhoneShell";
import { PostDetail } from "./components/PostDetail";
import { SettingsPanel } from "./components/SettingsPanel";
import { initializeStateForCurriculum, validateCurriculumDraft } from "./domain/curriculumValidator";
import { buildFallbackBundle } from "./domain/fallbackGenerator";
import { generateKnowledgeBundle, selectRenderableBundle } from "./domain/generationEngine";
import { completeLesson, getDailyMission, getMissionForConcept } from "./domain/learningEngine";
import { buildProfiles } from "./domain/profileBuilder";
import { fetchResearchBrief } from "./domain/researchEngine";
import { createColearningWorld } from "./domain/colearning";
import { createCommunityWorld } from "./domain/communityApi";
import { loadAppState, loadGeneratedBundle, resetAppState, saveAppState, saveGeneratedBundle } from "./domain/storage";
import { generateCurriculumDraft } from "./domain/topicPlanner";
import type { AppState, GeneratedKnowledgeBundle, LessonResult, LocalReply, OnboardingInput, Screen } from "./domain/types";

export default function App() {
  const [state, setState] = useState<AppState>(() => loadAppState());
  const [screen, setScreen] = useState<Screen>(state.curriculum ? "feed" : "onboarding");
  const mission = useMemo(() => getDailyMission(state), [state]);
  const initialActiveConceptId = useRef(resolveInitialActiveConceptId(state));
  const [activeConceptId, setActiveConceptId] = useState(initialActiveConceptId.current);
  const [activePostId, setActivePostId] = useState<string | undefined>(undefined);
  const [activeAgentId, setActiveAgentId] = useState<string | undefined>(undefined);
  const agentReturnScreenRef = useRef<Screen>("feed");
  const activeMission = useMemo(() => getMissionForConcept(state, activeConceptId), [state, activeConceptId]);
  const curriculum = state.curriculum;
  const initialFulfilledBundleKey = useRef("");
  const [bundle, setBundle] = useState<GeneratedKnowledgeBundle | null>(() => {
    const cached = curriculum ? loadGeneratedBundle(curriculum.curriculumId, initialActiveConceptId.current) : undefined;
    if (cached && cached.source !== "fallback") {
      initialFulfilledBundleKey.current = bundleKeyFor(curriculum?.curriculumId ?? "", initialActiveConceptId.current);
    }
    // 如果没有 curriculum，不要调用 buildFallbackBundle（会导致报错）
    return cached ?? (state.curriculum ? buildFallbackBundle(state, initialActiveConceptId.current) : null);
  });
  const [isGenerating, setIsGenerating] = useState(false);
  const [isBuildingCurriculum, setIsBuildingCurriculum] = useState(false);
  const [buildStage, setBuildStage] = useState<BuildStageId | undefined>();
  const [buildStatus, setBuildStatus] = useState("");
  const [buildError, setBuildError] = useState<string | undefined>();
  const [lessonHandoff, setLessonHandoff] = useState<{ lessonTitle: string; xpGained: number } | undefined>();
  const fulfilledBundleKey = useRef(initialFulfilledBundleKey.current);
  const attemptedBundleKey = useRef(initialFulfilledBundleKey.current);
  const pendingWarmBundleKeys = useRef(new Set<string>());
  const renderableBundle = useMemo(
    () => {
      // 在刚重置完、还没生成新课程时，如果不加保护会导致访问未定义 bundle 报错
      if (!bundle || !state.curriculum) {
        return null as unknown as GeneratedKnowledgeBundle;
      }
      return selectRenderableBundle(state, activeConceptId, bundle);
    },
    [activeConceptId, bundle, state]
  );

  const lastSavedStateRef = useRef<AppState | undefined>(undefined);
  const saveTimerRef = useRef<number | undefined>(undefined);
  const communityWorldAttemptRef = useRef("");

  // Lazily create/restore the community world when the learner first opens a
  // screen that needs it (spec 6.1); the world id is persisted in AppState.
  useEffect(() => {
    if (!curriculum) return;
    if (!["feed", "post", "new-post", "agent-profile"].includes(screen)) return;
    if (state.communityWorldId) return;
    const attemptKey = curriculum.topic.topicId;
    if (communityWorldAttemptRef.current === attemptKey) return;
    communityWorldAttemptRef.current = attemptKey;
    let cancelled = false;
    createCommunityWorld({
      sessionKey: curriculum.topic.topicId,
      topicId: curriculum.topic.topicId,
      topicTitle: curriculum.topic.title,
      currentConceptId: activeConceptId,
      conceptIds: curriculum.concepts.map((concept) => concept.id)
    })
      .then((world) => {
        if (!cancelled) {
          setState((current) => ({ ...current, communityWorldId: world.worldId }));
        }
      })
      .catch((error) => {
        communityWorldAttemptRef.current = "";
        console.warn("Community world creation failed", error);
      });
    return () => {
      cancelled = true;
    };
  }, [screen, curriculum, state.communityWorldId, activeConceptId]);

  useEffect(() => {
    if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current);
    saveTimerRef.current = window.setTimeout(() => {
      if (JSON.stringify(lastSavedStateRef.current) !== JSON.stringify(state)) {
        saveAppState(state);
        lastSavedStateRef.current = state;
      }
    }, 300);

    function flushSave() {
      if (saveTimerRef.current) {
        window.clearTimeout(saveTimerRef.current);
        saveTimerRef.current = undefined;
      }
      if (JSON.stringify(lastSavedStateRef.current) !== JSON.stringify(state)) {
        saveAppState(state);
        lastSavedStateRef.current = state;
      }
    }

    window.addEventListener("beforeunload", flushSave);
    return () => {
      if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current);
      window.removeEventListener("beforeunload", flushSave);
    };
  }, [state]);

  useEffect(() => {
    if (!curriculum) return;
    const bundleKey = bundleKeyFor(curriculum.curriculumId, activeConceptId);
    if (fulfilledBundleKey.current === bundleKey) return;
    const cached = loadGeneratedBundle(curriculum.curriculumId, activeConceptId);
    if (cached && cached.source !== "fallback") {
      fulfilledBundleKey.current = bundleKey;
      attemptedBundleKey.current = bundleKey;
      setBundle(cached);
      return;
    }
    if (attemptedBundleKey.current === bundleKey) return;
    let cancelled = false;
    attemptedBundleKey.current = bundleKey;
    setIsGenerating(true);
    generateKnowledgeBundle(state, activeConceptId).then((nextBundle) => {
      if (!cancelled) {
        if (nextBundle.source !== "fallback") {
          fulfilledBundleKey.current = bundleKey;
          saveGeneratedBundle(curriculum.curriculumId, activeConceptId, nextBundle);
        }
        setBundle(nextBundle);
        setIsGenerating(false);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [activeConceptId, curriculum]);

  async function handleOnboardingComplete(input: OnboardingInput) {
    setIsBuildingCurriculum(true);
    setBuildError(undefined);
    try {
      setBuildStage("profile");
      setBuildStatus("正在保存你的主题和背景");
      const { topicProfile, learnerProfile } = buildProfiles(input);
      setBuildStage("research");
      setBuildStatus("正在联网检索资料");
      const researchBrief = await fetchResearchBrief({ topicProfile, learnerProfile });
      setBuildStage("planner");
      setBuildStatus(researchBrief.source === "web" ? "已获取资料，正在让 AI 规划路径" : "资料检索不稳定，正在继续规划路径");
      const { draft, usedFallback } = await generateCurriculumDraft(topicProfile, learnerProfile, researchBrief);
      setBuildStatus(usedFallback ? "正在完成路径结构校验" : "正在固化课程 ID 和进度结构");
      const curriculum = validateCurriculumDraft(
        draft,
        topicProfile,
        learnerProfile,
        researchBrief,
        usedFallback ? "deterministic-fallback" : "planner"
      );
      const nextState = initializeStateForCurriculum(curriculum);
      const nextMission = getDailyMission(nextState);
      setBuildStage("content");
      setBuildStatus("正在生成首页微课和评论区");
      const [nextBundle, world] = await Promise.all([
        generateKnowledgeBundle(nextState, nextMission.conceptId),
        createColearningWorld(
          curriculum.topic.topicId,
          curriculum.topic.topicId,
          curriculum.topic.title,
          nextMission.conceptId,
          nextMission.title,
        ).catch((error) => {
          console.warn("Co-learning world creation failed, falling back to local bundle", error);
          return undefined;
        }),
      ]);
      if (world) {
        nextState.colearningWorldId = world.worldId;
      }
      if (nextBundle.source === "fallback" && researchBrief.source === "web" && curriculum.source === "planner") {
        throw new Error("AI 生成内容未通过质量校验，请保留表单重试");
      }
      attemptedBundleKey.current = bundleKeyFor(curriculum.curriculumId, nextMission.conceptId);
      if (nextBundle.source !== "fallback") {
        fulfilledBundleKey.current = bundleKeyFor(curriculum.curriculumId, nextMission.conceptId);
        saveGeneratedBundle(curriculum.curriculumId, nextMission.conceptId, nextBundle);
      }
      setActiveConceptId(nextMission.conceptId);
      setBundle(nextBundle);
      setState(nextState);
      setScreen("map");
      setBuildStatus("");
      setBuildStage(undefined);
    } catch (error) {
      setBuildError(error instanceof Error ? error.message : "生成路径失败，请重试");
      setBuildStatus("生成中断，表单已保留，可以直接重试");
    } finally {
      setIsBuildingCurriculum(false);
    }
  }

  function startLesson(conceptId = mission.conceptId) {
    loadBundleForConcept(conceptId);
    setActiveConceptId(conceptId);
    setLessonHandoff(undefined);
    setScreen("lesson");
  }

  function openPost(conceptId = renderableBundle.conceptId, postId?: string) {
    loadBundleForConcept(conceptId);
    setActiveConceptId(conceptId);
    setActivePostId(postId);
    setLessonHandoff(undefined);
    setScreen("post");
  }

  function openAgent(agentId: string) {
    agentReturnScreenRef.current = screen;
    setActiveAgentId(agentId);
    setScreen("agent-profile");
  }

  function handleCompleteLesson(result: LessonResult) {
    const updated = completeLesson(state, result);
    const xpGained = updated.progress.xp - state.progress.xp;
    const nextState = {
      ...updated,
      shadowDrafts: [
        { ...renderableBundle.shadowDraft, generationSource: renderableBundle.source },
        ...updated.shadowDrafts
      ].slice(0, 5)
    };
    setState(nextState);
    warmUpcomingBundle(nextState, result.conceptId);
    setLessonHandoff({ lessonTitle: activeMission.title, xpGained });
    setActivePostId(undefined);
    setScreen("post");
  }

  function approveShadowDraft(draftId: string) {
    setState((current) => {
      const draft = current.shadowDrafts.find((item) => item.id === draftId);
      if (!draft) return current;
      return {
        ...current,
        shadowDrafts: current.shadowDrafts.filter((item) => item.id !== draftId),
        approvedShadowPosts: [{ ...draft, status: "approved" }, ...current.approvedShadowPosts]
      };
    });
  }

  function updateShadowDraft(draftId: string, body: string) {
    const trimmedBody = body.trim();
    if (!trimmedBody) return;
    setState((current) => ({
      ...current,
      shadowDrafts: current.shadowDrafts.map((draft) =>
        draft.id === draftId ? { ...draft, body: trimmedBody, status: "draft" } : draft
      )
    }));
  }

  function rejectShadowDraft(draftId: string) {
    setState((current) => ({
      ...current,
      shadowDrafts: current.shadowDrafts.filter((draft) => draft.id !== draftId)
    }));
  }

  function addPostReply(postId: string, reply: LocalReply) {
    setState((current) => ({
      ...current,
      postReplies: {
        ...current.postReplies,
        [postId]: [reply, ...(current.postReplies[postId] ?? [])]
      }
    }));
  }

  function handleNavigate(nextScreen: Screen) {
    setScreen(nextScreen);
  }

  function handleReset() {
    const reset = resetAppState();
    fulfilledBundleKey.current = "";
    attemptedBundleKey.current = "";
    pendingWarmBundleKeys.current.clear();
    communityWorldAttemptRef.current = "";
    setActivePostId(undefined);
    setActiveAgentId(undefined);
    setIsBuildingCurriculum(false);
    setBuildStage(undefined);
    setBuildStatus("");
    setBuildError(undefined);
    setState(reset);
    const nextActiveConceptId = reset.curriculum ? getDailyMission(reset).conceptId : "";
    setActiveConceptId(nextActiveConceptId);
    
    // 只有在有课程的时候才生成 fallback bundle，否则重置为 null/undefined 状态
    if (reset.curriculum) {
      setBundle(buildFallbackBundle(reset, nextActiveConceptId));
    }
    
    setScreen("onboarding");
  }

  function loadBundleForConcept(conceptId: string) {
    if (!curriculum) return;
    const cached = loadGeneratedBundle(curriculum.curriculumId, conceptId);
    if (!cached || cached.source === "fallback") return;
    fulfilledBundleKey.current = bundleKeyFor(curriculum.curriculumId, conceptId);
    attemptedBundleKey.current = bundleKeyFor(curriculum.curriculumId, conceptId);
    setBundle(cached);
  }

  function warmUpcomingBundle(nextState: AppState, completedConceptId: string) {
    const nextCurriculum = nextState.curriculum;
    if (!nextCurriculum) return;
    const completedConcept = nextCurriculum.concepts.find((concept) => concept.id === completedConceptId);
    const nextMission = getDailyMission(nextState);
    const nextConceptId =
      nextMission.conceptId !== completedConceptId
        ? nextMission.conceptId
        : nextCurriculum.concepts.find((concept) => concept.order > (completedConcept?.order ?? 0))?.id;
    if (!nextConceptId || nextConceptId === completedConceptId) return;
    warmBundleForConcept(nextState, nextConceptId);
  }

  function warmBundleForConcept(nextState: AppState, conceptId: string) {
    const nextCurriculum = nextState.curriculum;
    if (!nextCurriculum) return;
    const bundleKey = bundleKeyFor(nextCurriculum.curriculumId, conceptId);
    if (pendingWarmBundleKeys.current.has(bundleKey)) return;
    if (attemptedBundleKey.current === bundleKey || fulfilledBundleKey.current === bundleKey) return;
    const cached = loadGeneratedBundle(nextCurriculum.curriculumId, conceptId);
    if (cached && cached.source !== "fallback") return;
    pendingWarmBundleKeys.current.add(bundleKey);
    void generateKnowledgeBundle(nextState, conceptId)
      .then((nextBundle) => {
        if (nextBundle.source === "fallback") return;
        saveGeneratedBundle(nextCurriculum.curriculumId, conceptId, nextBundle);
      })
      .finally(() => {
        pendingWarmBundleKeys.current.delete(bundleKey);
      });
  }

    // 必须有 renderableBundle 才能渲染这些页面
    const isRenderable = Boolean(renderableBundle && state.curriculum);

  return (
    <PhoneShell
      activeScreen={screen}
      onNavigate={handleNavigate}
      streak={state.progress.streak}
      xp={state.progress.xp}
      source={isRenderable ? renderableBundle.source : "planner"}
      isGenerating={isGenerating}
    >
      {screen === "onboarding" && (
        <Onboarding
          key={`onboarding-${state.curriculum?.curriculumId ?? 'new'}`}
          isBuilding={isBuildingCurriculum}
          activeStage={buildStage}
          statusText={buildStatus}
          errorText={buildError}
          onComplete={handleOnboardingComplete}
        />
      )}
      {isRenderable && screen === "feed" && (
        <HomeFeed
          state={state}
          mission={mission}
          bundle={renderableBundle!}
          onStartDaily={() => startLesson(mission.conceptId)}
          onStartConcept={startLesson}
          onOpenPost={(postId) => openPost(renderableBundle!.conceptId, postId)}
          onOpenMap={() => setScreen("map")}
          onOpenAgent={openAgent}
          onNewPost={() => setScreen("new-post")}
        />
      )}
      {isRenderable && screen === "path-preview" && (
        <PathPreview
          state={state}
          mission={mission}
          source={renderableBundle!.source}
          onStartDaily={() => startLesson(mission.conceptId)}
          onEnterFeed={() => setScreen("feed")}
          onOpenMap={() => setScreen("map")}
        />
      )}
      {isRenderable && screen === "lesson" && (
        <MicroLesson
          activeMission={activeMission}
          state={state}
          bundle={renderableBundle!}
          onBack={() => setScreen("feed")}
          onComplete={handleCompleteLesson}
        />
      )}
      {isRenderable && screen === "post" && (
        <PostDetail
          state={state}
          bundle={renderableBundle!}
          postId={activePostId}
          lessonHandoff={lessonHandoff}
          userReplies={state.postReplies[renderableBundle!.post.id] ?? []}
          onBack={() => setScreen("feed")}
          onDismissLessonHandoff={() => setLessonHandoff(undefined)}
          onStartLesson={() => startLesson(renderableBundle!.conceptId)}
          onAddReply={addPostReply}
          onOpenAgent={openAgent}
        />
      )}
      {isRenderable && screen === "agent-profile" && activeAgentId && (
        <AgentProfile
          state={state}
          agentId={activeAgentId}
          onBack={() => setScreen(agentReturnScreenRef.current)}
          onOpenPost={(postId) => openPost(renderableBundle!.conceptId, postId)}
        />
      )}
      {isRenderable && screen === "new-post" && (
        <NewPost
          state={state}
          worldId={state.communityWorldId}
          currentConceptId={activeConceptId}
          onCancel={() => setScreen("feed")}
          onPosted={(postId) => openPost(renderableBundle!.conceptId, postId)}
        />
      )}
      {isRenderable && screen === "settings" && (
        <SettingsPanel
          state={state}
          currentDraft={renderableBundle!.shadowDraft}
          currentSource={renderableBundle!.source}
          onApproveDraft={approveShadowDraft}
          onUpdateDraft={updateShadowDraft}
          onRejectDraft={rejectShadowDraft}
          onReset={handleReset}
        />
      )}
      {isRenderable && screen === "map" && (
        <KnowledgeMap
          state={state}
          activeConceptId={activeConceptId}
          source={renderableBundle!.source}
          onStartConcept={(conceptId) => startLesson(conceptId)}
          onReset={handleReset}
        />
      )}
    </PhoneShell>
  );
}

function bundleKeyFor(curriculumId: string, conceptId: string): string {
  return `${curriculumId}:${conceptId}`;
}

function resolveInitialActiveConceptId(state: AppState): string {
  const mission = getDailyMission(state);
  const curriculum = state.curriculum;
  const lastCompletedConceptId = state.progress.lastCompletedConceptId;
  if (!curriculum || !lastCompletedConceptId) return mission.conceptId;
  const cached = loadGeneratedBundle(curriculum.curriculumId, lastCompletedConceptId);
  if (cached && cached.source !== "fallback") return lastCompletedConceptId;
  return mission.conceptId;
}
