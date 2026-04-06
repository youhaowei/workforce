import { useState, useRef, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowUp, Loader2, Check, AlertCircle } from "lucide-react";
import { useTRPC } from "@/bridge/react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { GIT_STATUS_QUERY_OPTS } from "./gitQueryOpts";
import { GIT_PILL_CLS } from "./GitStatusBadge";

interface GitPushButtonProps {
  cwd: string;
}

export function GitPushButton({ cwd }: GitPushButtonProps) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const statusQueryKey = trpc.git.status.queryKey({ cwd });
  const logQueryKey = trpc.git.log.queryKey({ cwd, limit: 10 });

  const { data: status } = useQuery(trpc.git.status.queryOptions({ cwd }, GIT_STATUS_QUERY_OPTS));

  const [result, setResult] = useState<{ message: string; isError: boolean } | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  const pushMutation = useMutation(
    trpc.git.push.mutationOptions({
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: statusQueryKey });
        queryClient.invalidateQueries({ queryKey: logQueryKey });
        setResult({ message: "Pushed", isError: false });
        timerRef.current = setTimeout(() => setResult(null), 3000);
      },
      onError: (err) => {
        setResult({ message: err instanceof Error ? err.message : "Push failed", isError: true });
        timerRef.current = setTimeout(() => setResult(null), 5000);
      },
    }),
  );

  const ahead = status?.ahead ?? 0;
  const hasUpstream = status?.hasUpstream ?? true;
  if (ahead === 0 && hasUpstream) return null;

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

  const buttonLabel = pushMutation.isPending ? "Pushing..." : ahead > 0 ? `Push ${ahead}` : "Push";

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          color="neutral"
          size="xs"
          onClick={() => pushMutation.mutate({ cwd })}
          disabled={pushMutation.isPending}
          className={GIT_PILL_CLS}
        >
          {pushMutation.isPending ? (
            <Loader2 className="h-3 w-3 animate-spin shrink-0" />
          ) : (
            <ArrowUp className="h-3 w-3 text-neutral-fg-subtle shrink-0" />
          )}
          <span className="font-medium">{buttonLabel}</span>
        </Button>
      </TooltipTrigger>
      <TooltipContent side="bottom">
        {!hasUpstream
          ? "Push and set upstream"
          : `Push ${ahead} commit${ahead !== 1 ? "s" : ""} to remote`}
      </TooltipContent>
    </Tooltip>
  );
}
