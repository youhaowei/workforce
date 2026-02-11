/**
 * Shell - Main application layout.
 *
 * Four-column layout: sidebar | sessions panel | content column (TopBar → banners → main → StatusBar) | todo panel.
 * Sessions and todo panels are persistent full-height siblings. Board filters are lifted to TopBar.
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AlertCircle, WifiOff } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { TooltipProvider } from '@/components/ui/tooltip';

import { TodoPanel } from '../Todo';
import { SessionsPanel, SessionsView } from '../Sessions';
import { BoardView } from '../Board';
import { ReviewQueue } from '../Review';
import { AgentDetailView } from '../AgentDetail';
import { TemplateListView } from '../Templates';
import { WorkflowListView } from '../Workflows';
import { WorkspaceAuditView } from '../Audit';
import { WorkspacesListView } from '../Workspace/WorkspacesListView';
import { HomeView } from '../Home';
import { useHotkey } from '@/ui/hotkeys';
import { useMessagesStore } from '@/ui/stores/useMessagesStore';
import { useSdkStore } from '@/ui/stores/useSdkStore';
import { useWorkspaceStore } from '@/ui/stores/useWorkspaceStore';
import { useTRPC } from '@/bridge/react';
import { trpc as trpcClient } from '@/bridge/trpc';
import { getEventBus } from '@/shared/event-bus';
import AppSidebar from './AppSidebar';
import TopBar from './AppHeader';
import StatusBar from './StatusBar';

export type ViewType = 'home' | 'board' | 'queue' | 'sessions' | 'templates' | 'workflows' | 'workspaces' | 'audit' | 'detail';
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
  const [todoPanelOpen, setTodoPanelOpen] = useState(false);
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

  // Board filter state — lifted here so TopBar and BoardView share it
  const [boardKeyword, setBoardKeyword] = useState('');
  const [boardStatusFilter, setBoardStatusFilter] = useState('all');

  const trpc = useTRPC();
  const workspaceId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const setCurrentWorkspaceId = useWorkspaceStore((s) => s.setCurrentWorkspaceId);

  const messages = useMessagesStore((s) => s.messages);
  const isStreaming = useMessagesStore((s) => s.isStreaming);
  const addUserMessage = useMessagesStore((s) => s.addUserMessage);
  const startAssistantMessage = useMessagesStore((s) => s.startAssistantMessage);
  const appendToStreamingMessage = useMessagesStore((s) => s.appendToStreamingMessage);
  const finishStreamingMessage = useMessagesStore((s) => s.finishStreamingMessage);
  const clearMessages = useMessagesStore((s) => s.clearMessages);
  const setActiveSession = useMessagesStore((s) => s.setActiveSession);
  const cumulativeUsage = useSdkStore((s) => s.cumulativeUsage);
  const currentQueryStats = useSdkStore((s) => s.currentQueryStats);

  const { data: currentWorkspace } = useQuery(
    trpc.workspace.getCurrent.queryOptions(undefined, { enabled: serverConnected }),
  );

  useEffect(() => {
    if (currentWorkspace?.id && !workspaceId) {
      setCurrentWorkspaceId(currentWorkspace.id);
    }
  }, [currentWorkspace, workspaceId, setCurrentWorkspaceId]);

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
    finishStreamingMessage();
  }, [finishStreamingMessage]);

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
    if (sessionId === selectedSessionId) return;
    clearMessages();
    setActiveSession(sessionId);
    setSelectedSessionId(sessionId);
    setCurrentView('sessions');
  }, [selectedSessionId, clearMessages, setActiveSession]);

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
  useHotkey('toggleTasks', () => setTodoPanelOpen((prev) => !prev));
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
    addUserMessage(content);
    startAssistantMessage();

    const subscription = trpcClient.agent.query.subscribe(
      { prompt: content },
      {
        onData: (data) => {
          if (data.type === 'token') {
            appendToStreamingMessage(data.data);
          } else if (data.type === 'done') {
            finishStreamingMessage();
            cancelStreamRef.current = null;
          } else if (data.type === 'error') {
            finishStreamingMessage();
            setError(data.data);
            cancelStreamRef.current = null;
          }
        },
        onError: (err) => {
          finishStreamingMessage();
          setError(err instanceof Error ? err.message : String(err));
          cancelStreamRef.current = null;
        },
      },
    );
    cancelStreamRef.current = () => subscription.unsubscribe();
  }, [addUserMessage, startAssistantMessage, appendToStreamingMessage, finishStreamingMessage]);

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
            onStartNewChat={handleCreateSession}
          />
        );
      case 'templates':
        return <TemplateListView />;
      case 'workflows':
        return <WorkflowListView />;
      case 'workspaces':
        return <WorkspacesListView />;
      case 'audit':
        return <WorkspaceAuditView />;
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

        {/* Sessions panel — full height, same level as sidebar */}
        <SessionsPanel
          collapsed={sessionsPanelCollapsed}
          activeSessionId={selectedSessionId ?? undefined}
          onSelectSession={handleSelectSession}
          onCreateSession={handleCreateSession}
          onCollapse={toggleSessionsPanel}
        />

        {/* Content column — TopBar only spans this area */}
        <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
          <TopBar
            currentView={currentView}
            onBack={currentView === 'detail' ? navigateBack : undefined}
            sidebarHidden={sidebarMode === 'hidden'}
            onToggleSidebar={toggleSidebarVisibility}
            sessionsPanelCollapsed={sessionsPanelCollapsed}
            onToggleSessionsPanel={toggleSessionsPanel}
            todoPanelOpen={todoPanelOpen}
            onToggleTodo={() => setTodoPanelOpen((prev) => !prev)}
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
          <main className="flex-1 overflow-hidden">
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

        {/* Todo panel — full height, same level as sidebar and sessions */}
        <TodoPanel
          isOpen={todoPanelOpen}
          onClose={() => setTodoPanelOpen(false)}
        />
      </div>
    </TooltipProvider>
  );
}

export default function Shell() {
  return <ShellContent />;
}
