/**
 * SessionsPanel - Left panel for session management.
 * Adjacent to the nav sidebar. Collapsible via X button in header.
 */

import { useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { X } from 'lucide-react';
import { useTRPC } from '@/bridge/react';
import { useRequiredOrgId } from '@/ui/hooks/useRequiredOrgId';
import { useResizablePanel } from '@/ui/hooks/useResizablePanel';
import type { SessionSummary } from '@/services/types';
import { Button } from '@/components/ui/button';
import { SessionList } from './SessionList';

/** Header bar with title and close button. */
function PanelHeader({ onCollapse }: { onCollapse?: () => void }) {
  return (
    <div className="flex items-center h-10 px-3 gap-1">
      <h2 className="text-sm font-semibold text-foreground flex-1 select-none">Sessions</h2>
      {onCollapse && (
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6 shrink-0 text-muted-foreground hover:text-foreground"
          onClick={onCollapse}
          aria-label="Hide sessions panel"
        >
          <X className="h-3.5 w-3.5" />
        </Button>
      )}
    </div>
  );
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
  const orgId = useRequiredOrgId();
  const { width: panelWidth, isDragging, onResizeStart } = useResizablePanel({
    storageKey: 'workforce:sessions-panel-width',
    defaultWidth: 180,
    minWidth: 160,
    maxWidth: 480,
  });
  const listInput = { orgId };
  const listQueryKey = trpc.session.list.queryKey(listInput);

  const { data: sessions = [], isLoading } = useQuery(
    trpc.session.list.queryOptions(listInput),
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

  const handleSelect = useCallback((sessionId: string) => {
    if (sessionId !== activeSessionId) {
      resumeMutation.mutate({ sessionId });
    }
    onSelectSession?.(sessionId);
  }, [activeSessionId, resumeMutation, onSelectSession]);

  const handleDelete = useCallback((sessionId: string) => {
    deleteMutation.mutate({ sessionId });
  }, [deleteMutation]);

  return (
    <div
      data-collapsed={collapsed}
      className={`shrink-0 flex flex-col relative select-none ${
        isDragging ? '' : 'transition-[width] duration-200 ease-in-out'
      } ${collapsed ? 'w-0' : ''}`}
      style={collapsed ? undefined : { width: panelWidth }}
      aria-hidden={collapsed}
      inert={collapsed ? true : undefined}
    >
      <PanelHeader onCollapse={onCollapse} />

      {/* Content */}
      {isLoading ? (
        <div className="flex-1 flex items-center justify-center text-muted-foreground text-sm">
          Loading...
        </div>
      ) : (
        <SessionList
          sessions={sessions}
          activeSessionId={activeSessionId}
          typeFilter="all"
          stateFilter="all"
          groupBy="date"
          projectMap={new Map()}
          onSelect={handleSelect}
          onDelete={handleDelete}
          onCreate={onCreateSession}
        />
      )}

      {/* Resize handle — right edge */}
      {!collapsed && (
        <div
          onMouseDown={onResizeStart}
          className="absolute top-0 right-0 w-1 h-full cursor-col-resize hover:bg-primary/20 active:bg-primary/30 transition-colors z-10"
          aria-hidden="true"
        />
      )}
    </div>
  );
}
