import { type Component, Show, createSignal, onMount, onCleanup } from 'solid-js';
import { sendAction } from '@bridge/index';
import { SessionList } from './SessionList';
import type { Session } from '@services/types';

export interface SessionsPanelProps {
  isOpen: boolean;
  onClose?: () => void;
}

export const SessionsPanel: Component<SessionsPanelProps> = (props) => {
  const [sessions, setSessions] = createSignal<Session[]>([]);
  const [loading, setLoading] = createSignal(true);
  const [activeSessionId, setActiveSessionId] = createSignal<string | undefined>(undefined);

  const loadSessions = async () => {
    try {
      const list = await sendAction<Session[]>('session:list');
      setSessions(list || []);
    } catch (err) {
      console.error('Failed to load sessions:', err);
      setSessions([]);
    } finally {
      setLoading(false);
    }
  };

  let refreshInterval: ReturnType<typeof setInterval>;

  onMount(() => {
    loadSessions();
    refreshInterval = setInterval(loadSessions, 5000);
  });

  onCleanup(() => {
    clearInterval(refreshInterval);
  });

  const handleSelect = async (sessionId: string) => {
    try {
      await sendAction('session:resume', { sessionId });
      setActiveSessionId(sessionId);
      await loadSessions();
    } catch (err) {
      console.error('Failed to resume session:', err);
    }
  };

  const handleDelete = async (sessionId: string) => {
    if (!confirm('Delete this session?')) return;

    try {
      await sendAction('session:delete', { sessionId });
      await loadSessions();
    } catch (err) {
      console.error('Failed to delete session:', err);
    }
  };

  const handleFork = async (sessionId: string) => {
    try {
      await sendAction('session:fork', { sessionId });
      await loadSessions();
    } catch (err) {
      console.error('Failed to fork session:', err);
    }
  };

  const handleCreate = async () => {
    try {
      const result = await sendAction<{ sessionId: string }>('session:create');
      if (result?.sessionId) {
        setActiveSessionId(result.sessionId);
      }
      await loadSessions();
    } catch (err) {
      console.error('Failed to create session:', err);
    }
  };

  return (
    <Show when={props.isOpen}>
      <div class="w-80 border-l border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 flex flex-col">
        {/* Header */}
        <div class="flex items-center justify-between p-3 border-b border-gray-200 dark:border-gray-700">
          <h2 class="font-semibold text-gray-800 dark:text-gray-200">
            Sessions
          </h2>
          <button
            class="p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-800"
            onClick={props.onClose}
            title="Close"
          >
            ✕
          </button>
        </div>

        {/* Content */}
        <Show
          when={!loading()}
          fallback={
            <div class="flex-1 flex items-center justify-center text-gray-400">
              Loading...
            </div>
          }
        >
          <SessionList
            sessions={sessions()}
            activeSessionId={activeSessionId()}
            onSelect={handleSelect}
            onDelete={handleDelete}
            onFork={handleFork}
            onCreate={handleCreate}
          />
        </Show>
      </div>
    </Show>
  );
};
