/**
 * GitStatusBadge - Compact git status indicator for the session header.
 *
 * Shows current branch name with a dirty/clean dot indicator.
 * Clicking opens the info panel (where git staging could live).
 *
 * Only renders when the active session has a project with a valid git repo.
 */

import { useQuery } from '@tanstack/react-query';
import { GitBranch, Circle, ArrowUp, ArrowDown } from 'lucide-react';
import { useTRPC } from '@/bridge/react';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';

interface GitStatusBadgeProps {
  /** Project rootPath to query git status for. */
  cwd: string;
  /** Called when user clicks the badge (e.g., to open info panel). */
  onClick?: () => void;
}

export function GitStatusBadge({ cwd, onClick }: GitStatusBadgeProps) {
  const trpc = useTRPC();

  const { data: status } = useQuery(
    trpc.git.status.queryOptions(
      { cwd },
      { staleTime: 5_000, refetchInterval: 10_000 },
    ),
  );

  if (!status) return null;

  const changeCount = status.staged.length + status.unstaged.length + status.untracked.length;
  const hasAheadBehind = status.ahead > 0 || status.behind > 0;

  const tooltipLines = [
    `Branch: ${status.branch}`,
    status.isClean ? 'Working tree clean' : `${changeCount} change${changeCount !== 1 ? 's' : ''}`,
    ...(status.staged.length > 0 ? [`${status.staged.length} staged`] : []),
    ...(status.unstaged.length > 0 ? [`${status.unstaged.length} modified`] : []),
    ...(status.untracked.length > 0 ? [`${status.untracked.length} untracked`] : []),
    ...(status.ahead > 0 ? [`${status.ahead} ahead`] : []),
    ...(status.behind > 0 ? [`${status.behind} behind`] : []),
  ];

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          onClick={onClick}
          className="flex items-center gap-1.5 h-7 px-2.5 bg-neutral-bg/70 rounded-full shadow-sm border border-neutral-border/30 hover:bg-neutral-bg/90 transition-colors text-xs select-none"
          aria-label={`Git: ${status.branch}${status.isClean ? '' : ' (dirty)'}`}
        >
          <GitBranch className="h-3 w-3 text-neutral-fg-subtle shrink-0" />
          <span className="font-medium text-neutral-fg truncate max-w-24">
            {status.branch}
          </span>
          {/* Dirty/clean indicator dot */}
          <Circle
            className={`h-2 w-2 shrink-0 ${
              status.isClean
                ? 'text-green-500 fill-green-500'
                : 'text-amber-500 fill-amber-500'
            }`}
          />
          {/* Ahead/behind indicators */}
          {hasAheadBehind && (
            <span className="flex items-center gap-0.5 text-[10px] text-neutral-fg-subtle">
              {status.ahead > 0 && (
                <span className="flex items-center">
                  <ArrowUp className="h-2.5 w-2.5" />
                  {status.ahead}
                </span>
              )}
              {status.behind > 0 && (
                <span className="flex items-center">
                  <ArrowDown className="h-2.5 w-2.5" />
                  {status.behind}
                </span>
              )}
            </span>
          )}
        </button>
      </TooltipTrigger>
      <TooltipContent side="bottom">
        <div className="space-y-0.5">
          {tooltipLines.map((line, i) => (
            <div key={i}>{line}</div>
          ))}
        </div>
      </TooltipContent>
    </Tooltip>
  );
}
