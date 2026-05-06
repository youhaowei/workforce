import { ArrowLeft, PanelLeftOpen, Plus, Palette } from "lucide-react";

import { Button } from "@/components/ui/button";

import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { usePlatform } from "@/ui/context/PlatformProvider";

import { BoardFilters } from "../Board/BoardFilters";
import type { ViewType } from "./Shell";

const TRAFFIC_LIGHT_SPACER_PX = 78;

const VIEW_TITLES: Partial<Record<ViewType, string>> = {
  home: "Home",
  board: "Supervision Board",
  queue: "Review Queue",
  sessions: "Sessions",
  projects: "Projects",
  templates: "Templates",
  workflows: "Workflows",
  orgs: "Organizations",
  audit: "Audit Log",
};

interface TopBarProps {
  currentView: ViewType;
  sessionTitle?: string;
  onBack?: () => void;
  sidebarHidden: boolean;
  onShowSidebar: () => void;
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
  sidebarHidden,
  onShowSidebar,
  onQuickCreate,
  themePanelOpen,
  onToggleThemePanel,
  boardKeyword,
  onBoardKeywordChange,
  boardStatusFilter,
  onBoardStatusFilterChange,
}: TopBarProps) {
  const { isDesktop, isMacOS } = usePlatform();
  const macDesktop = isDesktop && isMacOS;

  const title =
    currentView === "sessions" && sessionTitle
      ? sessionTitle
      : (VIEW_TITLES[currentView] ?? currentView);

  return (
    <header className="shell-topbar relative">
      <div className="absolute inset-0 titlebar-drag-region" />

      <div className="flex items-center gap-2 min-w-0 flex-1 relative">
        {sidebarHidden && macDesktop && (
          <div className="shrink-0" style={{ width: TRAFFIC_LIGHT_SPACER_PX }} aria-hidden="true" />
        )}
        {sidebarHidden && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="xs" onClick={onShowSidebar} aria-label="Show sidebar">
                <PanelLeftOpen className="h-3 w-3" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Show sidebar (Cmd+Shift+H)</TooltipContent>
          </Tooltip>
        )}

        {currentView === "detail" && onBack ? (
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

      {/* Right — global actions */}
      <div className="flex items-center gap-0.5 shrink-0 relative">
        <Button variant="ghost" size="xs" onClick={onQuickCreate} aria-label="New session">
          <Plus className="h-3 w-3" />
          <span>New</span>
        </Button>

        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="xs"
              onClick={onToggleThemePanel}
              className={themePanelOpen ? "bg-neutral-bg-subtle" : ""}
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
