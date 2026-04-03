import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { GitBranch, ArrowUp, ArrowDown, AlertCircle } from "lucide-react";
import { useTRPC } from "@/bridge/react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { GitStatus } from "@/services/git";

interface GitStatusBadgeProps {
  cwd: string;
  onClick?: () => void;
}

const BADGE_BASE =
  "flex items-center gap-1.5 h-7 px-2.5 rounded-full text-xs select-none bg-neutral-bg/70 shadow-sm border border-neutral-border/30 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-ring focus-visible:ring-offset-2 ring-offset-neutral-bg";

function buildTooltipLines(status: GitStatus): string[] {
  const changeCount = status.staged.length + status.unstaged.length + status.untracked.length;
  const lines = [
    `Branch: ${status.branch}`,
    status.isClean ? "Working tree clean" : `${changeCount} change${changeCount !== 1 ? "s" : ""}`,
    ...(status.staged.length > 0 ? [`${status.staged.length} staged`] : []),
    ...(status.unstaged.length > 0 ? [`${status.unstaged.length} modified`] : []),
    ...(status.untracked.length > 0 ? [`${status.untracked.length} untracked`] : []),
  ];
  if (status.insertions > 0 || status.deletions > 0) {
    lines.push(`+${status.insertions} -${status.deletions} lines`);
  }
  if (status.ahead > 0) lines.push(`${status.ahead} ahead`);
  if (status.behind > 0) lines.push(`${status.behind} behind`);
  return lines;
}

/** Only truncate truly long branch names (>40 chars). Keeps last segment intact. */
function abbreviateBranch(branch: string, maxLen = 40): string {
  if (branch.length <= maxLen) return branch;
  const parts = branch.split("/");
  if (parts.length <= 1) return branch.slice(0, maxLen - 1) + "\u2026";
  const last = parts[parts.length - 1];
  const prefix = parts.slice(0, -1).join("/");
  const budget = maxLen - last.length - 2; // 2 for "/" and "…"
  if (budget <= 0) return last.length > maxLen ? last.slice(0, maxLen - 1) + "\u2026" : last;
  return prefix.slice(0, budget) + "\u2026/" + last;
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
          <button
            onClick={onClick}
            className={`${BADGE_BASE} hover:bg-neutral-bg/90`}
            aria-label="Git: error fetching status"
          >
            <AlertCircle className="h-3 w-3 text-palette-danger shrink-0" />
            <span className="text-neutral-fg-subtle">git</span>
          </button>
        </TooltipTrigger>
        <TooltipContent side="bottom">Failed to fetch git status</TooltipContent>
      </Tooltip>
    );
  }

  // Skeleton placeholder while loading to prevent layout shift
  if (!status) {
    return (
      <div
        className={`${BADGE_BASE} pointer-events-none opacity-50`}
        aria-label="Git: loading"
      >
        <GitBranch className="h-3 w-3 text-neutral-fg-subtle shrink-0" />
        <span className="w-14 h-2 bg-neutral-fg-subtle/20 rounded animate-pulse" />
      </div>
    );
  }

  const tooltipLines = buildTooltipLines(status);
  const hasLineChanges = status.insertions > 0 || status.deletions > 0;
  const changeCount = status.staged.length + status.unstaged.length + status.untracked.length;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          onClick={onClick}
          className={`${BADGE_BASE} hover:bg-neutral-bg/90`}
          aria-label={`Git: ${status.branch}${status.isClean ? "" : " (dirty)"}`}
        >
          <GitBranch className="h-3 w-3 text-neutral-fg-subtle shrink-0" />
          <span className="font-medium text-neutral-fg">
            {abbreviateBranch(status.branch)}
          </span>
          {hasLineChanges ? (
            <span className="flex items-center gap-1 text-[10px] tabular-nums">
              <span className="text-palette-success font-medium">+{status.insertions}</span>
              <span className="text-palette-danger font-medium">-{status.deletions}</span>
            </span>
          ) : !status.isClean && changeCount > 0 ? (
            <span className="text-[10px] font-medium text-palette-warning tabular-nums">
              {changeCount} file{changeCount !== 1 ? "s" : ""}
            </span>
          ) : null}
          {(status.ahead > 0 || status.behind > 0) && (
            <span className="flex items-center gap-0.5 text-[10px] text-neutral-fg-subtle tabular-nums">
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
