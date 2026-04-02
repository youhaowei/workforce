/** Shell - Main application layout (sidebar | sessions | content | artifact | chatinfo | task). */

import { useState, useEffect, useRef, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { Outlet, useNavigate, useLocation } from "@tanstack/react-router";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ShellProvider } from "@/ui/context/ShellContext";
import { useCurrentView } from "@/ui/hooks/useCurrentView";
import { useShellStore } from "@/ui/stores/shellStore";

import { ThemePanel } from "../Theme/ThemePanel";
import { ChatInfoPanel } from "../ChatInfo";
import { ArtifactPanel } from "../Artifact";
import { SessionsPanel } from "../Sessions";
import { ProjectsPanel, CreateProjectDialog } from "../Project";
import { ConfirmDialog } from "./ConfirmDialog";
import { AgentQuestionDialog } from "./AgentQuestionDialog";
import { useAgentQuestionStore } from "@/ui/stores/useAgentQuestionStore";
import { useHotkey } from "@/ui/hotkeys";
import { usePlatform } from "@/ui/context/PlatformProvider";
import { getServerPort } from "@/bridge/config";
import { useMessagesStore } from "@/ui/stores/useMessagesStore";
import { useRequiredOrgId } from "@/ui/hooks/useRequiredOrgId";
import { useTRPC } from "@/bridge/react";
import { trpc as trpcClient } from "@/bridge/trpc";
import { queryClient } from "@/bridge/query-client";
import { getEventBus } from "@/shared/event-bus";
import type { Project } from "@/services/types";
import AppSidebar from "./AppSidebar";
import TopBar from "./AppHeader";
import { MainContentColumn } from "./MainContentColumn";
import { Surface } from "@/components/ui/surface";
import { useActiveSessionTitle } from "./useActiveSessionTitle";
import { useForkActions } from "./useForkActions";
import { useAgentStream } from "./useAgentStream";
import { usePlanMode } from "@/ui/hooks/usePlanMode";
import { useArtifactPanel } from "@/ui/hooks/useArtifactPanel";
import {
  SESSIONS_PANEL_STORAGE_KEY,
  VIEW_STORAGE_KEY,
  SELECTED_SESSION_STORAGE_KEY,
  checkServerConnection,
} from "./shellHelpers";

export type ViewType =
  | "home"
  | "board"
  | "queue"
  | "sessions"
  | "projects"
  | "templates"
  | "workflows"
  | "orgs"
  | "audit"
  | "detail";
export type SidebarMode = "expanded" | "collapsed";

// oxlint-disable-next-line complexity
export default function Shell() {
  const { isDesktop } = usePlatform();
  const location = useLocation();
  const navigate = useNavigate();
  const currentView = useCurrentView();
  const pathname = location.pathname;

  // UI state from shell store (for panels, sidebar, etc.)
  const themePanelOpen = useShellStore((s) => s.themePanelOpen);
  const setThemePanelOpen = useShellStore((s) => s.setThemePanelOpen);
  const sessionsPanelCollapsed = useShellStore((s) => s.sessionsPanelCollapsed);
  const setSessionsPanelCollapsed = useShellStore((s) => s.setSessionsPanelCollapsed);
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
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(
    () => localStorage.getItem(SELECTED_SESSION_STORAGE_KEY),
  );
  const [projectsPanelCollapsed, setProjectsPanelCollapsed] = useState(false);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);

  const cancelStreamRef = useRef<(() => void) | null>(null);
  const activeSessionRef = useRef<string | null>(selectedSessionId);
  const lastLoadedSessionRef = useRef<string | null>(null);
  const planReadyRef = useRef<(path: string, sessId: string | null) => void>(() => {});

  const trpc = useTRPC();
  const orgId = useRequiredOrgId();

  const messages = useMessagesStore((s) => s.messages);
  const isStreaming = useMessagesStore((s) => s.isStreaming);
  const finishStreamingMessage = useMessagesStore((s) => s.finishStreamingMessage);
  const clearMessages = useMessagesStore((s) => s.clearMessages);
  const loadMessages = useMessagesStore((s) => s.loadMessages);
  const setCurrentTool = useMessagesStore((s) => s.setCurrentTool);

  const { data: projects = [] } = useQuery(
    trpc.project.list.queryOptions({ orgId }),
  );

  const activeSessionTitle = useActiveSessionTitle({
    orgId,
    selectedSessionId,
    serverConnected,
  });

  const showSessionsView = pathname.startsWith('/sessions');

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

  const navigateToDetail = useCallback((sessionId: string) => {
    setSelectedAgentId(sessionId);
    navigate({ to: `/agent/${sessionId}` });
  }, [navigate]);
  const navigateBack = useCallback(() => {
    setSelectedAgentId(null);
    navigate({ to: '/board' });
  }, [navigate]);

  const cancelActiveStream = useCallback(() => {
    trpcClient.agent.cancel.mutate().catch(() => { /* best-effort */ });
    if (cancelStreamRef.current) {
      cancelStreamRef.current();
      cancelStreamRef.current = null;
    }
    setCurrentTool(null);
  }, [setCurrentTool]);

  const handleCancel = useCallback(() => {
    const sessId = activeSessionRef.current;
    const msgId = useMessagesStore.getState().streamingMessageId;
    cancelActiveStream();
    useAgentQuestionStore.getState().clear();
    if (sessId && msgId) {
      trpcClient.session.streamAbort
        .mutate({ sessionId: sessId, messageId: msgId, reason: "user_cancelled" })
        .catch(() => { /* best-effort */ });
    }
    finishStreamingMessage();
  }, [cancelActiveStream, finishStreamingMessage]);

  const toggleSidebarSize = useCallback(() => {
    setSidebarMode(sidebarMode === "expanded" ? "collapsed" : "expanded");
  }, [sidebarMode, setSidebarMode]);

  const toggleSessionsPanel = useCallback(() => {
    setSessionsPanelCollapsed(!sessionsPanelCollapsed);
  }, [sessionsPanelCollapsed, setSessionsPanelCollapsed]);

  const toggleInfoPanel = useCallback(() => {
    setInfoPanelCollapsed(!infoPanelCollapsed);
  }, [infoPanelCollapsed, setInfoPanelCollapsed]);

  const toggleProjectsPanel = useCallback(() => {
    setProjectsPanelCollapsed((prev) => !prev);
  }, []);

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

  const handleSelectSession = useCallback(
    (sessionId: string) => {
      const hasMessages = useMessagesStore.getState().messages.length > 0;
      if (sessionId === activeSessionRef.current && hasMessages) return;

      cancelActiveStream();
      finishStreamingMessage();
      useAgentQuestionStore.getState().clear();
      setNewSessionProjectId(null);
      clearMessages();
      setActiveSession(sessionId);
      setSelectedSessionId(sessionId);
      activeSessionRef.current = sessionId;
      lastLoadedSessionRef.current = null;
      navigate({ to: '/sessions/$id', params: { id: sessionId } });
      queryClient.invalidateQueries({
        queryKey: trpc.session.messages.queryKey({ sessionId }),
      });
    },
    [cancelActiveStream, finishStreamingMessage, setNewSessionProjectId, clearMessages, setActiveSession, trpc, navigate],
  );

  const handleDeleteSession = useCallback(
    (sessionId: string) => {
      if (sessionId !== activeSessionRef.current) return;
      cancelActiveStream();
      useAgentQuestionStore.getState().clear();
      clearMessages();
      setActiveSession(null);
      setSelectedSessionId(null);
      setNewSessionProjectId(null);
      activeSessionRef.current = null;
      lastLoadedSessionRef.current = null;
      localStorage.removeItem(SELECTED_SESSION_STORAGE_KEY);
    },
    [cancelActiveStream, clearMessages, setActiveSession, setNewSessionProjectId],
  );

  const handleCreateSession = useCallback(() => {
    cancelActiveStream();
    useAgentQuestionStore.getState().clear();
    clearMessages();
    setActiveSession(null);
    setSelectedSessionId(null);
    setNewSessionProjectId(currentView === "projects" ? selectedProjectId : null);
    activeSessionRef.current = null;
    lastLoadedSessionRef.current = null;
    navigate({ to: '/sessions' });
    setSessionsPanelCollapsed(false);
    localStorage.setItem(SESSIONS_PANEL_STORAGE_KEY, "false");
  }, [cancelActiveStream, clearMessages, setActiveSession, setNewSessionProjectId, currentView, selectedProjectId, navigate, setSessionsPanelCollapsed]);

  const { forksMap, handleRewind, handleFork } = useForkActions({
    selectedSessionId,
    activeSessionRef,
    handleSelectSession,
    setError,
    currentView,
  });

  useHotkey("toggleHistory", toggleSessionsPanel);
  useHotkey("toggleTasks", () => setThemePanelOpen(!themePanelOpen));
  useHotkey("cancelStream", handleCancel, isStreaming);
  useHotkey("refresh", () => window.location.reload());

  useEffect(() => () => { cancelStreamRef.current?.(); }, []);

  useEffect(() => {
    localStorage.setItem(VIEW_STORAGE_KEY, currentView);
  }, [currentView]);

  useEffect(() => {
    selectedSessionId
      ? localStorage.setItem(SELECTED_SESSION_STORAGE_KEY, selectedSessionId)
      : localStorage.removeItem(SELECTED_SESSION_STORAGE_KEY);
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
    ) return;
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
    navigate({ to: '/' });
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
    isPlanMode, planPanelOpen, planTitle, planFilePath, planStatus, planContent, planLoadError, planArtifactId,
    handlePlanReady, handlePlanApprove, handlePlanReject, handlePlanClose,
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

  const handleProjectDialogOpenChange = useCallback((open: boolean) => {
    setCreateProjectDialog(open, open ? createProjectDialogSource : null);
  }, [createProjectDialogSource, setCreateProjectDialog]);

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
  const showChatInfo = showSessionsView && !!selectedSessionId && !infoPanelCollapsed;

  // Provide Shell state to route components via context
  const shellContextValue = {
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
    onCreateProjectForSession: () => {
      setCreateProjectDialog(true, "new-session");
    },
    onSubmitMessage: handleSubmit,
    onCancelStream: handleCancel,
    onDismissError: dismissError,
    onRewind: handleRewind,
    onFork: handleFork,
  };

  return (
    <ShellProvider value={shellContextValue}>
      <TooltipProvider>
      <div
        className="h-screen flex overflow-hidden shell-ground"
        data-desktop={isDesktop || undefined}
      >
        {/* Window dragging: Electron uses CSS -webkit-app-region: drag via the
            .titlebar-drag-region class in AppHeader and sidebar spacer.
            Interactive elements opt out via app-region: no-drag (set in index.html <style>). */}

        <AppSidebar
          mode={sidebarMode}
          onToggleSize={toggleSidebarSize}
        />

        <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
          <TopBar
            currentView={currentView}
            sessionTitle={activeSessionTitle}
            onBack={currentView === "detail" ? navigateBack : undefined}
            sessionsPanelCollapsed={sessionsPanelCollapsed}
            onToggleSessionsPanel={toggleSessionsPanel}
            projectsPanelCollapsed={projectsPanelCollapsed}
            onToggleProjectsPanel={toggleProjectsPanel}
            onQuickCreate={handleCreateSession}
            themePanelOpen={themePanelOpen}
            onToggleThemePanel={() => setThemePanelOpen(!themePanelOpen)}
            boardKeyword={boardKeyword}
            onBoardKeywordChange={setBoardKeyword}
            boardStatusFilter={boardStatusFilter}
            onBoardStatusFilterChange={setBoardStatusFilter}
          />

          <div className="flex-1 flex min-h-0 overflow-hidden">
            <Surface variant="main" className="flex min-w-0 flex-1 m-[0_var(--surface-inset)_var(--surface-inset)_0] rounded-[var(--surface-radius)] [contain:paint]">
            {showSessionsView && (
              <SessionsPanel
                collapsed={sessionsPanelCollapsed}
                activeSessionId={selectedSessionId ?? undefined}
                onSelectSession={handleSelectSession}
                onDeleteSession={handleDeleteSession}
                onCreateSession={handleCreateSession}
              />
            )}

            {currentView === "projects" && (
              <ProjectsPanel
                collapsed={projectsPanelCollapsed}
                selectedProjectId={selectedProjectId}
                onCollapse={toggleProjectsPanel}
                onSelectProject={setSelectedProjectId}
                onClearSelection={() => setSelectedProjectId(null)}
                onCreateProject={() => {
                  setCreateProjectDialog(true, "projects-panel");
                }}
              />
            )}

            {/* Stage: chat + artifact grouped so sessions resize pushes both */}
            <div className="flex-1 flex min-w-0 overflow-hidden">
              <MainContentColumn
                serverConnected={serverConnected}
                showFloatingPill={showSessionsView}
                sessionTitle={activeSessionTitle}
                sessionsPanelOpen={!sessionsPanelCollapsed}
                infoPanelOpen={showChatInfo}
                onToggleSessions={toggleSessionsPanel}
                onToggleInfo={toggleInfoPanel}
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
                content={artifactPanel.panelOpen ? (artifactPanel.artifact?.content ?? '') : (artifactPanel.artifact?.content ?? planContent)}
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

            <ChatInfoPanel
              isOpen={showChatInfo}
              sessionId={selectedSessionId}
              onOpenArtifact={artifactPanel.openArtifact}
            />
          </Surface>

          <ThemePanel
            isOpen={themePanelOpen}
            onClose={() => setThemePanelOpen(false)}
          />
          </div>
        </div>
      </div>

      <CreateProjectDialog
        open={createProjectDialogOpen}
        onOpenChange={handleProjectDialogOpenChange}
        onCreated={handleProjectCreated}
      />
      <ConfirmDialog />
      <AgentQuestionDialog />
      </TooltipProvider>
    </ShellProvider>
  );
}
