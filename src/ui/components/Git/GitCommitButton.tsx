import { useState, useCallback, useRef, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { GitCommit, Loader2, Check } from "lucide-react";
import { useTRPC } from "@/bridge/react";
import { trpc as trpcClient } from "@/bridge/trpc";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { GIT_STATUS_QUERY_OPTS } from "./gitQueryOpts";

interface GitCommitButtonProps {
  cwd: string;
}

type CommitProgress = {
  phase: "idle" | "running" | "done";
  statusText?: string;
  commitCount: number;
  error?: string;
};

export function GitCommitButton({ cwd }: GitCommitButtonProps) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const statusQueryKey = trpc.git.status.queryKey({ cwd });
  const logQueryKey = trpc.git.log.queryKey({ cwd, limit: 10 });

  const { data: status } = useQuery(trpc.git.status.queryOptions({ cwd }, GIT_STATUS_QUERY_OPTS));

  const [progress, setProgress] = useState<CommitProgress>({ phase: "idle", commitCount: 0 });
  const subRef = useRef<{ unsubscribe: () => void } | null>(null);
  const clearTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      subRef.current?.unsubscribe();
      if (clearTimerRef.current) clearTimeout(clearTimerRef.current);
    };
  }, []);

  const handleCommit = useCallback(() => {
    if (progress.phase === "running") return;

    subRef.current?.unsubscribe();
    if (clearTimerRef.current) clearTimeout(clearTimerRef.current);
    setProgress({ phase: "running", statusText: "Starting...", commitCount: 0 });

    let sub: { unsubscribe: () => void } | null = null;
    let pendingUnsub = false;
    const unsub = () => {
      if (sub) sub.unsubscribe();
      else pendingUnsub = true;
    };

    sub = trpcClient.git.smartCommit.subscribe(
      { cwd },
      {
        onData: (event: {
          type: string;
          message?: string;
          commits?: { hash: string; message: string }[];
          error?: string;
        }) => {
          if (event.type === "status") {
            setProgress((p) => ({ ...p, statusText: event.message }));
          } else if (event.type === "committing") {
            setProgress((p) => ({
              ...p,
              statusText: event.message,
              commitCount: p.commitCount + 1,
            }));
          } else if (event.type === "done") {
            queryClient.invalidateQueries({ queryKey: statusQueryKey });
            queryClient.invalidateQueries({ queryKey: logQueryKey });
            const count = event.commits?.length ?? 0;
            setProgress({
              phase: "done",
              statusText:
                count > 0
                  ? `${count} commit${count !== 1 ? "s" : ""} created`
                  : "No commits created",
              commitCount: count,
              error: event.error,
            });
            clearTimerRef.current = setTimeout(
              () => setProgress({ phase: "idle", commitCount: 0 }),
              event.error ? 5000 : 3000,
            );
            unsub();
            subRef.current = null;
          }
        },
        onError: (err: unknown) => {
          setProgress({
            phase: "done",
            statusText: err instanceof Error ? err.message : "Failed",
            commitCount: 0,
            error: "failed",
          });
          clearTimerRef.current = setTimeout(
            () => setProgress({ phase: "idle", commitCount: 0 }),
            5000,
          );
          subRef.current = null;
        },
      },
    );

    if (pendingUnsub) {
      sub.unsubscribe();
      sub = null;
    }
    subRef.current = sub;
  }, [cwd, progress.phase, queryClient, statusQueryKey, logQueryKey]);

  if (!status || status.isClean) return null;

  if (progress.phase === "done") {
    const isError = !!progress.error;
    return (
      <span
        className={`text-[10px] font-medium px-2 ${isError ? "text-palette-danger" : "text-palette-success"}`}
      >
        {progress.statusText}
      </span>
    );
  }

  if (progress.phase === "running") {
    return (
  if (progress.phase === "done") {
    const isError = !!progress.error;
    return (
      <span
        className={`text-[10px] font-medium px-2 ${isError ? "text-palette-danger" : "text-palette-success"}`}
      >
        {progress.statusText}
      </span>
    );
  }

  if (!status || status.isClean) return null;

        {progress.commitCount > 0 && (
          <span className="flex items-center gap-0.5 text-palette-success">
            <Check className="h-2.5 w-2.5" />
            <span className="text-[10px] tabular-nums">{progress.commitCount}</span>
          </span>
        )}
      </div>
    );
  }

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
