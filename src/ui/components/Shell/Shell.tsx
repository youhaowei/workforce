/** Shell - Main application layout (sidebar | sessions | content | plan | chatinfo | task). */

import { useState, useEffect, useRef, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { TooltipProvider } from "@/components/ui/tooltip";

import { ThemePanel } from "../Theme/ThemePanel";
import { ChatInfoPanel } from "../ChatInfo";
import { PlanPanel } from "../Plan";
import { SessionsPanel } from "../Sessions";
import { ProjectsPanel, CreateProjectDialog } from "../Project";
import { ConfirmDialog } from "./ConfirmDialog";
import { AgentQuestionDialog } from "./AgentQuestionDialog";
import { useAgentQuestionStore } from "@/ui/stores/useAgentQuestionStore";
import { useHotkey } from "@/ui/hotkeys";
import { usePlatform } from "@/ui/context/PlatformProvider";
import { useMessagesStore } from "@/ui/stores/useMessagesStore";
import { useRequiredOrgId } from "@/ui/hooks/useRequiredOrgId";
import { useTRPC } from "@/bridge/react";
import { trpc as trpcClient } from "@/bridge/trpc";
import { queryClient } from "@/bridge/query-client";
import { getEventBus } from "@/shared/event-bus";
import type { Project } from "@/services/types";
import AppSidebar from "./AppSidebar";
import TopBar from "./AppHeader";
import { MainViewContent } from "./MainViewContent";
import { MainContentColumn } from "./MainContentColumn";
import { Surface } from "@/components/ui/surface";
import { useActiveSessionTitle } from "./useActiveSessionTitle";
import { useForkActions } from "./useForkActions";
import { useAgentStream } from "./useAgentStream";
import { usePlanMode } from "@/ui/hooks/usePlanMode";
import {
  SIDEBAR_STORAGE_KEY,
  SESSIONS_PANEL_STORAGE_KEY,
  VIEW_STORAGE_KEY,
  SELECTED_SESSION_STORAGE_KEY,
  checkServerConnection,
  getInitialView,
  getInitialSidebarMode,
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

export default function Shell() {
  const { isDesktop } = usePlatform();
  const isElectrobun = typeof window !== 'undefined' && '__electrobunWindowId' in window;
  const [currentView, setCurrentView] = useState<ViewType>(getInitialView);
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [themePanelOpen, setThemePanelOpen] = useState(false);
  const [sessionsPanelCollapsed, setSessionsPanelCollapsed] = useState(
    () => localStorage.getItem(SESSIONS_PANEL_STORAGE_KEY) === "true",
  );
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(
    () => localStorage.getItem(SELECTED_SESSION_STORAGE_KEY),
  );
  const [serverConnected, setServerConnected] = useState(true);
  const [sidebarMode, setSidebarMode] = useState<SidebarMode>(getInitialSidebarMode);
  const cancelStreamRef = useRef<(() => void) | null>(null);
  const activeSessionRef = useRef<string | null>(selectedSessionId);
  const lastLoadedSessionRef = useRef<string | null>(null);
  const planReadyRef = useRef<(path: string, sessId: string | null) => void>(() => {});

  // Board filter state
  const [boardKeyword, setBoardKeyword] = useState("");
  const [boardStatusFilter, setBoardStatusFilter] = useState("all");
  const [createProjectDialogOpen, setCreateProjectDialogOpen] = useState(false);
  const [createProjectDialogSource, setCreateProjectDialogSource] = useState<
    "projects-panel" | "new-session" | null
  >(null);
  const [projectsPanelCollapsed, setProjectsPanelCollapsed] = useState(false);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [newSessionProjectId, setNewSessionProjectId] = useState<string | null>(null);

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

  useEffect(() => {
    setSelectedProjectId(null);
    setNewSessionProjectId(null);
  }, [orgId]);

  const navigateToDetail = useCallback((sessionId: string) => {
    setSelectedAgentId(sessionId);
    setCurrentView("detail");
  }, []);
  const navigateBack = useCallback(() => {
    setSelectedAgentId(null);
    setCurrentView("board");
  }, []);

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
    setSidebarMode((prev) => {
      const next: SidebarMode = prev === "expanded" ? "collapsed" : "expanded";
      localStorage.setItem(SIDEBAR_STORAGE_KEY, next);
      return next;
    });
  }, []);

  const toggleSessionsPanel = useCallback(() => {
    setSessionsPanelCollapsed((prev) => {
      const next = !prev;
      localStorage.setItem(SESSIONS_PANEL_STORAGE_KEY, String(next));
      return next;
    });
  }, []);

  const toggleProjectsPanel = useCallback(() => {
    setProjectsPanelCollapsed((prev) => !prev);
  }, []);

  const { setActiveSession } = useAgentStream({
    selectedSessionId,
    orgId,
    newSessionProjectId,
    isStreaming,
    restoredMessages: null, // set below after useQuery
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
      setNewSessionProjectId(null);
      clearMessages();
      setActiveSession(sessionId);
      setSelectedSessionId(sessionId);
      activeSessionRef.current = sessionId;
      lastLoadedSessionRef.current = null;
      setCurrentView("sessions");
      queryClient.invalidateQueries({
        queryKey: trpc.session.messages.queryKey({ sessionId }),
      });
    },
    [cancelActiveStream, finishStreamingMessage, clearMessages, setActiveSession, trpc],
  );

  const handleDeleteSession = useCallback(
    (sessionId: string) => {
      if (sessionId !== activeSessionRef.current) return;
      cancelActiveStream();
      clearMessages();
      setActiveSession(null);
      setSelectedSessionId(null);
      setNewSessionProjectId(null);
      activeSessionRef.current = null;
      lastLoadedSessionRef.current = null;
      localStorage.removeItem(SELECTED_SESSION_STORAGE_KEY);
    },
    [cancelActiveStream, clearMessages, setActiveSession],
  );

  const handleCreateSession = useCallback(() => {
    cancelActiveStream();
    clearMessages();
    setActiveSession(null);
    setSelectedSessionId(null);
    setNewSessionProjectId(currentView === "projects" ? selectedProjectId : null);
    activeSessionRef.current = null;
    lastLoadedSessionRef.current = null;
    setCurrentView("sessions");
    setSessionsPanelCollapsed(false);
    localStorage.setItem(SESSIONS_PANEL_STORAGE_KEY, "false");
  }, [cancelActiveStream, clearMessages, setActiveSession, currentView, selectedProjectId]);

  const { forksMap, handleRewind, handleFork } = useForkActions({
    selectedSessionId,
    activeSessionRef,
    handleSelectSession,
    setError,
    currentView,
  });

  useHotkey("toggleHistory", toggleSessionsPanel);
  useHotkey("toggleTasks", () => setThemePanelOpen((prev) => !prev));
  useHotkey("cancelStream", handleCancel, isStreaming);

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
  const restoreEnabled = !!selectedSessionId && currentView === "sessions" && !isStreaming;
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
    setCurrentView("home");
    localStorage.removeItem(SELECTED_SESSION_STORAGE_KEY);
  }, [restoreError, setActiveSession, clearMessages]);

  useEffect(() => {
    const id = setInterval(async () => {
      setServerConnected(await checkServerConnection());
    }, 5000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    return getEventBus().on("BridgeError", (e) => {
      setError((e as { error: string }).error);
      setTimeout(() => setError(null), 5000);
    });
  }, []);

  // Plan mode
  const {
    isPlanMode, planPanelOpen, planArtifact, planContent, planLoadError,
    handlePlanReady, handlePlanApprove, handlePlanReject, handlePlanClose, handleOpenPlan,
  } = usePlanMode({
    selectedSessionId,
    messages,
    onCancelStream: handleCancel,
    onSubmit: handleSubmit,
  });
  planReadyRef.current = handlePlanReady;

  const handleProjectDialogOpenChange = useCallback((open: boolean) => {
    setCreateProjectDialogOpen(open);
    if (!open) setCreateProjectDialogSource(null);
  }, []);

  const handleProjectCreated = useCallback(
    (projectId: string) => {
      setSelectedProjectId(projectId);
      if (createProjectDialogSource === "new-session") {
        setNewSessionProjectId(projectId);
      }
    },
    [createProjectDialogSource],
  );

  const dismissError = useCallback(() => setError(null), []);
  const showChatInfo = currentView === "sessions" && !!selectedSessionId;

  return (
    <TooltipProvider>
      <div
        className="h-screen flex overflow-hidden shell-ground"
        data-desktop={isElectrobun || isDesktop || undefined}
      >
        <AppSidebar
          currentView={currentView}
          onViewChange={setCurrentView}
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
            onToggleThemePanel={() => setThemePanelOpen((prev) => !prev)}
            boardKeyword={boardKeyword}
            onBoardKeywordChange={setBoardKeyword}
            boardStatusFilter={boardStatusFilter}
            onBoardStatusFilterChange={setBoardStatusFilter}
          />

          <div className="flex-1 flex min-h-0 overflow-hidden">
            <Surface variant="main" className="flex min-w-0 flex-1 m-[0_var(--surface-inset)_var(--surface-inset)_0] rounded-[var(--surface-radius)] [contain:paint]">
            {currentView === "sessions" && (
              <SessionsPanel
                collapsed={sessionsPanelCollapsed}
                activeSessionId={selectedSessionId ?? undefined}
                onSelectSession={handleSelectSession}
                onDeleteSession={handleDeleteSession}
                onCreateSession={handleCreateSession}
                onCollapse={toggleSessionsPanel}
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
                  setCreateProjectDialogSource("projects-panel");
                  setCreateProjectDialogOpen(true);
                }}
              />
            )}

            <MainContentColumn
              serverConnected={serverConnected}
              error={error}
              onDismissError={dismissError}
            >
              <MainViewContent
                currentView={currentView}
                selectedAgentId={selectedAgentId}
                selectedSessionId={selectedSessionId}
                selectedProjectId={selectedProjectId}
                projects={projects as Project[]}
                newSessionProjectId={newSessionProjectId}
                boardKeyword={boardKeyword}
                boardStatusFilter={boardStatusFilter}
                messages={messages}
                isStreaming={isStreaming}
                forksMap={forksMap}
                onSelectAgent={navigateToDetail}
                onBackFromDetail={navigateBack}
                onStartChat={handleCreateSession}
                onNavigate={setCurrentView}
                onSelectSession={handleSelectSession}
                onSelectProject={setSelectedProjectId}
                onNewSessionProjectChange={setNewSessionProjectId}
                onCreateProjectForSession={() => {
                  setCreateProjectDialogSource("new-session");
                  setCreateProjectDialogOpen(true);
                }}
                onSubmitMessage={handleSubmit}
                onCancelStream={handleCancel}
                onRewind={handleRewind}
                onFork={handleFork}
              />
            </MainContentColumn>

            <PlanPanel
              isOpen={planPanelOpen}
              isPlanMode={isPlanMode}
              artifact={planArtifact}
              content={planContent}
              loadError={planLoadError}
              onApprove={handlePlanApprove}
              onReject={handlePlanReject}
              onClose={handlePlanClose}
            />

            <ChatInfoPanel
              isOpen={showChatInfo}
              sessionId={selectedSessionId}
              planArtifact={planArtifact}
              onOpenPlan={handleOpenPlan}
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
  );
}
