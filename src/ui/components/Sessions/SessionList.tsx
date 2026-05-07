/**
 * SessionList - Virtualized scrollable list of sessions with search, filtering, and grouping.
 *
 * Uses react-virtuoso for performance with large session counts (CC imports).
 * Supports grouping by created date, last active, project, or status.
 */

import { useState, useMemo, useCallback, useEffect, useRef } from "react";
import { Virtuoso } from "react-virtuoso";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Search,
  Plus,
  X,
  ChevronDown,
  ChevronRight,
  FolderGit2,
  Activity,
  Shapes,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  Calendar,
  Clock,
  Folder,
} from "lucide-react";
import type { Project, SessionSummary } from "@/services/types";
import { SessionItem } from "./SessionItem";
import { filterSessions, groupSessions } from "./sessionListHelpers";
import type { GroupByMode, SortDirection } from "./sessionListHelpers";
import {
  FILTERS_STORAGE_KEY,
  GROUP_BY_STORAGE_KEY,
  SORT_FIELD_OPTIONS,
  SORT_STORAGE_KEY,
  flattenGroups,
  getInitialFilters,
  getInitialSort,
  type FlatItem,
  type SortField,
  type StatusFilter,
  type TypeFilterMode,
} from "./sessionListState";
import { FilterDropdown } from "./SessionListUIHelpers";
import { renderEmptyState } from "./renderEmptyState";

const GROUP_BY_OPTIONS: { value: GroupByMode; label: string; icon: typeof Calendar }[] = [
  { value: "date", label: "Created", icon: Calendar },
  { value: "active", label: "Active", icon: Clock },
  { value: "project", label: "Project", icon: Folder },
  { value: "status", label: "Status", icon: Activity },
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
  return "date";
}

export type { GroupByMode } from "./sessionListHelpers";

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
  onSelect?: (sessionId: string) => void;
  onDelete?: (sessionId: string) => void;
  onCreate?: () => void;
}

export function SessionList({
  sessions,
  activeSessionId,
  typeFilter = "all",
  stateFilter = "all",
  groupBy: groupByProp = "date",
  projectMap,
  onSelect,
  onDelete,
  onCreate,
}: SessionListProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
  const searchInputRef = useRef<HTMLInputElement>(null);
  const [groupBy, setGroupBy] = useState<GroupByMode>(() => getInitialGroupBy(groupByProp));
  const [filters, setFilters] = useState(getInitialFilters);
  const [{ dir: initialDir, secondary: initialSecondary }] = useState(getInitialSort);
  const [sortDir, setSortDir] = useState<SortDirection>(initialDir);
  const [secondarySort, setSecondarySort] = useState<{ field: SortField; dir: SortDirection }>(
    initialSecondary,
  );

  const persistSort = useCallback(
    (dir: SortDirection, secondary: { field: SortField; dir: SortDirection }) => {
      localStorage.setItem(SORT_STORAGE_KEY, JSON.stringify({ dir, secondary }));
    },
    [],
  );

  const handleGroupByChange = useCallback((mode: string) => {
    if (!VALID_GROUP_BY_MODES.has(mode as GroupByMode)) return;
    setGroupBy(mode as GroupByMode);
    localStorage.setItem(GROUP_BY_STORAGE_KEY, mode);
    setCollapsedGroups(new Set());
  }, []);

  const updateFilter = useCallback(
    <K extends keyof typeof filters>(key: K, value: (typeof filters)[K]) => {
      setFilters((prev) => {
        const next = { ...prev, [key]: value };
        localStorage.setItem(FILTERS_STORAGE_KEY, JSON.stringify(next));
        return next;
      });
    },
    [],
  );

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(searchQuery), 300);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  const filteredSessions = useMemo(() => {
    let result = filterSessions(sessions, typeFilter, stateFilter, debouncedQuery);

    if (filters.status !== "all") {
      result = result.filter((s) => {
        const lifecycle = s.metadata?.lifecycle as { state?: string } | undefined;
        const state = lifecycle?.state ?? "created";
        if (filters.status === "active") return state === "active" || state === "created";
        if (filters.status === "completed") return state === "completed";
        if (filters.status === "failed") return state === "failed";
        return true;
      });
    }
    if (filters.type !== "all") {
      result = result.filter((s) => {
        if (filters.type === "external") return s.metadata?.source === "claude-code";
        const sessionType = (s.metadata?.type as string) ?? "chat";
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
    () =>
      groups !== null
        ? flattenGroups(
            groups,
            groupBy,
            collapsedGroups,
            secondarySort.field !== "default" ? secondarySort : undefined,
          )
        : filteredSessions.map((s): FlatItem => ({ kind: "session", session: s })),
    [groups, groupBy, collapsedGroups, filteredSessions, secondarySort],
  );

  // Build rootPath → Project index once for O(1) cwd lookups in renderItem.
  const cwdToProject = useMemo(() => {
    if (!projectMap) return new Map<string, Project>();
    return new Map([...projectMap.values()].map((p) => [p.rootPath, p]));
  }, [projectMap]);

  const toggleGroup = useCallback((key: string) => {
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const clearSearch = () => {
    setSearchQuery("");
    setDebouncedQuery("");
    searchInputRef.current?.focus();
  };

  const renderItem = useCallback(
    (_index: number, item: FlatItem) => {
      if (item.kind === "header") {
        if (!item.collapsible) {
          return (
            <div className="px-3 py-2 text-[11px] font-medium text-neutral-fg-subtle tracking-wider select-none">
              {item.label}
            </div>
          );
        }
        return (
          <button
            onClick={() => toggleGroup(item.key)}
            aria-expanded={!item.collapsed}
            className="w-full flex items-center gap-2 px-3 py-2 text-xs font-medium text-neutral-fg-subtle hover:bg-neutral-fg/[0.04] transition-colors"
          >
            {item.collapsed ? (
              <ChevronRight className="h-3 w-3" />
            ) : (
              <ChevronDown className="h-3 w-3" />
            )}
            {groupBy === "project" && <FolderGit2 className="h-3 w-3 shrink-0" />}
            <span className="truncate">{item.label}</span>
            <span className="ml-auto text-[10px]">{item.count}</span>
          </button>
        );
      }

      const session = item.session;
      const projectId = session.metadata?.projectId as string | undefined;
      const cwd = session.metadata?.cwd as string | undefined;
      const project =
        (projectId ? projectMap?.get(projectId) : undefined) ??
        (cwd ? cwdToProject.get(cwd) : undefined);
      const cwdPath = !project && cwd ? cwd : undefined;
      return (
        <SessionItem
          session={session}
          isActive={session.id === activeSessionId}
          projectName={project?.name || cwdPath}
          projectColor={project?.color}
          isCwdFolder={!project && !!cwdPath}
          timeField={groupBy === "date" ? "createdAt" : "updatedAt"}
          onSelect={onSelect}
          onDelete={onDelete}
        />
      );
    },
    [activeSessionId, groupBy, projectMap, cwdToProject, onSelect, onDelete, toggleGroup],
  );

  const emptyState = renderEmptyState(
    filteredSessions.length,
    sessions.length,
    debouncedQuery,
    onCreate,
  );

  return (
    <div className="flex flex-col h-full min-w-0">
      {/* Search bar */}
      <div className="px-3 py-2 border-b border-neutral-border/20">
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
          <Button variant="ghost" size="sm" className="h-7 px-2.5 text-xs" onClick={onCreate}>
            <Plus className="h-3 w-3 mr-1" />
            New
          </Button>
        </div>
      </div>

      {/* Group-by row */}
      <div className="flex items-center gap-1 px-3 py-1 border-b border-neutral-border/20">
        <span className="text-[10px] text-neutral-fg-subtle shrink-0">Group</span>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="flex items-center gap-1 h-6 px-1.5 rounded text-[11px] text-neutral-fg-subtle hover:text-neutral-fg hover:bg-neutral-fg/[0.04] transition-colors shrink-0">
              {GROUP_BY_OPTIONS.find((o) => o.value === groupBy)?.label ?? "Group"}
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
            <button className="flex items-center gap-1 h-6 px-1.5 rounded text-[11px] text-neutral-fg-subtle hover:text-neutral-fg hover:bg-neutral-fg/[0.04] transition-colors shrink-0">
              <ArrowUpDown className="h-3 w-3" />
              Sort
            </button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-56 p-2 space-y-2">
            <div>
              <p className="text-[10px] text-neutral-fg-subtle mb-1">Group order</p>
              <div className="flex gap-1">
                <button
                  onClick={() => {
                    setSortDir("desc");
                    persistSort("desc", secondarySort);
                  }}
                  className={`flex-1 flex items-center justify-center gap-1 h-7 rounded text-xs transition-colors ${
                    sortDir === "desc"
                      ? "bg-neutral-fg/[0.06] text-neutral-fg font-medium"
                      : "text-neutral-fg-subtle hover:bg-neutral-fg/[0.04]"
                  }`}
                >
                  <ArrowDown className="h-3 w-3" /> Newest
                </button>
                <button
                  onClick={() => {
                    setSortDir("asc");
                    persistSort("asc", secondarySort);
                  }}
                  className={`flex-1 flex items-center justify-center gap-1 h-7 rounded text-xs transition-colors ${
                    sortDir === "asc"
                      ? "bg-neutral-fg/[0.06] text-neutral-fg font-medium"
                      : "text-neutral-fg-subtle hover:bg-neutral-fg/[0.04]"
                  }`}
                >
                  <ArrowUp className="h-3 w-3" /> Oldest
                </button>
              </div>
            </div>
            <div>
              <p className="text-[10px] text-neutral-fg-subtle mb-1">Then sort by</p>
              <div className="flex gap-1">
                <select
                  value={secondarySort.field}
                  onChange={(e) => {
                    const next = { ...secondarySort, field: e.target.value as SortField };
                    setSecondarySort(next);
                    persistSort(sortDir, next);
                  }}
                  className="flex-1 h-7 rounded border border-neutral-border bg-transparent text-xs px-1.5"
                >
                  {SORT_FIELD_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
                <button
                  onClick={() => {
                    const next = {
                      ...secondarySort,
                      dir: (secondarySort.dir === "desc" ? "asc" : "desc") as SortDirection,
                    };
                    setSecondarySort(next);
                    persistSort(sortDir, next);
                  }}
                  className="h-7 w-7 flex items-center justify-center rounded text-neutral-fg-subtle hover:bg-neutral-fg/[0.04] transition-colors"
                >
                  {secondarySort.dir === "desc" ? (
                    <ArrowDown className="h-3 w-3" />
                  ) : (
                    <ArrowUp className="h-3 w-3" />
                  )}
                </button>
              </div>
            </div>
          </PopoverContent>
        </Popover>
      </div>

      {/* Filter row */}
      <div className="flex items-center flex-wrap gap-0.5 px-3 py-1 border-b border-neutral-border/20">
        <span className="text-[10px] text-neutral-fg-subtle shrink-0 mr-0.5">Filter</span>
        <FilterDropdown<StatusFilter>
          label="Status"
          icon={Activity}
          value={filters.status}
          options={[
            { value: "all", label: "All" },
            { value: "active", label: "Active" },
            { value: "completed", label: "Done" },
            { value: "failed", label: "Failed" },
          ]}
          onChange={(v) => updateFilter("status", v)}
        />
        <FilterDropdown<TypeFilterMode>
          label="Type"
          icon={Shapes}
          value={filters.type}
          options={[
            { value: "all", label: "All" },
            { value: "chat", label: "Chat" },
            { value: "workagent", label: "Agent" },
            { value: "external", label: "External" },
          ]}
          onChange={(v) => updateFilter("type", v)}
        />
      </div>

      {/* Session list (virtualized) */}
      <div className="flex-1">
        {emptyState}
        {!emptyState && (
          <Virtuoso
            data={flatItems}
            itemContent={renderItem}
            className="h-full [scrollbar-gutter:stable]"
          />
        )}
      </div>
    </div>
  );
}
