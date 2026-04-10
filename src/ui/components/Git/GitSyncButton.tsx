import { useState, useRef, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowUp, ArrowDown, Loader2, Check, AlertCircle, RefreshCw } from "lucide-react";
import { useTRPC } from "@/bridge/react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { GIT_STATUS_QUERY_OPTS } from "./gitQueryOpts";
import { GIT_PILL_CLS } from "./GitStatusBadge";

interface GitSyncButtonProps {
  cwd: string;
}

type SyncPhase = "idle" | "pulling" | "pushing";

export function GitSyncButton({ cwd }: GitSyncButtonProps) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const statusQueryKey = trpc.git.status.queryKey({ cwd });
  const logQueryKey = trpc.git.log.queryKey({ cwd, limit: 10 });

  const { data: status } = useQuery(trpc.git.status.queryOptions({ cwd }, GIT_STATUS_QUERY_OPTS));

  const [result, setResult] = useState<{ message: string; isError: boolean } | null>(null);
  const [phase, setPhase] = useState<SyncPhase>("idle");
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: statusQueryKey });
    queryClient.invalidateQueries({ queryKey: logQueryKey });
  };

  const showResult = (message: string, isError: boolean) => {
    setResult({ message, isError });
    setPhase("idle");
    timerRef.current = setTimeout(() => setResult(null), isError ? 5000 : 3000);
  };

  const pullMutation = useMutation(trpc.git.pull.mutationOptions({}));
  const pushMutation = useMutation(trpc.git.push.mutationOptions({}));

  const ahead = status?.ahead ?? 0;
  const behind = status?.behind ?? 0;
  const hasUpstream = status?.hasUpstream ?? true;

  // Nothing to sync and has upstream — hide
  if (ahead === 0 && behind === 0 && hasUpstream) return null;

  const isBusy = phase !== "idle";

  const handleSync = async () => {
    if (isBusy) return;

    try {
      // Pull first if behind
      if (behind > 0) {
        setPhase("pulling");
        await pullMutation.mutateAsync({ cwd });
      }

      // Then push if ahead (or no upstream)
      if (ahead > 0 || !hasUpstream) {
        setPhase("pushing");
        await pushMutation.mutateAsync({ cwd });
      }

      invalidate();
      showResult("Synced", false);
    } catch (err) {
      invalidate();
      showResult(err instanceof Error ? err.message : "Sync failed", true);
    }
  };

  if (result) {
    return (
      <div
        className={`flex items-center ${GIT_PILL_CLS} pointer-events-none ${result.isError ? "text-palette-danger" : "text-palette-success"}`}
      >
        {result.isError ? (
          <AlertCircle className="h-3 w-3 shrink-0" />
        ) : (
          <Check className="h-3 w-3 shrink-0" />
        )}
        <span className="text-[11px] font-medium">{result.message}</span>
      </div>
    );
  }

  // Build label: ↓N ↑M
  const labelParts: React.ReactNode[] = [];
  if (isBusy) {
    labelParts.push(phase === "pulling" ? "Pulling…" : "Pushing…");
  } else {
    if (behind > 0) {
      labelParts.push(
        <span key="behind" className="flex items-center gap-0.5">
          <ArrowDown className="h-2.5 w-2.5" />
          <span className="tabular-nums">{behind}</span>
        </span>,
      );
    }
    if (ahead > 0) {
      labelParts.push(
        <span key="ahead" className="flex items-center gap-0.5">
          <ArrowUp className="h-2.5 w-2.5" />
          <span className="tabular-nums">{ahead}</span>
        </span>,
      );
    }
    if (!hasUpstream && ahead === 0) {
      labelParts.push("Publish");
    }
  }

  // Icon: sync icon when both, arrow when single direction
  const Icon = isBusy
    ? Loader2
    : behind > 0 && ahead > 0
      ? RefreshCw
      : behind > 0
        ? ArrowDown
        : ArrowUp;

  // Tooltip
  const tooltipLines: string[] = [];
  if (behind > 0) tooltipLines.push(`Pull ${behind} commit${behind !== 1 ? "s" : ""} from remote`);
  if (ahead > 0) tooltipLines.push(`Push ${ahead} commit${ahead !== 1 ? "s" : ""} to remote`);
  if (!hasUpstream) tooltipLines.push("Push and set upstream");

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          color="neutral"
          size="xs"
          onClick={handleSync}
          disabled={isBusy}
          className={GIT_PILL_CLS}
        >
          <Icon
            className={`h-3 w-3 text-neutral-fg-subtle shrink-0 ${isBusy ? "animate-spin" : ""}`}
          />
          <span className="font-medium flex items-center gap-1">{labelParts}</span>
        </Button>
      </TooltipTrigger>
      <TooltipContent side="bottom">
        {tooltipLines.map((line) => (
          <div key={line}>{line}</div>
        ))}
      </TooltipContent>
    </Tooltip>
  );
}
