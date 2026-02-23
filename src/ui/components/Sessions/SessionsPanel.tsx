/**
 * SessionsPanel - Persistent left panel for session management.
 * Always visible adjacent to the nav sidebar. Collapsible to save space.
 * Uses tRPC queries/mutations with type and state filtering.
 *
 * Filters are collapsible to maximize list space — a toggle button in the
 * header reveals/hides them, with a badge showing active filter count.
 */

import { useState, useCallback, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ChevronsLeft, SlidersHorizontal, X } from 'lucide-react';
import { useTRPC } from '@/bridge/react';
import { useRequiredOrgId } from '@/ui/hooks/useRequiredOrgId';
import { useResizablePanel } from '@/ui/hooks/useResizablePanel';
import type { SessionSummary, Project } from '@/services/types';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { SessionList } from './SessionList';
import type { GroupByMode } from './sessionListHelpers';

/** Fetches project list for group-by-project and defers grouping while loading. */
function useProjectGrouping(groupBy: GroupByMode, orgId: string) {
  const trpc = useTRPC();
  const listInput = { orgId };
  const { data: projects = [], isLoading } = useQuery(
    trpc.project.list.queryOptions(listInput, { enabled: groupBy === 'project' }),
  );
  const projectMap = useMemo(
    () => new Map((projects as Project[]).map((p) => [p.id, p])),
    [projects],
  );
  // Defer project grouping until the project list is loaded to avoid flashing raw IDs
  const effectiveGroupBy: GroupByMode = (groupBy === 'project' && isLoading) ? 'none' : groupBy;
  return { projectMap, effectiveGroupBy };
}

/** Collapsible filter toolbar for type, state, and group-by controls. */
function FilterToolbar({
  typeFilter,
  stateFilter,
  groupBy,
  activeFilterCount,
  onTypeChange,
  onStateChange,
  onGroupChange,
  onClear,
}: {
  typeFilter: string;
  stateFilter: string;
  groupBy: GroupByMode;
  activeFilterCount: number;
  onTypeChange: (v: string) => void;
  onStateChange: (v: string) => void;
  onGroupChange: (v: GroupByMode) => void;
  onClear: () => void;
}) {
  return (
    <div className="px-3 py-2 border-b space-y-1.5 bg-muted/30">
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Filters</span>
        {activeFilterCount > 0 && (
          <button
            onClick={onClear}
            className="text-[11px] text-muted-foreground hover:text-foreground flex items-center gap-0.5 transition-colors"
          >
            <X className="h-3 w-3" />
            Clear
          </button>
        )}
      </div>
      <div className="flex gap-1.5">
        <Select value={typeFilter} onValueChange={onTypeChange}>
          <SelectTrigger className="h-7 text-xs flex-1">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All types</SelectItem>
            <SelectItem value="chat">Chat</SelectItem>
            <SelectItem value="workagent">Agent</SelectItem>
          </SelectContent>
        </Select>
        <Select value={stateFilter} onValueChange={onStateChange}>
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
      <Select value={groupBy} onValueChange={(v) => onGroupChange(v as GroupByMode)}>
        <SelectTrigger className="h-7 text-xs">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="none">No grouping</SelectItem>
          <SelectItem value="project">Group by project</SelectItem>
          <SelectItem value="status">Group by status</SelectItem>
        </SelectContent>
      </Select>
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
  const [typeFilter, setTypeFilter] = useState('all');
  const [stateFilter, setStateFilter] = useState('all');
  const [groupBy, setGroupBy] = useState<'none' | 'project' | 'status'>('none');
  const [filtersOpen, setFiltersOpen] = useState(false);
  const { width: panelWidth, isDragging, onResizeStart } = useResizablePanel({
    storageKey: 'workforce:sessions-panel-width',
    defaultWidth: 288,
    minWidth: 220,
    maxWidth: 480,
  });
  const listInput = { orgId };
  const listQueryKey = trpc.session.list.queryKey(listInput);

  const activeFilterCount = useMemo(() => {
    let count = 0;
    if (typeFilter !== 'all') count++;
    if (stateFilter !== 'all') count++;
    return count;
  }, [typeFilter, stateFilter]);

  const clearFilters = useCallback(() => {
    setTypeFilter('all');
    setStateFilter('all');
  }, []);

  const { data: sessions = [], isLoading } = useQuery(
    trpc.session.list.queryOptions(listInput, { refetchInterval: 5000 }),
  );

  const { projectMap, effectiveGroupBy } = useProjectGrouping(groupBy, orgId);

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
      className={`shrink-0 flex flex-col bg-background border-r overflow-hidden relative ${
        collapsed ? 'w-0 border-r-0' : ''
      } ${isDragging ? '' : 'transition-[width] duration-200 ease-in-out'}`}
      style={collapsed ? undefined : { width: panelWidth }}
      aria-hidden={collapsed}
      inert={collapsed ? true : undefined}
    >
      {/* Header — title, filter toggle with badge, collapse */}
      <div className="flex items-center gap-1 px-3 py-2.5 border-b">
        <h2 className="font-semibold text-sm flex-1">Sessions</h2>
        <Button
          variant="ghost"
          size="icon"
          className={`h-6 w-6 relative ${filtersOpen || activeFilterCount > 0 ? 'text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
          onClick={() => setFiltersOpen((prev) => !prev)}
          aria-label="Toggle filters"
          aria-expanded={filtersOpen}
        >
          <SlidersHorizontal className="h-3.5 w-3.5" />
          {activeFilterCount > 0 && !filtersOpen && (
            <span className="absolute -top-0.5 -right-0.5 h-3.5 min-w-3.5 rounded-full bg-primary text-primary-foreground text-[9px] font-medium flex items-center justify-center px-0.5">
              {activeFilterCount}
            </span>
          )}
        </Button>
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

      {/* Collapsible filters */}
      {filtersOpen && (
        <FilterToolbar
          typeFilter={typeFilter}
          stateFilter={stateFilter}
          groupBy={groupBy}
          activeFilterCount={activeFilterCount}
          onTypeChange={setTypeFilter}
          onStateChange={setStateFilter}
          onGroupChange={setGroupBy}
          onClear={clearFilters}
        />
      )}

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
          groupBy={effectiveGroupBy}
          projectMap={projectMap}
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
