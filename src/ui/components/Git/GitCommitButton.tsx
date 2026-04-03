import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { GitCommit, Loader2 } from "lucide-react";
import { useTRPC } from "@/bridge/react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

interface GitCommitButtonProps {
  cwd: string;
}

export function GitCommitButton({ cwd }: GitCommitButtonProps) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const statusQueryKey = trpc.git.status.queryKey({ cwd });

  const { data: status } = useQuery(
    trpc.git.status.queryOptions({ cwd }, { staleTime: 5_000, refetchInterval: 10_000 }),
  );

  const [result, setResult] = useState<{ message: string; isError: boolean } | null>(null);

  const smartCommit = useMutation(
    trpc.git.smartCommit.mutationOptions({
      onSuccess: (data) => {
        queryClient.invalidateQueries({ queryKey: statusQueryKey });
        const count = data.commits?.length ?? 0;
        const msg = count > 0
          ? `${count} commit${count !== 1 ? "s" : ""} created`
          : "No commits created";
        const hasWarning = !!data.warning;
        setResult({ message: hasWarning ? `${msg} (with errors)` : msg, isError: hasWarning || count === 0 });
        setTimeout(() => setResult(null), hasWarning ? 5000 : 3000);
      },
      onError: (err) => {
        setResult({ message: err instanceof Error ? err.message : "Failed", isError: true });
        setTimeout(() => setResult(null), 5000);
      },
    }),
  );

  if (!status || status.isClean) return null;

  if (result) {
    return (
      <span className={`text-[10px] font-medium px-2 ${result.isError ? "text-palette-danger" : "text-palette-success"}`}>
        {result.message}
      </span>
    );
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          color="neutral"
          size="xs"
          onClick={() => smartCommit.mutate({ cwd })}
          disabled={smartCommit.isPending}
          className="h-7 rounded-full shadow-sm border border-neutral-border/30 bg-neutral-bg/70
            hover:bg-neutral-bg/90 text-xs gap-1 px-2.5"
        >
          {smartCommit.isPending ? (
            <Loader2 className="h-3 w-3 animate-spin shrink-0" />
          ) : (
            <GitCommit className="h-3 w-3 text-neutral-fg-subtle shrink-0" />
          )}
          <span className="font-medium">
            {smartCommit.isPending ? "Committing..." : "Commit"}
          </span>
        </Button>
      </TooltipTrigger>
      <TooltipContent side="bottom">Stage all changes and create logical commits</TooltipContent>
    </Tooltip>
  );
}
