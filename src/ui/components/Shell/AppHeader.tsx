import { ArrowLeft, FolderGit2, MessageSquare, Plus, Palette } from 'lucide-react';

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
  sessionTitle?: string;
  onBack?: () => void;
  sessionsPanelCollapsed: boolean;
  onToggleSessionsPanel: () => void;
  projectsPanelCollapsed: boolean;
  onToggleProjectsPanel: () => void;
  onQuickCreate: () => void;
  themePanelOpen: boolean;
  onToggleThemePanel: () => void;
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
  onQuickCreate,
  themePanelOpen,
  onToggleThemePanel,
  boardKeyword,
  onBoardKeywordChange,
  boardStatusFilter,
  onBoardStatusFilterChange,
}: TopBarProps) {
  const title = currentView === 'sessions' && sessionTitle
    ? sessionTitle
    : (VIEW_TITLES[currentView] ?? currentView);

  return (
    <header
      className="shell-topbar relative"
    >
      <div className="absolute inset-0 titlebar-drag-region" />

      <div className="flex items-center gap-2 min-w-0 flex-1 relative">
        {sessionsPanelCollapsed && currentView === 'sessions' && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost" size="xs"
                onClick={onToggleSessionsPanel}
                aria-label="Show sessions"
              >
                <MessageSquare className="h-3 w-3" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Show sessions (Cmd+Shift+H)</TooltipContent>
          </Tooltip>
        )}

        {currentView === 'projects' && projectsPanelCollapsed && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost" size="xs"
                onClick={onToggleProjectsPanel}
                aria-label="Show projects"
              >
                <FolderGit2 className="h-3 w-3" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Show projects</TooltipContent>
          </Tooltip>
        )}

        {currentView === 'detail' && onBack ? (
          <div className="flex items-center gap-1.5 min-w-0">
            <Button variant="ghost" size="xs" onClick={onBack} aria-label="Go back">
              <ArrowLeft className="h-3 w-3" />
            </Button>
            <span className="text-[11px] text-neutral-fg/50 truncate">{title}</span>
          </div>
        ) : (
          <span className="text-[11px] text-neutral-fg/50 truncate">{title}</span>
        )}
      </div>

      {/* Center — view-specific controls */}
      {currentView === 'board' && (
        <div className="relative">
          <BoardFilters
            keyword={boardKeyword}
            onKeywordChange={onBoardKeywordChange}
            statusFilter={boardStatusFilter}
            onStatusFilterChange={onBoardStatusFilterChange}
          />
        </div>
      )}

      {/* Right — global actions */}
      <div className="flex items-center gap-0.5 shrink-0 relative">
        <Button
          variant="ghost" size="xs"
          onClick={onQuickCreate}
          aria-label="New session"
        >
          <Plus className="h-3 w-3" />
          <span>New</span>
        </Button>

        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost" size="xs"
              onClick={onToggleThemePanel}
              className={themePanelOpen ? 'bg-neutral-bg-subtle' : ''}
              aria-label="Toggle appearance panel"
            >
              <Palette className="h-3 w-3" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Appearance</TooltipContent>
        </Tooltip>
      </div>
    </header>
  );
}
