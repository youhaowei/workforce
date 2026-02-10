/**
 * WorkspaceSettings - Settings dialog for workspace configuration.
 * Manages allowed tools, cost caps, and default template.
 */

import { useState, useEffect } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTRPC } from '@bridge/react';
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
import type { Workspace } from '@services/types';

interface WorkspaceSettingsProps {
  workspace: Workspace;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function WorkspaceSettings({ workspace, open, onOpenChange }: WorkspaceSettingsProps) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();

  const [costWarning, setCostWarning] = useState(String(workspace.settings.costWarningThreshold ?? ''));
  const [costCap, setCostCap] = useState(String(workspace.settings.costHardCap ?? ''));
  const [hardCapEnabled, setHardCapEnabled] = useState(!!workspace.settings.costHardCap);

  useEffect(() => {
    setCostWarning(String(workspace.settings.costWarningThreshold ?? ''));
    setCostCap(String(workspace.settings.costHardCap ?? ''));
    setHardCapEnabled(!!workspace.settings.costHardCap);
  }, [workspace]);

  const updateMutation = useMutation(
    trpc.workspace.update.mutationOptions({
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: ['workspace'] });
        onOpenChange(false);
      },
    }),
  );

  const handleSave = () => {
    updateMutation.mutate({
      id: workspace.id,
      updates: {
        settings: {
          ...workspace.settings,
          costWarningThreshold: costWarning ? Number(costWarning) : undefined,
          costHardCap: hardCapEnabled && costCap ? Number(costCap) : undefined,
        },
      },
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Workspace Settings</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label>Workspace Name</Label>
            <p className="text-sm">{workspace.name}</p>
          </div>
          <div className="space-y-2">
            <Label>Root Path</Label>
            <p className="text-sm font-mono text-muted-foreground">{workspace.rootPath}</p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="cost-warning">Cost Warning Threshold (USD)</Label>
            <Input
              id="cost-warning"
              type="number"
              step="0.01"
              placeholder="e.g. 5.00"
              value={costWarning}
              onChange={(e) => setCostWarning(e.target.value)}
            />
          </div>
          <div className="flex items-center justify-between">
            <Label htmlFor="hard-cap-toggle">Enable Hard Cost Cap</Label>
            <Switch
              id="hard-cap-toggle"
              checked={hardCapEnabled}
              onCheckedChange={setHardCapEnabled}
            />
          </div>
          {hardCapEnabled && (
            <div className="space-y-2">
              <Label htmlFor="cost-cap">Hard Cap (USD)</Label>
              <Input
                id="cost-cap"
                type="number"
                step="0.01"
                placeholder="e.g. 20.00"
                value={costCap}
                onChange={(e) => setCostCap(e.target.value)}
              />
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={handleSave} disabled={updateMutation.isPending}>
            {updateMutation.isPending ? 'Saving...' : 'Save'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
