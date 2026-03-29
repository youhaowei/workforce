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
  GitBranch,
} from "lucide-react";
import { Link } from "@tanstack/react-router";
import { usePlatform } from "@/ui/context/PlatformProvider";
import { getServerPort } from "@/bridge/config";

import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

import { ReviewBadge } from "../Review";
import type { ViewType, SidebarMode } from "./Shell";

interface NavItem {
  id: ViewType;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  badge?: React.ReactNode;
  path: string;
}

const NAV_ITEMS: NavItem[] = [
  { id: "home", label: "Home", icon: Home, path: "/" },
  { id: "board", label: "Board", icon: LayoutDashboard, path: "/board" },
  { id: "queue", label: "Queue", icon: ClipboardList, badge: <ReviewBadge />, path: "/queue" },
  { id: "sessions", label: "Sessions", icon: MessageSquare, path: "/sessions" },
  { id: "projects", label: "Projects", icon: FolderGit2, path: "/projects" },
  { id: "templates", label: "Templates", icon: Blocks, path: "/templates" },
  { id: "workflows", label: "Workflows", icon: Workflow, path: "/workflows" },
  { id: "orgs", label: "Orgs", icon: FolderKanban, path: "/orgs" },
  { id: "audit", label: "Audit", icon: History, path: "/audit" },
];

const SIDEBAR_WIDTH_CLASSES: Record<SidebarMode, string> = {
  expanded: "w-[200px]",
  collapsed: "w-[68px]",
};

interface AppSidebarProps {
  mode: SidebarMode;
  onToggleSize?: () => void;
}

export default function AppSidebar({
  mode,
  onToggleSize,
}: AppSidebarProps) {
  const isCollapsed = mode === "collapsed";
  const { isDesktop, isMacOS } = usePlatform();
  const isMacDesktop = isDesktop && isMacOS;
  const topSpacerHeight = isDesktop ? "h-10" : "h-2";

  return (
    <nav
      aria-label="Main navigation"
      className={`shrink-0 flex flex-col transition-[width] duration-200 ease-in-out overflow-hidden relative z-50 pointer-events-none ${SIDEBAR_WIDTH_CLASSES[mode]}`}
    >
      {/* Traffic light zone — inherits pointer-events-none so drag overlay beneath is reachable */}
      <div className={`${topSpacerHeight} shrink-0 flex items-center pointer-events-auto`}>
        {isMacDesktop && (
          <div
            className="h-full w-full titlebar-drag-region rounded-lg border-neutral-border-subtle flex items-center font-medium text-neutral-fg-subtle tracking-tight"
          >
          </div>
        )}
      </div>

      {/* Logo */}
      <div
        className={`flex items-center overflow-hidden h-8 pointer-events-auto ${isCollapsed ? "justify-center px-0" : "gap-2.5 px-3"}`}
      >
        <div className="shrink-0 flex items-center justify-center w-7 h-7 rounded-lg bg-neutral-fg/90 text-neutral-bg font-bold text-[11px] tracking-tight">
          W
        </div>
        {!isCollapsed && (
          <span className="text-[13px] font-semibold text-neutral-fg/80 truncate tracking-tight">
            Workforce
          </span>
        )}
      </div>

      {/* Nav items */}
      <div
        className="flex-1 flex flex-col gap-0.5 overflow-y-auto pointer-events-auto px-2 py-2"
      >
        {NAV_ITEMS.map((item) => {
          const Icon = item.icon;

          const linkElement = (
            <Link
              key={item.id}
              to={item.path}
              className={`nav-glass-item relative flex items-center gap-2.5 w-full rounded-lg text-[13px] transition-all duration-150 text-neutral-fg/50 hover:text-neutral-fg/80 hover:bg-white/30 dark:hover:bg-white/5 ${
                isCollapsed ? "px-0 py-2 justify-center" : "px-2.5 py-[7px]"
              }`}
              activeProps={{
                className: `nav-glass-item nav-glass-active relative flex items-center gap-2.5 w-full rounded-lg text-[13px] transition-all duration-150 text-neutral-fg font-medium ${
                  isCollapsed ? "px-0 py-2 justify-center" : "px-2.5 py-[7px]"
                }`
              }}
            >
              <Icon
                className="h-[18px] w-[18px] shrink-0"
              />
              {!isCollapsed && <span className="truncate">{item.label}</span>}
              {item.badge}
            </Link>
          );

          if (isCollapsed) {
            return (
              <Tooltip key={item.id} delayDuration={0}>
                <TooltipTrigger asChild>{linkElement}</TooltipTrigger>
                <TooltipContent side="right" sideOffset={8}>
                  {item.label}
                </TooltipContent>
              </Tooltip>
            );
          }

          return linkElement;
        })}
      </div>

      {/* Collapse / Expand toggle */}
      {onToggleSize && (
        <div
          className="pointer-events-auto px-2 py-2"
        >
          {isCollapsed ? (
            <Tooltip delayDuration={0}>
              <TooltipTrigger asChild>
                <button
                  className="flex items-center justify-center w-full rounded-lg py-2 text-neutral-fg/40 hover:text-neutral-fg/70 hover:bg-white/30 dark:hover:bg-white/5 transition-all duration-150"
                  onClick={onToggleSize}
                  aria-label="Expand sidebar"
                >
                  <PanelLeftOpen className="h-4 w-4" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="right" sideOffset={8}>
                Expand
              </TooltipContent>
            </Tooltip>
          ) : (
            <button
              className="flex items-center gap-2.5 w-full rounded-lg px-2.5 py-[7px] text-neutral-fg/40 hover:text-neutral-fg/70 hover:bg-white/30 dark:hover:bg-white/5 transition-all duration-150"
              onClick={onToggleSize}
            >
              <PanelLeftClose className="h-4 w-4" />
              <span className="text-xs">Collapse</span>
            </button>
          )}
        </div>
      )}

      {/* Dev mode indicator — only visible when VITE_GIT_BRANCH is set */}
      {import.meta.env.VITE_GIT_BRANCH && (
        <div className="pointer-events-auto px-2 pb-2">
          <div className={`rounded-md bg-amber-500/10 border border-amber-500/20 text-amber-600 dark:text-amber-400 ${isCollapsed ? "px-1.5 py-1.5 flex justify-center" : "px-2.5 py-1.5"}`}>
            {isCollapsed ? (
              <Tooltip delayDuration={0}>
                <TooltipTrigger asChild>
                  <GitBranch className="h-3.5 w-3.5" />
                </TooltipTrigger>
                <TooltipContent side="right" sideOffset={8}>
                  <div className="flex flex-col gap-0.5">
                    <span className="font-medium">{import.meta.env.VITE_GIT_BRANCH}</span>
                    <span className="opacity-60">API :{getServerPort()}</span>
                  </div>
                </TooltipContent>
              </Tooltip>
            ) : (
              <div className="flex flex-col gap-0.5">
                <div className="flex items-center gap-1.5">
                  <GitBranch className="h-3 w-3 shrink-0" />
                  <span className="text-[10px] font-medium truncate">
                    {import.meta.env.VITE_GIT_BRANCH}
                  </span>
                </div>
                <span className="text-[10px] opacity-50 pl-[18px]">API :{getServerPort()}</span>
              </div>
            )}
          </div>
        </div>
      )}
    </nav>
  );
}
