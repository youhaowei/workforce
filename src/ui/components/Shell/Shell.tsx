/** Shell - Main application layout (sidebar | sessions | content | plan | chatinfo | task). */

import { useState, useEffect, useRef, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { TooltipProvider } from '@/components/ui/tooltip';

import { TaskPanel } from '../Task';
import { ChatInfoPanel } from '../ChatInfo';
import { PlanPanel } from '../Plan';
import { SessionsPanel } from '../Sessions';
import { ProjectsPanel, CreateProjectDialog } from '../Project';
import { ConfirmDialog } from './ConfirmDialog';
import { useHotkey } from '@/ui/hotkeys';
import { useMessagesStore } from '@/ui/stores/useMessagesStore';
import { useSdkStore } from '@/ui/stores/useSdkStore';
import { useRequiredOrgId } from '@/ui/hooks/useRequiredOrgId';
import { useTRPC } from '@/bridge/react';
import { trpc as trpcClient } from '@/bridge/trpc';
import { queryClient } from '@/bridge/query-client';
import { getEventBus } from '@/shared/event-bus';
import type { AgentConfig, Project, SessionSummary } from '@/services/types';
import { THINKING_TOKENS } from '../Messages/agentConfig';
import AppSidebar from './AppSidebar';
import { MainViewContent } from './MainViewContent';
import { MainContentColumn } from './MainContentColumn';
import { useActiveSessionTitle } from './useActiveSessionTitle';
import { usePlanMode } from '@/ui/hooks/usePlanMode';
import {
  SIDEBAR_STORAGE_KEY,
  SESSIONS_PANEL_STORAGE_KEY,
  VIEW_STORAGE_KEY,
  SELECTED_SESSION_STORAGE_KEY,
  SESSION_TITLE_MAX_LENGTH,
  checkServerConnection,
  toSessionSummary,
  handleStreamEvent,
  handleStreamError,
  getInitialView,
  getInitialSidebarMode,
} from './shellHelpers';

export type ViewType = 'home' | 'board' | 'queue' | 'sessions' | 'projects' | 'templates' | 'workflows' | 'orgs' | 'audit' | 'detail'; export type SidebarMode = 'expanded' | 'collapsed' | 'hidden';

function ShellContent() {
  const [currentView, setCurrentView] = useState<ViewType>(getInitialView);
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [taskPanelOpen, setTaskPanelOpen] = useState(false);
  const [sessionsPanelCollapsed, setSessionsPanelCollapsed] = useState(
    () => localStorage.getItem(SESSIONS_PANEL_STORAGE_KEY) === 'true',
  );
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(
    () => localStorage.getItem(SELECTED_SESSION_STORAGE_KEY),
  );
  // Start true — SetupGate guarantees server is up before Shell mounts.
  // The periodic check below detects if the server goes down later.
  const [serverConnected, setServerConnected] = useState(true);
  const [sidebarMode, setSidebarMode] = useState<SidebarMode>(getInitialSidebarMode);
  const cancelStreamRef = useRef<(() => void) | null>(null);
  const intendedSessionRef = useRef<string | null>(null);
  const activeSessionRef = useRef<string | null>(selectedSessionId);
  const streamSeqRef = useRef(0);
  const deltaBufferRef = useRef<Array<{ delta: string; seq: number }>>([]);
  const flushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Stable ref for plan-ready handler (set after usePlanMode, read inside handleSubmit closure). */
  const planReadyRef = useRef<(path: string, sessId: string | null) => void>(() => {});

  // Board filter state — lifted here so TopBar and BoardView share it
  const [boardKeyword, setBoardKeyword] = useState('');
  const [boardStatusFilter, setBoardStatusFilter] = useState('all');
  const [createProjectDialogOpen, setCreateProjectDialogOpen] = useState(false);
  const [createProjectDialogSource, setCreateProjectDialogSource] = useState<'projects-panel' | 'new-session' | null>(null);
  const [projectsPanelCollapsed, setProjectsPanelCollapsed] = useState(false);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [newSessionProjectId, setNewSessionProjectId] = useState<string | null>(null);

  const trpc = useTRPC();
  const orgId = useRequiredOrgId();

  const messages = useMessagesStore((s) => s.messages);
  const isStreaming = useMessagesStore((s) => s.isStreaming);
  const addUserMessage = useMessagesStore((s) => s.addUserMessage);
  const startAssistantMessage = useMessagesStore((s) => s.startAssistantMessage);
  const appendToStreamingMessage = useMessagesStore((s) => s.appendToStreamingMessage);
  const finishStreamingMessage = useMessagesStore((s) => s.finishStreamingMessage);
  const clearMessages = useMessagesStore((s) => s.clearMessages);
  const setActiveSession = useMessagesStore((s) => s.setActiveSession);
  const loadMessages = useMessagesStore((s) => s.loadMessages);
  const addToolActivity = useMessagesStore((s) => s.addToolActivity);
  const setCurrentTool = useMessagesStore((s) => s.setCurrentTool);
  const appendToTextBlock = useMessagesStore((s) => s.appendToTextBlock);
  const startContentBlock = useMessagesStore((s) => s.startContentBlock);
  const startToolBlock = useMessagesStore((s) => s.startToolBlock);
  const setToolResult = useMessagesStore((s) => s.setToolResult);
  const finishContentBlock = useMessagesStore((s) => s.finishContentBlock);
  const cumulativeUsage = useSdkStore((s) => s.cumulativeUsage);
  const currentQueryStats = useSdkStore((s) => s.currentQueryStats);

  const { data: projects = [] } = useQuery(
    trpc.project.list.queryOptions({ orgId }),
  );

  const activeSessionTitle = useActiveSessionTitle({ orgId, selectedSessionId, serverConnected });

  useEffect(() => {
    setSelectedProjectId(null);
    setNewSessionProjectId(null);
  }, [orgId]);

  const navigateToDetail = useCallback((sessionId: string) => { setSelectedAgentId(sessionId); setCurrentView('detail'); }, []);
  const navigateBack = useCallback(() => { setSelectedAgentId(null); setCurrentView('board'); }, []);

  /** Cancel any in-flight agent stream and flush buffered deltas. */
  const cancelActiveStream = useCallback(() => {
    trpcClient.agent.cancel.mutate().catch(() => {/* best-effort */});
    if (cancelStreamRef.current) {
      cancelStreamRef.current();
      cancelStreamRef.current = null;
    }
    setCurrentTool(null);
    const sessId = activeSessionRef.current;
    const msgId = useMessagesStore.getState().streamingMessageId;
    if (deltaBufferRef.current.length > 0 && sessId && msgId) {
      const deltas = deltaBufferRef.current;
      trpcClient.session.streamDeltaBatch.mutate({ sessionId: sessId, messageId: msgId, deltas }).catch(() => {});
    }
    deltaBufferRef.current = [];
    if (flushTimerRef.current) { clearTimeout(flushTimerRef.current); flushTimerRef.current = null; }
    streamSeqRef.current = 0;
  }, [setCurrentTool]);

  const handleCancel = useCallback(() => {
    const sessId = activeSessionRef.current;
    const msgId = useMessagesStore.getState().streamingMessageId;
    cancelActiveStream();
    if (sessId && msgId) {
      trpcClient.session.streamAbort.mutate({
        sessionId: sessId, messageId: msgId, reason: 'user_cancelled',
      }).catch(() => {/* best-effort */});
    }
    finishStreamingMessage();
  }, [cancelActiveStream, finishStreamingMessage]);

  const toggleSidebarSize = useCallback(() => {
    setSidebarMode((prev) => {
      const next: SidebarMode = prev === 'expanded' ? 'collapsed' : 'expanded';
      localStorage.setItem(SIDEBAR_STORAGE_KEY, next);
      return next;
    });
  }, []);

  const toggleSidebarVisibility = useCallback(() => {
    setSidebarMode((prev) => {
      const next: SidebarMode = prev === 'hidden' ? 'expanded' : 'hidden';
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

  const handleSelectSession = useCallback((sessionId: string) => {
    if (sessionId === activeSessionRef.current || sessionId === intendedSessionRef.current) return;
    cancelActiveStream();
    finishStreamingMessage();
    intendedSessionRef.current = sessionId;
    setNewSessionProjectId(null);
    clearMessages();
    setActiveSession(sessionId);
    setSelectedSessionId(sessionId);
    activeSessionRef.current = sessionId;
    setCurrentView('sessions');
    trpcClient.session.messages.query({ sessionId }).then((msgs) => {
      if (intendedSessionRef.current === sessionId && msgs.length > 0) {
        loadMessages(msgs);
      }
    }).catch(() => {})
      .finally(() => {
        if (intendedSessionRef.current === sessionId) {
          intendedSessionRef.current = null;
        }
      });
  }, [cancelActiveStream, finishStreamingMessage, clearMessages, loadMessages, setActiveSession]);

  const handleDeleteSession = useCallback((sessionId: string) => {
    if (sessionId !== activeSessionRef.current) return;
    cancelActiveStream();
    clearMessages();
    setActiveSession(null);
    setSelectedSessionId(null);
    setNewSessionProjectId(null);
    activeSessionRef.current = null;
    intendedSessionRef.current = null;
    localStorage.removeItem(SELECTED_SESSION_STORAGE_KEY);
  }, [cancelActiveStream, clearMessages, setActiveSession]);

  const handleCreateSession = useCallback(() => {
    cancelActiveStream();
    clearMessages();
    setActiveSession(null);
    setSelectedSessionId(null);
    setNewSessionProjectId(currentView === 'projects' ? selectedProjectId : null);
    activeSessionRef.current = null;
    intendedSessionRef.current = null;
    setCurrentView('sessions');
    setSessionsPanelCollapsed(false);
    localStorage.setItem(SESSIONS_PANEL_STORAGE_KEY, 'false');
  }, [cancelActiveStream, clearMessages, setActiveSession, currentView, selectedProjectId]);

  useHotkey('toggleHistory', toggleSessionsPanel);
  useHotkey('toggleTasks', () => setTaskPanelOpen((prev) => !prev));
  useHotkey('cancelStream', handleCancel, isStreaming);

  useEffect(() => () => { cancelStreamRef.current?.(); }, []);

  useEffect(() => { localStorage.setItem(VIEW_STORAGE_KEY, currentView); }, [currentView]);

  useEffect(() => {
    selectedSessionId ? localStorage.setItem(SELECTED_SESSION_STORAGE_KEY, selectedSessionId) : localStorage.removeItem(SELECTED_SESSION_STORAGE_KEY);
  }, [selectedSessionId]);

  const hasRestoredSession = useRef(false);
  useEffect(() => {
    if (!serverConnected || hasRestoredSession.current) return;
    if (!selectedSessionId || currentView !== 'sessions') return;
    hasRestoredSession.current = true;
    intendedSessionRef.current = selectedSessionId;
    clearMessages();
    setActiveSession(selectedSessionId);
    trpcClient.session.messages.query({ sessionId: selectedSessionId }).then((msgs) => {
      if (intendedSessionRef.current === selectedSessionId && msgs.length > 0) {
        loadMessages(msgs);
      }
    }).catch(() => {
      setSelectedSessionId(null);
      activeSessionRef.current = null;
      setActiveSession(null);
      clearMessages();
      setCurrentView('home');
      localStorage.removeItem(SELECTED_SESSION_STORAGE_KEY);
    }).finally(() => {
      if (intendedSessionRef.current === selectedSessionId) {
        intendedSessionRef.current = null;
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- fires once when server is first available
  }, [serverConnected]);

  useEffect(() => {
    const id = setInterval(async () => { setServerConnected(await checkServerConnection()); }, 5000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    return getEventBus().on('BridgeError', (e) => { setError((e as { error: string }).error); setTimeout(() => setError(null), 5000); });
  }, []);

  const handleSubmit = useCallback(({ content, agentConfig }: { content: string; agentConfig: AgentConfig }) => {
    const userMsgId = addUserMessage(content, agentConfig);
    const assistantMsgId = startAssistantMessage();
    streamSeqRef.current = 0;
    deltaBufferRef.current = [];

    const maxThinkingTokens = THINKING_TOKENS[agentConfig.thinkingLevel];

    void (async () => {
      let sessId = selectedSessionId;
      if (!sessId) {
        try {
          const projectIdForSession = newSessionProjectId ?? undefined;
          const session = await trpcClient.session.create.mutate({
            title: content.slice(0, SESSION_TITLE_MAX_LENGTH),
            orgId,
            ...(projectIdForSession && { projectId: projectIdForSession }),
          });
          sessId = session.id;
          setSelectedSessionId(sessId);
          setActiveSession(sessId);
          setNewSessionProjectId(null);
          activeSessionRef.current = sessId;
          const summary = toSessionSummary(session);
          queryClient.setQueriesData<SessionSummary[]>(
            { queryKey: trpc.session.list.queryKey({ orgId }) },
            (old) => old ? [summary, ...old] : [summary],
          );
          if (projectIdForSession) {
            queryClient.setQueriesData<SessionSummary[]>(
              { queryKey: trpc.session.list.queryKey({ orgId, projectId: projectIdForSession }) },
              (old) => old ? [summary, ...old] : [summary],
            );
          }
        } catch {
          setError('Could not save session. Your conversation is temporary.');
          setTimeout(() => setError(null), 5000);
        }
      }

      const flushDeltas = () => {
        if (deltaBufferRef.current.length === 0) return;
        const deltas = deltaBufferRef.current;
        deltaBufferRef.current = [];
        if (flushTimerRef.current) { clearTimeout(flushTimerRef.current); flushTimerRef.current = null; }
        if (sessId) {
          trpcClient.session.streamDeltaBatch.mutate({
            sessionId: sessId, messageId: assistantMsgId, deltas,
          }).catch(() => {/* best-effort */});
        }
      };

      if (sessId) {
        trpcClient.session.addMessage.mutate({
          sessionId: sessId,
          message: { id: userMsgId, role: 'user' as const, content, timestamp: Date.now(), agentConfig },
        }).catch(() => {/* best-effort */});
        trpcClient.session.streamStart.mutate({
          sessionId: sessId, messageId: assistantMsgId,
        }).catch(() => {/* best-effort */});
      }

      const subscription = trpcClient.agent.query.subscribe(
        {
          prompt: content,
          model: agentConfig.model,
          ...(maxThinkingTokens !== undefined ? { maxThinkingTokens } : {}),
          permissionMode: agentConfig.permissionMode,
        },
        {
          onData: (data) => {
            const actions = {
              appendToStreamingMessage, appendToTextBlock,
              addToolActivity, setCurrentTool,
              startToolBlock, setToolResult,
              startContentBlock, finishContentBlock,
              finishStreamingMessage, setError,
              planReady: (path: string, sid: string | null) => planReadyRef.current(path, sid),
              onDelta: (delta: string) => {
                if (sessId) {
                  deltaBufferRef.current.push({ delta, seq: streamSeqRef.current++ });
                  if (!flushTimerRef.current) {
                    flushTimerRef.current = setTimeout(flushDeltas, 150);
                  }
                }
              },
              flushDeltas,
            };
            handleStreamEvent(data as { type: string; [key: string]: unknown }, sessId, assistantMsgId, actions, cancelStreamRef);
          },
          onError: (err) => {
            handleStreamError(err, sessId, assistantMsgId, { finishStreamingMessage, setError, flushDeltas }, cancelStreamRef);
          },
        },
      );
      cancelStreamRef.current = () => subscription.unsubscribe();
    })();
  }, [addUserMessage, startAssistantMessage, appendToStreamingMessage, finishStreamingMessage, addToolActivity, setCurrentTool, appendToTextBlock, startContentBlock, startToolBlock, setToolResult, finishContentBlock, newSessionProjectId, orgId, selectedSessionId, setActiveSession, trpc]);

  // Plan mode (extracted to keep Shell under max-lines)
  const {
    isPlanMode, planPanelOpen, planArtifact, planContent, planLoadError,
    handlePlanReady, handlePlanApprove, handlePlanReject, handlePlanClose, handleOpenPlan,
  } = usePlanMode({ selectedSessionId, messages, onCancelStream: handleCancel, onSubmit: handleSubmit });
  planReadyRef.current = handlePlanReady;

  const handleProjectDialogOpenChange = useCallback((open: boolean) => {
    setCreateProjectDialogOpen(open);
    if (!open) setCreateProjectDialogSource(null);
  }, []);

  const handleProjectCreated = useCallback((projectId: string) => {
    setSelectedProjectId(projectId);
    if (createProjectDialogSource === 'new-session') {
      setNewSessionProjectId(projectId);
    }
  }, [createProjectDialogSource]);

  const dismissError = useCallback(() => setError(null), []);

  const showChatInfo = currentView === 'sessions' && !!selectedSessionId;

  return (
    <TooltipProvider>
      <div className="h-screen flex bg-background overflow-hidden">
        <AppSidebar
          currentView={currentView}
          onViewChange={setCurrentView}
          mode={sidebarMode}
          onToggleSize={toggleSidebarSize}
        />

        {/* Sessions panel — only visible on sessions view */}
        {currentView === 'sessions' && (
          <SessionsPanel
            collapsed={sessionsPanelCollapsed}
            activeSessionId={selectedSessionId ?? undefined}
            onSelectSession={handleSelectSession}
            onDeleteSession={handleDeleteSession}
            onCreateSession={handleCreateSession}
            onCollapse={toggleSessionsPanel}
          />
        )}

        {/* Projects panel — only visible on projects view */}
        {currentView === 'projects' && (
          <ProjectsPanel
            collapsed={projectsPanelCollapsed}
            selectedProjectId={selectedProjectId}
            onCollapse={toggleProjectsPanel}
            onSelectProject={setSelectedProjectId}
            onClearSelection={() => setSelectedProjectId(null)}
            onCreateProject={() => {
              setCreateProjectDialogSource('projects-panel');
              setCreateProjectDialogOpen(true);
            }}
          />
        )}

        <MainContentColumn
          currentView={currentView}
          sessionTitle={activeSessionTitle}
          onBack={currentView === 'detail' ? navigateBack : undefined}
          sidebarMode={sidebarMode}
          sessionsPanelCollapsed={sessionsPanelCollapsed}
          onToggleSidebar={toggleSidebarVisibility}
          onToggleSessionsPanel={toggleSessionsPanel}
          projectsPanelCollapsed={projectsPanelCollapsed}
          onToggleProjectsPanel={toggleProjectsPanel}
          taskPanelOpen={taskPanelOpen}
          onToggleTask={() => setTaskPanelOpen((prev) => !prev)}
          onQuickCreate={handleCreateSession}
          boardKeyword={boardKeyword}
          onBoardKeywordChange={setBoardKeyword}
          boardStatusFilter={boardStatusFilter}
          onBoardStatusFilterChange={setBoardStatusFilter}
          serverConnected={serverConnected}
          error={error}
          onDismissError={dismissError}
          isStreaming={isStreaming}
          cumulativeUsage={cumulativeUsage}
          currentQueryStats={currentQueryStats}
          messageCount={messages.length}
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
            onSelectAgent={navigateToDetail}
            onBackFromDetail={navigateBack}
            onStartChat={handleCreateSession}
            onNavigate={setCurrentView}
            onSelectSession={handleSelectSession}
            onSelectProject={setSelectedProjectId}
            onNewSessionProjectChange={setNewSessionProjectId}
            onCreateProjectForSession={() => { setCreateProjectDialogSource('new-session'); setCreateProjectDialogOpen(true); }}
            onSubmitMessage={handleSubmit}
            onCancelStream={handleCancel}
          />
        </MainContentColumn>

        {/* Plan panel — slides in when plan mode is active or plan is ready */}
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

        {/* Chat info panel — session metadata, always visible in sessions view */}
        <ChatInfoPanel
          isOpen={showChatInfo}
          sessionId={selectedSessionId}
          planArtifact={planArtifact}
          onOpenPlan={handleOpenPlan}
        />

        {/* Task panel — full height, same level as sidebar and sessions */}
        <TaskPanel
          isOpen={taskPanelOpen}
          onClose={() => setTaskPanelOpen(false)}
        />
      </div>

      <CreateProjectDialog
        open={createProjectDialogOpen}
        onOpenChange={handleProjectDialogOpenChange}
        onCreated={handleProjectCreated}
      />
      <ConfirmDialog />
    </TooltipProvider>
  );
}

export default function Shell() {
  return <ShellContent />;
}
