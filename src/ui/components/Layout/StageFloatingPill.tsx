/**
 * StageFloatingPill — floating glass elements at the top of the stage.
 * Left: git status badges
 * Right: info panel toggle
 */

import { PanelRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { GitStatusBadge } from "../Git/GitStatusBadge";
import { GitCommitButton } from "../Git/GitCommitButton";
import { GitSyncButton } from "../Git/GitSyncButton";

interface StageFloatingPillProps {
  infoPanelOpen: boolean;
  projectRootPath?: string | null;
  onToggleInfo: () => void;
  onGitClick?: () => void;
}

export function StageFloatingPill({
  infoPanelOpen,
  projectRootPath,
  onToggleInfo,
  onGitClick,
}: StageFloatingPillProps) {
  return (
    <div className="absolute top-2 left-2 right-2 z-10 flex items-center gap-1.5">
      <div className="flex-1" />

      {projectRootPath && <GitStatusBadge cwd={projectRootPath} onClick={onGitClick} />}
      {projectRootPath && <GitCommitButton cwd={projectRootPath} />}
      {projectRootPath && <GitSyncButton cwd={projectRootPath} />}

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
