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

import { Button } from '@/components/ui/button';

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
  collapsed: 'w-12',
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
      className={`flex-shrink-0 flex flex-col text-sidebar-foreground transition-[width] duration-200 ease-in-out overflow-hidden ${
        SIDEBAR_WIDTH_CLASSES[mode]
      }`}
    >
      {/* Logo */}
      <div className="flex items-center gap-2 px-3 h-14 overflow-hidden">
        <div className="flex-shrink-0 flex items-center justify-center w-7 h-7 rounded-lg bg-sidebar-primary text-sidebar-primary-foreground font-bold text-xs">
          W
        </div>
        {!isCollapsed && (
          <span className="text-sm font-semibold truncate">Workforce</span>
        )}
      </div>

      {/* Nav items */}
      <div className="flex-1 flex flex-col gap-0.5 p-1.5 overflow-y-auto">
        {NAV_ITEMS.map((item) => {
          const isActive = activeView === item.id;
          const Icon = item.icon;

          const button = (
            <button
              key={item.id}
              onClick={() => onViewChange(item.id)}
              className={`relative flex items-center gap-2.5 w-full rounded-md px-2.5 py-2 text-sm transition-colors ${
                isActive
                  ? 'bg-sidebar-accent text-sidebar-accent-foreground font-medium'
                  : 'text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground'
              }`}
            >
              <Icon className="h-4 w-4 flex-shrink-0" />
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
        <div className="p-1.5">
          {isCollapsed ? (
            <Tooltip delayDuration={0}>
              <TooltipTrigger asChild>
                <button
                  className="flex items-center justify-center w-full rounded-md py-2 text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground transition-colors"
                  onClick={onToggleSize}
                  aria-label="Expand sidebar"
                >
                  <PanelLeftOpen className="h-4 w-4" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="right" sideOffset={8}>Expand</TooltipContent>
            </Tooltip>
          ) : (
            <Button
              variant="ghost"
              size="sm"
              className="w-full justify-start gap-2 text-sidebar-foreground/70 hover:text-sidebar-foreground"
              onClick={onToggleSize}
            >
              <PanelLeftClose className="h-4 w-4" />
              <span className="text-xs">Collapse</span>
            </Button>
          )}
        </div>
      )}
    </nav>
  );
}
