/**
 * Pure helper functions for SessionList filtering and grouping.
 *
 * Extracted from SessionList.tsx to enable direct unit testing
 * without rendering the React component.
 */

import type { Project, SessionLifecycle, SessionSummary, SessionType } from '@/services/types';

export type GroupByMode = 'none' | 'date' | 'active' | 'project' | 'status';

export interface SessionGroup {
  key: string;
  label: string;
  color?: string;
  sessions: SessionSummary[];
}

/**
 * Smart-truncate titles that look like file paths.
 * Shows the last 2 path segments for scannability.
 */
export function smartTruncateTitle(title: string): string {
  if (!title.includes('/')) return title;
  const segments = title.split('/').filter(Boolean);
  if (segments.length <= 2) return title;
  return segments.slice(-2).join('/');
}

export function filterSessions(
  sessions: SessionSummary[],
  typeFilter: string,
  stateFilter: string,
  query: string,
): SessionSummary[] {
  let result = sessions;

  if (typeFilter !== 'all') {
    result = result.filter((s) => {
      const type = (s.metadata?.type as SessionType) ?? 'chat';
      return type === typeFilter;
    });
  }

  if (stateFilter !== 'all') {
    result = result.filter((s) => {
      const lifecycle = s.metadata?.lifecycle as SessionLifecycle | undefined;
      return lifecycle?.state === stateFilter;
    });
  }

  // Search filter (intentionally summary-only for UI responsiveness).
  const q = query.toLowerCase().trim();
  if (q) {
    result = result.filter((session) => {
      if (session.title?.toLowerCase().includes(q)) return true;
      const goal = session.metadata?.goal as string | undefined;
      if (goal?.toLowerCase().includes(q)) return true;
      const preview = session.lastMessagePreview?.toLowerCase();
      return Boolean(preview?.includes(q));
    });
  }

  return result;
}

/** Format a date as "MMM D" (e.g., "FEB 25") or "Today" / "Yesterday". */
function formatDateGroupLabel(date: Date): string {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const target = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const diffDays = Math.round((today.getTime() - target.getTime()) / 86400000);

  if (diffDays === 0) return 'TODAY';
  if (diffDays === 1) return 'YESTERDAY';

  const months = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
  return `${months[date.getMonth()]} ${date.getDate()}`;
}

/** Get a stable date key (YYYY-MM-DD) for grouping. */
function dateKey(timestamp: number): string {
  const d = new Date(timestamp);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export type SortDirection = 'asc' | 'desc';

function groupByTimestamp(sessions: SessionSummary[], field: 'createdAt' | 'updatedAt', dir: SortDirection): SessionGroup[] {
  const grouped = new Map<string, SessionSummary[]>();
  for (const session of sessions) {
    const ts = session[field];
    const key = dateKey(ts);
    const arr = grouped.get(key) ?? [];
    arr.push(session);
    grouped.set(key, arr);
  }
  const mul = dir === 'desc' ? -1 : 1;
  return [...grouped.entries()]
    .sort(([a], [b]) => mul * a.localeCompare(b))
    .map(([key, items]) => {
      const sorted = items.sort((a, b) => mul * (a[field] - b[field]));
      return {
        key,
        label: formatDateGroupLabel(new Date(sorted[0][field])),
        sessions: sorted,
      };
    });
}

export function groupSessions(
  filteredSessions: SessionSummary[],
  groupBy: GroupByMode,
  projectMap?: Map<string, Project>,
  sortDir: SortDirection = 'desc',
): SessionGroup[] | null {
  if (groupBy === 'none') {
    return null;
  }

  if (groupBy === 'date' || groupBy === 'active') {
    return groupByTimestamp(filteredSessions, groupBy === 'date' ? 'createdAt' : 'updatedAt', sortDir);
  }

  if (groupBy === 'project') {
    const grouped = new Map<string, SessionSummary[]>();
    for (const session of filteredSessions) {
      const projectId = (session.metadata?.projectId as string) ?? '__ungrouped__';
      const arr = grouped.get(projectId) ?? [];
      arr.push(session);
      grouped.set(projectId, arr);
    }
    const result: SessionGroup[] = [];
    for (const [key, groupSessions] of grouped) {
      if (key === '__ungrouped__') {
        result.push({ key, label: 'Ungrouped', sessions: groupSessions });
      } else {
        const project = projectMap?.get(key);
        result.push({
          key,
          label: project?.name ?? key,
          color: project?.color,
          sessions: groupSessions,
        });
      }
    }
    const mul = sortDir === 'desc' ? -1 : 1;
    return result.sort((a, b) => {
      if (a.key === '__ungrouped__') return 1;
      if (b.key === '__ungrouped__') return -1;
      return mul * a.label.localeCompare(b.label);
    });
  }

  // Group by status
  return groupByStatus(filteredSessions, sortDir);
}

function groupByStatus(sessions: SessionSummary[], dir: SortDirection): SessionGroup[] {
  const grouped = new Map<string, SessionSummary[]>();
  for (const session of sessions) {
    const lifecycle = session.metadata?.lifecycle as SessionLifecycle | undefined;
    const state = lifecycle?.state ?? 'created';
    const arr = grouped.get(state) ?? [];
    arr.push(session);
    grouped.set(state, arr);
  }
  const stateOrder = dir === 'desc'
    ? ['active', 'created', 'paused', 'completed', 'failed', 'cancelled']
    : ['cancelled', 'failed', 'completed', 'paused', 'created', 'active'];
  return stateOrder
    .filter((s) => grouped.has(s))
    .map((state) => ({
      key: state,
      label: state.charAt(0).toUpperCase() + state.slice(1),
      sessions: grouped.get(state)!,
    }));
}
