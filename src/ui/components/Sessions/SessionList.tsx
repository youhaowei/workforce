/**
 * SessionList - Scrollable list of sessions with search, filtering, and grouping.
 *
 * Default: date-grouped (FEB 25, FEB 18, etc.) matching craft-agents-oss style.
 * Supports grouping by project or status with collapsible headers.
 */

import { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Search, Plus, X, ChevronDown, ChevronRight, FolderGit2, MessageSquare, SlidersHorizontal } from 'lucide-react';
import type { Project, SessionSummary } from '@/services/types';
import { SessionItem } from './SessionItem';
import { filterSessions, groupSessions } from './sessionListHelpers';
import type { GroupByMode, SessionGroup } from './sessionListHelpers';

export type { GroupByMode } from './sessionListHelpers';

/** Presentational empty state with icon, heading, and optional subtext / action. */
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

/** Returns the appropriate empty state, or null if there are results to show. */
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

/** Date group header — small, muted (e.g., "Feb 25"). */
function DateGroupHeader({ label }: { label: string }) {
  return (
    <div className="px-3 py-2 text-[11px] font-medium text-neutral-fg-subtle/60 tracking-wider select-none">
      {label}
    </div>
  );
}

/** Renders grouped session list with collapsible headers. */
function GroupedSessions({
  groups,
  groupBy,
  collapsedGroups,
  onToggleGroup,
  renderItems,
}: {
  groups: SessionGroup[];
  groupBy: GroupByMode;
  collapsedGroups: Set<string>;
  onToggleGroup: (key: string) => void;
  renderItems: (items: SessionSummary[]) => React.ReactNode;
}) {
  // Date groups use non-collapsible headers
  if (groupBy === 'date') {
    return groups.map((group) => (
      <div key={group.key}>
        <DateGroupHeader label={group.label} />
        {renderItems(group.sessions)}
      </div>
    ));
  }

  return groups.map((group) => {
    const isCollapsed = collapsedGroups.has(group.key);
    let groupIcon: React.ReactNode = null;
    if (group.color) {
      groupIcon = <div className="w-3 h-3 rounded-sm shrink-0" style={{ backgroundColor: group.color }} />;
    } else if (groupBy === 'project') {
      groupIcon = <FolderGit2 className="h-3 w-3 shrink-0" />;
    }
    return (
      <div key={group.key}>
        <button
          onClick={() => onToggleGroup(group.key)}
          aria-expanded={!isCollapsed}
          className="w-full flex items-center gap-2 px-3 py-2 text-xs font-medium text-neutral-fg-subtle hover:bg-neutral-bg-dim/50 transition-colors"
        >
          {isCollapsed ? (
            <ChevronRight className="h-3 w-3" />
          ) : (
            <ChevronDown className="h-3 w-3" />
          )}
          {groupIcon}
          <span className="truncate">{group.label}</span>
          <span className="ml-auto text-[10px]">{group.sessions.length}</span>
        </button>
        {!isCollapsed && renderItems(group.sessions)}
      </div>
    );
  });
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

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
  typeFilter = 'all',
  stateFilter = 'all',
  groupBy = 'date',
  projectMap,
  onSelect,
  onDelete,
  onCreate,
}: SessionListProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
  const searchInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedQuery(searchQuery);
    }, 300);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  const filteredSessions = useMemo(
    () => filterSessions(sessions, typeFilter, stateFilter, debouncedQuery),
    [debouncedQuery, sessions, typeFilter, stateFilter],
  );

  const groups = useMemo(
    () => groupSessions(filteredSessions, groupBy, projectMap),
    [groupBy, filteredSessions, projectMap],
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

  const renderSessionItems = useCallback(
    (items: SessionSummary[]) =>
      items.map((session) => (
        <SessionItem
          key={session.id}
          session={session}
          isActive={session.id === activeSessionId}
          onSelect={onSelect}
          onDelete={onDelete}
        />
      )),
    [activeSessionId, onSelect, onDelete],
  );

  return (
    <div className="flex flex-col h-full">
      {/* Search bar — compact, always visible */}
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

      {/* Session list */}
      <ScrollArea className="flex-1">
        {renderEmptyState(filteredSessions.length, sessions.length, debouncedQuery, onCreate)}

        {filteredSessions.length > 0 && groups && (
          <GroupedSessions
            groups={groups}
            groupBy={groupBy}
            collapsedGroups={collapsedGroups}
            onToggleGroup={toggleGroup}
            renderItems={renderSessionItems}
          />
        )}
        {filteredSessions.length > 0 && !groups && (
          /* Flat rendering */
          renderSessionItems(filteredSessions)
        )}
      </ScrollArea>
    </div>
  );
}
