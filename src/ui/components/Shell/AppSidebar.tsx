import {
  Home,
  LayoutDashboard,
  ClipboardList,
  MessageSquare,
  Blocks,
  Workflow,
  FolderKanban,
  FolderGit2,
  History,
  PanelLeftClose,
  PanelLeftOpen,
} from 'lucide-react';

import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';

import { ReviewBadge } from '../Review';
import type { ViewType, SidebarMode } from './Shell';

interface NavItem {
  id: ViewType;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  badge?: React.ReactNode;
}

const NAV_ITEMS: NavItem[] = [
  { id: 'home', label: 'Home', icon: Home },
  { id: 'board', label: 'Board', icon: LayoutDashboard },
  { id: 'queue', label: 'Queue', icon: ClipboardList, badge: <ReviewBadge /> },
  { id: 'sessions', label: 'Sessions', icon: MessageSquare },
  { id: 'projects', label: 'Projects', icon: FolderGit2 },
  { id: 'templates', label: 'Templates', icon: Blocks },
  { id: 'workflows', label: 'Workflows', icon: Workflow },
  { id: 'orgs', label: 'Orgs', icon: FolderKanban },
  { id: 'audit', label: 'Audit', icon: History },
];

const SIDEBAR_WIDTH_CLASSES: Record<SidebarMode, string> = {
  expanded: 'w-[200px]',
  collapsed: 'w-[68px]',
};

interface AppSidebarProps {
  currentView: ViewType;
  onViewChange: (view: ViewType) => void;
  mode: SidebarMode;
  onToggleSize?: () => void;
}

export default function AppSidebar({
  currentView,
  onViewChange,
  mode,
  onToggleSize,
}: AppSidebarProps) {
  const activeView = currentView === 'detail' ? 'board' : currentView;
  const isCollapsed = mode === 'collapsed';

  return (
    <nav
      aria-label="Main navigation"
      className={`flex-shrink-0 flex flex-col transition-[width] duration-200 ease-in-out overflow-hidden electrobun-webkit-app-region-drag ${SIDEBAR_WIDTH_CLASSES[mode]}`}
    >
      {/* Traffic light zone — extra height so macOS controls feel vertically centered */}
      <div className="h-10 shrink-0" />

      {/* Logo */}
      <div className={`flex items-center overflow-hidden h-8 electrobun-webkit-app-region-no-drag ${isCollapsed ? 'justify-center px-0' : 'gap-2.5 px-3'}`}>
        <div className="flex-shrink-0 flex items-center justify-center w-7 h-7 rounded-lg bg-foreground/90 text-background font-bold text-[11px] tracking-tight">
          W
        </div>
        {!isCollapsed && (
          <span className="text-[13px] font-semibold text-foreground/80 truncate tracking-tight">
            Workforce
          </span>
        )}
      </div>

      {/* Nav items */}
      <div className={`flex-1 flex flex-col gap-0.5 overflow-y-auto electrobun-webkit-app-region-no-drag ${isCollapsed ? 'px-2 py-2' : 'px-2 py-2'}`}>
        {NAV_ITEMS.map((item) => {
          const isActive = activeView === item.id;
          const Icon = item.icon;

          const button = (
            <button
              key={item.id}
              onClick={() => onViewChange(item.id)}
              className={`nav-glass-item relative flex items-center gap-2.5 w-full rounded-lg text-[13px] transition-all duration-150 ${
                isCollapsed ? 'px-0 py-2 justify-center' : 'px-2.5 py-[7px]'
              } ${isActive
                ? 'nav-glass-active text-foreground font-medium'
                : 'text-foreground/50 hover:text-foreground/80 hover:bg-white/30 dark:hover:bg-white/5'
              }`}
            >
              <Icon className={`h-[18px] w-[18px] flex-shrink-0 ${isActive ? '' : ''}`} />
              {!isCollapsed && <span className="truncate">{item.label}</span>}
              {!isActive && item.badge}
            </button>
          );

          if (isCollapsed) {
            return (
              <Tooltip key={item.id} delayDuration={0}>
                <TooltipTrigger asChild>{button}</TooltipTrigger>
                <TooltipContent side="right" sideOffset={8}>
                  {item.label}
                </TooltipContent>
              </Tooltip>
            );
          }

          return button;
        })}
      </div>

      {/* Collapse / Expand toggle */}
      {onToggleSize && (
        <div className={`electrobun-webkit-app-region-no-drag ${isCollapsed ? 'px-2 py-2' : 'px-2 py-2'}`}>
          {isCollapsed ? (
            <Tooltip delayDuration={0}>
              <TooltipTrigger asChild>
                <button
                  className="flex items-center justify-center w-full rounded-lg py-2 text-foreground/40 hover:text-foreground/70 hover:bg-white/30 dark:hover:bg-white/5 transition-all duration-150"
                  onClick={onToggleSize}
                  aria-label="Expand sidebar"
                >
                  <PanelLeftOpen className="h-4 w-4" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="right" sideOffset={8}>Expand</TooltipContent>
            </Tooltip>
          ) : (
            <button
              className="flex items-center gap-2.5 w-full rounded-lg px-2.5 py-[7px] text-foreground/40 hover:text-foreground/70 hover:bg-white/30 dark:hover:bg-white/5 transition-all duration-150"
              onClick={onToggleSize}
            >
              <PanelLeftClose className="h-4 w-4" />
              <span className="text-xs">Collapse</span>
            </button>
          )}
        </div>
      )}
    </nav>
  );
}
