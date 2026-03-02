/**
 * ProjectsPanel - Secondary sidebar for project management.
 * Shows when currentView === 'projects'. Same w-72 pattern as SessionsPanel.
 */

import { useState, useCallback, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ChevronsLeft, Plus, Search, Trash2, FolderOpen } from 'lucide-react';
import { useTRPC } from '@/bridge/react';
import { useRequiredOrgId } from '@/ui/hooks/useRequiredOrgId';
import { useDialogStore } from '@/ui/stores/useDialogStore';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import type { Project } from '@/services/types';

export interface ProjectsPanelProps {
  collapsed: boolean;
  selectedProjectId?: string | null;
  onCollapse?: () => void;
  onCreateProject?: () => void;
  onSelectProject?: (projectId: string) => void;
  onClearSelection?: () => void;
}

export function ProjectsPanel({
  collapsed,
  selectedProjectId,
  onCollapse,
  onCreateProject,
  onSelectProject,
  onClearSelection,
}: ProjectsPanelProps) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const orgId = useRequiredOrgId();
  const [search, setSearch] = useState('');

  const listInput = { orgId };
  const { data: projects = [], isLoading } = useQuery(
    trpc.project.list.queryOptions(listInput, { enabled: !collapsed }),
  );

  const deleteMutation = useMutation(
    trpc.project.delete.mutationOptions({
      onMutate: ({ id }) => {
        const previousProjects = queryClient.getQueryData<Project[]>(
          trpc.project.list.queryKey(listInput),
        );
        queryClient.setQueriesData<Project[]>(
          { queryKey: trpc.project.list.queryKey(listInput) },
          (old) => old?.filter((p) => p.id !== id) ?? old,
        );
        const wasSelected = id === selectedProjectId;
        if (wasSelected) onClearSelection?.();
        return { wasSelected, id, previousProjects };
      },
      onError: (_err, _vars, context) => {
        if (context?.previousProjects !== undefined) {
          queryClient.setQueryData(trpc.project.list.queryKey(listInput), context.previousProjects);
        }
        if (context?.wasSelected) onSelectProject?.(context.id);
      },
    }),
  );

  const handleSelect = useCallback((projectId: string) => {
    onSelectProject?.(projectId);
  }, [onSelectProject]);

  const handleDelete = useCallback(async (e: React.MouseEvent, project: Project) => {
    e.stopPropagation();
    const confirmed = await useDialogStore.getState().confirm({
      title: 'Delete project',
      description: `Delete "${project.name}"? This cannot be undone.`,
      confirmLabel: 'Delete',
      variant: 'destructive',
    });
    if (confirmed) {
      deleteMutation.mutate({ id: project.id });
    }
  }, [deleteMutation]);

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim();
    if (!q) return projects as Project[];
    return (projects as Project[]).filter(
      (p) => p.name.toLowerCase().includes(q) || p.rootPath.toLowerCase().includes(q),
    );
  }, [projects, search]);

  return (
    <div
      data-collapsed={collapsed}
      className={`shrink-0 flex flex-col inner-panel transition-[width,margin] duration-200 ease-in-out m-[var(--inner-gap)] ${
        collapsed ? 'w-0 !m-0' : 'w-72'
      }`}
      aria-hidden={collapsed}
      inert={collapsed ? true : undefined}
    >
      {/* Header */}
      <div className="flex items-center justify-between p-3 border-b">
        <h2 className="font-semibold text-sm">Projects</h2>
        {onCollapse && (
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6 text-muted-foreground hover:text-foreground"
            onClick={onCollapse}
            aria-label="Hide projects"
          >
            <ChevronsLeft className="h-3.5 w-3.5" />
          </Button>
        )}
      </div>

      {/* Search + New */}
      <div className="p-3 border-b space-y-2">
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-2.5 top-2 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              placeholder="Search projects..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-8 h-8 text-sm"
            />
          </div>
          <Button size="sm" className="h-8" onClick={onCreateProject}>
            <Plus className="h-3.5 w-3.5 mr-1" />
            New
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          {filtered.length} project{filtered.length !== 1 ? 's' : ''}
        </p>
      </div>

      {/* List */}
      {isLoading && (
        <div className="flex-1 flex items-center justify-center text-muted-foreground text-sm">
          Loading...
        </div>
      )}
      {!isLoading && filtered.length === 0 && (
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center space-y-3 px-4">
            <FolderOpen className="h-8 w-8 mx-auto text-muted-foreground/50" />
            <p className="text-sm text-muted-foreground">
              {search ? 'No projects match your search' : 'No projects yet'}
            </p>
            {!search && (
              <Button variant="outline" size="sm" onClick={onCreateProject}>
                <Plus className="h-3.5 w-3.5 mr-1.5" />
                Create project
              </Button>
            )}
          </div>
        </div>
      )}
      {!isLoading && filtered.length > 0 && (
        <ScrollArea className="flex-1">
          {filtered.map((project) => {
            const isActive = project.id === selectedProjectId;
            return (
              <div
                key={project.id}
                role="button"
                tabIndex={0}
                onClick={() => handleSelect(project.id)}
                onKeyDown={(e) => {
                  if (e.target !== e.currentTarget) return;
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    handleSelect(project.id);
                  }
                }}
                className={`w-full text-left px-3 py-2.5 border-b transition-colors group focus:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                  isActive
                    ? 'bg-accent'
                    : 'hover:bg-muted/50'
                }`}
              >
                <div className="flex items-center gap-2.5">
                  {/* Color avatar */}
                  <div
                    className="shrink-0 w-7 h-7 rounded-md flex items-center justify-center text-white text-xs font-semibold"
                    style={{ backgroundColor: project.color }}
                  >
                    {project.name.charAt(0).toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{project.name}</p>
                    <p className="text-[11px] text-muted-foreground truncate font-mono">
                      {project.rootPath}
                    </p>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6 opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive"
                    onClick={(e) => handleDelete(e, project)}
                    onKeyDown={(e) => e.stopPropagation()}
                    aria-label={`Delete ${project.name}`}
                  >
                    <Trash2 className="h-3 w-3" />
                  </Button>
                </div>
              </div>
            );
          })}
        </ScrollArea>
      )}
    </div>
  );
}
