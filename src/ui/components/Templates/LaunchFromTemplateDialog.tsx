/**
 * LaunchFromTemplateDialog - Dialog to set goal and spawn an agent from a template.
 */

import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTRPC } from '@/bridge/react';
import { useOrgStore } from '@/ui/stores/useOrgStore';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Play } from 'lucide-react';
import type { AgentTemplate } from '@/services/types';

interface LaunchFromTemplateDialogProps {
  template: AgentTemplate | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function LaunchFromTemplateDialog({ template, open, onOpenChange }: LaunchFromTemplateDialogProps) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const orgId = useOrgStore((s) => s.currentOrgId);
  const [goal, setGoal] = useState('');
  const [isolateWorktree, setIsolateWorktree] = useState(false);

  const spawnMutation = useMutation(
    trpc.orchestration.spawn.mutationOptions({
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: ['session'] });
        onOpenChange(false);
        setGoal('');
      },
    }),
  );

  const handleLaunch = () => {
    if (!orgId || !template || !goal.trim()) return;
    spawnMutation.mutate({
      orgId,
      templateId: template.id,
      goal: goal.trim(),
      isolateWorktree,
    });
  };

  if (!template) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Launch Agent</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <Badge variant="outline">{template.name}</Badge>
            <Badge variant="secondary" className="text-[10px]">{template.reasoningIntensity}</Badge>
          </div>
          <div className="space-y-2">
            <Label htmlFor="launch-goal">Goal</Label>
            <Input
              id="launch-goal"
              placeholder="Describe what this agent should accomplish..."
              value={goal}
              onChange={(e) => setGoal(e.target.value)}
              autoFocus
            />
          </div>
          <div className="flex items-center justify-between">
            <Label htmlFor="isolate-toggle">Isolate in worktree</Label>
            <Switch
              id="isolate-toggle"
              checked={isolateWorktree}
              onCheckedChange={setIsolateWorktree}
            />
          </div>
          <p className="text-xs text-muted-foreground">
            Worktree isolation creates a separate git branch for this agent&apos;s changes.
          </p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={handleLaunch} disabled={!goal.trim() || spawnMutation.isPending}>
            <Play className="h-3 w-3 mr-1.5" />
            {spawnMutation.isPending ? 'Launching...' : 'Launch'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
