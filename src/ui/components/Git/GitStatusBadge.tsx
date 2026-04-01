import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { GitBranch, Circle, ArrowUp, ArrowDown, AlertCircle } from 'lucide-react';
import { useTRPC } from '@/bridge/react';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import type { GitStatus } from '@/services/git';

interface GitStatusBadgeProps {
  /** Project rootPath to query git status for. */
  cwd: string;
  /** Called when user clicks the badge (e.g., to open info panel). */
  onClick?: () => void;
}

const BADGE_CLASS =
  'flex items-center gap-1.5 h-7 px-2.5 bg-neutral-bg/70 rounded-full shadow-sm border border-neutral-border/30 hover:bg-neutral-bg/90 transition-colors text-xs select-none';

function buildTooltipLines(status: GitStatus): string[] {
  const changeCount = status.staged.length + status.unstaged.length + status.untracked.length;
  return [
    `Branch: ${status.branch}`,
    status.isClean ? 'Working tree clean' : `${changeCount} change${changeCount !== 1 ? 's' : ''}`,
    ...(status.staged.length > 0 ? [`${status.staged.length} staged`] : []),
    ...(status.unstaged.length > 0 ? [`${status.unstaged.length} modified`] : []),
    ...(status.untracked.length > 0 ? [`${status.untracked.length} untracked`] : []),
    ...(status.ahead > 0 ? [`${status.ahead} ahead`] : []),
    ...(status.behind > 0 ? [`${status.behind} behind`] : []),
  ];
}

export function GitStatusBadge({ cwd, onClick }: GitStatusBadgeProps) {
  const trpc = useTRPC();

  const { data: status, error } = useQuery(
    trpc.git.status.queryOptions(
      { cwd },
      { staleTime: 5_000, refetchInterval: 10_000 },
    ),
  );

  useEffect(() => {
    if (error) console.error('[GitStatusBadge] Failed to fetch git status:', error);
  }, [error]);

  if (error) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <button onClick={onClick} className={BADGE_CLASS} aria-label="Git: error fetching status">
            <AlertCircle className="h-3 w-3 text-palette-danger shrink-0" />
            <span className="text-neutral-fg-subtle">git</span>
          </button>
        </TooltipTrigger>
        <TooltipContent side="bottom">
          Failed to fetch git status
        </TooltipContent>
      </Tooltip>
    );
  }

  if (!status) return null;

  const tooltipLines = buildTooltipLines(status);
  const hasAheadBehind = status.ahead > 0 || status.behind > 0;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          onClick={onClick}
          className={BADGE_CLASS}
          aria-label={`Git: ${status.branch}${status.isClean ? '' : ' (dirty)'}`}
        >
          <GitBranch className="h-3 w-3 text-neutral-fg-subtle shrink-0" />
          <span className="font-medium text-neutral-fg truncate max-w-24">
            {status.branch}
          </span>
          <Circle
            className={`h-2 w-2 shrink-0 ${
              status.isClean
                ? 'text-palette-success fill-palette-success'
                : 'text-palette-warning fill-palette-warning'
            }`}
          />
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
