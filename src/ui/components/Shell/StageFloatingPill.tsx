/**
 * StageFloatingPill - Three floating glass elements at the top of the stage area.
 *
 * Top-left: sessions panel toggle
 * Top-center: current session title + git status badge
 * Top-right: info panel toggle
 */

import { PanelLeft, PanelRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { GitStatusBadge } from '../Git/GitStatusBadge';

interface StageFloatingPillProps {
  sessionTitle?: string;
  sessionsPanelOpen: boolean;
  infoPanelOpen: boolean;
  /** Project rootPath for git status. Null = no git badge. */
  projectRootPath?: string | null;
  onToggleSessions: () => void;
  onToggleInfo: () => void;
  /** Called when user clicks the git badge. */
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
    <>
      {/* Top-left: sessions panel toggle */}
      <Button
        variant="ghost"
        color="neutral"
        size="icon"
        active={sessionsPanelOpen}
        onClick={onToggleSessions}
        className="absolute top-2 left-2 z-10 h-7 w-7 rounded-full shadow-sm border border-neutral-border/30"
        aria-pressed={sessionsPanelOpen}
        aria-label={sessionsPanelOpen ? 'Hide sessions panel' : 'Show sessions panel'}
      >
        <PanelLeft className="h-3.5 w-3.5" />
      </Button>

      {/* Top-center: session title + git status */}
      <div className="absolute top-2 left-1/2 -translate-x-1/2 z-10 flex items-center gap-2">
        {sessionTitle && (
          <div className="flex items-center h-7 px-3 bg-neutral-bg/70 rounded-full shadow-sm border border-neutral-border/30">
            <span className="text-xs font-medium text-neutral-fg truncate max-w-56 select-none">
              {sessionTitle}
            </span>
          </div>
        )}
        {projectRootPath && (
          <GitStatusBadge cwd={projectRootPath} onClick={onGitClick} />
        )}
      </div>

      {/* Top-right: info panel toggle */}
      <Button
        variant="ghost"
        color="neutral"
        size="icon"
        active={infoPanelOpen}
        onClick={onToggleInfo}
        className="absolute top-2 right-2 z-10 h-7 w-7 rounded-full shadow-sm border border-neutral-border/30"
        aria-pressed={infoPanelOpen}
        aria-label={infoPanelOpen ? 'Hide info panel' : 'Show info panel'}
      >
        <PanelRight className="h-3.5 w-3.5" />
      </Button>
    </>
  );
}
