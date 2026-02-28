import { AlertCircle, WifiOff } from 'lucide-react';
import type { ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import TopBar from './AppHeader';
import StatusBar from './StatusBar';
import type { SidebarMode, ViewType } from './Shell';

interface MainContentColumnProps {
  currentView: ViewType;
  sessionTitle?: string;
  onBack?: () => void;
  sidebarMode: SidebarMode;
  sessionsPanelCollapsed: boolean;
  onToggleSidebar: () => void;
  onToggleSessionsPanel: () => void;
  projectsPanelCollapsed: boolean;
  onToggleProjectsPanel: () => void;
  taskPanelOpen: boolean;
  onToggleTask: () => void;
  onQuickCreate: () => void;
  boardKeyword: string;
  onBoardKeywordChange: (value: string) => void;
  boardStatusFilter: string;
  onBoardStatusFilterChange: (value: string) => void;
  serverConnected: boolean;
  error: string | null;
  onDismissError: () => void;
  children: ReactNode;
  isStreaming: boolean;
  cumulativeUsage: {
    inputTokens: number;
    outputTokens: number;
    totalCostUsd: number;
  };
  currentQueryStats: { durationMs: number } | null;
  messageCount: number;
}

export function MainContentColumn({
  currentView,
  sessionTitle,
  onBack,
  sidebarMode,
  sessionsPanelCollapsed,
  onToggleSidebar,
  onToggleSessionsPanel,
  projectsPanelCollapsed,
  onToggleProjectsPanel,
  taskPanelOpen,
  onToggleTask,
  onQuickCreate,
  boardKeyword,
  onBoardKeywordChange,
  boardStatusFilter,
  onBoardStatusFilterChange,
  serverConnected,
  error,
  onDismissError,
  children,
  isStreaming,
  cumulativeUsage,
  currentQueryStats,
  messageCount,
}: MainContentColumnProps) {
  return (
    <div className="flex-1 flex flex-col min-w-0 overflow-hidden relative panel-surface">
      <TopBar
        currentView={currentView}
        sessionTitle={sessionTitle}
        onBack={onBack}
        sidebarCollapsed={sidebarMode === 'collapsed'}
        onToggleSidebar={onToggleSidebar}
        sessionsPanelCollapsed={sessionsPanelCollapsed}
        onToggleSessionsPanel={onToggleSessionsPanel}
        projectsPanelCollapsed={projectsPanelCollapsed}
        onToggleProjectsPanel={onToggleProjectsPanel}
        taskPanelOpen={taskPanelOpen}
        onToggleTask={onToggleTask}
        onQuickCreate={onQuickCreate}
        boardKeyword={boardKeyword}
        onBoardKeywordChange={onBoardKeywordChange}
        boardStatusFilter={boardStatusFilter}
        onBoardStatusFilterChange={onBoardStatusFilterChange}
      />

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

      {error && (
        <div className="absolute top-12 inset-x-0 z-20 mx-4 px-4 py-2 bg-destructive/10 border border-destructive/20 rounded-lg flex items-center justify-between shadow-sm">
          <div className="flex items-center gap-2">
            <AlertCircle className="h-4 w-4 text-destructive" />
            <span className="text-sm text-destructive">{error}</span>
          </div>
          <Button variant="ghost" size="sm" onClick={onDismissError} className="text-destructive h-7">
            Dismiss
          </Button>
        </div>
      )}

      <main className="flex-1 flex flex-col overflow-hidden">
        {children}
      </main>

      {currentView === 'sessions' && (
        <StatusBar
          isStreaming={isStreaming}
          cumulativeUsage={cumulativeUsage}
          currentQueryStats={currentQueryStats}
          messageCount={messageCount}
        />
      )}
    </div>
  );
}
