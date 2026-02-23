/**
 * OrgSettings - Settings dialog for organization configuration.
 * Manages description, agent defaults, cost caps, and default template.
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { Separator } from '@/components/ui/separator';
import type { AgentTone, Org, ThinkingLevel, VerboseLevel } from '@/services/types';
import {
  SEED_MODELS,
  THINKING_LEVELS,
  TONE_OPTIONS,
  VERBOSE_OPTIONS,
  DEFAULT_AGENT_DEFAULTS,
} from '../Messages/agentConfig';

interface OrgSettingsProps {
  org: Org;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function OrgSettings({ org, open, onOpenChange }: OrgSettingsProps) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();

  const defaults = org.settings.agentDefaults ?? DEFAULT_AGENT_DEFAULTS;

  const [description, setDescription] = useState(org.description ?? '');
  const [costWarning, setCostWarning] = useState(String(org.settings.costWarningThreshold ?? ''));
  const [costCap, setCostCap] = useState(String(org.settings.costHardCap ?? ''));
  const [hardCapEnabled, setHardCapEnabled] = useState(!!org.settings.costHardCap);
  const [model, setModel] = useState(defaults.model);
  const [thinkingLevel, setThinkingLevel] = useState<ThinkingLevel>(defaults.thinkingLevel);
  const [tone, setTone] = useState<AgentTone>(defaults.tone);
  const [verboseLevel, setVerboseLevel] = useState<VerboseLevel>(defaults.verboseLevel);

  useEffect(() => {
    const d = org.settings.agentDefaults ?? DEFAULT_AGENT_DEFAULTS;
    setDescription(org.description ?? '');
    setCostWarning(String(org.settings.costWarningThreshold ?? ''));
    setCostCap(String(org.settings.costHardCap ?? ''));
    setHardCapEnabled(!!org.settings.costHardCap);
    setModel(d.model);
    setThinkingLevel(d.thinkingLevel);
    setTone(d.tone);
    setVerboseLevel(d.verboseLevel);
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
        description: description.trim() || undefined,
        settings: {
          ...org.settings,
          costWarningThreshold: costWarning ? Number(costWarning) : undefined,
          costHardCap: hardCapEnabled && costCap ? Number(costCap) : undefined,
          agentDefaults: { model, thinkingLevel, tone, verboseLevel },
        },
      },
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Workspace Settings</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          {/* General */}
          <div className="space-y-2">
            <Label>Workspace Name</Label>
            <p className="text-sm">{org.name}</p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="org-desc">Description</Label>
            <Textarea
              id="org-desc"
              placeholder="What's this workspace for?"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              className="resize-none"
            />
          </div>

          <Separator />

          {/* Agent Defaults */}
          <div className="space-y-3">
            <Label className="text-sm font-semibold">Default Agent Settings</Label>

            <div className="space-y-2">
              <Label className="text-xs text-muted-foreground">Model</Label>
              <div className="flex flex-wrap gap-2">
                {SEED_MODELS.map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => setModel(m.id)}
                    className={`px-3 py-1.5 rounded-md text-xs font-medium border transition-colors ${
                      model === m.id
                        ? 'bg-primary text-primary-foreground border-primary'
                        : 'bg-card text-foreground border-border hover:border-primary/50'
                    }`}
                  >
                    {m.displayName}
                  </button>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label className="text-xs text-muted-foreground">Thinking</Label>
                <Select value={thinkingLevel} onValueChange={(v) => setThinkingLevel(v as ThinkingLevel)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {THINKING_LEVELS.map((opt) => (
                      <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label className="text-xs text-muted-foreground">Tone</Label>
                <Select value={tone} onValueChange={(v) => setTone(v as AgentTone)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {TONE_OPTIONS.map((opt) => (
                      <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-2">
              <Label className="text-xs text-muted-foreground">Detail Level</Label>
              <Select value={verboseLevel} onValueChange={(v) => setVerboseLevel(v as VerboseLevel)}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {VERBOSE_OPTIONS.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <Separator />

          {/* Cost Controls */}
          <div className="space-y-3">
            <Label className="text-sm font-semibold">Cost Controls</Label>
            <div className="space-y-2">
              <Label htmlFor="cost-warning">Warning Threshold (USD)</Label>
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
