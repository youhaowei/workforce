/**
 * AppSidebar — left sidebar content (projects + sessions).
 *
 * Structural wrapping (aside, Surface, collapse) is handled by the
 * Sidebar primitive in Layout.tsx. This component is content-only.
 */

import { useCallback, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "@tanstack/react-router";
import { Download, RefreshCw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/ui/lib/utils";
import { useTRPC } from "@/bridge/react";
import { useRequiredOrgId } from "@/ui/hooks/useRequiredOrgId";
import type { Project, SessionSummary } from "@/services/types";

import { SessionList } from "../Sessions/SessionList";
import { ImportCCDialog } from "../Sessions/ImportCCDialog";

export interface AppSidebarProps {
  selectedProjectId: string | null;
  selectedSessionId: string | null;
  onSelectProject: (projectId: string) => void;
  onSelectSession: (sessionId: string) => void;
  onDeleteSession?: (sessionId: string) => void;
  onCreateSession: () => void;
}

export default function AppSidebar({
  selectedProjectId,
  selectedSessionId,
  onSelectProject,
  onSelectSession,
  onDeleteSession,
  onCreateSession,
}: AppSidebarProps) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const orgId = useRequiredOrgId();
  const pathname = useLocation({ select: (l) => l.pathname });

  const activeSessionRef = useRef(selectedSessionId);
  activeSessionRef.current = selectedSessionId;

  const listInput = { orgId };
  const listQueryKey = trpc.session.list.queryKey(listInput);

  const { data: projects = [] } = useQuery(trpc.project.list.queryOptions(listInput));
  const { data: sessions = [] } = useQuery(trpc.session.list.queryOptions(listInput));

  const projectMap = useMemo(
    () => new Map((projects as Project[]).map((p) => [p.id, p])),
    [projects],
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

  const [importOpen, setImportOpen] = useState(false);

  const resumeMutation = useMutation(trpc.session.resume.mutationOptions());
  const resume = resumeMutation.mutate;
  const handleSelect = useCallback(
    (sessionId: string) => {
      activeSessionRef.current = sessionId;
      if (sessionId !== selectedSessionId) resume({ sessionId });
      onSelectSession(sessionId);
    },
    [resume, selectedSessionId, onSelectSession],
  );

  const deleteMutation = useMutation(
    trpc.session.delete.mutationOptions({
      onMutate: ({ sessionId }) => {
        const previous = queryClient.getQueriesData<SessionSummary[]>({
          queryKey: listQueryKey,
        });
        queryClient.setQueriesData<SessionSummary[]>(
          { queryKey: listQueryKey },
          (old) => old?.filter((s) => s.id !== sessionId) ?? old,
        );
        return { previous, wasActive: sessionId === selectedSessionId };
      },
      onSuccess: (_r, { sessionId }) => {
        if (sessionId === activeSessionRef.current) onDeleteSession?.(sessionId);
      },
      onError: (_err, _vars, ctx) => {
        if (ctx?.previous) {
          for (const [key, data] of ctx.previous) queryClient.setQueryData(key, data);
        }
      },
      onSettled: () => {
        void queryClient.invalidateQueries({ queryKey: listQueryKey });
      },
    }),
  );
  const deleteFn = deleteMutation.mutate;
  const handleDelete = useCallback((sessionId: string) => deleteFn({ sessionId }), [deleteFn]);

  return (
    <>
        <div className="shrink-0">
          <div className="flex items-center px-3 py-2">
            <span className="flex-1 text-[11px] font-medium text-neutral-fg-subtle tracking-wider">
              Projects
            </span>
          </div>
          {projects.length === 0 ? (
            <div className="px-3 pb-2 text-xs text-neutral-fg-subtle/70">No projects yet</div>
          ) : (
            <div className="flex flex-col gap-px px-2 pb-2">
              {(projects as Project[]).map((p) => {
                const active = pathname === "/projects" && p.id === selectedProjectId;
                return (
                  <Button
                    key={p.id}
                    variant="ghost"
                    onClick={() => onSelectProject(p.id)}
                    className={cn(
                      "justify-start gap-2 h-8 px-2 text-sm",
                      active
                        ? "bg-neutral-fg/[0.06] text-neutral-fg font-medium"
                        : "text-neutral-fg/70 hover:bg-neutral-fg/[0.04] hover:text-neutral-fg",
                    )}
                  >
                    <span
                      className="shrink-0 w-1.5 h-1.5 rounded-full bg-neutral-fg-subtle/60"
                      style={p.color ? { backgroundColor: p.color } : undefined}
                      aria-hidden="true"
                    />
                    <span className="flex-1 truncate">{p.name}</span>
                  </Button>
                );
              })}
            </div>
          )}
        </div>

        <div className="shrink-0 flex items-center px-3 py-2">
          <span className="flex-1 text-[11px] font-medium text-neutral-fg-subtle tracking-wider">
            Sessions
          </span>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6 text-neutral-fg/50 hover:text-neutral-fg/80"
                onClick={() => setImportOpen(true)}
                aria-label="Import from Claude Code"
              >
                <Download className="h-3.5 w-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Import from Claude Code</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6 text-neutral-fg/50 hover:text-neutral-fg/80"
                onClick={handleRefresh}
                aria-label="Refresh sessions"
              >
                <RefreshCw className={cn("h-3.5 w-3.5", isRefreshing && "animate-spin")} />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Refresh sessions</TooltipContent>
          </Tooltip>
        </div>

        <div className="flex-1 min-h-0 flex flex-col">
          <SessionList
            sessions={sessions as SessionSummary[]}
            activeSessionId={selectedSessionId ?? undefined}
            groupBy="project"
            projectMap={projectMap}
            onSelect={handleSelect}
            onDelete={handleDelete}
            onCreate={onCreateSession}
          />
        </div>
      <ImportCCDialog
        open={importOpen}
        onOpenChange={setImportOpen}
        orgId={orgId}
        onImported={handleSelect}
      />
    </>
  );
}
