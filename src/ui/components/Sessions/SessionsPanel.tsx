/**
 * SessionsPanel - Side panel for managing chat sessions.
 * Uses tRPC queries/mutations with type and state filtering.
 */

import { useState, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTRPC } from '@bridge/react';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { X } from 'lucide-react';
import { SessionList } from './SessionList';

export interface SessionsPanelProps {
  isOpen: boolean;
  onClose?: () => void;
}

export function SessionsPanel({ isOpen, onClose }: SessionsPanelProps) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const [activeSessionId, setActiveSessionId] = useState<string | undefined>(undefined);
  const [typeFilter, setTypeFilter] = useState('all');
  const [stateFilter, setStateFilter] = useState('all');

  const { data: sessions = [], isLoading } = useQuery(
    trpc.session.list.queryOptions(undefined, { refetchInterval: 5000 }),
  );

  const resumeMutation = useMutation(
    trpc.session.resume.mutationOptions({
      onSuccess: () => queryClient.invalidateQueries({ queryKey: ['session'] }),
    }),
  );

  const deleteMutation = useMutation(
    trpc.session.delete.mutationOptions({
      onSuccess: () => queryClient.invalidateQueries({ queryKey: ['session'] }),
    }),
  );

  const forkMutation = useMutation(
    trpc.session.fork.mutationOptions({
      onSuccess: () => queryClient.invalidateQueries({ queryKey: ['session'] }),
    }),
  );

  const createMutation = useMutation(
    trpc.session.create.mutationOptions({
      onSuccess: (data) => {
        if (data && typeof data === 'object' && 'id' in data) {
          setActiveSessionId(data.id as string);
        }
        queryClient.invalidateQueries({ queryKey: ['session'] });
      },
    }),
  );

  const handleSelect = useCallback((sessionId: string) => {
    resumeMutation.mutate({ sessionId });
    setActiveSessionId(sessionId);
  }, [resumeMutation]);

  const handleDelete = useCallback((sessionId: string) => {
    deleteMutation.mutate({ sessionId });
  }, [deleteMutation]);

  const handleFork = useCallback((sessionId: string) => {
    forkMutation.mutate({ sessionId });
  }, [forkMutation]);

  const handleCreate = useCallback(() => {
    createMutation.mutate(undefined);
  }, [createMutation]);

  if (!isOpen) return null;

  return (
    <div className="w-80 border-l flex flex-col bg-background">
      {/* Header */}
      <div className="flex items-center justify-between p-3 border-b">
        <h2 className="font-semibold text-sm">Sessions</h2>
        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onClose}>
          <X className="h-4 w-4" />
        </Button>
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
