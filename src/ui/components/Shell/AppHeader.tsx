import { ArrowLeft, FolderGit2, MessageSquare, ListTodo, Plus } from 'lucide-react';

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
  sessionTitle?: string;
  onBack?: () => void;
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
  const title = currentView === 'sessions' && sessionTitle
    ? sessionTitle
    : (VIEW_TITLES[currentView] ?? currentView);

  return (
    <header className="shell-topbar electrobun-webkit-app-region-drag">
      {/* Left — reopen toggles + title */}
      <div className="flex items-center gap-2 min-w-0 flex-1 electrobun-webkit-app-region-no-drag">
        {sessionsPanelCollapsed && currentView === 'sessions' && (
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                className="topbar-glass-btn"
                onClick={onToggleSessionsPanel}
                aria-label="Show sessions"
              >
                <MessageSquare className="h-3 w-3" />
              </button>
            </TooltipTrigger>
            <TooltipContent>Show sessions (Cmd+Shift+H)</TooltipContent>
          </Tooltip>
        )}

        {currentView === 'projects' && projectsPanelCollapsed && (
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                className="topbar-glass-btn"
                onClick={onToggleProjectsPanel}
                aria-label="Show projects"
              >
                <FolderGit2 className="h-3 w-3" />
              </button>
            </TooltipTrigger>
            <TooltipContent>Show projects</TooltipContent>
          </Tooltip>
        )}

        {currentView === 'detail' && onBack ? (
          <div className="flex items-center gap-1.5 min-w-0">
            <button className="topbar-glass-btn" onClick={onBack} aria-label="Go back">
              <ArrowLeft className="h-3 w-3" />
            </button>
            <span className="text-[11px] text-foreground/50 truncate">{title}</span>
          </div>
        ) : (
          <span className="text-[11px] text-foreground/50 truncate">{title}</span>
        )}
      </div>

      {/* Center — view-specific controls */}
      {currentView === 'board' && (
        <div className="electrobun-webkit-app-region-no-drag">
          <BoardFilters
            keyword={boardKeyword}
            onKeywordChange={onBoardKeywordChange}
            statusFilter={boardStatusFilter}
            onStatusFilterChange={onBoardStatusFilterChange}
          />
        </div>
      )}

      {/* Right — global actions */}
      <div className="flex items-center gap-0.5 shrink-0 electrobun-webkit-app-region-no-drag">
        <button
          className="topbar-glass-btn gap-1"
          onClick={onQuickCreate}
          aria-label="New session"
        >
          <Plus className="h-3 w-3" />
          <span>New</span>
        </button>

        <button
          className={`topbar-glass-btn gap-1 ${taskPanelOpen ? 'topbar-glass-btn-active' : ''}`}
          onClick={onToggleTask}
          aria-label="Toggle tasks panel"
        >
          <ListTodo className="h-3 w-3" />
          <span>Tasks</span>
        </button>
      </div>
    </header>
  );
}
