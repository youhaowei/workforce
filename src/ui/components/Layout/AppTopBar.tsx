import {
  ChevronRight,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
  Plus,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { TopBar } from "@/components/ui/topbar";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/ui/lib/utils";
import { usePlatform } from "@/ui/context/PlatformProvider";

import { BoardFilters } from "../Board/BoardFilters";
import type { ViewType } from "./Layout";

const TRAFFIC_LIGHT_SPACER_PX = 64;

interface AppTopBarProps {
  sidebarOpen: boolean;
  onToggleSidebar: () => void;
  projectName?: string;
  sessionTitle?: string;
  onQuickCreate: () => void;
  rightSidebarOpen: boolean;
  onToggleRightSidebar: () => void;
  currentView: ViewType;
  boardKeyword: string;
  onBoardKeywordChange: (value: string) => void;
  boardStatusFilter: string;
  onBoardStatusFilterChange: (value: string) => void;
}

export default function AppTopBar({
  sidebarOpen,
  onToggleSidebar,
  projectName,
  sessionTitle,
  onQuickCreate,
  rightSidebarOpen,
  onToggleRightSidebar,
  currentView,
  boardKeyword,
  onBoardKeywordChange,
  boardStatusFilter,
  onBoardStatusFilterChange,
}: AppTopBarProps) {
  const { isDesktop, isMacOS } = usePlatform();
  const macDesktop = isDesktop && isMacOS;
  const LeftSidebarIcon = sidebarOpen ? PanelLeftClose : PanelLeftOpen;
  const RightSidebarIcon = rightSidebarOpen ? PanelRightClose : PanelRightOpen;

  return (
    <TopBar className="shell-topbar">
      <div className="flex items-center gap-2 min-w-0 flex-1 relative">
        {macDesktop && (
          <div className="shrink-0" style={{ width: TRAFFIC_LIGHT_SPACER_PX }} aria-hidden="true" />
        )}

        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className={cn(
                "h-7 w-7 hover:text-neutral-fg/90",
                sidebarOpen ? "text-neutral-fg/80" : "text-neutral-fg/60",
              )}
              onClick={onToggleSidebar}
              aria-label={sidebarOpen ? "Hide sidebar" : "Show sidebar"}
            >
              <LeftSidebarIcon className="h-3.5 w-3.5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            {sidebarOpen ? "Hide" : "Show"} sidebar ({macDesktop ? "Cmd" : "Ctrl"}+Shift+H)
          </TooltipContent>
        </Tooltip>

        {currentView === "sessions" && (projectName || sessionTitle) && (
          <nav className="flex items-center gap-1 min-w-0 text-[11px]" aria-label="Breadcrumb">
            {projectName && (
              <>
                <span className="shrink-0 text-neutral-fg/50 truncate max-w-[160px]">
                  {projectName}
                </span>
                {sessionTitle && (
                  <ChevronRight className="h-2.5 w-2.5 shrink-0 text-neutral-fg/30" />
                )}
              </>
            )}
            {sessionTitle && <span className="text-neutral-fg/80 truncate">{sessionTitle}</span>}
          </nav>
        )}
      </div>

      {currentView === "board" && (
        <div className="relative">
          <BoardFilters
            keyword={boardKeyword}
            onKeywordChange={onBoardKeywordChange}
            statusFilter={boardStatusFilter}
            onStatusFilterChange={onBoardStatusFilterChange}
          />
        </div>
      )}

      <div className="flex items-center gap-1 shrink-0 relative">
        <Button
          variant="ghost"
          size="icon"
          className="h-7 gap-1.5 px-2 w-auto text-neutral-fg/60 hover:text-neutral-fg/90 text-xs"
          onClick={onQuickCreate}
          aria-label="New session"
        >
          <Plus className="h-3.5 w-3.5" />
          <span>New</span>
        </Button>

        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className={cn(
                "h-7 w-7 hover:text-neutral-fg/90",
                rightSidebarOpen ? "text-neutral-fg/80" : "text-neutral-fg/60",
              )}
              onClick={onToggleRightSidebar}
              aria-label="Toggle appearance panel"
            >
              <RightSidebarIcon className="h-3.5 w-3.5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Appearance</TooltipContent>
        </Tooltip>
      </div>
    </TopBar>
  );
}
