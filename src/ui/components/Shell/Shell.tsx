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
import { queryClient } from '@/bridge/query-client';
import { getEventBus } from '@/shared/event-bus';
import type { Session, SessionSummary } from '@/services/types';
import AppSidebar from './AppSidebar';
import TopBar from './AppHeader';
import StatusBar from './StatusBar';

export type ViewType = 'home' | 'board' | 'queue' | 'sessions' | 'templates' | 'workflows' | 'orgs' | 'audit' | 'detail';
export type SidebarMode = 'expanded' | 'collapsed' | 'hidden';

const SERVER_URL = 'http://localhost:4096';
const SIDEBAR_STORAGE_KEY = 'workforce-sidebar-mode';
const SESSIONS_PANEL_STORAGE_KEY = 'workforce-sessions-collapsed';
const VIEW_STORAGE_KEY = 'workforce-current-view';
const SELECTED_SESSION_STORAGE_KEY = 'workforce-selected-session';
const SESSION_TITLE_MAX_LENGTH = 80;

const VALID_VIEWS = new Set<ViewType>(['home', 'board', 'queue', 'sessions', 'templates', 'workflows', 'orgs', 'audit', 'detail']);

async function checkServerConnection(): Promise<boolean> {
  try {
    const response = await fetch(`${SERVER_URL}/health`, { method: 'GET' });
    return response.ok;
  } catch {
    return false;
  }
}

function toSessionSummary(session: Session): SessionSummary {
  const lastMessage = session.messages[session.messages.length - 1];
  return {
    id: session.id,
    title: session.title,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    parentId: session.parentId,
    metadata: session.metadata,
    messageCount: session.messages.length,
    lastMessagePreview: lastMessage?.content,
  };
}

function ShellContent() {
  const [currentView, setCurrentView] = useState<ViewType>(() => {
    const stored = localStorage.getItem(VIEW_STORAGE_KEY);
    if (stored && VALID_VIEWS.has(stored as ViewType)) {
      // 'detail' requires selectedAgentId which isn't persisted — fall back to board
      return stored === 'detail' ? 'board' : (stored as ViewType);
    }
    return 'home';
  });
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [taskPanelOpen, setTaskPanelOpen] = useState(false);
  const [sessionsPanelCollapsed, setSessionsPanelCollapsed] = useState(
    () => localStorage.getItem(SESSIONS_PANEL_STORAGE_KEY) === 'true',
  );
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(
    () => localStorage.getItem(SELECTED_SESSION_STORAGE_KEY),
  );
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
  /** Tracks the current session ID for imperative cross-callback coordination.
   *  Unlike `selectedSessionId` (React state), this is updated synchronously
   *  and visible immediately to `handleCancel` during the same event loop tick. */
  const activeSessionRef = useRef<string | null>(selectedSessionId);
  const streamSeqRef = useRef(0);
  const deltaBufferRef = useRef<Array<{ delta: string; seq: number }>>([]);
  const flushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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

  /** Cancel any in-flight agent stream: unsubscribe SSE, flush buffered deltas,
   *  and reset stream-related refs. Shared by handleCancel, handleDeleteSession,
   *  and handleCreateSession to avoid shotgun-surgery duplication. */
  const cancelActiveStream = useCallback(() => {
    trpcClient.agent.cancel.mutate().catch(() => {/* best-effort */});
    if (cancelStreamRef.current) {
      cancelStreamRef.current();
      cancelStreamRef.current = null;
    }
    // Flush buffered deltas before clearing
    const sessId = activeSessionRef.current;
    const msgId = useMessagesStore.getState().streamingMessageId;
    if (deltaBufferRef.current.length > 0 && sessId && msgId) {
      const deltas = deltaBufferRef.current;
      deltaBufferRef.current = [];
      if (flushTimerRef.current) { clearTimeout(flushTimerRef.current); flushTimerRef.current = null; }
      trpcClient.session.streamDeltaBatch.mutate({
        sessionId: sessId, messageId: msgId, deltas,
      }).catch(() => {/* best-effort */});
    } else {
      // No deltas to flush — just clear the buffer and timer
      deltaBufferRef.current = [];
      if (flushTimerRef.current) { clearTimeout(flushTimerRef.current); flushTimerRef.current = null; }
    }
    streamSeqRef.current = 0;
  }, []);

  const handleCancel = useCallback(() => {
    const sessId = activeSessionRef.current;
    const msgId = useMessagesStore.getState().streamingMessageId;
    cancelActiveStream();
    // Abort persistent stream if active
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

  const handleSelectSession = useCallback((sessionId: string) => {
    if (sessionId === intendedSessionRef.current) return;
    intendedSessionRef.current = sessionId;
    clearMessages();
    setActiveSession(sessionId);
    setSelectedSessionId(sessionId);
    activeSessionRef.current = sessionId;
    setCurrentView('sessions');
    // Fetch full messages from server (triggers lazy replay if needed)
    trpcClient.session.messages.query({ sessionId }).then((msgs) => {
      // Guard: only load if this session is still selected
      if (intendedSessionRef.current === sessionId && msgs.length > 0) {
        loadMessages(msgs);
      }
    }).catch(() => { /* session may have been deleted */ })
      .finally(() => {
        // Clear the dedup guard so clicking the same session again will re-fetch
        if (intendedSessionRef.current === sessionId) {
          intendedSessionRef.current = null;
        }
      });
  }, [clearMessages, setActiveSession, loadMessages]);

  /** Called by SessionsPanel when the currently-active session is deleted.
   *  Clears all session-related state so the chat area doesn't show stale messages. */
  const handleDeleteSession = useCallback((sessionId: string) => {
    // Defensive guard: only clear state if the deleted session is actually active
    if (sessionId !== activeSessionRef.current) return;
    cancelActiveStream();
    clearMessages();
    setActiveSession(null);
    setSelectedSessionId(null);
    activeSessionRef.current = null;
    intendedSessionRef.current = null;
    localStorage.removeItem(SELECTED_SESSION_STORAGE_KEY);
  }, [cancelActiveStream, clearMessages, setActiveSession]);

  const handleCreateSession = useCallback(() => {
    cancelActiveStream();
    clearMessages();
    setActiveSession(null);
    setSelectedSessionId(null);
    activeSessionRef.current = null;
    intendedSessionRef.current = null;
    setCurrentView('sessions');
    // Ensure sessions panel is visible
    setSessionsPanelCollapsed(false);
    localStorage.setItem(SESSIONS_PANEL_STORAGE_KEY, 'false');
  }, [cancelActiveStream, clearMessages, setActiveSession]);

  useHotkey('toggleHistory', toggleSessionsPanel);
  useHotkey('toggleTasks', () => setTaskPanelOpen((prev) => !prev));
  useHotkey('cancelStream', handleCancel, isStreaming);

  useEffect(() => {
    return () => {
      cancelStreamRef.current?.();
    };
  }, []);

  // Persist view state to localStorage so it survives reload/HMR
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

  // When the server comes online with a persisted session, reload its messages.
  // Gated on `serverConnected` so we don't fire before the server is reachable.
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
      // Session was deleted between persist and restore — reset to clean state
      setSelectedSessionId(null);
      activeSessionRef.current = null;
      setActiveSession(null);
      clearMessages();
      setCurrentView('home');
      localStorage.removeItem(SELECTED_SESSION_STORAGE_KEY);
    }).finally(() => {
      // Clear dedup guard so clicking the same session in the panel works
      if (intendedSessionRef.current === selectedSessionId) {
        intendedSessionRef.current = null;
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- fires once when server is first available
  }, [serverConnected]);

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
    deltaBufferRef.current = [];

    // Start the async persistence + streaming pipeline.
    // Wrapped in an async IIFE so the useCallback itself stays synchronous
    // (React expects void from event handlers, not a Promise).
    void (async () => {
      // Resolve session ID: create a backend session on first message if needed
      let sessId = selectedSessionId;
      if (!sessId) {
        try {
          const session = await trpcClient.session.create.mutate({
            title: content.slice(0, SESSION_TITLE_MAX_LENGTH),
          });
          sessId = session.id;
          setSelectedSessionId(sessId);
          setActiveSession(sessId);
          activeSessionRef.current = sessId;
          const summary = toSessionSummary(session);
          // Optimistic insert: push new session into active session list cache immediately.
          queryClient.setQueriesData<SessionSummary[]>(
            { queryKey: trpc.session.list.queryKey(orgId ? { orgId } : undefined) },
            (old) => old ? [summary, ...old] : [summary],
          );
        } catch {
          // Session creation failed — continue without persistence.
          // The user still sees their conversation in the UI, but it won't survive a refresh.
          setError('Could not save session. Your conversation is temporary.');
          setTimeout(() => setError(null), 5000);
        }
      }

      // Flush buffered deltas as a single batch mutation
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
              // Buffer delta for batched persistence (flushes every 150ms)
              if (sessId) {
                deltaBufferRef.current.push({ delta: data.data, seq: streamSeqRef.current++ });
                if (!flushTimerRef.current) {
                  flushTimerRef.current = setTimeout(flushDeltas, 150);
                }
              }
            } else if (data.type === 'done') {
              // Assemble full content before finishing (Zustand hasn't committed yet)
              const fullContent = useMessagesStore.getState().streamingContent;
              finishStreamingMessage();
              cancelStreamRef.current = null;
              // Flush remaining deltas then persist finalized message
              flushDeltas();
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
              // Flush remaining deltas then persist abort
              flushDeltas();
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
            // Flush remaining deltas then persist abort
            flushDeltas();
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
    })();
  }, [addUserMessage, startAssistantMessage, appendToStreamingMessage, finishStreamingMessage, orgId, selectedSessionId, setActiveSession, trpc]);

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
            onDeleteSession={handleDeleteSession}
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
