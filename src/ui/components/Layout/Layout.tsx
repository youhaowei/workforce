/** Layout - Main application layout orchestrator. */

import { useState, useEffect, useRef, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { Outlet, useNavigate, useLocation } from "@tanstack/react-router";
import { useCurrentView } from "@/ui/hooks/useCurrentView";
import { useShellStore } from "@/ui/stores/shellStore";

import { ThemePanel } from "../Theme/ThemePanel";
import { ChatInfoPanel } from "../ChatInfo";
import { ArtifactPanel } from "../Artifact";
import { useHotkey } from "@/ui/hotkeys";
import { usePlatform } from "@/ui/context/PlatformProvider";
import { getServerPort } from "@/bridge/config";
import { useMessagesStore } from "@/ui/stores/useMessagesStore";
import { useRequiredOrgId } from "@/ui/hooks/useRequiredOrgId";
import { useTRPC } from "@/bridge/react";
import { getEventBus } from "@/shared/event-bus";
import type { Project } from "@/services/types";
import AppSidebar from "./AppSidebar";
import AppTopBar from "./AppTopBar";
import { MainContentColumn } from "./MainContentColumn";
import { Sidebar } from "@/components/ui/sidebar";
import { Workspace } from "@/components/ui/workspace";
import { Dock } from "@/components/ui/dock";
import { useActiveSessionInfo } from "./useActiveSessionInfo";
import { useSessionProjectPath } from "@/ui/hooks/useSessionProjectPath";
import { useForkActions } from "./useForkActions";
import { useAgentStream } from "./useAgentStream";
import { usePlanMode } from "@/ui/hooks/usePlanMode";
import { useArtifactPanel } from "@/ui/hooks/useArtifactPanel";
import {
  VIEW_STORAGE_KEY,
  SELECTED_SESSION_STORAGE_KEY,
  checkServerConnection,
} from "./shellHelpers";
import { ShellProviders } from "./ShellProviders";
import { useSessionActions } from "./useSessionActions";

export type { ViewType } from "@/ui/hooks/useCurrentView";
export type { SidebarMode } from "@/ui/stores/shellStore";

// oxlint-disable-next-line complexity
export default function Layout() {
  const { isDesktop } = usePlatform();
  const location = useLocation();
  const navigate = useNavigate();
  const currentView = useCurrentView();
  const pathname = location.pathname;

  // UI state from shell store (for panels, sidebar, etc.)
  const rightSidebarOpen = useShellStore((s) => s.rightSidebarOpen);
  const setRightSidebarOpen = useShellStore((s) => s.setRightSidebarOpen);
  const infoPanelCollapsed = useShellStore((s) => s.infoPanelCollapsed);
  const setInfoPanelCollapsed = useShellStore((s) => s.setInfoPanelCollapsed);
  const sidebarMode = useShellStore((s) => s.sidebarMode);
  const setSidebarMode = useShellStore((s) => s.setSidebarMode);
  const serverConnected = useShellStore((s) => s.serverConnected);
  const setServerConnected = useShellStore((s) => s.setServerConnected);
  const error = useShellStore((s) => s.error);
  const setError = useShellStore((s) => s.setError);
  const boardKeyword = useShellStore((s) => s.boardKeyword);
  const setBoardKeyword = useShellStore((s) => s.setBoardKeyword);
  const boardStatusFilter = useShellStore((s) => s.boardStatusFilter);
  const setBoardStatusFilter = useShellStore((s) => s.setBoardStatusFilter);
  const createProjectDialogOpen = useShellStore((s) => s.createProjectDialogOpen);
  const createProjectDialogSource = useShellStore((s) => s.createProjectDialogSource);
  const setCreateProjectDialog = useShellStore((s) => s.setCreateProjectDialog);
  const newSessionProjectId = useShellStore((s) => s.newSessionProjectId);
  const setNewSessionProjectId = useShellStore((s) => s.setNewSessionProjectId);

  // Local state for session/project selection
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(() =>
    localStorage.getItem(SELECTED_SESSION_STORAGE_KEY),
  );
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);

  const cancelStreamRef = useRef<(() => void) | null>(null);
  const activeSessionRef = useRef<string | null>(selectedSessionId);
  const lastLoadedSessionRef = useRef<string | null>(null);
  const planReadyRef = useRef<(path: string, sessId: string | null) => void>(() => {});

  const trpc = useTRPC();
  const orgId = useRequiredOrgId();

  const messages = useMessagesStore((s) => s.messages);
  const isStreaming = useMessagesStore((s) => s.isStreaming);
  const loadMessages = useMessagesStore((s) => s.loadMessages);

  const { data: projects = [] } = useQuery(trpc.project.list.queryOptions({ orgId }));

  const { title: activeSessionTitle, projectName: activeProjectName } = useActiveSessionInfo({
    orgId,
    selectedSessionId,
    serverConnected,
    projects: projects as Project[],
  });

  const projectRootPath = useSessionProjectPath({
    sessionId: selectedSessionId,
    projects: projects as Project[],
    serverConnected,
  });

  const showSessionsView = pathname.startsWith("/sessions");

  // Dev mode: include git branch + port in document.title for multi-instance debugging.
  useEffect(() => {
    const branch = import.meta.env.VITE_GIT_BRANCH;
    const port = getServerPort();
    const devPrefix = branch ? `[${branch}${port ? ` :${port}` : ""}] ` : "";
    const pageTitle = activeSessionTitle || "Workforce";
    document.title = devPrefix + pageTitle;
  }, [activeSessionTitle]);

  useEffect(() => {
    setSelectedProjectId(null);
    setNewSessionProjectId(null);
  }, [orgId, setNewSessionProjectId]);

  const navigateToDetail = useCallback(
    (sessionId: string) => {
      setSelectedAgentId(sessionId);
      navigate({ to: `/agent/${sessionId}` });
    },
    [navigate],
  );
  const navigateBack = useCallback(() => {
    setSelectedAgentId(null);
    navigate({ to: "/board" });
  }, [navigate]);

  // TECH DEBT: useAgentStream is called twice because setActiveSession is needed
  // before restoredMessages is available (hooks can't be conditional). The first
  // call's effects are no-ops because restoredMessages is null. The second call's
  // effects overwrite the first's sendMessage registration. This is safe because
  // React processes effects in order, but fragile. TODO: split useAgentStream into
  // useActiveSession() + useAgentStream() to eliminate the double-call.
  const { setActiveSession } = useAgentStream({
    selectedSessionId,
    orgId,
    newSessionProjectId,
    isStreaming,
    restoredMessages: null,
    cancelStreamRef,
    activeSessionRef,
    planReadyRef,
    trpcQueryKeys: { sessionList: (input) => trpc.session.list.queryKey(input) },
    setSelectedSessionId,
    setNewSessionProjectId,
    setError,
  });

  const {
    handleCancel,
    handleSelectSession,
    handleDeleteSession,
    handleCreateSession,
    clearMessages,
  } = useSessionActions({
    selectedProjectId,
    currentView,
    cancelStreamRef,
    activeSessionRef,
    lastLoadedSessionRef,
    setActiveSession,
    setSelectedSessionId,
  });

  const sidebarHidden = sidebarMode === "collapsed";
  const [sidebarPeek, setSidebarPeek] = useState(false);

  const toggleSidebarSize = useCallback(() => {
    setSidebarMode(sidebarMode === "expanded" ? "collapsed" : "expanded");
    setSidebarPeek(false);
  }, [sidebarMode, setSidebarMode]);

  const handleSidebarPeekLeave = useCallback(() => {
    setSidebarPeek(false);
  }, []);

  const handleSelectProject = useCallback(
    (projectId: string) => {
      setSelectedProjectId(projectId);
      navigate({ to: "/projects" });
    },
    [navigate],
  );

  const toggleInfoPanel = useCallback(() => {
    setInfoPanelCollapsed(!infoPanelCollapsed);
  }, [infoPanelCollapsed, setInfoPanelCollapsed]);

  const { forksMap, handleRewind, handleFork } = useForkActions({
    selectedSessionId,
    activeSessionRef,
    handleSelectSession,
    setError,
    currentView,
  });

  useHotkey("toggleHistory", toggleSidebarSize);
  useHotkey("toggleTasks", () => setRightSidebarOpen(!rightSidebarOpen));
  useHotkey("cancelStream", handleCancel, isStreaming);
  useHotkey("refresh", () => window.location.reload());

  useEffect(
    () => () => {
      cancelStreamRef.current?.();
    },
    [],
  );

  useEffect(() => {
    localStorage.setItem(VIEW_STORAGE_KEY, currentView);
  }, [currentView]);

  useEffect(() => {
    if (selectedSessionId) {
      localStorage.setItem(SELECTED_SESSION_STORAGE_KEY, selectedSessionId);
    } else {
      localStorage.removeItem(SELECTED_SESSION_STORAGE_KEY);
    }
  }, [selectedSessionId]);

  // Restore session messages via React Query
  const restoreEnabled = !!selectedSessionId && showSessionsView && !isStreaming;
  const { data: restoredMessages, error: restoreError } = useQuery(
    trpc.session.messages.queryOptions(
      { sessionId: selectedSessionId! },
      { enabled: restoreEnabled, staleTime: Infinity, retry: 2, retryDelay: 1000 },
    ),
  );

  // Sync restored messages into the Zustand store
  useEffect(() => {
    if (!selectedSessionId || !restoredMessages) return;
    if (
      lastLoadedSessionRef.current === selectedSessionId &&
      useMessagesStore.getState().messages.length > 0
    )
      return;
    lastLoadedSessionRef.current = selectedSessionId;
    setActiveSession(selectedSessionId);
    activeSessionRef.current = selectedSessionId;
    loadMessages(restoredMessages);
  }, [selectedSessionId, restoredMessages, setActiveSession, loadMessages]);

  // Agent stream (submit + reconnection + question registration) — uses restoredMessages
  const { handleSubmit } = useAgentStream({
    selectedSessionId,
    orgId,
    newSessionProjectId,
    isStreaming,
    restoredMessages,
    cancelStreamRef,
    activeSessionRef,
    planReadyRef,
    trpcQueryKeys: { sessionList: (input) => trpc.session.list.queryKey(input) },
    setSelectedSessionId,
    setNewSessionProjectId,
    setError,
  });

  // On permanent failure, clear selection gracefully
  useEffect(() => {
    if (!restoreError) return;
    console.error("[Shell] Session restore failed after retries:", restoreError);
    setSelectedSessionId(null);
    activeSessionRef.current = null;
    lastLoadedSessionRef.current = null;
    setActiveSession(null);
    clearMessages();
    navigate({ to: "/" });
    localStorage.removeItem(SELECTED_SESSION_STORAGE_KEY);
  }, [restoreError, setActiveSession, clearMessages, navigate]);

  useEffect(() => {
    const id = setInterval(async () => {
      setServerConnected(await checkServerConnection());
    }, 5000);
    return () => clearInterval(id);
  }, [setServerConnected]);

  useEffect(() => {
    return getEventBus().on("BridgeError", (e) => {
      setError((e as { error: string }).error);
      setTimeout(() => setError(null), 5000);
    });
  }, [setError]);

  // Plan mode
  const {
    isPlanMode,
    planPanelOpen,
    planTitle,
    planFilePath,
    planStatus,
    planContent,
    planLoadError,
    planArtifactId,
    handlePlanReady,
    handlePlanApprove,
    handlePlanReject,
    handlePlanClose,
  } = usePlanMode({
    orgId,
    selectedSessionId,
    messages,
    onCancelStream: handleCancel,
    onSubmit: handleSubmit,
  });
  planReadyRef.current = handlePlanReady;

  // Artifact panel (review, comments, artifact list)
  const artifactPanel = useArtifactPanel({
    planArtifactId,
    sessionId: selectedSessionId,
    onApprove: handlePlanApprove,
    onReject: handlePlanReject,
  });

  const handleProjectDialogOpenChange = useCallback(
    (open: boolean) => {
      setCreateProjectDialog(open, open ? createProjectDialogSource : null);
    },
    [createProjectDialogSource, setCreateProjectDialog],
  );

  const handleProjectCreated = useCallback(
    (projectId: string) => {
      setSelectedProjectId(projectId);
      if (createProjectDialogSource === "new-session") {
        setNewSessionProjectId(projectId);
      }
    },
    [createProjectDialogSource, setNewSessionProjectId],
  );

  const dismissError = useCallback(() => setError(null), [setError]);
  const openSettings = useCallback(() => navigate({ to: "/orgs" }), [navigate]);
  const showChatInfo = showSessionsView && !!selectedSessionId && !infoPanelCollapsed;

  return (
    <ShellProviders
      contextValue={{
        selectedSessionId,
        selectedProjectId,
        selectedAgentId,
        newSessionProjectId,
        messages,
        isStreaming,
        forksMap,
        projects: projects as Project[],
        boardKeyword,
        boardStatusFilter,
        error,
        onSelectSession: handleSelectSession,
        onSelectProject: setSelectedProjectId,
        onSelectAgent: navigateToDetail,
        onBackFromDetail: navigateBack,
        onStartChat: handleCreateSession,
        onNewSessionProjectChange: setNewSessionProjectId,
        onCreateProjectForSession: () => setCreateProjectDialog(true, "new-session"),
        onSubmitMessage: handleSubmit,
        onCancelStream: handleCancel,
        onDismissError: dismissError,
        onOpenSettings: openSettings,
        onRewind: handleRewind,
        onFork: handleFork,
      }}
      createProjectDialogOpen={createProjectDialogOpen}
      onProjectDialogOpenChange={handleProjectDialogOpenChange}
      onProjectCreated={handleProjectCreated}
    >
      <div
        className="h-screen flex flex-col overflow-hidden shell-ground relative"
        data-desktop={isDesktop || undefined}
      >
        {sidebarHidden && !sidebarPeek && (
          <div
            className="absolute left-0 top-0 bottom-0 w-3 z-30"
            onMouseEnter={() => setSidebarPeek(true)}
            aria-hidden="true"
          />
        )}

        <AppTopBar
          sidebarOpen={!sidebarHidden}
          onToggleSidebar={toggleSidebarSize}
          projectName={activeProjectName}
          sessionTitle={activeSessionTitle}
          onQuickCreate={handleCreateSession}
          rightSidebarOpen={rightSidebarOpen}
          onToggleRightSidebar={() => setRightSidebarOpen(!rightSidebarOpen)}
          currentView={currentView}
          boardKeyword={boardKeyword}
          onBoardKeywordChange={setBoardKeyword}
          boardStatusFilter={boardStatusFilter}
          onBoardStatusFilterChange={setBoardStatusFilter}
        />

        <div className="flex-1 flex gap-[var(--surface-inset)] min-h-0 overflow-hidden relative">
          <Sidebar
            side="left"
            open={!sidebarHidden}
            peek={sidebarPeek}
            onMouseLeave={handleSidebarPeekLeave}
          >
            <AppSidebar
              selectedProjectId={selectedProjectId}
              selectedSessionId={selectedSessionId}
              onSelectProject={handleSelectProject}
              onSelectSession={handleSelectSession}
              onDeleteSession={handleDeleteSession}
              onCreateSession={handleCreateSession}
            />
          </Sidebar>

          <Workspace>
            <div className="flex-1 flex min-w-0 overflow-hidden">
              <MainContentColumn
                serverConnected={serverConnected}
                showFloatingPill={showSessionsView}
                infoPanelOpen={showChatInfo}
                projectRootPath={projectRootPath}
                onToggleInfo={toggleInfoPanel}
                onGitClick={() => {
                  if (infoPanelCollapsed) toggleInfoPanel();
                }}
              >
                <Outlet />
              </MainContentColumn>

              <ArtifactPanel
                isOpen={planPanelOpen || artifactPanel.panelOpen}
                isPlanMode={isPlanMode}
                isPlanArtifact={!!planArtifactId && !artifactPanel.panelOpen}
                title={artifactPanel.artifact?.title ?? planTitle}
                filePath={artifactPanel.artifact?.filePath ?? planFilePath}
                status={artifactPanel.artifact?.status ?? planStatus}
                content={
                  artifactPanel.panelOpen
                    ? (artifactPanel.artifact?.content ?? "")
                    : (artifactPanel.artifact?.content ?? planContent)
                }
                loadError={planLoadError}
                comments={artifactPanel.pendingComments}
                sessionArtifacts={artifactPanel.sessionArtifacts}
                activeArtifactId={artifactPanel.activeArtifactId}
                onAddComment={artifactPanel.addComment}
                onSubmitReview={artifactPanel.submitReview}
                onApprove={artifactPanel.handleApprove}
                onReject={artifactPanel.handleReject}
                onClose={artifactPanel.panelOpen ? artifactPanel.closePanel : handlePlanClose}
                onSelectArtifact={artifactPanel.openArtifact}
              />
            </div>

            <Dock side="right" open={showChatInfo}>
              <ChatInfoPanel
                isOpen={showChatInfo}
                sessionId={selectedSessionId}
                projectRootPath={projectRootPath}
                onOpenArtifact={artifactPanel.openArtifact}
              />
            </Dock>
          </Workspace>

          <Sidebar side="right" open={rightSidebarOpen} width={288}>
            <ThemePanel isOpen={rightSidebarOpen} onClose={() => setRightSidebarOpen(false)} />
          </Sidebar>
        </div>
      </div>
    </ShellProviders>
  );
}
