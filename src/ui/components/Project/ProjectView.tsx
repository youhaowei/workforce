/**
 * ProjectView - Main content area when "Projects" view is active.
 * Shows project details and recent sessions scoped to the active project.
 */

import { useEffect, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { FolderOpen, MessageSquare } from "lucide-react";
import { useTRPC } from "@/bridge/react";
import { useRequiredOrgId } from "@/ui/hooks/useRequiredOrgId";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { Project, SessionSummary } from "@/services/types";

function formatDate(ts: number) {
  return new Date(ts).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

interface ProjectViewProps {
  selectedProjectId?: string | null;
  onSelectProject?: (projectId: string | null) => void;
  onStartChat?: () => void;
  onSelectSession?: (sessionId: string) => void;
}

export function ProjectView({
  selectedProjectId,
  onSelectProject,
  onStartChat,
  onSelectSession,
}: ProjectViewProps) {
  const trpc = useTRPC();
  const orgId = useRequiredOrgId();

  const listInput = { orgId };
  const { data: projects = [], isFetched: isProjectsFetched } = useQuery(
    trpc.project.list.queryOptions(listInput),
  );
  const project = useMemo(
    () =>
      selectedProjectId
        ? ((projects as Project[]).find((p) => p.id === selectedProjectId) ?? null)
        : null,
    [selectedProjectId, projects],
  );

  useEffect(() => {
    if (!selectedProjectId || !isProjectsFetched) return;
    if (!project) onSelectProject?.(null);
  }, [isProjectsFetched, onSelectProject, project, selectedProjectId]);

  const sessionsInput = project ? { orgId, projectId: project.id } : undefined;
  const { data: sessions = [] } = useQuery(
    trpc.session.list.queryOptions(sessionsInput, { enabled: !!sessionsInput }),
  );

  if (!selectedProjectId || !project) {
    return (
      <div className="flex-1 flex items-center justify-center pt-14">
        <div className="text-center space-y-3">
          <FolderOpen className="h-10 w-10 mx-auto text-neutral-fg-subtle/50" />
          <p className="text-sm text-neutral-fg-subtle">Select a project from the sidebar</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden pt-14 px-6 pb-6">
      {/* Project header */}
      <div className="mb-6">
        <div className="flex items-center gap-3 mb-2">
          <div
            className="flex-shrink-0 w-10 h-10 rounded-lg flex items-center justify-center text-white text-lg font-bold"
            style={{ backgroundColor: project.color }}
          >
            {project.name.charAt(0).toUpperCase()}
          </div>
          <div>
            <h2 className="text-lg font-semibold">{project.name}</h2>
            <p className="text-xs text-neutral-fg-subtle font-mono">{project.rootPath}</p>
          </div>
        </div>
        <div className="flex items-center gap-4 text-xs text-neutral-fg-subtle mt-2">
          <span>Created {formatDate(project.createdAt)}</span>
          <span>
            {sessions.length} session{sessions.length !== 1 ? "s" : ""}
          </span>
        </div>
      </div>

      {/* Actions */}
      <div className="mb-4">
        <Button size="sm" onClick={() => onStartChat?.()}>
          <MessageSquare className="h-3.5 w-3.5 mr-1.5" />
          New Session
        </Button>
      </div>

      {/* Recent sessions */}
      <div className="flex-1 flex flex-col min-h-0">
        <h3 className="text-sm font-medium mb-2">Recent Sessions</h3>
        {sessions.length === 0 ? (
          <div className="flex-1 flex items-center justify-center">
            <p className="text-sm text-neutral-fg-subtle">No sessions in this project yet</p>
          </div>
        ) : (
          <ScrollArea className="flex-1">
            <div className="space-y-1">
              {(sessions as SessionSummary[]).map((session) => (
                <button
                  key={session.id}
                  onClick={() => onSelectSession?.(session.id)}
                  className="w-full text-left px-3 py-2 rounded-md hover:bg-neutral-bg-dim/50 transition-colors"
                >
                  <p className="text-sm font-medium truncate">{session.title || "Untitled"}</p>
                  <div className="flex items-center gap-2 text-[11px] text-neutral-fg-subtle mt-0.5">
                    <span>{formatDate(session.updatedAt)}</span>
                    <span>
                      {session.messageCount} message{session.messageCount !== 1 ? "s" : ""}
                    </span>
                  </div>
                </button>
              ))}
            </div>
          </ScrollArea>
        )}
      </div>
    </div>
  );
}
