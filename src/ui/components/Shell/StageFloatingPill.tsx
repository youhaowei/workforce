/**
 * StageFloatingPill - Three floating glass elements at the top of the stage area.
 *
 * Top-left: sessions panel toggle
 * Top-center: current session title
 * Top-right: info panel toggle
 */

import { PanelLeft, PanelRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { GitStatusBadge } from "../Git/GitStatusBadge";
import { GitCommitButton } from "../Git/GitCommitButton";

interface StageFloatingPillProps {
  sessionTitle?: string;
  sessionsPanelOpen: boolean;
  infoPanelOpen: boolean;
  projectRootPath?: string | null;
  onToggleSessions: () => void;
  onToggleInfo: () => void;
  onGitClick?: () => void;
}

export function StageFloatingPill({
  sessionTitle,
  sessionsPanelOpen,
  infoPanelOpen,
  projectRootPath,
  onToggleSessions,
  onToggleInfo,
  onGitClick,
}: StageFloatingPillProps) {
  return (
    <div className="absolute top-2 left-2 right-2 z-10 flex items-center gap-1.5">
      {/* Left: sessions toggle + title */}
      <Button
        variant="ghost"
        color="neutral"
        size="icon"
        active={sessionsPanelOpen}
        onClick={onToggleSessions}
        className="h-7 w-7 shrink-0 rounded-full shadow-sm border border-neutral-border/30"
        aria-pressed={sessionsPanelOpen}
        aria-label={sessionsPanelOpen ? "Hide sessions panel" : "Show sessions panel"}
      >
        <PanelLeft className="h-3.5 w-3.5" />
      </Button>

      {sessionTitle && (
        <div className="flex items-center h-7 px-3 bg-neutral-bg/70 rounded-full shadow-sm border border-neutral-border/30">
          <span className="text-xs font-medium text-neutral-fg truncate max-w-56 select-none">
            {sessionTitle}
          </span>
        </div>
      )}

      {/* Spacer */}
      <div className="flex-1" />

      {/* Right: git status + commit + info toggle */}
      {projectRootPath && <GitStatusBadge cwd={projectRootPath} onClick={onGitClick} />}
      {projectRootPath && <GitCommitButton cwd={projectRootPath} />}

      <Button
        variant="ghost"
        color="neutral"
        size="icon"
        active={infoPanelOpen}
        onClick={onToggleInfo}
        className="h-7 w-7 shrink-0 rounded-full shadow-sm border border-neutral-border/30"
        aria-pressed={infoPanelOpen}
        aria-label={infoPanelOpen ? "Hide info panel" : "Show info panel"}
      >
        <PanelRight className="h-3.5 w-3.5" />
      </Button>
    </div>
  );
}
