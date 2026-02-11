/**
 * BoardView - Kanban-style supervision board showing agents grouped by lifecycle state.
 * Uses tRPC queries with BoardFilters for filtering.
 */

import { useMemo, useState, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTRPC } from '@bridge/react';
import { useWorkspaceStore } from '@ui/stores/useWorkspaceStore';
import { BoardColumn } from './BoardColumn';
import { BoardFilters } from './BoardFilters';
import type { Session, SessionLifecycle } from '@services/types';

export interface BoardViewProps {
  onSelectAgent?: (sessionId: string) => void;
}

const LIFECYCLE_COLUMNS = ['active', 'paused', 'completed', 'failed', 'cancelled'] as const;

export function BoardView({ onSelectAgent }: BoardViewProps) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const workspaceId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const [keyword, setKeyword] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');

  const { data: sessions = [] } = useQuery(
    trpc.session.list.queryOptions(undefined, {
      refetchInterval: 5000,
    }),
  );

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

  const handleCardAction = useCallback(
    (sessionId: string, action: 'pause' | 'resume' | 'cancel') => {
      if (action === 'cancel') {
        cancelMutation.mutate({ sessionId, reason: 'User cancelled from board' });
      } else if (action === 'pause') {
        pauseMutation.mutate({ sessionId, reason: 'User paused from board' });
      } else if (action === 'resume') {
        resumeMutation.mutate({ sessionId });
      }
    },
    [cancelMutation, pauseMutation, resumeMutation],
  );

  // Filter to WorkAgent sessions for this workspace
  const workAgents = useMemo(() => {
    let agents = sessions.filter(
      (s: Session) => s.metadata?.workspaceId === workspaceId && s.metadata?.type === 'workagent',
    );
    if (keyword) {
      const kw = keyword.toLowerCase();
      agents = agents.filter(
        (s: Session) =>
          (s.metadata?.goal as string)?.toLowerCase().includes(kw) ||
          s.id.toLowerCase().includes(kw),
      );
    }
    return agents;
  }, [sessions, workspaceId, keyword]);

  const sessionsByState = useMemo(() => {
    const map = new Map<string, Session[]>();
    for (const col of LIFECYCLE_COLUMNS) map.set(col, []);
    for (const s of workAgents) {
      const lifecycle = s.metadata?.lifecycle as SessionLifecycle | undefined;
      const state = lifecycle?.state ?? 'created';
      map.get(state)?.push(s);
    }
    return map;
  }, [workAgents]);

  const visibleColumns = statusFilter === 'all'
    ? LIFECYCLE_COLUMNS
    : LIFECYCLE_COLUMNS.filter((c) => c === statusFilter);

  return (
    <div className="flex-1 flex flex-col overflow-hidden p-6">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">Supervision Board</h2>
          <p className="text-xs text-muted-foreground">Monitor and manage your agents</p>
        </div>
        <BoardFilters
          keyword={keyword}
          onKeywordChange={setKeyword}
          statusFilter={statusFilter}
          onStatusFilterChange={setStatusFilter}
        />
      </div>
      <div className="flex-1 flex gap-4 overflow-x-auto">
        {visibleColumns.map((state) => (
          <BoardColumn
            key={state}
            title={state.charAt(0).toUpperCase() + state.slice(1)}
            sessions={sessionsByState.get(state) ?? []}
            state={state}
            onCardClick={onSelectAgent}
            onCardAction={handleCardAction}
          />
        ))}
      </div>
    </div>
  );
}
