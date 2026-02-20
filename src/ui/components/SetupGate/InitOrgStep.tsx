/**
 * InitOrgStep — Step 4: Initialize workspace with description + agent defaults.
 *
 * Sets org.initialized = true and org.settings.agentDefaults on submit.
 */

import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTRPC } from '@/bridge/react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { ArrowRight, Loader2 } from 'lucide-react';
import type { AgentTone, Org, ThinkingLevel, VerboseLevel } from '@/services/types';
import {
  SEED_MODELS,
  THINKING_LEVELS,
  TONE_OPTIONS,
  VERBOSE_OPTIONS,
  DEFAULT_AGENT_DEFAULTS,
} from '../Messages/agentConfig';

interface InitOrgStepProps {
  org: Org;
  onComplete: () => void;
}

export function InitOrgStep({ org, onComplete }: InitOrgStepProps) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();

  const [description, setDescription] = useState(org.description ?? '');
  const [model, setModel] = useState(DEFAULT_AGENT_DEFAULTS.model);
  const [thinkingLevel, setThinkingLevel] = useState<ThinkingLevel>(DEFAULT_AGENT_DEFAULTS.thinkingLevel);
  const [tone, setTone] = useState<AgentTone>(DEFAULT_AGENT_DEFAULTS.tone);
  const [verboseLevel, setVerboseLevel] = useState<VerboseLevel>(DEFAULT_AGENT_DEFAULTS.verboseLevel);

  const updateMutation = useMutation(
    trpc.org.update.mutationOptions({
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: ['org'] });
        onComplete();
      },
    }),
  );

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    updateMutation.mutate({
      id: org.id,
      updates: {
        description: description.trim() || undefined,
        initialized: true,
        settings: {
          ...org.settings,
          agentDefaults: { model, thinkingLevel, tone, verboseLevel },
        },
      },
    });
  };

  return (
    <div className="w-full max-w-lg px-6">
      <div className="text-center mb-8">
        <h1 className="text-2xl font-semibold mb-2">
          Set up "{org.name}"
        </h1>
        <p className="text-sm text-muted-foreground">
          Configure your workspace defaults. You can change these later in settings.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Description */}
        <div className="space-y-2">
          <Label htmlFor="org-description">What's this workspace for?</Label>
          <Textarea
            id="org-description"
            placeholder="Building a SaaS product with AI agents for code review and deployment"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
            className="resize-none"
          />
        </div>

        {/* Default agent settings */}
        <div className="space-y-4">
          <Label className="text-sm font-semibold">Default Agent Settings</Label>

          {/* Model selector — button group */}
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

          {/* Thinking + Tone row */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label className="text-xs text-muted-foreground">Thinking</Label>
              <Select value={thinkingLevel} onValueChange={(v) => setThinkingLevel(v as ThinkingLevel)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {THINKING_LEVELS.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      {opt.label}
                    </SelectItem>
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
                    <SelectItem key={opt.value} value={opt.value}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Detail Level */}
          <div className="space-y-2">
            <Label className="text-xs text-muted-foreground">Detail Level</Label>
            <Select value={verboseLevel} onValueChange={(v) => setVerboseLevel(v as VerboseLevel)}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {VERBOSE_OPTIONS.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {updateMutation.isError && (
          <p className="text-sm text-destructive">
            {updateMutation.error?.message ?? 'Something went wrong. Please try again.'}
          </p>
        )}

        <div className="flex justify-end">
          <Button type="submit" disabled={updateMutation.isPending}>
            {updateMutation.isPending ? (
              <>
                <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                Setting up...
              </>
            ) : (
              <>
                Get Started
                <ArrowRight className="h-3.5 w-3.5 ml-1.5" />
              </>
            )}
          </Button>
        </div>
      </form>
    </div>
  );
}
