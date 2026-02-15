/**
 * SessionsPanel - Persistent left panel for session management.
 * Always visible adjacent to the nav sidebar. Collapsible to save space.
 * Uses tRPC queries/mutations with type and state filtering.
 */

import { useState, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ChevronsLeft } from 'lucide-react';
import { useTRPC } from '@/bridge/react';
import { useOrgStore } from '@/ui/stores/useOrgStore';
import type { Session, SessionSummary } from '@/services/types';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { SessionList } from './SessionList';

function toSessionSummary(session: Session): SessionSummary {
  const lastMessage = session.messages[session.messages.length - 1];
  return {
    id: session.id,
    title: session.title,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    parentId: session.parentId,
    metadata: session.metadata,
    messageCount: session.messages.length,
    lastMessagePreview: lastMessage?.content,
  };
}

export interface SessionsPanelProps {
  collapsed: boolean;
  activeSessionId?: string;
  onSelectSession?: (sessionId: string) => void;
  onDeleteSession?: (sessionId: string) => void;
  onCreateSession?: () => void;
  onCollapse?: () => void;
}

export function SessionsPanel({
  collapsed,
  activeSessionId,
  onSelectSession,
  onDeleteSession,
  onCreateSession,
  onCollapse,
}: SessionsPanelProps) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const orgId = useOrgStore((s) => s.currentOrgId);
  const [typeFilter, setTypeFilter] = useState('all');
  const [stateFilter, setStateFilter] = useState('all');
  const listInput = orgId ? { orgId } : undefined;
  const listQueryKey = trpc.session.list.queryKey(listInput);

  const { data: sessions = [], isLoading } = useQuery(
    trpc.session.list.queryOptions(listInput, { refetchInterval: 5000 }),
  );

  const resumeMutation = useMutation(
    trpc.session.resume.mutationOptions(),
  );

  const deleteMutation = useMutation(
    trpc.session.delete.mutationOptions({
      onMutate: ({ sessionId }) => {
        queryClient.setQueriesData<SessionSummary[]>(
          { queryKey: listQueryKey },
          (old) => old?.filter((s) => s.id !== sessionId) ?? old,
        );
        // If deleting the active session, notify Shell to clear the chat area
        if (sessionId === activeSessionId) {
          onDeleteSession?.(sessionId);
        }
      },
      onError: () => {
        void queryClient.invalidateQueries({ queryKey: listQueryKey });
      },
    }),
  );

  const forkMutation = useMutation(
    trpc.session.fork.mutationOptions({
      onSuccess: (forkedSession) => {
        const summary = toSessionSummary(forkedSession);
        queryClient.setQueriesData<SessionSummary[]>(
          { queryKey: listQueryKey },
          (old) => old ? [summary, ...old.filter((s) => s.id !== summary.id)] : [summary],
        );
      },
      onError: () => {
        void queryClient.invalidateQueries({ queryKey: listQueryKey });
      },
    }),
  );

  const handleSelect = useCallback((sessionId: string) => {
    if (sessionId !== activeSessionId) {
      resumeMutation.mutate({ sessionId });
    }
    onSelectSession?.(sessionId);
  }, [activeSessionId, resumeMutation, onSelectSession]);

  const handleDelete = useCallback((sessionId: string) => {
    deleteMutation.mutate({ sessionId });
  }, [deleteMutation]);

  const handleFork = useCallback((sessionId: string) => {
    forkMutation.mutate({ sessionId });
  }, [forkMutation]);

  const handleCreate = useCallback(() => {
    onCreateSession?.();
  }, [onCreateSession]);

  return (
    <div
      className={`flex-shrink-0 flex flex-col bg-background border-r transition-[width] duration-200 ease-in-out overflow-hidden ${
        collapsed ? 'w-0 border-r-0' : 'w-72'
      }`}
      aria-hidden={collapsed}
      inert={collapsed ? true : undefined}
    >
      {/* Header */}
      <div className="flex items-center justify-between p-3 border-b">
        <h2 className="font-semibold text-sm">Sessions</h2>
        {onCollapse && (
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6 text-muted-foreground hover:text-foreground"
            onClick={onCollapse}
            aria-label="Hide sessions"
          >
            <ChevronsLeft className="h-3.5 w-3.5" />
          </Button>
        )}
      </div>

      {/* Filters */}
      <div className="p-3 border-b flex gap-2">
        <Select value={typeFilter} onValueChange={setTypeFilter}>
          <SelectTrigger className="h-7 text-xs flex-1">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All types</SelectItem>
            <SelectItem value="chat">Chat</SelectItem>
            <SelectItem value="workagent">Agent</SelectItem>
          </SelectContent>
        </Select>
        <Select value={stateFilter} onValueChange={setStateFilter}>
          <SelectTrigger className="h-7 text-xs flex-1">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All states</SelectItem>
            <SelectItem value="active">Active</SelectItem>
            <SelectItem value="paused">Paused</SelectItem>
            <SelectItem value="completed">Completed</SelectItem>
            <SelectItem value="failed">Failed</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Content */}
      {isLoading ? (
        <div className="flex-1 flex items-center justify-center text-muted-foreground text-sm">
          Loading...
        </div>
      ) : (
        <SessionList
          sessions={sessions}
          activeSessionId={activeSessionId}
          typeFilter={typeFilter}
          stateFilter={stateFilter}
          onSelect={handleSelect}
          onDelete={handleDelete}
          onFork={handleFork}
          onCreate={handleCreate}
        />
      )}
    </div>
  );
}
