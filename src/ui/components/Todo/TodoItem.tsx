/**
 * TodoItem - Individual todo item display
 *
 * Shows todo with status indicator, title, and action buttons.
 */

import { type Component, Show, createMemo } from 'solid-js';
import type { Todo, TodoStatus } from '../../../services/types';

export interface TodoItemProps {
  todo: Todo;
  onStatusChange?: (todoId: string, status: TodoStatus) => void;
  onDelete?: (todoId: string) => void;
}

const STATUS_ICONS: Record<TodoStatus, string> = {
  pending: '○',
  in_progress: '◐',
  completed: '●',
  cancelled: '✕',
};

const STATUS_COLORS: Record<TodoStatus, string> = {
  pending: 'text-gray-400',
  in_progress: 'text-blue-500',
  completed: 'text-green-500',
  cancelled: 'text-red-400',
};

export const TodoItem: Component<TodoItemProps> = (props) => {
  const statusIcon = createMemo(() => STATUS_ICONS[props.todo.status]);
  const statusColor = createMemo(() => STATUS_COLORS[props.todo.status]);

  const timeAgo = createMemo(() => {
    const diff = Date.now() - props.todo.updatedAt;
    const minutes = Math.floor(diff / 60000);
    if (minutes < 1) return 'just now';
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
  });

  const canStart = () => props.todo.status === 'pending';
  const canComplete = () =>
    props.todo.status === 'pending' || props.todo.status === 'in_progress';
  const canCancel = () =>
    props.todo.status === 'pending' || props.todo.status === 'in_progress';

  const handleStart = () => {
    props.onStatusChange?.(props.todo.id, 'in_progress');
  };

  const handleComplete = () => {
    props.onStatusChange?.(props.todo.id, 'completed');
  };

  const handleCancel = () => {
    props.onStatusChange?.(props.todo.id, 'cancelled');
  };

  const handleDelete = () => {
    props.onDelete?.(props.todo.id);
  };

  return (
    <div
      class={`group flex items-start gap-2 p-2 rounded hover:bg-gray-100 dark:hover:bg-gray-800 ${
        props.todo.status === 'completed' || props.todo.status === 'cancelled'
          ? 'opacity-60'
          : ''
      }`}
    >
      {/* Status indicator */}
      <span class={`text-lg ${statusColor()}`} title={props.todo.status}>
        {statusIcon()}
      </span>

      {/* Content */}
      <div class="flex-1 min-w-0">
        <div
          class={`font-medium ${
            props.todo.status === 'completed' ? 'line-through' : ''
          }`}
        >
          {props.todo.title}
        </div>

        <Show when={props.todo.description}>
          <div class="text-sm text-gray-500 dark:text-gray-400 truncate">
            {props.todo.description}
          </div>
        </Show>

        <div class="text-xs text-gray-400 dark:text-gray-500 mt-1">
          {timeAgo()}
        </div>
      </div>

      {/* Actions - visible on hover */}
      <div class="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
        <Show when={canStart()}>
          <button
            class="px-2 py-1 text-xs rounded bg-blue-100 text-blue-700 hover:bg-blue-200 dark:bg-blue-900 dark:text-blue-300"
            onClick={handleStart}
            title="Start"
          >
            ▶
          </button>
        </Show>

        <Show when={canComplete()}>
          <button
            class="px-2 py-1 text-xs rounded bg-green-100 text-green-700 hover:bg-green-200 dark:bg-green-900 dark:text-green-300"
            onClick={handleComplete}
            title="Complete"
          >
            ✓
          </button>
        </Show>

        <Show when={canCancel()}>
          <button
            class="px-2 py-1 text-xs rounded bg-red-100 text-red-700 hover:bg-red-200 dark:bg-red-900 dark:text-red-300"
            onClick={handleCancel}
            title="Cancel"
          >
            ✕
          </button>
        </Show>

        <button
          class="px-2 py-1 text-xs rounded bg-gray-100 text-gray-700 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-300"
          onClick={handleDelete}
          title="Delete"
        >
          🗑
        </button>
      </div>
    </div>
  );
};
