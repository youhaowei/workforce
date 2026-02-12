/**
 * OrgSettings - Settings dialog for organization configuration.
 * Manages allowed tools, cost caps, and default template.
 */

import { useState, useEffect } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTRPC } from '@/bridge/react';
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
import type { Org } from '@/services/types';

interface OrgSettingsProps {
  org: Org;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function OrgSettings({ org, open, onOpenChange }: OrgSettingsProps) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();

  const [costWarning, setCostWarning] = useState(String(org.settings.costWarningThreshold ?? ''));
  const [costCap, setCostCap] = useState(String(org.settings.costHardCap ?? ''));
  const [hardCapEnabled, setHardCapEnabled] = useState(!!org.settings.costHardCap);

  useEffect(() => {
    setCostWarning(String(org.settings.costWarningThreshold ?? ''));
    setCostCap(String(org.settings.costHardCap ?? ''));
    setHardCapEnabled(!!org.settings.costHardCap);
  }, [org]);

  const updateMutation = useMutation(
    trpc.org.update.mutationOptions({
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: ['org'] });
        onOpenChange(false);
      },
    }),
  );

  const handleSave = () => {
    updateMutation.mutate({
      id: org.id,
      updates: {
        settings: {
          ...org.settings,
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
          <DialogTitle>Organization Settings</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label>Organization Name</Label>
            <p className="text-sm">{org.name}</p>
          </div>
          <div className="space-y-2">
            <Label>Root Path</Label>
            <p className="text-sm font-mono text-muted-foreground">{org.rootPath}</p>
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
