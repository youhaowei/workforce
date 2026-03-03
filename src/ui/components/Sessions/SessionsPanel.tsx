/**
 * SessionsPanel - Left panel for session management.
 * Adjacent to the nav sidebar. Collapsible via floating stage pill.
 * Uses motion for smooth mount/unmount animation.
 */

import { useCallback, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'motion/react';
import { useTRPC } from '@/bridge/react';
import { useRequiredOrgId } from '@/ui/hooks/useRequiredOrgId';
import { useResizablePanel } from '@/ui/hooks/useResizablePanel';
import type { Project, SessionSummary } from '@/services/types';
import { SessionList } from './SessionList';

function PanelHeader() {
  return (
    <div className="flex items-center h-10 px-3">
      <h2 className="text-sm font-semibold text-neutral-fg select-none">Sessions</h2>
    </div>
  );
}

export interface SessionsPanelProps {
  collapsed: boolean;
  activeSessionId?: string;
  onSelectSession?: (sessionId: string) => void;
  onDeleteSession?: (sessionId: string) => void;
  onCreateSession?: () => void;
}

export function SessionsPanel({
  collapsed,
  activeSessionId,
  onSelectSession,
  onDeleteSession,
  onCreateSession,
}: SessionsPanelProps) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const orgId = useRequiredOrgId();
  const { width: panelWidth, isDragging, onResizeStart } = useResizablePanel({
    storageKey: 'workforce:sessions-panel-width',
    defaultWidth: 240,
    minWidth: 200,
    maxWidth: 480,
  });
  const listInput = { orgId };
  const listQueryKey = trpc.session.list.queryKey(listInput);

  const { data: sessions = [], isLoading } = useQuery(
    trpc.session.list.queryOptions(listInput),
  );

  const { data: projects = [] } = useQuery(
    trpc.project.list.queryOptions({ orgId }),
  );

  const projectMap = useMemo(
    () => new Map(projects.map((p: Project) => [p.id, p])),
    [projects],
  );

  const resumeMutation = useMutation(
    trpc.session.resume.mutationOptions(),
  );

  const deleteMutation = useMutation(
    trpc.session.delete.mutationOptions({
      onMutate: ({ sessionId }) => {
        const previous = queryClient.getQueriesData<SessionSummary[]>({ queryKey: listQueryKey });
        queryClient.setQueriesData<SessionSummary[]>(
          { queryKey: listQueryKey },
          (old) => old?.filter((s) => s.id !== sessionId) ?? old,
        );
        if (sessionId === activeSessionId) {
          onDeleteSession?.(sessionId);
        }
        return { previous };
      },
      onError: (_err, _vars, context) => {
        if (context?.previous) {
          for (const [key, data] of context.previous) {
            queryClient.setQueryData(key, data);
          }
        }
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
    <AnimatePresence initial={false}>
      {!collapsed && (
        <motion.div
          className="shrink-0 flex flex-col relative select-none overflow-hidden"
          initial={{ width: 0 }}
          animate={{ width: panelWidth }}
          exit={{ width: 0 }}
          transition={isDragging ? { duration: 0 } : { duration: 0.2, ease: [0.25, 0.1, 0.25, 1] }}
        >
          <PanelHeader />

          {isLoading ? (
            <div className="flex-1 flex items-center justify-center text-neutral-fg-subtle text-sm">
              Loading...
            </div>
          ) : (
            <SessionList
              sessions={sessions}
              activeSessionId={activeSessionId}
              typeFilter="all"
              stateFilter="all"
              groupBy="date"
              projectMap={projectMap}
              onSelect={handleSelect}
              onDelete={handleDelete}
              onCreate={onCreateSession}
            />
          )}

          <div
            onMouseDown={onResizeStart}
            className="absolute top-0 right-0 w-1 h-full cursor-col-resize hover:bg-palette-primary/20 active:bg-palette-primary/30 transition-colors z-10"
            aria-hidden="true"
          />
        </motion.div>
      )}
    </AnimatePresence>
  );
}
