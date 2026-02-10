/**
 * Shell - Main application layout with shadcn/ui components.
 *
 * Provides 6-tab navigation (Board, Queue, Chat, Templates, Workflows, Audit),
 * side panels for sessions and todos, workspace selector, and a status bar.
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  LayoutDashboard,
  MessageSquare,
  ClipboardList,
  Blocks,
  Workflow,
  History,
  PanelLeftOpen,
  ListTodo,
  AlertCircle,
  WifiOff,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';

import { MessageList, MessageInput } from '../Messages';
import { TodoPanel } from '../Todo';
import { SessionsPanel } from '../Sessions';
import { BoardView } from '../Board';
import { ReviewQueue, ReviewBadge } from '../Review';
import { AgentDetailView } from '../AgentDetail';
import { TemplateListView } from '../Templates';
import { WorkflowListView } from '../Workflows';
import { WorkspaceSelector } from '../Workspace';
import { WorkspaceAuditView } from '../Audit';
import { useHotkey } from '@ui/hotkeys';
import { useMessagesStore } from '@ui/stores/useMessagesStore';
import { useSdkStore } from '@ui/stores/useSdkStore';
import { useWorkspaceStore } from '@ui/stores/useWorkspaceStore';
import { useTRPC } from '@bridge/react';
import { trpc as trpcClient } from '@bridge/trpc';
import { getEventBus } from '@shared/event-bus';
import type { Session } from '@services/types';

export type ViewType = 'board' | 'queue' | 'chat' | 'templates' | 'workflows' | 'audit' | 'detail';

const SERVER_URL = 'http://localhost:4096';

async function checkServerConnection(): Promise<boolean> {
  try {
    const response = await fetch(`${SERVER_URL}/health`, { method: 'GET' });
    return response.ok;
  } catch {
    return false;
  }
}

function ShellContent() {
  const [currentView, setCurrentView] = useState<ViewType>('board');
  const [selectedAgent, setSelectedAgent] = useState<Session | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [todoPanelOpen, setTodoPanelOpen] = useState(false);
  const [sessionsPanelOpen, setSessionsPanelOpen] = useState(false);
  const [serverConnected, setServerConnected] = useState(false);
  const cancelStreamRef = useRef<(() => void) | null>(null);

  const trpc = useTRPC();
  const workspaceId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const setCurrentWorkspaceId = useWorkspaceStore((s) => s.setCurrentWorkspaceId);

  const messages = useMessagesStore((s) => s.messages);
  const isStreaming = useMessagesStore((s) => s.isStreaming);
  const addUserMessage = useMessagesStore((s) => s.addUserMessage);
  const startAssistantMessage = useMessagesStore((s) => s.startAssistantMessage);
  const appendToStreamingMessage = useMessagesStore((s) => s.appendToStreamingMessage);
  const finishStreamingMessage = useMessagesStore((s) => s.finishStreamingMessage);
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

  const navigateToDetail = useCallback((session: Session) => {
    setSelectedAgent(session);
    setCurrentView('detail');
  }, []);

  const navigateBack = useCallback(() => {
    setSelectedAgent(null);
    setCurrentView('board');
  }, []);

  const handleCancel = useCallback(() => {
    if (cancelStreamRef.current) {
      cancelStreamRef.current();
      cancelStreamRef.current = null;
    }
    finishStreamingMessage();
  }, [finishStreamingMessage]);

  useHotkey('toggleHistory', () => setSessionsPanelOpen((prev) => !prev));
  useHotkey('toggleTasks', () => setTodoPanelOpen((prev) => !prev));
  useHotkey('cancelStream', handleCancel, isStreaming);

  // Clean up any active tRPC subscription on unmount
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

  const tabValue = currentView === 'detail' ? 'board' : currentView;

  const renderMainView = () => {
    switch (currentView) {
      case 'board':
        return <BoardView onSelectAgent={navigateToDetail} />;
      case 'queue':
        return <ReviewQueue />;
      case 'detail':
        return selectedAgent ? (
          <AgentDetailView session={selectedAgent} onBack={navigateBack} onNavigateToChild={navigateToDetail} />
        ) : null;
      case 'chat':
        return (
          <div className="flex-1 flex flex-col overflow-hidden">
            <MessageList messages={messages} isStreaming={isStreaming} />
            <MessageInput onSubmit={handleSubmit} onCancel={handleCancel} isStreaming={isStreaming} />
          </div>
        );
      case 'templates':
        return <TemplateListView />;
      case 'workflows':
        return <WorkflowListView />;
      case 'audit':
        return <WorkspaceAuditView />;
      default:
        return null;
    }
  };

  return (
    <TooltipProvider>
      <div className="h-screen flex flex-col bg-background overflow-hidden">
        {/* Header */}
        <header className="flex-shrink-0 border-b bg-background/95 backdrop-blur-sm">
          <div className="px-4">
            <div className="flex items-center justify-between h-14">
              {/* Logo */}
              <div className="flex items-center gap-3">
                <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-primary text-primary-foreground font-bold text-sm">
                  W
                </div>
                <div>
                  <h1 className="text-sm font-semibold leading-none">Workforce</h1>
                  <p className="text-xs text-muted-foreground">Orchestrator</p>
                </div>
              </div>

              {/* Navigation Tabs */}
              <Tabs value={tabValue} onValueChange={(v) => setCurrentView(v as ViewType)}>
                <TabsList>
                  <TabsTrigger value="board" className="gap-1.5">
                    <LayoutDashboard className="h-3.5 w-3.5" />
                    Board
                  </TabsTrigger>
                  <TabsTrigger value="queue" className="gap-1.5 relative">
                    <ClipboardList className="h-3.5 w-3.5" />
                    Queue
                    <ReviewBadge />
                  </TabsTrigger>
                  <TabsTrigger value="chat" className="gap-1.5">
                    <MessageSquare className="h-3.5 w-3.5" />
                    Chat
                  </TabsTrigger>
                  <TabsTrigger value="templates" className="gap-1.5">
                    <Blocks className="h-3.5 w-3.5" />
                    Templates
                  </TabsTrigger>
                  <TabsTrigger value="workflows" className="gap-1.5">
                    <Workflow className="h-3.5 w-3.5" />
                    Workflows
                  </TabsTrigger>
                  <TabsTrigger value="audit" className="gap-1.5">
                    <History className="h-3.5 w-3.5" />
                    Audit
                  </TabsTrigger>
                </TabsList>
              </Tabs>

              {/* Right actions */}
              <div className="flex items-center gap-1">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant={sessionsPanelOpen ? 'secondary' : 'ghost'}
                      size="icon"
                      className="h-8 w-8"
                      onClick={() => setSessionsPanelOpen((prev) => !prev)}
                    >
                      <PanelLeftOpen className="h-4 w-4" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Sessions (Cmd+Shift+H)</TooltipContent>
                </Tooltip>

                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant={todoPanelOpen ? 'secondary' : 'ghost'}
                      size="icon"
                      className="h-8 w-8"
                      onClick={() => setTodoPanelOpen((prev) => !prev)}
                    >
                      <ListTodo className="h-4 w-4" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Tasks (Cmd+Shift+T)</TooltipContent>
                </Tooltip>

                <Separator orientation="vertical" className="h-5 mx-1" />

                <WorkspaceSelector />
              </div>
            </div>
          </div>
        </header>

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
        <main className="flex-1 flex overflow-hidden">
          <SessionsPanel
            isOpen={sessionsPanelOpen}
            onClose={() => setSessionsPanelOpen(false)}
          />
          {renderMainView()}
          <TodoPanel
            isOpen={todoPanelOpen}
            onClose={() => setTodoPanelOpen(false)}
          />
        </main>

        {/* Status Bar */}
        <footer className="flex-shrink-0 px-4 py-1.5 border-t bg-background">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <div className="flex items-center gap-2">
              <span
                className={`w-1.5 h-1.5 rounded-full ${
                  isStreaming ? 'bg-primary status-active' : 'bg-muted-foreground/40'
                }`}
              />
              <span>{isStreaming ? 'Thinking...' : 'Ready'}</span>
            </div>
            <div className="flex items-center gap-3">
              {(cumulativeUsage.inputTokens > 0 || cumulativeUsage.outputTokens > 0) && (
                <span title="Input / Output tokens">
                  {cumulativeUsage.inputTokens.toLocaleString()} / {cumulativeUsage.outputTokens.toLocaleString()} tokens
                </span>
              )}
              {cumulativeUsage.totalCostUsd > 0 && (
                <span className="text-foreground" title="Estimated cost">
                  ${cumulativeUsage.totalCostUsd.toFixed(4)}
                </span>
              )}
              {currentQueryStats && (
                <span title="Last query duration">
                  {(currentQueryStats.durationMs / 1000).toFixed(1)}s
                </span>
              )}
              <span>{messages.length} messages</span>
            </div>
          </div>
        </footer>
      </div>
    </TooltipProvider>
  );
}

export default function Shell() {
  return <ShellContent />;
}
