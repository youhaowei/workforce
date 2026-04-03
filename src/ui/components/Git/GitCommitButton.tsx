import { useState, useCallback, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { GitCommit, Loader2, Check } from "lucide-react";
import { useTRPC } from "@/bridge/react";
import { trpc as trpcClient } from "@/bridge/trpc";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

interface GitCommitButtonProps {
  cwd: string;
}

type CommitProgress = {
  phase: "idle" | "running" | "done";
  statusText?: string;
  commits: string[];
  error?: string;
};

export function GitCommitButton({ cwd }: GitCommitButtonProps) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const statusQueryKey = trpc.git.status.queryKey({ cwd });

  const { data: status } = useQuery(
    trpc.git.status.queryOptions({ cwd }, { staleTime: 5_000, refetchInterval: 10_000 }),
  );

  const [progress, setProgress] = useState<CommitProgress>({ phase: "idle", commits: [] });
  const clearRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const handleCommit = useCallback(() => {
    if (progress.phase === "running") return;

    setProgress({ phase: "running", statusText: "Starting...", commits: [] });

    const sub = trpcClient.git.smartCommit.subscribe(
      { cwd },
      {
        onData: (event: { type: string; message?: string; commits?: { hash: string; message: string }[]; error?: string }) => {
          if (event.type === "status") {
            setProgress((p) => ({ ...p, statusText: event.message }));
          } else if (event.type === "committing") {
            setProgress((p) => ({
              ...p,
              statusText: event.message,
              commits: [...p.commits, event.message!],
            }));
          } else if (event.type === "done") {
            queryClient.invalidateQueries({ queryKey: statusQueryKey });
            const count = event.commits?.length ?? 0;
            setProgress({
              phase: "done",
              statusText: count > 0
                ? `${count} commit${count !== 1 ? "s" : ""} created`
                : "No commits created",
              commits: event.commits?.map((c) => c.message) ?? [],
              error: event.error,
            });
            clearRef.current = setTimeout(
              () => setProgress({ phase: "idle", commits: [] }),
              event.error ? 5000 : 3000,
            );
            sub.unsubscribe();
          }
        },
        onError: (err: unknown) => {
          setProgress({
            phase: "done",
            statusText: err instanceof Error ? err.message : "Failed",
            commits: [],
            error: "failed",
          });
          clearRef.current = setTimeout(
            () => setProgress({ phase: "idle", commits: [] }),
            5000,
          );
        },
      },
    );
  }, [cwd, progress.phase, queryClient, statusQueryKey]);

  if (!status || status.isClean) return null;

  // Done state — show result
  if (progress.phase === "done") {
    const isError = !!progress.error;
    return (
      <span className={`text-[10px] font-medium px-2 ${isError ? "text-palette-danger" : "text-palette-success"}`}>
        {progress.statusText}
      </span>
    );
  }

  // Running — show progress
  if (progress.phase === "running") {
    return (
      <div className="flex items-center gap-1.5 h-7 px-2.5 rounded-full bg-neutral-bg/70 shadow-sm border border-neutral-border/30 text-xs">
        <Loader2 className="h-3 w-3 animate-spin text-neutral-fg-subtle shrink-0" />
        <span className="font-medium text-neutral-fg truncate max-w-48">
          {progress.statusText}
        </span>
        {progress.commits.length > 0 && (
          <span className="flex items-center gap-0.5 text-palette-success">
            <Check className="h-2.5 w-2.5" />
            <span className="text-[10px] tabular-nums">{progress.commits.length}</span>
          </span>
        )}
      </div>
    );
  }

  // Idle — show commit button
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          color="neutral"
          size="xs"
          onClick={handleCommit}
          className="h-7 rounded-full shadow-sm border border-neutral-border/30 bg-neutral-bg/70
            hover:bg-neutral-bg/90 text-xs gap-1 px-2.5"
        >
          <GitCommit className="h-3 w-3 text-neutral-fg-subtle shrink-0" />
          <span className="font-medium">Commit</span>
          {(status.insertions > 0 || status.deletions > 0) && (
            <span className="flex items-center gap-1 text-[10px] tabular-nums">
              <span className="text-palette-success font-medium">+{status.insertions}</span>
              <span className="text-palette-danger font-medium">-{status.deletions}</span>
            </span>
          )}
        </Button>
      </TooltipTrigger>
      <TooltipContent side="bottom">Stage all changes and create logical commits</TooltipContent>
    </Tooltip>
  );
}
