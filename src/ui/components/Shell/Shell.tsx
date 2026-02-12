/**
 * Shell - Main application layout.
 *
 * Four-column layout: sidebar | sessions panel | content column (TopBar → banners → main → StatusBar) | task panel.
 * Sessions and task panels are persistent full-height siblings. Board filters are lifted to TopBar.
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AlertCircle, WifiOff } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { TooltipProvider } from '@/components/ui/tooltip';

import { TaskPanel } from '../Task';
import { SessionsPanel, SessionsView } from '../Sessions';
import { BoardView } from '../Board';
import { ReviewQueue } from '../Review';
import { AgentDetailView } from '../AgentDetail';
import { TemplateListView } from '../Templates';
import { WorkflowListView } from '../Workflows';
import { AuditView } from '../Audit';
import { OrgListView } from '../Org/OrgListView';
import { HomeView } from '../Home';
import { useHotkey } from '@/ui/hotkeys';
import { useMessagesStore } from '@/ui/stores/useMessagesStore';
import { useSdkStore } from '@/ui/stores/useSdkStore';
import { useOrgStore } from '@/ui/stores/useOrgStore';
import { useTRPC } from '@/bridge/react';
import { trpc as trpcClient } from '@/bridge/trpc';
import { getEventBus } from '@/shared/event-bus';
import AppSidebar from './AppSidebar';
import TopBar from './AppHeader';
import StatusBar from './StatusBar';

export type ViewType = 'home' | 'board' | 'queue' | 'sessions' | 'templates' | 'workflows' | 'orgs' | 'audit' | 'detail';
export type SidebarMode = 'expanded' | 'collapsed' | 'hidden';

const SERVER_URL = 'http://localhost:4096';
const SIDEBAR_STORAGE_KEY = 'workforce-sidebar-mode';
const SESSIONS_PANEL_STORAGE_KEY = 'workforce-sessions-collapsed';

async function checkServerConnection(): Promise<boolean> {
  try {
    const response = await fetch(`${SERVER_URL}/health`, { method: 'GET' });
    return response.ok;
  } catch {
    return false;
  }
}

function ShellContent() {
  const [currentView, setCurrentView] = useState<ViewType>('home');
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [taskPanelOpen, setTaskPanelOpen] = useState(false);
  const [sessionsPanelCollapsed, setSessionsPanelCollapsed] = useState(
    () => localStorage.getItem(SESSIONS_PANEL_STORAGE_KEY) === 'true',
  );
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [serverConnected, setServerConnected] = useState(false);
  const [sidebarMode, setSidebarMode] = useState<SidebarMode>(() => {
    const stored = localStorage.getItem(SIDEBAR_STORAGE_KEY);
    // Backward compat: old key stored 'true'/'false'
    if (stored === 'true') return 'collapsed';
    if (stored === 'collapsed' || stored === 'hidden') return stored;
    return 'expanded';
  });
  const cancelStreamRef = useRef<(() => void) | null>(null);
  const intendedSessionRef = useRef<string | null>(null);
  const streamSeqRef = useRef(0);

  // Board filter state — lifted here so TopBar and BoardView share it
  const [boardKeyword, setBoardKeyword] = useState('');
  const [boardStatusFilter, setBoardStatusFilter] = useState('all');

  const trpc = useTRPC();
  const orgId = useOrgStore((s) => s.currentOrgId);
  const setCurrentOrgId = useOrgStore((s) => s.setCurrentOrgId);

  const messages = useMessagesStore((s) => s.messages);
  const isStreaming = useMessagesStore((s) => s.isStreaming);
  const addUserMessage = useMessagesStore((s) => s.addUserMessage);
  const startAssistantMessage = useMessagesStore((s) => s.startAssistantMessage);
  const appendToStreamingMessage = useMessagesStore((s) => s.appendToStreamingMessage);
  const finishStreamingMessage = useMessagesStore((s) => s.finishStreamingMessage);
  const clearMessages = useMessagesStore((s) => s.clearMessages);
  const setActiveSession = useMessagesStore((s) => s.setActiveSession);
  const loadMessages = useMessagesStore((s) => s.loadMessages);
  const cumulativeUsage = useSdkStore((s) => s.cumulativeUsage);
  const currentQueryStats = useSdkStore((s) => s.currentQueryStats);

  const { data: currentOrg } = useQuery(
    trpc.org.getCurrent.queryOptions(undefined, { enabled: serverConnected }),
  );

  useEffect(() => {
    if (currentOrg?.id && !orgId) {
      setCurrentOrgId(currentOrg.id);
    }
  }, [currentOrg, orgId, setCurrentOrgId]);

  const navigateToDetail = useCallback((sessionId: string) => {
    setSelectedAgentId(sessionId);
    setCurrentView('detail');
  }, []);

  const navigateBack = useCallback(() => {
    setSelectedAgentId(null);
    setCurrentView('board');
  }, []);

  const handleCancel = useCallback(() => {
    trpcClient.agent.cancel.mutate().catch(() => {/* best-effort */});
    if (cancelStreamRef.current) {
      cancelStreamRef.current();
      cancelStreamRef.current = null;
    }
    // Abort persistent stream if active
    const msgId = useMessagesStore.getState().streamingMessageId;
    const sessId = selectedSessionId;
    if (sessId && msgId) {
      trpcClient.session.streamAbort.mutate({
        sessionId: sessId, messageId: msgId, reason: 'user_cancelled',
      }).catch(() => {/* best-effort */});
    }
    finishStreamingMessage();
  }, [finishStreamingMessage, selectedSessionId]);

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

  const handleSelectSession = useCallback((sessionId: string, messages?: Array<{ id: string; role: string; content: string; timestamp: number }>) => {
    if (sessionId === intendedSessionRef.current) return;
    intendedSessionRef.current = sessionId;
    clearMessages();
    setActiveSession(sessionId);
    setSelectedSessionId(sessionId);
    setCurrentView('sessions');
    // Load messages passed from the caller (already fetched via session.list)
    if (messages?.length) {
      loadMessages(messages);
    }
  }, [clearMessages, setActiveSession, loadMessages]);

  const handleCreateSession = useCallback(() => {
    // Cancel any active stream (client + server) before starting fresh
    trpcClient.agent.cancel.mutate().catch(() => {/* best-effort */});
    if (cancelStreamRef.current) {
      cancelStreamRef.current();
      cancelStreamRef.current = null;
    }
    // clearMessages resets messages, streamingMessageId, streamingContent, and isStreaming
    clearMessages();
    setActiveSession(null);
    setSelectedSessionId(null);
    setCurrentView('sessions');
    // Ensure sessions panel is visible
    setSessionsPanelCollapsed(false);
    localStorage.setItem(SESSIONS_PANEL_STORAGE_KEY, 'false');
  }, [clearMessages, setActiveSession]);

  useHotkey('toggleHistory', toggleSessionsPanel);
  useHotkey('toggleTasks', () => setTaskPanelOpen((prev) => !prev));
  useHotkey('cancelStream', handleCancel, isStreaming);

  useEffect(() => {
    return () => {
      cancelStreamRef.current?.();
    };
  }, []);

  useEffect(() => {
    const checkConnection = async () => {
      const connected = await checkServerConnection();
      setServerConnected(connected);
    };
    checkConnection();
    const interval = setInterval(checkConnection, 5000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    const bus = getEventBus();
    const unsubError = bus.on('BridgeError', (event) => {
      setError((event as { error: string }).error);
      setTimeout(() => setError(null), 5000);
    });
    return unsubError;
  }, []);

  const handleSubmit = useCallback((content: string) => {
    const userMsgId = addUserMessage(content);
    const assistantMsgId = startAssistantMessage();
    streamSeqRef.current = 0;

    const sessId = selectedSessionId;

    // Persist user message + start assistant stream (best-effort, don't block UI)
    if (sessId) {
      trpcClient.session.addMessage.mutate({
        sessionId: sessId,
        message: { id: userMsgId, role: 'user' as const, content, timestamp: Date.now() },
      }).catch(() => {/* best-effort */});
      trpcClient.session.streamStart.mutate({
        sessionId: sessId, messageId: assistantMsgId,
      }).catch(() => {/* best-effort */});
    }

    const subscription = trpcClient.agent.query.subscribe(
      { prompt: content },
      {
        onData: (data) => {
          if (data.type === 'token') {
            appendToStreamingMessage(data.data);
            // Persist delta (fire-and-forget)
            if (sessId) {
              const seq = streamSeqRef.current++;
              trpcClient.session.streamDelta.mutate({
                sessionId: sessId, messageId: assistantMsgId, delta: data.data, seq,
              }).catch(() => {/* best-effort */});
            }
          } else if (data.type === 'done') {
            // Assemble full content before finishing (Zustand hasn't committed yet)
            const fullContent = useMessagesStore.getState().streamingContent;
            finishStreamingMessage();
            cancelStreamRef.current = null;
            // Persist finalized message
            if (sessId) {
              trpcClient.session.streamFinalize.mutate({
                sessionId: sessId,
                messageId: assistantMsgId,
                fullContent: fullContent.trim(),
                stopReason: 'end_turn',
              }).catch(() => {/* best-effort */});
            }
          } else if (data.type === 'error') {
            finishStreamingMessage();
            setError(data.data);
            cancelStreamRef.current = null;
            // Persist abort
            if (sessId) {
              trpcClient.session.streamAbort.mutate({
                sessionId: sessId, messageId: assistantMsgId, reason: data.data,
              }).catch(() => {/* best-effort */});
            }
          }
        },
        onError: (err) => {
          finishStreamingMessage();
          setError(err instanceof Error ? err.message : String(err));
          cancelStreamRef.current = null;
          // Persist abort
          if (sessId) {
            trpcClient.session.streamAbort.mutate({
              sessionId: sessId, messageId: assistantMsgId,
              reason: err instanceof Error ? err.message : String(err),
            }).catch(() => {/* best-effort */});
          }
        },
      },
    );
    cancelStreamRef.current = () => subscription.unsubscribe();
  }, [addUserMessage, startAssistantMessage, appendToStreamingMessage, finishStreamingMessage, selectedSessionId]);

  const dismissError = useCallback(() => setError(null), []);

  const renderMainView = () => {
    switch (currentView) {
      case 'board':
        return (
          <BoardView
            onSelectAgent={navigateToDetail}
            keyword={boardKeyword}
            statusFilter={boardStatusFilter}
          />
        );
      case 'queue':
        return <ReviewQueue />;
      case 'detail':
        return selectedAgentId ? (
          <AgentDetailView sessionId={selectedAgentId} onBack={navigateBack} onNavigateToChild={navigateToDetail} />
        ) : null;
      case 'home':
        return (
          <HomeView
            onStartChat={handleCreateSession}
            onNavigate={setCurrentView}
            onSelectSession={handleSelectSession}
          />
        );
      case 'sessions':
        return (
          <SessionsView
            sessionId={selectedSessionId}
            messages={messages}
            isStreaming={isStreaming}
            onSubmit={handleSubmit}
            onCancel={handleCancel}
          />
        );
      case 'templates':
        return <TemplateListView />;
      case 'workflows':
        return <WorkflowListView />;
      case 'orgs':
        return <OrgListView />;
      case 'audit':
        return <AuditView />;
      default:
        return null;
    }
  };

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
            onCreateSession={handleCreateSession}
            onCollapse={toggleSessionsPanel}
          />
        )}

        {/* Content column — TopBar only spans this area */}
        <div className="flex-1 flex flex-col min-w-0 overflow-hidden relative">
          <TopBar
            currentView={currentView}
            onBack={currentView === 'detail' ? navigateBack : undefined}
            sidebarHidden={sidebarMode === 'hidden'}
            onToggleSidebar={toggleSidebarVisibility}
            sessionsPanelCollapsed={sessionsPanelCollapsed}
            onToggleSessionsPanel={toggleSessionsPanel}
            taskPanelOpen={taskPanelOpen}
            onToggleTask={() => setTaskPanelOpen((prev) => !prev)}
            onQuickCreate={handleCreateSession}
            boardKeyword={boardKeyword}
            onBoardKeywordChange={setBoardKeyword}
            boardStatusFilter={boardStatusFilter}
            onBoardStatusFilterChange={setBoardStatusFilter}
          />

          {/* Server Not Connected Banner */}
          {!serverConnected && (
            <div className="px-4 py-3 bg-muted/50 border-b flex items-center gap-3">
              <WifiOff className="h-4 w-4 text-muted-foreground" />
              <div>
                <p className="text-sm font-medium">Server not connected</p>
                <p className="text-xs text-muted-foreground">
                  Run <code className="bg-muted px-1.5 py-0.5 rounded text-xs font-mono">bun run server</code> to start
                </p>
              </div>
            </div>
          )}

          {/* Error Banner */}
          {error && (
            <div className="px-4 py-2 bg-destructive/10 border-b flex items-center justify-between">
              <div className="flex items-center gap-2">
                <AlertCircle className="h-4 w-4 text-destructive" />
                <span className="text-sm text-destructive">{error}</span>
              </div>
              <Button variant="ghost" size="sm" onClick={dismissError} className="text-destructive h-7">
                Dismiss
              </Button>
            </div>
          )}

          {/* Main Content */}
          <main className="flex-1 flex flex-col overflow-hidden">
            {renderMainView()}
          </main>

          {currentView === 'sessions' && (
            <StatusBar
              isStreaming={isStreaming}
              cumulativeUsage={cumulativeUsage}
              currentQueryStats={currentQueryStats}
              messageCount={messages.length}
            />
          )}
        </div>

        {/* Task panel — full height, same level as sidebar and sessions */}
        <TaskPanel
          isOpen={taskPanelOpen}
          onClose={() => setTaskPanelOpen(false)}
        />
      </div>
    </TooltipProvider>
  );
}

export default function Shell() {
  return <ShellContent />;
}
