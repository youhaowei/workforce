import { ArrowLeft, FolderGit2, Menu, MessageSquare, ListTodo, Plus } from 'lucide-react';

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
  projects: 'Projects',
  templates: 'Templates',
  workflows: 'Workflows',
  orgs: 'Organizations',
  audit: 'Audit Log',
};

interface TopBarProps {
  currentView: ViewType;
  /** Title of the active session — shown in the page title pill on the sessions view. */
  sessionTitle?: string;
  onBack?: () => void;
  sidebarCollapsed: boolean;
  onToggleSidebar: () => void;
  sessionsPanelCollapsed: boolean;
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
}

export default function TopBar({
  currentView,
  sessionTitle,
  onBack,
  sidebarCollapsed,
  onToggleSidebar,
  sessionsPanelCollapsed,
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
}: TopBarProps) {
  return (
    <header className="absolute top-0 inset-x-0 z-10 flex items-center justify-between gap-4 px-4 py-2 pointer-events-none">
      {/* Left group — reopen pills (when collapsed) + page title pill */}
      <div className="flex items-center gap-2 pointer-events-auto">
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              className="glass-pill p-2 text-muted-foreground hover:text-foreground transition-colors"
              onClick={onToggleSidebar}
              aria-label={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            >
              <Menu className="h-4 w-4" />
            </button>
          </TooltipTrigger>
          <TooltipContent>{sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}</TooltipContent>
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

        {currentView === 'projects' && projectsPanelCollapsed && (
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                className="glass-pill p-2 text-muted-foreground hover:text-foreground transition-colors"
                onClick={onToggleProjectsPanel}
                aria-label="Show projects"
              >
                <FolderGit2 className="h-4 w-4" />
              </button>
            </TooltipTrigger>
            <TooltipContent>Show projects</TooltipContent>
          </Tooltip>
        )}

        {/* Page title pill */}
        <div className="glass-pill flex items-center gap-2 max-w-[280px]">
          {currentView === 'detail' && onBack ? (
            <>
              <Button variant="ghost" size="icon" className="h-6 w-6" onClick={onBack} aria-label="Go back">
                <ArrowLeft className="h-3.5 w-3.5" />
              </Button>
              <span className="text-sm font-medium truncate">Agent Detail</span>
            </>
          ) : (
            <span className="text-sm font-medium truncate">
              {currentView === 'sessions' && sessionTitle
                ? sessionTitle
                : (VIEW_TITLES[currentView] ?? currentView)}
            </span>
          )}
        </div>
      </div>

      {/* Center pill — view-specific controls */}
      {currentView === 'board' && (
        <div className="glass-pill pointer-events-auto">
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
      <div className="glass-pill flex items-center gap-1 pointer-events-auto">
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
              variant={taskPanelOpen ? 'secondary' : 'ghost'}
              size="icon"
              className="h-7 w-7 rounded-full"
              onClick={onToggleTask}
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
