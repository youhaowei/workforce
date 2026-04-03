import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { GitBranch, AlertCircle } from "lucide-react";
import { useTRPC } from "@/bridge/react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { GitStatus } from "@/services/git";
import { GIT_STATUS_QUERY_OPTS } from "./gitQueryOpts";

interface GitStatusBadgeProps {
  cwd: string;
  onClick?: () => void;
}

const BADGE_CLS =
  "h-7 rounded-full shadow-sm border border-neutral-border/30 bg-neutral-bg/70 hover:bg-neutral-bg/90 text-xs select-none gap-1.5 px-2.5";

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
  const budget = maxLen - last.length - 2;
  if (budget <= 0) return last.length > maxLen ? last.slice(0, maxLen - 1) + "\u2026" : last;
  return prefix.slice(0, budget) + "\u2026/" + last;
}

export function GitStatusBadge({ cwd, onClick }: GitStatusBadgeProps) {
  const trpc = useTRPC();

  const { data: status, error } = useQuery(
    trpc.git.status.queryOptions({ cwd }, GIT_STATUS_QUERY_OPTS),
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
            className={BADGE_CLS}
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

  if (!status) {
    return (
      <div
        className={`flex items-center ${BADGE_CLS} pointer-events-none opacity-50`}
        aria-label="Git: loading"
      >
        <GitBranch className="h-3 w-3 text-neutral-fg-subtle shrink-0" />
        <span className="w-14 h-2 bg-neutral-fg-subtle/20 rounded animate-pulse" />
      </div>
    );
  }

  const tooltipLines = buildTooltipLines(status);

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          color="neutral"
          onClick={onClick}
          className={BADGE_CLS}
          aria-label={`Git: ${status.branch}${status.isClean ? "" : " (dirty)"}`}
        >
          <GitBranch className="h-3 w-3 text-neutral-fg-subtle shrink-0" />
          <span className="font-medium text-neutral-fg">{abbreviateBranch(status.branch)}</span>
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
