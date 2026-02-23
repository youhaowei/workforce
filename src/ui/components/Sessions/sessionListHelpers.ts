/**
 * Pure helper functions for SessionList filtering and grouping.
 *
 * Extracted from SessionList.tsx to enable direct unit testing
 * without rendering the React component.
 */

import type { Project, SessionLifecycle, SessionSummary, SessionType } from '@/services/types';

export type GroupByMode = 'none' | 'project' | 'status';

export interface SessionGroup {
  key: string;
  label: string;
  color?: string;
  sessions: SessionSummary[];
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

export function groupSessions(
  filteredSessions: SessionSummary[],
  groupBy: GroupByMode,
  projectMap?: Map<string, Project>,
): SessionGroup[] | null {
  if (groupBy === 'none') return null;

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
    return result.sort((a, b) => {
      if (a.key === '__ungrouped__') return 1;
      if (b.key === '__ungrouped__') return -1;
      return a.label.localeCompare(b.label);
    });
  }

  // Group by status
  const grouped = new Map<string, SessionSummary[]>();
  for (const session of filteredSessions) {
    const lifecycle = session.metadata?.lifecycle as SessionLifecycle | undefined;
    const state = lifecycle?.state ?? 'created';
    const arr = grouped.get(state) ?? [];
    arr.push(session);
    grouped.set(state, arr);
  }
  const stateOrder = ['active', 'created', 'paused', 'completed', 'failed', 'cancelled'];
  return stateOrder
    .filter((s) => grouped.has(s))
    .map((state) => ({
      key: state,
      label: state.charAt(0).toUpperCase() + state.slice(1),
      sessions: grouped.get(state)!,
    }));
}
