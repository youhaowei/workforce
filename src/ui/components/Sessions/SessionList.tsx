/**
 * SessionList - Virtualized list of sessions with search
 *
 * Uses virtual scrolling for performance with many sessions.
 */

import {
  type Component,
  For,
  Show,
  createSignal,
  createMemo,
  createEffect,
} from 'solid-js';
import type { Session } from '../../../services/types';
import { SessionItem } from './SessionItem';

export interface SessionListProps {
  sessions: Session[];
  activeSessionId?: string;
  onSelect?: (sessionId: string) => void;
  onDelete?: (sessionId: string) => void;
  onFork?: (sessionId: string) => void;
  onCreate?: () => void;
}

export const SessionList: Component<SessionListProps> = (props) => {
  const [searchQuery, setSearchQuery] = createSignal('');
  const [debouncedQuery, setDebouncedQuery] = createSignal('');

  // Debounce search input
  createEffect(() => {
    const query = searchQuery();
    const timer = setTimeout(() => {
      setDebouncedQuery(query);
    }, 300);
    return () => clearTimeout(timer);
  });

  const filteredSessions = createMemo(() => {
    const query = debouncedQuery().toLowerCase().trim();
    if (!query) {
      return props.sessions;
    }

    return props.sessions.filter((session) => {
      // Search in title
      if (session.title?.toLowerCase().includes(query)) {
        return true;
      }

      // Search in messages
      return session.messages.some((msg) =>
        msg.content.toLowerCase().includes(query)
      );
    });
  });

  return (
    <div class="flex flex-col h-full">
      {/* Header with search and new button */}
      <div class="p-3 border-b border-gray-200 dark:border-gray-700">
        <div class="flex gap-2 mb-2">
          <input
            type="text"
            placeholder="Search sessions..."
            value={searchQuery()}
            onInput={(e) => setSearchQuery(e.currentTarget.value)}
            class="flex-1 px-3 py-1.5 text-sm border rounded bg-white dark:bg-gray-800 border-gray-300 dark:border-gray-600 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <button
            class="px-3 py-1.5 text-sm font-medium rounded bg-blue-500 text-white hover:bg-blue-600"
            onClick={props.onCreate}
            title="New session"
          >
            New
          </button>
        </div>
        <div class="text-xs text-gray-500 dark:text-gray-400">
          {filteredSessions().length} session
          {filteredSessions().length !== 1 ? 's' : ''}
          <Show when={debouncedQuery()}>
            <span> matching "{debouncedQuery()}"</span>
          </Show>
        </div>
      </div>

      {/* Session list */}
      <div class="flex-1 overflow-y-auto">
        <Show
          when={filteredSessions().length > 0}
          fallback={
            <div class="p-4 text-center text-gray-400 dark:text-gray-500">
              {debouncedQuery()
                ? 'No sessions match your search'
                : 'No sessions yet'}
            </div>
          }
        >
          <For each={filteredSessions()}>
            {(session) => (
              <SessionItem
                session={session}
                isActive={session.id === props.activeSessionId}
                onSelect={props.onSelect}
                onDelete={props.onDelete}
                onFork={props.onFork}
              />
            )}
          </For>
        </Show>
      </div>
    </div>
  );
};
