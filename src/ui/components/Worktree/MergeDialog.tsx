/**
 * MergeDialog - Confirmation dialog for merging a worktree.
 */

import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTRPC } from '@/bridge/react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { GitMerge } from 'lucide-react';

interface MergeDialogProps {
  sessionId: string;
  branch: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function MergeDialog({ sessionId, branch, open, onOpenChange }: MergeDialogProps) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const [strategy, setStrategy] = useState<'merge' | 'rebase'>('merge');

  const mergeMutation = useMutation(
    trpc.worktree.merge.mutationOptions({
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: ['worktree'] });
        queryClient.invalidateQueries({ queryKey: ['session'] });
        onOpenChange(false);
      },
    }),
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Merge Worktree</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <Label className="text-xs text-muted-foreground">Branch</Label>
            <p className="text-sm font-mono">{branch}</p>
          </div>
          <div className="space-y-2">
            <Label>Strategy</Label>
            <div className="flex gap-2">
              <Badge
                variant={strategy === 'merge' ? 'default' : 'outline'}
                className="cursor-pointer"
                onClick={() => setStrategy('merge')}
              >
                Merge
              </Badge>
              <Badge
                variant={strategy === 'rebase' ? 'default' : 'outline'}
                className="cursor-pointer"
                onClick={() => setStrategy('rebase')}
              >
                Rebase
              </Badge>
            </div>
          </div>
          {mergeMutation.error && (
            <p className="text-xs text-destructive">
              {mergeMutation.error.message}
            </p>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={() => mergeMutation.mutate({ sessionId, strategy })} disabled={mergeMutation.isPending}>
            <GitMerge className="h-3 w-3 mr-1.5" />
            {mergeMutation.isPending ? 'Merging...' : 'Merge'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
