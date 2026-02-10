/**
 * WorktreePanel - Shows worktree info, diff, and merge/archive actions for an agent session.
 * Integrated into AgentDetailView when the agent has a worktree.
 */

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTRPC } from '@bridge/react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { GitBranch, GitMerge, Archive, ChevronDown, ChevronRight } from 'lucide-react';
import { DiffViewer } from './DiffViewer';
import { MergeDialog } from './MergeDialog';

interface WorktreePanelProps {
  sessionId: string;
}

export function WorktreePanel({ sessionId }: WorktreePanelProps) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const [mergeOpen, setMergeOpen] = useState(false);
  const [diffExpanded, setDiffExpanded] = useState(false);

  const { data: worktree, isError } = useQuery(
    trpc.worktree.get.queryOptions({ sessionId }),
  );

  const { data: diff } = useQuery(
    trpc.worktree.diff.queryOptions(
      { sessionId },
      { enabled: diffExpanded },
    ),
  );

  const archiveMutation = useMutation(
    trpc.worktree.archive.mutationOptions({
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: ['worktree'] });
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
              <GitBranch className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm font-mono">{worktree.branch}</span>
              <Badge variant="outline" className="text-[10px]">{worktree.status}</Badge>
            </div>
            <div className="flex gap-1.5">
              {worktree.status === 'active' && (
                <Button size="sm" variant="default" onClick={() => setMergeOpen(true)}>
                  <GitMerge className="h-3 w-3 mr-1" />
                  Merge
                </Button>
              )}
              {worktree.status === 'active' && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => archiveMutation.mutate({ sessionId })}
                  disabled={archiveMutation.isPending}
                >
                  <Archive className="h-3 w-3 mr-1" />
                  Archive
                </Button>
              )}
            </div>
          </div>

          <p className="text-xs text-muted-foreground font-mono truncate">{worktree.path}</p>

          <Collapsible open={diffExpanded} onOpenChange={setDiffExpanded}>
            <CollapsibleTrigger className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors">
              {diffExpanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
              View Diff
            </CollapsibleTrigger>
            <CollapsibleContent className="mt-2">
              {diff !== undefined ? (
                <DiffViewer diff={diff} />
              ) : (
                <p className="text-xs text-muted-foreground">Loading diff...</p>
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
