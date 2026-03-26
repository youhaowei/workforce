/**
 * SessionsPanel - Left panel for session management.
 * Adjacent to the nav sidebar. Collapsible via floating stage pill.
 * Uses motion for smooth mount/unmount animation.
 *
 * Shows only Workforce sessions (including imported CC sessions).
 * External CC sessions are imported via the ImportCCDialog.
 */

import { useCallback, useMemo, useRef, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'motion/react';
import { Download, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useTRPC } from '@/bridge/react';
import { useRequiredOrgId } from '@/ui/hooks/useRequiredOrgId';
import { useResizablePanel } from '@/ui/hooks/useResizablePanel';
import type { Project, SessionSummary } from '@/services/types';
import { SessionList } from './SessionList';
import { ImportCCDialog } from './ImportCCDialog';

function PanelHeader({
  onRefresh,
  isRefreshing,
  onImport,
}: {
  onRefresh: () => void;
  isRefreshing: boolean;
  onImport: () => void;
}) {
  return (
    <div className="flex items-center h-10 px-4 pt-2">
      <h2 className="text-sm font-semibold text-neutral-fg select-none">Sessions</h2>
      <span className="flex-1" />
      <Button
        variant="ghost"
        size="icon"
        className="h-6 w-6 text-neutral-fg-subtle hover:text-neutral-fg"
        onClick={onImport}
        title="Import from Claude Code"
        aria-label="Import from Claude Code"
      >
        <Download className="h-3 w-3" />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        className="h-6 w-6 text-neutral-fg-subtle hover:text-neutral-fg"
        onClick={onRefresh}
        title="Refresh sessions"
        aria-label="Refresh sessions"
      >
        <RefreshCw className={`h-3 w-3 ${isRefreshing ? 'animate-spin' : ''}`} />
      </Button>
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
  const [importDialogOpen, setImportDialogOpen] = useState(false);
  const activeSessionRef = useRef(activeSessionId);
  activeSessionRef.current = activeSessionId;

  const { width: panelWidth, isDragging, onResizeStart } = useResizablePanel({
    storageKey: 'workforce:sessions-panel-width',
    defaultWidth: 240,
    minWidth: 200,
    maxWidth: 480,
  });
  const listInput = { orgId };
  const listQueryKey = trpc.session.list.queryKey(listInput);

  const { data: wfSessions = [], isLoading: wfLoading } = useQuery(
    trpc.session.list.queryOptions(listInput),
  );

  const [isRefreshing, setIsRefreshing] = useState(false);
  const handleRefresh = useCallback(async () => {
    setIsRefreshing(true);
    try {
      await queryClient.refetchQueries({ queryKey: listQueryKey });
    } finally {
      setIsRefreshing(false);
    }
  }, [queryClient, listQueryKey]);

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
        return { previous, wasActiveSession: sessionId === activeSessionId };
      },
      onSuccess: (_result, { sessionId }) => {
        // Check live ref — user may have navigated away during the mutation.
        if (sessionId === activeSessionRef.current) {
          onDeleteSession?.(sessionId);
        }
      },
      onError: (_err, _vars, context) => {
        if (context?.previous) {
          for (const [key, data] of context.previous) {
            queryClient.setQueryData(key, data);
          }
        }
      },
      onSettled: () => {
        void queryClient.invalidateQueries({ queryKey: listQueryKey });
      },
    }),
  );

  const resume = resumeMutation.mutate;
  const handleSelect = useCallback((sessionId: string) => {
    if (sessionId !== activeSessionId) {
      resume({ sessionId });
    }
    onSelectSession?.(sessionId);
  }, [activeSessionId, resume, onSelectSession]);

  const deleteFn = deleteMutation.mutate;
  const handleDelete = useCallback((sessionId: string) => {
    deleteFn({ sessionId });
  }, [deleteFn]);

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
          <PanelHeader
            onRefresh={handleRefresh}
            isRefreshing={isRefreshing}
            onImport={() => setImportDialogOpen(true)}
          />

          {wfLoading ? (
            <div className="flex-1 flex items-center justify-center text-neutral-fg-subtle text-sm">
              Loading...
            </div>
          ) : (
            <SessionList
              sessions={wfSessions}
              activeSessionId={activeSessionId}
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

          <ImportCCDialog
            open={importDialogOpen}
            onOpenChange={setImportDialogOpen}
            orgId={orgId}
            onImported={handleSelect}
          />
        </motion.div>
      )}
    </AnimatePresence>
  );
}
