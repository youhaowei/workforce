import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { GitBranch, Circle, ArrowUp, ArrowDown, AlertCircle } from "lucide-react";
import { useTRPC } from "@/bridge/react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { GitStatus } from "@/services/git";

interface GitStatusBadgeProps {
  cwd: string;
  onClick?: () => void;
}

const BADGE_SHARED =
  "h-7 rounded-full shadow-sm border border-neutral-border/30 bg-neutral-bg/70 hover:bg-neutral-bg/90 text-xs select-none gap-1.5 px-2.5";

function buildTooltipLines(status: GitStatus): string[] {
  const changeCount = status.staged.length + status.unstaged.length + status.untracked.length;
  return [
    `Branch: ${status.branch}`,
    status.isClean ? "Working tree clean" : `${changeCount} change${changeCount !== 1 ? "s" : ""}`,
    ...(status.staged.length > 0 ? [`${status.staged.length} staged`] : []),
    ...(status.unstaged.length > 0 ? [`${status.unstaged.length} modified`] : []),
    ...(status.untracked.length > 0 ? [`${status.untracked.length} untracked`] : []),
    ...(status.ahead > 0 ? [`${status.ahead} ahead`] : []),
    ...(status.behind > 0 ? [`${status.behind} behind`] : []),
  ];
}

export function GitStatusBadge({ cwd, onClick }: GitStatusBadgeProps) {
  const trpc = useTRPC();

  // Polling required — no SSE events for git status
  const { data: status, error } = useQuery(
    trpc.git.status.queryOptions({ cwd }, { staleTime: 5_000, refetchInterval: 10_000 }),
  );

  useEffect(() => {
    if (error) console.error("[GitStatusBadge] Failed to fetch git status:", error);
  }, [error]);

  if (error) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            color="neutral"
            onClick={onClick}
            className={BADGE_SHARED}
            aria-label="Git: error fetching status"
          >
            <AlertCircle className="h-3 w-3 text-palette-danger shrink-0" />
            <span className="text-neutral-fg-subtle">git</span>
          </Button>
        </TooltipTrigger>
        <TooltipContent side="bottom">Failed to fetch git status</TooltipContent>
      </Tooltip>
    );
  }

  // Skeleton placeholder while loading to prevent layout shift
  if (!status) {
    return (
      <div
        className={`flex items-center ${BADGE_SHARED} pointer-events-none opacity-50`}
        aria-label="Git: loading"
      >
        <GitBranch className="h-3 w-3 text-neutral-fg-subtle shrink-0" />
        <span className="w-16 h-2 bg-neutral-fg-subtle/20 rounded animate-pulse" />
      </div>
    );
  }

  const tooltipLines = buildTooltipLines(status);
  const hasAheadBehind = status.ahead > 0 || status.behind > 0;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          color="neutral"
          onClick={onClick}
          className={BADGE_SHARED}
          aria-label={`Git: ${status.branch}${status.isClean ? "" : " (dirty)"}`}
        >
          <GitBranch className="h-3 w-3 text-neutral-fg-subtle shrink-0" />
          <span className="font-medium text-neutral-fg truncate max-w-24">{status.branch}</span>
          <Circle
            className={`h-2 w-2 shrink-0 ${
              status.isClean
                ? "text-palette-success fill-palette-success"
                : "text-palette-warning fill-palette-warning"
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
        </Button>
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
