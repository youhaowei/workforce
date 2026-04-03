import { useState, useEffect, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useTRPC } from "@/bridge/react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { GitBranch, GitCommit as GitCommitIcon } from "lucide-react";
import { Section } from "../shared/Section";
import { GIT_STATUS_QUERY_OPTS } from "./gitQueryOpts";

// ─── Helpers ────────────────────────────────────────────────────────────────

function gitStatusColor(isStaged: boolean, area: string): string {
  if (isStaged) return "text-palette-success";
  if (area === "untracked") return "text-neutral-fg-subtle";
  return "text-palette-warning";
}

const STATUS_CHAR: Record<string, string> = {
  added: "A",
  modified: "M",
  deleted: "D",
  renamed: "R",
  copied: "C",
  unmerged: "U",
};

// ─── Component ──────────────────────────────────────────────────────────────

export function GitSection({ cwd, isOpen }: { cwd: string; isOpen: boolean }) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const statusQueryKey = trpc.git.status.queryKey({ cwd });

  // Polling required — no SSE events for git status
  const { data: status, error: queryError } = useQuery(
    trpc.git.status.queryOptions({ cwd }, { enabled: isOpen, ...GIT_STATUS_QUERY_OPTS }),
  );

  const { data: log } = useQuery(
    trpc.git.log.queryOptions(
      { cwd, limit: 10 },
      { enabled: isOpen, staleTime: 10_000, refetchInterval: 30_000 },
    ),
  );

  const [commitMsg, setCommitMsg] = useState("");
  const [actionError, setActionError] = useState<string | null>(null);
  const [togglingFile, setTogglingFile] = useState<string | null>(null);

  // Reset local state when project changes
  useEffect(() => {
    setCommitMsg("");
    setActionError(null);
    setTogglingFile(null);
  }, [cwd]);

  const logQueryKey = trpc.git.log.queryKey({ cwd, limit: 10 });

  const invalidateGit = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: statusQueryKey });
    queryClient.invalidateQueries({ queryKey: logQueryKey });
  }, [queryClient, statusQueryKey, logQueryKey]);

  const stageMutation = useMutation(
    trpc.git.stage.mutationOptions({ onSuccess: () => invalidateGit() }),
  );
  const unstageMutation = useMutation(
    trpc.git.unstage.mutationOptions({ onSuccess: () => invalidateGit() }),
  );
  const commitMutation = useMutation(
    trpc.git.commit.mutationOptions({
      onSuccess: (result) => {
        if (result.success) {
          setCommitMsg("");
          invalidateGit();
        } else {
          setActionError(result.error ?? "Commit failed");
        }
      },
      onError: (err) => {
        setActionError(err instanceof Error ? err.message : "Commit failed");
      },
    }),
  );

  const handleToggleStaged = useCallback(
    async (file: string, isStaged: boolean) => {
      setActionError(null);
      setTogglingFile(file);
      try {
        const mutation = isStaged ? unstageMutation : stageMutation;
        await mutation.mutateAsync({ cwd, files: [file] });
      } catch (err) {
        const action = isStaged ? "unstage" : "stage";
        setActionError(err instanceof Error ? err.message : `Failed to ${action} file`);
      } finally {
        setTogglingFile(null);
      }
    },
    [cwd, stageMutation, unstageMutation],
  );

  const handleCommit = useCallback(() => {
    if (!commitMsg.trim() || !status || status.staged.length === 0) return;
    setActionError(null);
    commitMutation.mutate({ cwd, message: commitMsg.trim() });
  }, [cwd, commitMsg, status, commitMutation]);

  if (queryError) {
    return (
      <Section label="Git" icon={<GitBranch className="h-3 w-3" />}>
        <p className="text-xs text-palette-danger">Failed to load git status</p>
      </Section>
    );
  }

  if (!status) return null;

  const allChanges = [
    ...status.staged.map((f) => ({ ...f, area: "staged" as const })),
    ...status.unstaged.map((f) => ({ ...f, area: "unstaged" as const })),
    ...status.untracked.map((p) => ({
      path: p,
      status: "added" as const,
      area: "untracked" as const,
    })),
  ];

  return (
    <>
      <Section label={`Git (${status.branch})`} icon={<GitBranch className="h-3 w-3" />}>
        <div className="space-y-2">
          {status.isClean ? (
            <p className="text-xs text-neutral-fg-subtle">Working tree clean</p>
          ) : (
            <>
              <ScrollArea className="max-h-40">
                <div className="space-y-0.5">
                  {allChanges.map((f) => {
                    const filename = f.path.split("/").pop() ?? f.path;
                    const isStaged = f.area === "staged";
                    return (
                      <Button
                        key={`${f.area}-${f.path}`}
                        variant="ghost"
                        color="neutral"
                        className="w-full justify-start text-xs h-6 px-1.5 gap-1 group font-normal"
                        onClick={() => handleToggleStaged(f.path, isStaged)}
                        disabled={togglingFile === f.path}
                        title={`${f.path} (${f.area}) - click to ${isStaged ? "unstage" : "stage"}`}
                      >
                        <span
                          className={`font-mono w-3 shrink-0 text-center ${gitStatusColor(isStaged, f.area)}`}
                        >
                          {f.area === "untracked" ? "?" : (STATUS_CHAR[f.status] ?? "?")}
                        </span>
                        <span className="font-mono text-neutral-fg-subtle truncate flex-1 text-left">
                          {filename}
                        </span>
                        <span className="text-[10px] text-neutral-fg-subtle/50 opacity-0 group-hover:opacity-100">
                          {isStaged ? "unstage" : "stage"}
                        </span>
                      </Button>
                    );
                  })}
                </div>
              </ScrollArea>

              {status.staged.length > 0 && (
                <div className="space-y-1">
                  <Input
                    value={commitMsg}
                    onChange={(e) => setCommitMsg(e.currentTarget.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault();
                        handleCommit();
                      }
                    }}
                    placeholder="Commit message..."
                    className="h-7 text-xs px-2"
                    disabled={commitMutation.isPending}
                  />
                  <Button
                    variant="solid"
                    color="primary"
                    size="xs"
                    onClick={handleCommit}
                    disabled={!commitMsg.trim() || commitMutation.isPending}
                    className="w-full"
                  >
                    {commitMutation.isPending
                      ? "Committing..."
                      : `Commit ${status.staged.length} file${status.staged.length !== 1 ? "s" : ""}`}
                  </Button>
                </div>
              )}
              {actionError && <p className="text-xs text-palette-danger">{actionError}</p>}
            </>
          )}
        </div>
      </Section>

      {log && log.length > 0 && (
        <Section label="Recent commits" icon={<GitCommitIcon className="h-3 w-3" />}>
          <ScrollArea className="max-h-52">
            <div className="space-y-0.5">
              {log.map((c) => (
                <div key={c.hash} className="flex items-baseline gap-1.5 text-xs py-0.5">
                  <span className="font-mono text-[10px] text-neutral-fg-subtle shrink-0">
                    {c.shortHash}
                  </span>
                  <span className="text-neutral-fg truncate">{c.subject}</span>
                </div>
              ))}
            </div>
          </ScrollArea>
        </Section>
      )}
    </>
  );
}
