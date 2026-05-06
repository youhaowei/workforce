/**
 * AppSidebar — left navbar (Claude-desktop style).
 * Transparent over shell-ground (matches the old icon-rail navbar) — main
 * paper carries the visual weight via Surface variant="main".
 *
 * Hierarchy: projects first; sessions nested under their project. Sessions
 * with no project live in a flat "Sessions" section at the bottom.
 */

import { useCallback, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { ChevronDown, ChevronRight, Download, PanelLeftClose, RefreshCw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useTRPC } from "@/bridge/react";
import { useRequiredOrgId } from "@/ui/hooks/useRequiredOrgId";
import { usePlatform } from "@/ui/context/PlatformProvider";
import type { Project, SessionSummary } from "@/services/types";

import { ImportCCDialog } from "../Sessions/ImportCCDialog";

const SIDEBAR_WIDTH_PX = 300;
const TRAFFIC_LIGHT_SPACER_PX = 78;
const COLLAPSED_PROJECTS_KEY = "workforce:sidebar-collapsed-projects";

function readCollapsedSet(): Set<string> {
  try {
    const raw = localStorage.getItem(COLLAPSED_PROJECTS_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    return Array.isArray(parsed) ? new Set<string>(parsed) : new Set<string>();
  } catch {
    return new Set<string>();
  }
}

export interface AppSidebarProps {
  hidden: boolean;
  peek?: boolean;
  selectedProjectId: string | null;
  selectedSessionId: string | null;
  onToggle: () => void;
  onSelectProject: (projectId: string) => void;
  onSelectSession: (sessionId: string) => void;
  onMouseLeave?: () => void;
}

export default function AppSidebar({
  hidden,
  peek,
  selectedProjectId,
  selectedSessionId,
  onToggle,
  onSelectProject,
  onSelectSession,
  onMouseLeave,
}: AppSidebarProps) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const orgId = useRequiredOrgId();
  const { isDesktop, isMacOS } = usePlatform();
  const macDesktop = isDesktop && isMacOS;

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

  const { byProject, orphans } = useMemo(() => {
    const map = new Map<string, SessionSummary[]>();
    const orphans: SessionSummary[] = [];
    for (const s of sessions as SessionSummary[]) {
      const pid = s.metadata?.projectId as string | undefined;
      if (pid && projectMap.has(pid)) {
        const arr = map.get(pid);
        if (arr) arr.push(s);
        else map.set(pid, [s]);
      } else {
        orphans.push(s);
      }
    }
    return { byProject: map, orphans };
  }, [sessions, projectMap]);

  const [collapsedProjects, setCollapsedProjects] = useState<Set<string>>(readCollapsedSet);
  const toggleProjectCollapsed = useCallback((projectId: string) => {
    setCollapsedProjects((prev) => {
      const next = new Set(prev);
      if (next.has(projectId)) next.delete(projectId);
      else next.add(projectId);
      localStorage.setItem(COLLAPSED_PROJECTS_KEY, JSON.stringify([...next]));
      return next;
    });
  }, []);

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

  const isCollapsed = hidden && !peek;

  return (
    <aside
      role="complementary"
      aria-label="Navigation sidebar"
      onMouseLeave={onMouseLeave}
      className={[
        "shrink-0 flex flex-col select-none overflow-hidden",
        "transition-[width] duration-200 ease-in-out motion-reduce:transition-none",
        peek ? "absolute inset-y-0 left-0 z-40 shadow-[4px_0_24px_rgba(0,0,0,0.4)]" : "relative",
      ].join(" ")}
      style={{ width: isCollapsed ? 0 : SIDEBAR_WIDTH_PX }}
      aria-hidden={isCollapsed}
      inert={isCollapsed ? true : undefined}
    >
      {/* Top row — drag region + sidebar toggle */}
      <div className="relative shrink-0 flex items-center h-10 px-3">
        <div className="absolute inset-0 titlebar-drag-region" aria-hidden="true" />
        {macDesktop && (
          <div className="shrink-0" style={{ width: TRAFFIC_LIGHT_SPACER_PX }} aria-hidden="true" />
        )}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              color="neutral"
              className="relative z-10 h-7 w-7 text-neutral-fg-subtle hover:text-neutral-fg"
              onClick={onToggle}
              aria-label="Hide sidebar"
            >
              <PanelLeftClose className="h-3.5 w-3.5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Hide sidebar (Cmd+Shift+H)</TooltipContent>
        </Tooltip>
      </div>

      <ScrollArea className="flex-1">
        {/* Projects header (clickable → /projects list) */}
        <div className="px-3 py-2">
          <Link
            to="/projects"
            className="text-[11px] font-medium text-neutral-fg-subtle/60 hover:text-neutral-fg-subtle tracking-wider focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-ring rounded"
          >
            Projects
          </Link>
        </div>

        {projects.length === 0 ? (
          <div className="px-3 pb-3 text-xs text-neutral-fg-subtle/70">No projects yet</div>
        ) : (
          <div className="flex flex-col px-2 pb-2">
            {(projects as Project[]).map((p) => {
              const projSessions = byProject.get(p.id) ?? [];
              const isProjectCollapsed = collapsedProjects.has(p.id);
              const isActive = p.id === selectedProjectId;
              return (
                <div key={p.id} className="flex flex-col">
                  <ProjectRow
                    project={p}
                    count={projSessions.length}
                    collapsed={isProjectCollapsed}
                    active={isActive}
                    onActivate={() => onSelectProject(p.id)}
                    onToggleCollapse={() => toggleProjectCollapsed(p.id)}
                  />
                  {!isProjectCollapsed && projSessions.length > 0 && (
                    <div className="flex flex-col pl-3">
                      {projSessions.map((s) => (
                        <SessionRow
                          key={s.id}
                          session={s}
                          active={s.id === selectedSessionId}
                          onClick={() => handleSelect(s.id)}
                        />
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* Sessions (orphans only — sessions with no project) */}
        <div className="flex items-center px-3 py-2">
          <span className="flex-1 text-[11px] font-medium text-neutral-fg-subtle/60 tracking-wider">
            Sessions
          </span>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                color="neutral"
                className="h-5 w-5 text-neutral-fg-subtle hover:text-neutral-fg"
                onClick={() => setImportOpen(true)}
                aria-label="Import from Claude Code"
              >
                <Download className="h-3 w-3" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Import from Claude Code</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                color="neutral"
                className="h-5 w-5 text-neutral-fg-subtle hover:text-neutral-fg"
                onClick={handleRefresh}
                aria-label="Refresh sessions"
              >
                <RefreshCw className={`h-3 w-3 ${isRefreshing ? "animate-spin" : ""}`} />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Refresh sessions</TooltipContent>
          </Tooltip>
        </div>

        {orphans.length === 0 ? (
          <div className="px-3 pb-3 text-xs text-neutral-fg-subtle/70">No standalone sessions</div>
        ) : (
          <div className="flex flex-col px-2 pb-3">
            {orphans.map((s) => (
              <SessionRow
                key={s.id}
                session={s}
                active={s.id === selectedSessionId}
                onClick={() => handleSelect(s.id)}
              />
            ))}
          </div>
        )}
      </ScrollArea>

      <ImportCCDialog
        open={importOpen}
        onOpenChange={setImportOpen}
        orgId={orgId}
        onImported={handleSelect}
      />
    </aside>
  );
}

function ProjectRow({
  project,
  count,
  collapsed,
  active,
  onActivate,
  onToggleCollapse,
}: {
  project: Project;
  count: number;
  collapsed: boolean;
  active: boolean;
  onActivate: () => void;
  onToggleCollapse: () => void;
}) {
  const Chevron = collapsed ? ChevronRight : ChevronDown;
  return (
    <div
      className={[
        "group flex items-center gap-1 h-8 rounded-md pr-2 transition-colors",
        active
          ? "bg-neutral-bg-subtle text-neutral-fg"
          : "text-neutral-fg/80 hover:bg-neutral-bg-dim/50 hover:text-neutral-fg",
      ].join(" ")}
    >
      <button
        type="button"
        onClick={onToggleCollapse}
        className="shrink-0 h-6 w-6 flex items-center justify-center rounded text-neutral-fg-subtle hover:text-neutral-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-ring"
        aria-label={collapsed ? `Expand ${project.name}` : `Collapse ${project.name}`}
        aria-expanded={!collapsed}
      >
        <Chevron className="h-3 w-3" />
      </button>
      <button
        type="button"
        onClick={onActivate}
        className="flex-1 flex items-center gap-2 h-full text-left text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-ring rounded"
      >
        <span
          className="shrink-0 w-1.5 h-1.5 rounded-full bg-neutral-fg-subtle/60"
          style={project.color ? { backgroundColor: project.color } : undefined}
          aria-hidden="true"
        />
        <span className="flex-1 truncate">{project.name}</span>
        {count > 0 && (
          <span className="text-[11px] text-neutral-fg-subtle/60 tabular-nums">{count}</span>
        )}
      </button>
    </div>
  );
}

function SessionRow({
  session,
  active,
  onClick,
}: {
  session: SessionSummary;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        "flex items-center gap-2 h-7 rounded-md px-2 text-sm text-left transition-colors",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-ring",
        active
          ? "bg-neutral-bg-subtle text-neutral-fg"
          : "text-neutral-fg/70 hover:bg-neutral-bg-dim/50 hover:text-neutral-fg",
      ].join(" ")}
    >
      <span className="flex-1 truncate">{session.title || "Untitled session"}</span>
    </button>
  );
}
