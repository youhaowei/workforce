/**
 * AgentDetailView - Tabbed detail view for inspecting a single agent session.
 *
 * Tabs: Overview | Messages | Actions | Audit
 * Delegates to sub-tab components for content. Handles agent lifecycle mutations.
 *
 * Accepts `sessionId` and fetches session via tRPC query — this makes the
 * component reactive to cache invalidations from mutations (cancel/pause/resume).
 */

import { useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTRPC } from '@bridge/react';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ArrowLeft, Pause, Play, XCircle, Plus } from 'lucide-react';
import { stateVariant } from '@ui/lib/stateVariant';
import { AgentOverview } from './AgentOverview';
import { AgentMessages } from './AgentMessages';
import { AgentActions } from './AgentActions';
import { AgentAudit } from './AgentAudit';
import type { SessionLifecycle } from '@services/types';

export interface AgentDetailViewProps {
  sessionId: string;
  onBack?: () => void;
  onNavigateToChild?: (childSessionId: string) => void;
}

export function AgentDetailView({ sessionId, onBack, onNavigateToChild }: AgentDetailViewProps) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();

  const { data: session } = useQuery(
    trpc.session.get.queryOptions({ sessionId }),
  );

  const lifecycle = session?.metadata?.lifecycle as SessionLifecycle | undefined;
  const state = lifecycle?.state ?? 'created';
  const goal = (session?.metadata?.goal as string) ?? 'No goal set';
  const templateId = session?.metadata?.templateId as string | undefined;
  const workspaceId = session?.metadata?.workspaceId as string | undefined;

  const cancelMutation = useMutation(
    trpc.orchestration.cancelAgent.mutationOptions({
      onSuccess: () => queryClient.invalidateQueries({ queryKey: ['session'] }),
    }),
  );

  const pauseMutation = useMutation(
    trpc.orchestration.pauseAgent.mutationOptions({
      onSuccess: () => queryClient.invalidateQueries({ queryKey: ['session'] }),
    }),
  );

  const resumeMutation = useMutation(
    trpc.orchestration.resumeAgent.mutationOptions({
      onSuccess: () => queryClient.invalidateQueries({ queryKey: ['session'] }),
    }),
  );

  const spawnMutation = useMutation(
    trpc.orchestration.spawn.mutationOptions({
      onSuccess: () => queryClient.invalidateQueries({ queryKey: ['session'] }),
    }),
  );

  const handleAction = useCallback((action: string) => {
    if (action === 'cancel') {
      cancelMutation.mutate({ sessionId, reason: 'User cancelled' });
    } else if (action === 'pause') {
      pauseMutation.mutate({ sessionId, reason: 'User paused' });
    } else if (action === 'resume') {
      resumeMutation.mutate({ sessionId });
    }
  }, [sessionId, cancelMutation, pauseMutation, resumeMutation]);

  const handleSpawnChild = useCallback(() => {
    if (!workspaceId || !templateId) return;
    spawnMutation.mutate({
      workspaceId,
      templateId,
      goal: 'Sub-task',
      parentSessionId: sessionId,
    });
  }, [workspaceId, templateId, sessionId, spawnMutation]);

  if (!session) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <p className="text-sm text-muted-foreground">Loading session...</p>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden p-6">
      {/* Header */}
      <div className="mb-4">
        <div className="flex items-center gap-3 mb-2">
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onBack}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <h2 className="text-lg font-semibold flex-1 truncate">{goal}</h2>
          <Badge variant={stateVariant(state)} className="text-[10px] uppercase">
            {state}
          </Badge>
        </div>
        <div className="flex items-center gap-3 text-xs text-muted-foreground ml-10">
          <code className="bg-muted px-1.5 py-0.5 rounded text-[10px]">{session.id}</code>
          {templateId && <span>Template: {templateId}</span>}
        </div>
      </div>

      {/* Action buttons */}
      {(state === 'active' || state === 'paused') && (
        <div className="flex gap-2 mb-4 ml-10">
          {state === 'active' && (
            <>
              <Button variant="outline" size="sm" onClick={() => handleAction('pause')}>
                <Pause className="h-3 w-3 mr-1.5" />
                Pause
              </Button>
              <Button variant="destructive" size="sm" onClick={() => handleAction('cancel')}>
                <XCircle className="h-3 w-3 mr-1.5" />
                Cancel
              </Button>
            </>
          )}
          {state === 'paused' && (
            <>
              <Button variant="default" size="sm" onClick={() => handleAction('resume')}>
                <Play className="h-3 w-3 mr-1.5" />
                Resume
              </Button>
              <Button variant="destructive" size="sm" onClick={() => handleAction('cancel')}>
                <XCircle className="h-3 w-3 mr-1.5" />
                Cancel
              </Button>
            </>
          )}
          {workspaceId && templateId && (
            <Button
              variant="outline"
              size="sm"
              onClick={handleSpawnChild}
              disabled={spawnMutation.isPending}
            >
              <Plus className="h-3 w-3 mr-1.5" />
              Spawn Child
            </Button>
          )}
        </div>
      )}

      {/* Tabs */}
      <Tabs defaultValue="overview" className="flex-1 flex flex-col overflow-hidden">
        <TabsList className="w-fit">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="messages">Messages</TabsTrigger>
          <TabsTrigger value="actions">Actions</TabsTrigger>
          <TabsTrigger value="audit">Audit</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="flex-1 overflow-hidden mt-4">
          <AgentOverview session={session} onChildClick={onNavigateToChild} />
        </TabsContent>

        <TabsContent value="messages" className="flex-1 overflow-hidden mt-4">
          <AgentMessages session={session} />
        </TabsContent>

        <TabsContent value="actions" className="flex-1 overflow-hidden mt-4">
          {workspaceId ? (
            <AgentActions sessionId={session.id} workspaceId={workspaceId} />
          ) : (
            <p className="text-sm text-muted-foreground text-center py-8">No workspace context</p>
          )}
        </TabsContent>

        <TabsContent value="audit" className="flex-1 overflow-hidden mt-4">
          {workspaceId ? (
            <AgentAudit sessionId={session.id} workspaceId={workspaceId} />
          ) : (
            <p className="text-sm text-muted-foreground text-center py-8">No workspace context</p>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
