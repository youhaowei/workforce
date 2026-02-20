/**
 * SelectOrgStep — Step 3: Pick an existing workspace (shown when orgs exist but none selected).
 *
 * Migrated from OrgGate's org picker with inline create support.
 */

import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTRPC } from '@/bridge/react';
import { trpc as trpcClient } from '@/bridge/trpc';
import { useOrgStore } from '@/ui/stores/useOrgStore';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Plus, Loader2, ArrowRight, ArrowLeft } from 'lucide-react';
import type { Org } from '@/services/types';

interface SelectOrgStepProps {
  orgs: Org[];
  onComplete: () => void;
}

export function SelectOrgStep({ orgs, onComplete }: SelectOrgStepProps) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const setCurrentOrgId = useOrgStore((s) => s.setCurrentOrgId);
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState('');

  const activateMutation = useMutation(
    trpc.org.activate.mutationOptions({
      onSuccess: (org) => {
        queryClient.setQueryData(trpc.org.getCurrent.queryKey(), org);
        setCurrentOrgId(org.id);
        onComplete();
      },
    }),
  );

  const createMutation = useMutation(
    trpc.org.create.mutationOptions({
      onSuccess: (org) => {
        trpcClient.org.activate.mutate({ id: org.id }).catch((err) => {
          console.warn('[SetupGate] Failed to activate org on server:', err);
        });
        queryClient.setQueryData(trpc.org.list.queryKey(), (old: Org[] | undefined) => [...(old ?? []), org]);
        queryClient.setQueryData(trpc.org.getCurrent.queryKey(), org);
        setCurrentOrgId(org.id);
        onComplete();
      },
    }),
  );

  const handleCreate = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = newName.trim();
    if (!trimmed) return;
    createMutation.mutate({ name: trimmed });
  };

  if (showCreate) {
    return (
      <div className="w-full max-w-md px-6">
        <div className="text-center mb-8">
          <h1 className="text-2xl font-semibold mb-2">New Workspace</h1>
        </div>
        <form onSubmit={handleCreate} className="space-y-6">
          <div className="space-y-2">
            <Label htmlFor="new-org-name">Workspace Name</Label>
            <Input
              id="new-org-name"
              placeholder="My Workspace"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              autoFocus
            />
          </div>
          <div className="flex justify-between">
            <Button type="button" variant="outline" onClick={() => setShowCreate(false)}>
              <ArrowLeft className="h-3.5 w-3.5 mr-1.5" />
              Back
            </Button>
            <Button type="submit" disabled={!newName.trim() || createMutation.isPending}>
              {createMutation.isPending ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                  Creating...
                </>
              ) : (
                <>
                  Create
                  <ArrowRight className="h-3.5 w-3.5 ml-1.5" />
                </>
              )}
            </Button>
          </div>
        </form>
      </div>
    );
  }

  return (
    <div className="w-full max-w-2xl px-6">
      <div className="text-center mb-8">
        <h1 className="text-2xl font-semibold mb-2">Select a Workspace</h1>
        <p className="text-sm text-muted-foreground">
          Choose a workspace to continue.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
        {orgs.map((org) => (
          <Card
            key={org.id}
            className="cursor-pointer transition-colors hover:border-primary/50"
            onClick={() => activateMutation.mutate({ id: org.id })}
          >
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm">{org.name}</CardTitle>
                {activateMutation.isPending && activateMutation.variables?.id === org.id && (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                )}
              </div>
            </CardHeader>
            <CardContent className="pt-0">
              <p className="text-xs text-muted-foreground">
                Created {new Date(org.createdAt).toLocaleDateString()}
              </p>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="text-center">
        <Button variant="outline" size="sm" onClick={() => setShowCreate(true)}>
          <Plus className="h-3.5 w-3.5 mr-1.5" />
          New Workspace
        </Button>
      </div>
    </div>
  );
}
