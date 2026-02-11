import { ArrowLeft, Menu, MessageSquare, ListTodo, Plus } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';

import { BoardFilters } from '../Board/BoardFilters';
import type { ViewType } from './Shell';

const VIEW_TITLES: Partial<Record<ViewType, string>> = {
  home: 'Home',
  board: 'Supervision Board',
  queue: 'Review Queue',
  sessions: 'Sessions',
  templates: 'Templates',
  workflows: 'Workflows',
  workspaces: 'Workspaces',
  audit: 'Audit Log',
};

interface TopBarProps {
  currentView: ViewType;
  onBack?: () => void;
  sidebarHidden: boolean;
  onToggleSidebar: () => void;
  sessionsPanelCollapsed: boolean;
  onToggleSessionsPanel: () => void;
  todoPanelOpen: boolean;
  onToggleTodo: () => void;
  onQuickCreate: () => void;
  boardKeyword: string;
  onBoardKeywordChange: (value: string) => void;
  boardStatusFilter: string;
  onBoardStatusFilterChange: (value: string) => void;
}

export default function TopBar({
  currentView,
  onBack,
  sidebarHidden,
  onToggleSidebar,
  sessionsPanelCollapsed,
  onToggleSessionsPanel,
  todoPanelOpen,
  onToggleTodo,
  onQuickCreate,
  boardKeyword,
  onBoardKeywordChange,
  boardStatusFilter,
  onBoardStatusFilterChange,
}: TopBarProps) {
  return (
    <header className="flex-shrink-0 flex items-center justify-between gap-4 px-4 py-2">
      {/* Left group — reopen pills (when collapsed) + page title pill */}
      <div className="flex items-center gap-2">
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              className="glass-pill p-2 text-muted-foreground hover:text-foreground transition-colors"
              onClick={onToggleSidebar}
              aria-label={sidebarHidden ? 'Show sidebar' : 'Hide sidebar'}
            >
              <Menu className="h-4 w-4" />
            </button>
          </TooltipTrigger>
          <TooltipContent>{sidebarHidden ? 'Show sidebar' : 'Hide sidebar'}</TooltipContent>
        </Tooltip>

        {sessionsPanelCollapsed && (
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                className="glass-pill p-2 text-muted-foreground hover:text-foreground transition-colors"
                onClick={onToggleSessionsPanel}
                aria-label="Show sessions"
              >
                <MessageSquare className="h-4 w-4" />
              </button>
            </TooltipTrigger>
            <TooltipContent>Show sessions (Cmd+Shift+H)</TooltipContent>
          </Tooltip>
        )}

        {/* Page title pill */}
        <div className="glass-pill flex items-center gap-2">
          {currentView === 'detail' && onBack ? (
            <>
              <Button variant="ghost" size="icon" className="h-6 w-6" onClick={onBack} aria-label="Go back">
                <ArrowLeft className="h-3.5 w-3.5" />
              </Button>
              <span className="text-sm font-medium">Agent Detail</span>
            </>
          ) : (
            <span className="text-sm font-medium">
              {VIEW_TITLES[currentView] ?? currentView}
            </span>
          )}
        </div>
      </div>

      {/* Center pill — view-specific controls */}
      {currentView === 'board' && (
        <div className="glass-pill">
          <BoardFilters
            keyword={boardKeyword}
            onKeywordChange={onBoardKeywordChange}
            statusFilter={boardStatusFilter}
            onStatusFilterChange={onBoardStatusFilterChange}
          />
        </div>
      )}

      {/* Spacer when no center pill */}
      {currentView !== 'board' && <div className="flex-1" />}

      {/* Right pill — global actions */}
      <div className="glass-pill flex items-center gap-1">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 rounded-full"
              onClick={onQuickCreate}
              aria-label="New session"
            >
              <Plus className="h-3.5 w-3.5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>New session</TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant={todoPanelOpen ? 'secondary' : 'ghost'}
              size="icon"
              className="h-7 w-7 rounded-full"
              onClick={onToggleTodo}
              aria-label="Toggle tasks panel"
            >
              <ListTodo className="h-3.5 w-3.5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Tasks (Cmd+Shift+T)</TooltipContent>
        </Tooltip>
      </div>
    </header>
  );
}
