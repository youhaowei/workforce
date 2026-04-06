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

  useEffect(() => {
    if (queryError) console.error("[GitSection] status query failed", { cwd, queryError });
  }, [queryError, cwd]);

  if (queryError) {
    return (
      <Section label="Git" icon={<GitBranch className="h-3 w-3" />}>
        <p className="text-xs text-palette-danger">Failed to load git status</p>
      </Section>
    );
  }

  if (!status) return null;

  const stagedFiles = status.staged.map((f) => ({ ...f, area: "staged" as const }));
  const unstagedFiles = [
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
              <ScrollArea className="max-h-48">
                <div className="space-y-0.5">
                  {/* Staged group */}
                  {stagedFiles.length > 0 && (
                    <>
                      <div className="text-[11px] font-medium text-palette-success px-1.5 pt-0.5 pb-0.5 select-none">
                        Staged ({stagedFiles.length})
                      </div>
                      {stagedFiles.map((f) => (
                        <FileRow
                          key={`staged-${f.path}`}
                          file={f}
                          isStaged
                          disabled={togglingFile === f.path}
                          onToggle={handleToggleStaged}
                        />
                      ))}
                    </>
                  )}

                  {/* Unstaged / untracked group */}
                  {unstagedFiles.length > 0 && (
                    <>
                      <div className="text-[11px] font-medium text-neutral-fg-subtle px-1.5 pt-1 pb-0.5 select-none">
                        Changes ({unstagedFiles.length})
                      </div>
                      {unstagedFiles.map((f) => (
                        <FileRow
                          key={`${f.area}-${f.path}`}
                          file={f}
                          isStaged={false}
                          disabled={togglingFile === f.path}
                          onToggle={handleToggleStaged}
                        />
                      ))}
                    </>
                  )}
                </div>
              </ScrollArea>

              {/* Commit flow */}
              {stagedFiles.length > 0 && (
                <div className="space-y-1.5 pt-0.5">
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
                    variant="soft"
                    color="primary"
                    size="xs"
                    onClick={handleCommit}
                    disabled={!commitMsg.trim() || commitMutation.isPending}
                    className="w-full"
                  >
                    {commitMutation.isPending
                      ? "Committing..."
                      : `Commit ${stagedFiles.length} file${stagedFiles.length !== 1 ? "s" : ""}`}
                  </Button>
                </div>
              )}
              {actionError && (
                <p className="text-xs text-palette-danger px-1.5 pt-0.5">{actionError}</p>
              )}
            </>
          )}
        </div>
      </Section>

      {log && log.length > 0 && (
        <Section label="Recent commits" icon={<GitCommitIcon className="h-3 w-3" />}>
          <ScrollArea className="max-h-48">
            <div className="space-y-px">
              {log.map((c) => (
                <div
                  key={c.hash}
                  className="flex items-baseline gap-1.5 text-xs py-1 px-1.5 rounded hover:bg-neutral-bg-subtle/50"
                >
                  <span className="font-mono text-[11px] text-neutral-fg-subtle shrink-0">
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

// ─── Sub-components ────────────────────────────────────────────────────────

interface FileRowProps {
  file: { path: string; status: string; area: string };
  isStaged: boolean;
  disabled: boolean;
  onToggle: (path: string, isStaged: boolean) => void;
}

function FileRow({ file, isStaged, disabled, onToggle }: FileRowProps) {
  const filename = file.path.split("/").pop() ?? file.path;
  const dir = file.path.includes("/") ? file.path.slice(0, file.path.lastIndexOf("/")) : null;

  return (
    <Button
      variant="ghost"
      color="neutral"
      className="w-full justify-start text-xs h-6 px-1.5 gap-1 group font-normal"
      onClick={() => onToggle(file.path, isStaged)}
      disabled={disabled}
      title={`${file.path} (${file.area}) - click to ${isStaged ? "unstage" : "stage"}`}
    >
      <span className={`font-mono w-3 shrink-0 text-center ${gitStatusColor(isStaged, file.area)}`}>
        {file.area === "untracked" ? "?" : (STATUS_CHAR[file.status] ?? "?")}
      </span>
      <span className="truncate flex-1 text-left flex items-baseline gap-0.5 min-w-0">
        <span className="font-mono text-neutral-fg truncate">{filename}</span>
        {dir && (
          <span className="font-mono text-neutral-fg-subtle/50 text-[11px] truncate shrink-[2]">
            {dir}
          </span>
        )}
      </span>
      <span className="text-[11px] text-neutral-fg-subtle/50 opacity-0 group-hover:opacity-100 shrink-0">
        {isStaged ? "unstage" : "stage"}
      </span>
    </Button>
  );
}
