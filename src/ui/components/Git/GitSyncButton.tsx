import { useState, useRef, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowUp, ArrowDown, Loader2, Check, AlertCircle, RefreshCw } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useTRPC } from "@/bridge/react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { GIT_STATUS_QUERY_OPTS } from "./gitQueryOpts";
import { GIT_PILL_CLS } from "./GitStatusBadge";

interface GitSyncButtonProps {
  cwd: string;
}

type SyncPhase = "idle" | "pulling" | "pushing";

interface StatusSnapshot {
  ahead: number;
  behind: number;
  hasUpstream: boolean;
}

const EMPTY_STATUS: StatusSnapshot = { ahead: 0, behind: 0, hasUpstream: true };

function toSnapshot(
  status: { ahead?: number; behind?: number; hasUpstream?: boolean } | undefined | null,
): StatusSnapshot {
  if (!status) return EMPTY_STATUS;
  return {
    ahead: status.ahead ?? 0,
    behind: status.behind ?? 0,
    hasUpstream: status.hasUpstream ?? true,
  };
}

function shouldHide({ ahead, behind, hasUpstream }: StatusSnapshot): boolean {
  return ahead === 0 && behind === 0 && hasUpstream;
}

function shouldPush({ ahead, hasUpstream }: StatusSnapshot): boolean {
  return ahead > 0 || !hasUpstream;
}

function pickIcon(phase: SyncPhase, { ahead, behind }: StatusSnapshot): LucideIcon {
  if (phase !== "idle") return Loader2;
  if (behind > 0 && ahead > 0) return RefreshCw;
  if (behind > 0) return ArrowDown;
  return ArrowUp;
}

function buildLabelParts(
  phase: SyncPhase,
  { ahead, behind, hasUpstream }: StatusSnapshot,
): React.ReactNode[] {
  if (phase !== "idle") {
    return [phase === "pulling" ? "Pulling…" : "Pushing…"];
  }
  const parts: React.ReactNode[] = [];
  if (behind > 0) {
    parts.push(
      <span key="behind" className="flex items-center gap-0.5">
        <ArrowDown className="h-2.5 w-2.5" />
        <span className="tabular-nums">{behind}</span>
      </span>,
    );
  }
  if (ahead > 0) {
    parts.push(
      <span key="ahead" className="flex items-center gap-0.5">
        <ArrowUp className="h-2.5 w-2.5" />
        <span className="tabular-nums">{ahead}</span>
      </span>,
    );
  }
  if (!hasUpstream) parts.push("Publish");
  return parts;
}

function buildTooltipLines({ ahead, behind, hasUpstream }: StatusSnapshot): string[] {
  const lines: string[] = [];
  if (behind > 0) lines.push(`Pull ${behind} commit${behind !== 1 ? "s" : ""} from remote`);
  if (ahead > 0) lines.push(`Push ${ahead} commit${ahead !== 1 ? "s" : ""} to remote`);
  if (!hasUpstream) lines.push("Push and set upstream");
  return lines;
}

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

  const snapshot = toSnapshot(status);

  if (shouldHide(snapshot)) return null;

  const isBusy = phase !== "idle";

  const handleSync = async () => {
    if (isBusy) return;

    try {
      // Pull first if behind, then re-read status so the push decision isn't stale.
      let next = snapshot;
      if (snapshot.behind > 0) {
        setPhase("pulling");
        await pullMutation.mutateAsync({ cwd });
        await queryClient.refetchQueries({ queryKey: statusQueryKey });
        next = toSnapshot(queryClient.getQueryData(statusQueryKey));
      }

      if (shouldPush(next)) {
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
    const ResultIcon = result.isError ? AlertCircle : Check;
    return (
      <div
        className={`flex items-center ${GIT_PILL_CLS} pointer-events-none ${result.isError ? "text-palette-danger" : "text-palette-success"}`}
      >
        <ResultIcon className="h-3 w-3 shrink-0" />
        <span className="text-[11px] font-medium">{result.message}</span>
      </div>
    );
  }

  const Icon = pickIcon(phase, snapshot);
  const labelParts = buildLabelParts(phase, snapshot);
  const tooltipLines = buildTooltipLines(snapshot);

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
