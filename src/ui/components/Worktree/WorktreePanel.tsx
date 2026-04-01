/**
 * WorktreePanel - Shows worktree info, diff, and merge/archive actions for an agent session.
 * Integrated into AgentDetailView when the agent has a worktree.
 */

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useTRPC } from "@/bridge/react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { GitBranch, GitMerge, Archive, Clock, ChevronDown, ChevronRight } from "lucide-react";
import { DiffViewer } from "./DiffViewer";
import { MergeDialog } from "./MergeDialog";

interface WorktreePanelProps {
  sessionId: string;
}

export function WorktreePanel({ sessionId }: WorktreePanelProps) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const [mergeOpen, setMergeOpen] = useState(false);
  const [diffExpanded, setDiffExpanded] = useState(false);

  const { data: worktree, isError } = useQuery(trpc.worktree.get.queryOptions({ sessionId }));

  const { data: diff } = useQuery(
    trpc.worktree.diff.queryOptions({ sessionId }, { enabled: diffExpanded }),
  );

  const archiveMutation = useMutation(
    trpc.worktree.archive.mutationOptions({
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: ["worktree"] });
      },
    }),
  );

  const keepMutation = useMutation(
    trpc.worktree.keep.mutationOptions({
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: ["worktree"] });
        queryClient.invalidateQueries({ queryKey: ["session"] });
      },
    }),
  );

  if (isError || !worktree) return null;

  return (
    <>
      <Card>
        <CardContent className="p-3 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <GitBranch className="h-4 w-4 text-neutral-fg-subtle" />
              <span className="text-sm font-mono">{worktree.branch}</span>
              <Badge variant="outline" className="text-[10px]">
                {worktree.status}
              </Badge>
            </div>
            <div className="flex gap-1.5">
              {worktree.status === "active" && (
                <>
                  <Button size="sm" onClick={() => setMergeOpen(true)}>
                    <GitMerge className="h-3 w-3 mr-1" />
                    Merge
                  </Button>
                  <Button
                    size="sm"
                    variant="soft"
                    onClick={() => keepMutation.mutate({ sessionId })}
                    disabled={keepMutation.isPending}
                  >
                    <Clock className="h-3 w-3 mr-1" />
                    Keep
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => archiveMutation.mutate({ sessionId })}
                    disabled={archiveMutation.isPending}
                  >
                    <Archive className="h-3 w-3 mr-1" />
                    Archive
                  </Button>
                </>
              )}
            </div>
          </div>

          <p className="text-xs text-neutral-fg-subtle font-mono truncate">{worktree.path}</p>

          <Collapsible open={diffExpanded} onOpenChange={setDiffExpanded}>
            <CollapsibleTrigger className="flex items-center gap-1.5 text-xs text-neutral-fg-subtle hover:text-neutral-fg transition-colors">
              {diffExpanded ? (
                <ChevronDown className="h-3 w-3" />
              ) : (
                <ChevronRight className="h-3 w-3" />
              )}
              View Diff
            </CollapsibleTrigger>
            <CollapsibleContent className="mt-2">
              {diff !== undefined ? (
                <DiffViewer diff={diff} />
              ) : (
                <p className="text-xs text-neutral-fg-subtle">Loading diff...</p>
              )}
            </CollapsibleContent>
          </Collapsible>
        </CardContent>
      </Card>

      <MergeDialog
        sessionId={sessionId}
        branch={worktree.branch}
        open={mergeOpen}
        onOpenChange={setMergeOpen}
      />
    </>
  );
}
