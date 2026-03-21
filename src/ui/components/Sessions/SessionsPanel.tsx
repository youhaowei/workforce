/**
 * SessionsPanel - Left panel for session management.
 * Adjacent to the nav sidebar. Collapsible via floating stage pill.
 * Uses motion for smooth mount/unmount animation.
 *
 * Merges WF native sessions with discovered CC sessions into a unified list.
 * CC sessions are imported on-demand when selected.
 */

import { useCallback, useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'motion/react';
import { RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useTRPC } from '@/bridge/react';
import { useRequiredOrgId } from '@/ui/hooks/useRequiredOrgId';
import { useResizablePanel } from '@/ui/hooks/useResizablePanel';
import type { Project, SessionSummary } from '@/services/types';
import type { CCSessionSummary } from '@/services/cc-discovery';
import { SessionList } from './SessionList';

function PanelHeader({ onRefresh, isRefreshing }: { onRefresh: () => void; isRefreshing: boolean }) {
  return (
    <div className="flex items-center h-10 px-4 pt-2">
      <h2 className="text-sm font-semibold text-neutral-fg select-none">Sessions</h2>
      <span className="flex-1" />
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

/** Convert a CC session summary to SessionSummary shape for unified list rendering. */
function ccToSessionSummary(cc: CCSessionSummary): SessionSummary {
  return {
    id: `cc:${cc.sessionId}`,
    title: cc.title,
    createdAt: cc.lastModified,
    updatedAt: cc.lastModified,
    metadata: {
      source: 'claude-code',
      ccSessionId: cc.sessionId,
      ccFullPath: cc.fullPath,
      gitBranch: cc.gitBranch,
      cwd: cc.cwd,
      imported: false,
    },
    messageCount: 0,
    lastMessagePreview: cc.firstPrompt,
  };
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
  const [importingId, setImportingId] = useState<string | null>(null);
  const [hiddenCCIds, setHiddenCCIds] = useState<Set<string>>(() => {
    try {
      const stored = localStorage.getItem('workforce:hidden-cc-sessions');
      return stored ? new Set(JSON.parse(stored)) : new Set();
    } catch { return new Set(); }
  });

  const handleHide = useCallback((sessionId: string) => {
    const ccId = sessionId.startsWith('cc:') ? sessionId.slice(3) : sessionId;
    setHiddenCCIds((prev) => {
      const next = new Set(prev).add(ccId);
      localStorage.setItem('workforce:hidden-cc-sessions', JSON.stringify([...next]));
      return next;
    });
  }, []);
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

  const { data: ccSessions = [] } = useQuery({
    ...trpc.session.discoverCC.queryOptions({}),
    staleTime: 60_000, // CC discovery is expensive-ish, cache for 1 min
  });

  const [isRefreshing, setIsRefreshing] = useState(false);
  const handleRefresh = useCallback(async () => {
    setIsRefreshing(true);
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: listQueryKey }),
      queryClient.invalidateQueries({ queryKey: trpc.session.discoverCC.queryKey() }),
      queryClient.invalidateQueries({ queryKey: trpc.session.checkCCSyncBatch.queryKey() }),
    ]);
    setIsRefreshing(false);
  }, [queryClient, listQueryKey, trpc]);

  const { data: projects = [] } = useQuery(
    trpc.project.list.queryOptions({ orgId }),
  );

  const projectMap = useMemo(
    () => new Map(projects.map((p: Project) => [p.id, p])),
    [projects],
  );

  // Build set of already-imported CC session IDs + their WF session IDs
  const importedCCIds = useMemo(
    () => new Set(
      wfSessions
        .filter((s) => s.metadata?.ccSessionId)
        .map((s) => s.metadata!.ccSessionId as string),
    ),
    [wfSessions],
  );

  const importedSessionIds = useMemo(
    () => wfSessions.filter((s) => s.metadata?.ccSourcePath).map((s) => s.id),
    [wfSessions],
  );

  // Batch check sync status for imported CC sessions
  const { data: syncStatus = {} } = useQuery({
    ...trpc.session.checkCCSyncBatch.queryOptions({ sessionIds: importedSessionIds }),
    enabled: importedSessionIds.length > 0,
    staleTime: 10_000,
  });

  // Merge: WF sessions + CC sessions (excluding already-imported ones)
  const mergedSessions = useMemo(() => {
    const unimportedCC = ccSessions
      .filter((cc) => !importedCCIds.has(cc.sessionId) && !hiddenCCIds.has(cc.sessionId))
      .map(ccToSessionSummary);
    return [...wfSessions, ...unimportedCC];
  }, [wfSessions, ccSessions, importedCCIds, hiddenCCIds]);

  const importMutation = useMutation(
    trpc.session.importCC.mutationOptions({
      onSettled: async () => {
        await queryClient.invalidateQueries({ queryKey: listQueryKey });
        setImportingId(null);
      },
    }),
  );

  const syncMutation = useMutation(
    trpc.session.syncCC.mutationOptions({
      onSettled: () => {
        void queryClient.invalidateQueries({ queryKey: listQueryKey });
        void queryClient.invalidateQueries({ queryKey: trpc.session.checkCCSyncBatch.queryKey() });
        // Also invalidate individual checkCCSync so the chat banner (useCCSyncBanner) updates
        void queryClient.invalidateQueries({ queryKey: trpc.session.checkCCSync.queryKey() });
      },
    }),
  );

  const handleSync = useCallback((sessionId: string) => {
    syncMutation.mutate({ sessionId });
  }, [syncMutation]);

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
      onSuccess: (_result, { sessionId }, context) => {
        if (context?.wasActiveSession) {
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

  const handleSelect = useCallback((sessionId: string) => {
    // CC session: auto-import on click, then select the imported session
    if (sessionId.startsWith('cc:')) {
      const ccId = sessionId.slice(3);
      const ccSession = ccSessions.find((cc) => cc.sessionId === ccId);
      if (ccSession && !importingId && !importMutation.isPending) {
        setImportingId(ccId);
        importMutation.mutate(
          { ccFilePath: ccSession.fullPath, orgId },
          {
            onSuccess: (imported) => {
              void queryClient.invalidateQueries({ queryKey: listQueryKey }).then(() => {
                resumeMutation.mutate({ sessionId: imported.id });
                onSelectSession?.(imported.id);
              });
            },
            onError: (err) => {
              console.error('Failed to import CC session:', err);
              setImportingId(null);
            },
          },
        );
      }
      return;
    }

    // Auto-sync if the session is out of date
    if (syncStatus[sessionId] === false) {
      syncMutation.mutate({ sessionId });
    }

    if (sessionId !== activeSessionId) {
      resumeMutation.mutate({ sessionId });
    }
    onSelectSession?.(sessionId);
  }, [activeSessionId, ccSessions, importingId, importMutation, resumeMutation, syncMutation, syncStatus, onSelectSession, queryClient, listQueryKey, orgId]);

  const handleDelete = useCallback((sessionId: string) => {
    // Can't delete CC sessions that haven't been imported
    if (sessionId.startsWith('cc:')) return;
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
          <PanelHeader onRefresh={handleRefresh} isRefreshing={isRefreshing} />

          {wfLoading ? (
            <div className="flex-1 flex items-center justify-center text-neutral-fg-subtle text-sm">
              Loading...
            </div>
          ) : (
            <SessionList
              sessions={mergedSessions}
              activeSessionId={activeSessionId}
              typeFilter="all"
              stateFilter="all"
              groupBy="date"
              projectMap={projectMap}
              syncStatus={syncStatus}
              importingId={importingId ? `cc:${importingId}` : null}
              onSelect={handleSelect}
              onDelete={handleDelete}
              onHide={handleHide}
              onCreate={onCreateSession}
              onSync={handleSync}
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
