/**
 * SessionList - Virtualized scrollable list of sessions with search, filtering, and grouping.
 *
 * Uses react-virtuoso for performance with large session counts (CC imports).
 * Supports grouping by created date, last active, project, or status.
 */

import { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { Virtuoso } from 'react-virtuoso';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Search, Plus, X, ChevronDown, ChevronRight, FolderGit2, MessageSquare, SlidersHorizontal, Calendar, Clock, Folder, Activity, Shapes, ArrowUpDown, ArrowUp, ArrowDown } from 'lucide-react';
import type { Project, SessionSummary } from '@/services/types';
import { SessionItem } from './SessionItem';
import { filterSessions, groupSessions } from './sessionListHelpers';
import type { GroupByMode, SortDirection, SessionGroup } from './sessionListHelpers';

const GROUP_BY_STORAGE_KEY = 'workforce:sessions-group-by';

const GROUP_BY_OPTIONS: { value: GroupByMode; label: string; icon: typeof Calendar }[] = [
  { value: 'date', label: 'Created', icon: Calendar },
  { value: 'active', label: 'Active', icon: Clock },
  { value: 'project', label: 'Project', icon: Folder },
  { value: 'status', label: 'Status', icon: Activity },
];

const VALID_GROUP_BY_MODES: ReadonlySet<GroupByMode> = new Set(
  GROUP_BY_OPTIONS.map((option) => option.value),
);

function getInitialGroupBy(groupByProp: GroupByMode): GroupByMode {
  const stored = localStorage.getItem(GROUP_BY_STORAGE_KEY);
  if (stored && VALID_GROUP_BY_MODES.has(stored as GroupByMode)) {
    return stored as GroupByMode;
  }
  if (VALID_GROUP_BY_MODES.has(groupByProp)) {
    return groupByProp;
  }
  return 'date';
}

export type { GroupByMode } from './sessionListHelpers';

// =============================================================================
// Filter Types
// =============================================================================

type SortField = 'default' | 'created' | 'active' | 'title' | 'messages';

const SORT_FIELD_OPTIONS: { value: SortField; label: string }[] = [
  { value: 'default', label: 'Same as group' },
  { value: 'created', label: 'Created' },
  { value: 'active', label: 'Last active' },
  { value: 'title', label: 'Title' },
  { value: 'messages', label: 'Messages' },
];

type StatusFilter = 'all' | 'active' | 'completed' | 'failed';
type TypeFilterMode = 'all' | 'chat' | 'workagent' | 'external';

const FILTERS_STORAGE_KEY = 'workforce:sessions-filters';

function getInitialFilters(): { status: StatusFilter; type: TypeFilterMode } {
  try {
    const stored = localStorage.getItem(FILTERS_STORAGE_KEY);
    if (stored) return JSON.parse(stored);
  } catch { /* ignore */ }
  return { status: 'all', type: 'all' };
}

// =============================================================================
// Small Filter Dropdown
// =============================================================================

function FilterDropdown<T extends string>({
  label,
  icon: Icon,
  value,
  options,
  onChange,
}: {
  label: string;
  icon: typeof Calendar;
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
}) {
  const active = value !== 'all';
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button className={`flex items-center gap-1 h-6 px-1.5 rounded text-[11px] transition-colors ${
          active
            ? 'bg-palette-primary/10 text-palette-primary font-medium'
            : 'text-neutral-fg-subtle hover:text-neutral-fg hover:bg-neutral-bg-dim/50'
        }`}>
          <Icon className="h-3 w-3" />
          {active ? options.find((o) => o.value === value)?.label : label}
          <ChevronDown className="h-2.5 w-2.5" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-[100px]">
        <DropdownMenuRadioGroup value={value} onValueChange={(v) => onChange(v as T)}>
          {options.map((opt) => (
            <DropdownMenuRadioItem key={opt.value} value={opt.value} className="text-xs">
              {opt.label}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// =============================================================================
// Empty States
// =============================================================================

function EmptyState({
  icon,
  heading,
  subtext,
  action,
}: {
  icon: React.ReactNode;
  heading: string;
  subtext: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-10 text-center">
      <div className="h-10 w-10 rounded-full bg-neutral-bg-dim flex items-center justify-center mb-3">
        {icon}
      </div>
      <p className="text-sm font-medium mb-1">{heading}</p>
      <p className="text-xs text-neutral-fg-subtle mb-4">{subtext}</p>
      {action}
    </div>
  );
}

function renderEmptyState(
  filteredCount: number,
  totalCount: number,
  query: string,
  onCreate?: () => void,
): React.ReactNode {
  if (filteredCount > 0) return null;

  if (query) {
    return (
      <EmptyState
        icon={<Search className="h-5 w-5 text-neutral-fg-subtle" />}
        heading="No results"
        subtext={`No sessions match \u201c${query}\u201d`}
      />
    );
  }

  if (totalCount > 0) {
    return (
      <EmptyState
        icon={<SlidersHorizontal className="h-5 w-5 text-neutral-fg-subtle" />}
        heading="No matching sessions"
        subtext="Try adjusting your filters"
      />
    );
  }

  return (
    <EmptyState
      icon={<MessageSquare className="h-5 w-5 text-neutral-fg-subtle" />}
      heading="No sessions yet"
      subtext="Start a conversation to begin"
      action={
        <Button variant="outline" size="sm" onClick={onCreate}>
          <Plus className="h-3.5 w-3.5 mr-1.5" />
          New session
        </Button>
      }
    />
  );
}

// =============================================================================
// Flattened List Item (for virtualization)
// =============================================================================

type FlatItem =
  | { kind: 'header'; label: string; key: string; count: number; collapsible: boolean; collapsed: boolean }
  | { kind: 'session'; session: SessionSummary };

function compareByField(a: SessionSummary, b: SessionSummary, field: SortField, dir: SortDirection, groupBy: GroupByMode): number {
  const mul = dir === 'desc' ? -1 : 1;
  let resolvedField = field;
  if (field === 'default') {
    resolvedField = groupBy === 'active' ? 'active' : 'created';
  }
  switch (resolvedField) {
    case 'created': return mul * (a.createdAt - b.createdAt);
    case 'active': return mul * (a.updatedAt - b.updatedAt);
    case 'title': return mul * (a.title ?? '').localeCompare(b.title ?? '');
    case 'messages': return mul * (a.messageCount - b.messageCount);
    default: return 0;
  }
}

function flattenGroups(
  groups: SessionGroup[],
  groupBy: GroupByMode,
  collapsedGroups: Set<string>,
  secondary?: { field: SortField; dir: SortDirection },
): FlatItem[] {
  const items: FlatItem[] = [];
  const collapsible = groupBy !== 'date';

  for (const group of groups) {
    const collapsed = collapsible && collapsedGroups.has(group.key);
    const sorted = secondary
      ? [...group.sessions].sort((a, b) => compareByField(a, b, secondary.field, secondary.dir, groupBy))
      : group.sessions;
    items.push({ kind: 'header', label: group.label, key: group.key, count: sorted.length, collapsible, collapsed });
    if (!collapsed) {
      for (const session of sorted) {
        items.push({ kind: 'session', session });
      }
    }
  }
  return items;
}

// =============================================================================
// Component
// =============================================================================

export interface SessionListProps {
  sessions: SessionSummary[];
  activeSessionId?: string;
  typeFilter?: string;
  stateFilter?: string;
  groupBy?: GroupByMode;
  projectMap?: Map<string, Project>;
  /** Map of sessionId → inSync status for imported CC sessions */
  syncStatus?: Record<string, boolean>;
  /** Session ID currently being imported (shows loading state) */
  importingId?: string | null;
  onSelect?: (sessionId: string) => void;
  onDelete?: (sessionId: string) => void;
  onHide?: (sessionId: string) => void;
  onCreate?: () => void;
  onSync?: (sessionId: string) => void;
}

export function SessionList({
  sessions,
  activeSessionId,
  typeFilter = 'all',
  stateFilter = 'all',
  groupBy: groupByProp = 'date',
  projectMap,
  syncStatus,
  onSelect,
  onDelete,
  onHide,
  onCreate,
  onSync,
  importingId,
}: SessionListProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
  const searchInputRef = useRef<HTMLInputElement>(null);
  const [groupBy, setGroupBy] = useState<GroupByMode>(() => getInitialGroupBy(groupByProp));
  const [filters, setFilters] = useState(getInitialFilters);
  const [sortDir, setSortDir] = useState<SortDirection>('desc');
  const [secondarySort, setSecondarySort] = useState<{ field: SortField; dir: SortDirection }>({ field: 'default', dir: 'desc' });

  const handleGroupByChange = useCallback((mode: string) => {
    if (!VALID_GROUP_BY_MODES.has(mode as GroupByMode)) return;
    setGroupBy(mode as GroupByMode);
    localStorage.setItem(GROUP_BY_STORAGE_KEY, mode);
    setCollapsedGroups(new Set());
  }, []);

  const updateFilter = useCallback(<K extends keyof typeof filters>(key: K, value: (typeof filters)[K]) => {
    setFilters((prev) => {
      const next = { ...prev, [key]: value };
      localStorage.setItem(FILTERS_STORAGE_KEY, JSON.stringify(next));
      return next;
    });
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(searchQuery), 300);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  const filteredSessions = useMemo(() => {
    let result = filterSessions(sessions, typeFilter, stateFilter, debouncedQuery);

    if (filters.status !== 'all') {
      result = result.filter((s) => {
        const lifecycle = s.metadata?.lifecycle as { state?: string } | undefined;
        const state = lifecycle?.state ?? 'created';
        if (filters.status === 'active') return state === 'active' || state === 'created';
        if (filters.status === 'completed') return state === 'completed';
        if (filters.status === 'failed') return state === 'failed';
        return true;
      });
    }
    if (filters.type !== 'all') {
      result = result.filter((s) => {
        if (filters.type === 'external') return s.id.startsWith('cc:');
        const sessionType = (s.metadata?.type as string) ?? 'chat';
        return sessionType === filters.type;
      });
    }

    return result;
  }, [debouncedQuery, sessions, typeFilter, stateFilter, filters]);

  const groups = useMemo(
    () => groupSessions(filteredSessions, groupBy, projectMap, sortDir),
    [groupBy, filteredSessions, projectMap, sortDir],
  );

  const flatItems = useMemo(
    () => groups
      ? flattenGroups(groups, groupBy, collapsedGroups, secondarySort)
      : filteredSessions.map((s): FlatItem => ({ kind: 'session', session: s })),
    [groups, groupBy, collapsedGroups, filteredSessions, secondarySort],
  );

  const toggleGroup = (key: string) => {
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const clearSearch = () => {
    setSearchQuery('');
    setDebouncedQuery('');
    searchInputRef.current?.focus();
  };

  const renderItem = useCallback((_index: number, item: FlatItem) => {
    if (item.kind === 'header') {
      if (!item.collapsible) {
        // Date group header — small, muted
        return (
          <div className="px-3 py-2 text-[11px] font-medium text-neutral-fg-subtle/60 tracking-wider select-none">
            {item.label}
          </div>
        );
      }
      // Collapsible group header
      return (
        <button
          onClick={() => toggleGroup(item.key)}
          aria-expanded={!item.collapsed}
          className="w-full flex items-center gap-2 px-3 py-2 text-xs font-medium text-neutral-fg-subtle hover:bg-neutral-bg-dim/50 transition-colors"
        >
          {item.collapsed ? <ChevronRight className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
          {groupBy === 'project' && <FolderGit2 className="h-3 w-3 shrink-0" />}
          <span className="truncate">{item.label}</span>
          <span className="ml-auto text-[10px]">{item.count}</span>
        </button>
      );
    }

    const session = item.session;
    const projectId = session.metadata?.projectId as string | undefined;
    const project = projectId ? projectMap?.get(projectId) : undefined;
    const cwdFolder = session.metadata?.cwd
      ? (session.metadata.cwd as string).split('/').pop()
      : undefined;
    return (
      <SessionItem
        session={session}
        isActive={session.id === activeSessionId || importingId === session.id}
        projectName={project?.name || cwdFolder}
        isOutOfSync={syncStatus?.[session.id] === false}
        isImporting={importingId === session.id}
        timeField={groupBy === 'date' ? 'createdAt' : 'updatedAt'}
        onSelect={onSelect}
        onDelete={onDelete}
        onHide={onHide}
        onSync={onSync}
      />
    );
  }, [activeSessionId, groupBy, projectMap, syncStatus, importingId, onSelect, onDelete, onHide, onSync]);

  const emptyState = renderEmptyState(filteredSessions.length, sessions.length, debouncedQuery, onCreate);

  return (
    <div className="flex flex-col h-full min-w-0">
      {/* Search bar */}
      <div className="px-3 py-2 border-b border-neutral-border/50">
        <div className="flex gap-1.5">
          <div className="relative flex-1">
            <Search className="absolute left-2 top-1.5 h-3.5 w-3.5 text-neutral-fg-subtle pointer-events-none" />
            <Input
              ref={searchInputRef}
              placeholder="Search..."
              aria-label="Search sessions"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-7 pr-7 h-7 text-xs"
            />
            {searchQuery && (
              <button
                onClick={clearSearch}
                aria-label="Clear search"
                className="absolute right-1.5 top-1.5 h-4 w-4 flex items-center justify-center text-neutral-fg-subtle hover:text-neutral-fg rounded-sm"
              >
                <X className="h-3 w-3" aria-hidden="true" />
              </button>
            )}
          </div>
          <Button size="sm" className="h-7 px-2.5 text-xs" onClick={onCreate}>
            <Plus className="h-3 w-3 mr-1" />
            New
          </Button>
        </div>
      </div>

      {/* Group-by row */}
      <div className="flex items-center gap-1 px-3 py-1 border-b border-neutral-border/50">
        <span className="text-[10px] text-neutral-fg-subtle/50 shrink-0">Group</span>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="flex items-center gap-1 h-6 px-1.5 rounded text-[11px] text-neutral-fg-subtle hover:text-neutral-fg hover:bg-neutral-bg-dim/50 transition-colors shrink-0">
              {GROUP_BY_OPTIONS.find((o) => o.value === groupBy)?.label ?? 'Group'}
              <ChevronDown className="h-2.5 w-2.5" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="min-w-[120px]">
            <DropdownMenuRadioGroup value={groupBy} onValueChange={handleGroupByChange}>
              {GROUP_BY_OPTIONS.map(({ value, label, icon: Icon }) => (
                <DropdownMenuRadioItem key={value} value={value} className="text-xs gap-2">
                  <Icon className="h-3 w-3" />
                  {label}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>
        <Popover>
          <PopoverTrigger asChild>
            <button className="flex items-center gap-1 h-6 px-1.5 rounded text-[11px] text-neutral-fg-subtle hover:text-neutral-fg hover:bg-neutral-bg-dim/50 transition-colors shrink-0">
              <ArrowUpDown className="h-3 w-3" />
              Sort
            </button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-56 p-2 space-y-2">
            {/* Primary direction */}
            <div>
              <p className="text-[10px] text-neutral-fg-subtle mb-1">Group order</p>
              <div className="flex gap-1">
                <button
                  onClick={() => setSortDir('desc')}
                  className={`flex-1 flex items-center justify-center gap-1 h-7 rounded text-xs transition-colors ${
                    sortDir === 'desc' ? 'bg-neutral-bg-subtle text-neutral-fg font-medium' : 'text-neutral-fg-subtle hover:bg-neutral-bg-dim/50'
                  }`}
                >
                  <ArrowDown className="h-3 w-3" /> Newest
                </button>
                <button
                  onClick={() => setSortDir('asc')}
                  className={`flex-1 flex items-center justify-center gap-1 h-7 rounded text-xs transition-colors ${
                    sortDir === 'asc' ? 'bg-neutral-bg-subtle text-neutral-fg font-medium' : 'text-neutral-fg-subtle hover:bg-neutral-bg-dim/50'
                  }`}
                >
                  <ArrowUp className="h-3 w-3" /> Oldest
                </button>
              </div>
            </div>
            {/* Secondary sort */}
            <div>
              <p className="text-[10px] text-neutral-fg-subtle mb-1">Then sort by</p>
              <div className="flex gap-1">
                <select
                  value={secondarySort.field}
                  onChange={(e) => setSecondarySort((prev) => ({ ...prev, field: e.target.value as SortField }))}
                  className="flex-1 h-7 rounded border border-neutral-border bg-transparent text-xs px-1.5"
                >
                  {SORT_FIELD_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </select>
                <button
                  onClick={() => setSecondarySort((prev) => ({ ...prev, dir: prev.dir === 'desc' ? 'asc' : 'desc' }))}
                  className="h-7 w-7 flex items-center justify-center rounded text-neutral-fg-subtle hover:bg-neutral-bg-dim/50 transition-colors"
                >
                  {secondarySort.dir === 'desc' ? <ArrowDown className="h-3 w-3" /> : <ArrowUp className="h-3 w-3" />}
                </button>
              </div>
            </div>
          </PopoverContent>
        </Popover>
      </div>

      {/* Filter row */}
      <div className="flex items-center flex-wrap gap-0.5 px-3 py-1 border-b border-neutral-border/50">
        <span className="text-[10px] text-neutral-fg-subtle/50 shrink-0 mr-0.5">Filter</span>
        <FilterDropdown<StatusFilter>
          label="Status"
          icon={Activity}
          value={filters.status}
          options={[
            { value: 'all', label: 'All' },
            { value: 'active', label: 'Active' },
            { value: 'completed', label: 'Done' },
            { value: 'failed', label: 'Failed' },
          ]}
          onChange={(v) => updateFilter('status', v)}
        />
        <FilterDropdown<TypeFilterMode>
          label="Type"
          icon={Shapes}
          value={filters.type}
          options={[
            { value: 'all', label: 'All' },
            { value: 'chat', label: 'Chat' },
            { value: 'workagent', label: 'Agent' },
            { value: 'external', label: 'External' },
          ]}
          onChange={(v) => updateFilter('type', v)}
        />
      </div>

      {/* Session list (virtualized) */}
      <div className="flex-1">
        {emptyState}
        {!emptyState && (
          <Virtuoso
            data={flatItems}
            itemContent={renderItem}
            className="h-full"
          />
        )}
      </div>
    </div>
  );
}
