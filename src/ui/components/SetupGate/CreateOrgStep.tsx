/**
 * CreateOrgStep — Step 2: Create first workspace (only shown when zero orgs exist).
 *
 * Pre-fills org name from user display name.
 */

import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTRPC } from '@/bridge/react';
import { trpc as trpcClient } from '@/bridge/trpc';
import { useOrgStore } from '@/ui/stores/useOrgStore';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ArrowRight, Loader2 } from 'lucide-react';
import type { Org } from '@/services/types';

interface CreateOrgStepProps {
  userName: string;
  onComplete: () => void;
}

export function CreateOrgStep({ userName, onComplete }: CreateOrgStepProps) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const setCurrentOrgId = useOrgStore((s) => s.setCurrentOrgId);
  const [name, setName] = useState(`${userName}'s Workspace`);

  const createMutation = useMutation(
    trpc.org.create.mutationOptions({
      onSuccess: (org) => {
        // Activate on the server so getCurrent returns it on next restart
        trpcClient.org.activate.mutate({ id: org.id }).catch((err) => {
          console.warn('[SetupGate] Failed to activate org on server:', err);
        });
        // Synchronously update cache to avoid stale-data window where
        // orgList is still [] during refetch (causes CreateOrgStep re-mount)
        queryClient.setQueryData(trpc.org.list.queryKey(), (old: Org[] | undefined) => [...(old ?? []), org]);
        queryClient.setQueryData(trpc.org.getCurrent.queryKey(), org);
        setCurrentOrgId(org.id);
        onComplete();
      },
    }),
  );

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    createMutation.mutate({ name: trimmed });
  };

  return (
    <div className="w-full max-w-md px-6">
      <div className="text-center mb-8">
        <h1 className="text-2xl font-semibold mb-2">
          Hi {userName}! Let's create your first workspace.
        </h1>
        <p className="text-sm text-muted-foreground">
          A workspace keeps your agents, sessions, and settings organized.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        <div className="space-y-2">
          <Label htmlFor="org-name">Workspace Name</Label>
          <Input
            id="org-name"
            placeholder="My Workspace"
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoFocus
          />
        </div>

        {createMutation.isError && (
          <p className="text-sm text-destructive">
            {createMutation.error?.message ?? 'Something went wrong. Please try again.'}
          </p>
        )}

        <div className="flex justify-end">
          <Button type="submit" disabled={!name.trim() || createMutation.isPending}>
            {createMutation.isPending ? (
              <>
                <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                Creating...
              </>
            ) : (
              <>
                Continue
                <ArrowRight className="h-3.5 w-3.5 ml-1.5" />
              </>
            )}
          </Button>
        </div>
      </form>
    </div>
  );
}
