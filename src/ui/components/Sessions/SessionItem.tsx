/**
 * SessionItem - Individual session display
 *
 * Shows session title, preview, and timestamp.
 */

import { type Component, Show, createMemo } from 'solid-js';
import type { Session } from '../../../services/types';

export interface SessionItemProps {
  session: Session;
  isActive?: boolean;
  onSelect?: (sessionId: string) => void;
  onDelete?: (sessionId: string) => void;
  onFork?: (sessionId: string) => void;
}

export const SessionItem: Component<SessionItemProps> = (props) => {
  const timeAgo = createMemo(() => {
    const diff = Date.now() - props.session.updatedAt;
    const minutes = Math.floor(diff / 60000);
    if (minutes < 1) return 'just now';
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
  });

  const messageCount = createMemo(() => props.session.messages.length);

  const preview = createMemo(() => {
    const lastMessage = props.session.messages[props.session.messages.length - 1];
    if (!lastMessage) return 'No messages';
    const content = lastMessage.content;
    return content.length > 100 ? content.slice(0, 100) + '...' : content;
  });

  const handleSelect = () => {
    props.onSelect?.(props.session.id);
  };

  const handleDelete = (e: Event) => {
    e.stopPropagation();
    props.onDelete?.(props.session.id);
  };

  const handleFork = (e: Event) => {
    e.stopPropagation();
    props.onFork?.(props.session.id);
  };

  return (
    <div
      class={`group p-3 cursor-pointer border-b border-gray-100 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-800 ${
        props.isActive
          ? 'bg-blue-50 dark:bg-blue-900/30 border-l-2 border-l-blue-500'
          : ''
      }`}
      onClick={handleSelect}
    >
      {/* Header */}
      <div class="flex items-center justify-between mb-1">
        <h3
          class={`font-medium truncate ${
            props.isActive ? 'text-blue-700 dark:text-blue-300' : ''
          }`}
        >
          {props.session.title || 'Untitled Session'}
        </h3>
        <span class="text-xs text-gray-400 dark:text-gray-500 flex-shrink-0 ml-2">
          {timeAgo()}
        </span>
      </div>

      {/* Preview */}
      <p class="text-sm text-gray-500 dark:text-gray-400 line-clamp-2 mb-2">
        {preview()}
      </p>

      {/* Footer */}
      <div class="flex items-center justify-between">
        <div class="flex items-center gap-2 text-xs text-gray-400 dark:text-gray-500">
          <span>{messageCount()} messages</span>
          <Show when={props.session.parentId}>
            <span class="text-purple-500">forked</span>
          </Show>
        </div>

        {/* Actions - visible on hover */}
        <div class="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          <button
            class="px-2 py-0.5 text-xs rounded bg-gray-100 text-gray-600 hover:bg-gray-200 dark:bg-gray-700 dark:text-gray-300"
            onClick={handleFork}
            title="Fork session"
          >
            Fork
          </button>
          <button
            class="px-2 py-0.5 text-xs rounded bg-red-100 text-red-600 hover:bg-red-200 dark:bg-red-900/30 dark:text-red-400"
            onClick={handleDelete}
            title="Delete session"
          >
            Delete
          </button>
        </div>
      </div>
    </div>
  );
};
