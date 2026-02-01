/**
 * TodoPanel - Collapsible todo panel
 *
 * A side panel that shows todos and allows management.
 */

import { type Component, Show, createSignal, createMemo, onMount, onCleanup } from 'solid-js';
import type { TodoStatus } from '../../../services/types';
import { getTodoService } from '@services/todo';
import { TodoList } from './TodoList';

export interface TodoPanelProps {
  isOpen: boolean;
  onClose?: () => void;
}

export const TodoPanel: Component<TodoPanelProps> = (props) => {
  const [todos, setTodos] = createSignal(getTodoService().list());
  const [newTodoTitle, setNewTodoTitle] = createSignal('');

  // Refresh todos periodically
  let refreshInterval: ReturnType<typeof setInterval>;

  onMount(() => {
    refreshInterval = setInterval(() => {
      setTodos(getTodoService().list());
    }, 1000);
  });

  onCleanup(() => {
    clearInterval(refreshInterval);
  });

  const handleStatusChange = (todoId: string, status: TodoStatus) => {
    const service = getTodoService();
    switch (status) {
      case 'in_progress':
        service.start(todoId);
        break;
      case 'completed':
        service.complete(todoId);
        break;
      case 'cancelled':
        service.cancel(todoId);
        break;
      default:
        service.update(todoId, { status });
    }
    setTodos(service.list());
  };

  const handleDelete = (todoId: string) => {
    const service = getTodoService();
    service.delete(todoId);
    setTodos(service.list());
  };

  const handleAddTodo = (e: Event) => {
    e.preventDefault();
    const title = newTodoTitle().trim();
    if (!title) return;

    const service = getTodoService();
    service.create(title);
    setNewTodoTitle('');
    setTodos(service.list());
  };

  const pendingCount = createMemo(
    () =>
      todos().filter((t) => t.status === 'pending' || t.status === 'in_progress')
        .length
  );

  return (
    <Show when={props.isOpen}>
      <div class="w-80 border-l border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 flex flex-col">
        {/* Header */}
        <div class="flex items-center justify-between p-3 border-b border-gray-200 dark:border-gray-700">
          <h2 class="font-semibold text-gray-800 dark:text-gray-200">
            Todos
            <Show when={pendingCount() > 0}>
              <span class="ml-2 px-2 py-0.5 text-xs rounded-full bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300">
                {pendingCount()}
              </span>
            </Show>
          </h2>
          <button
            class="p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-800"
            onClick={props.onClose}
            title="Close"
          >
            ✕
          </button>
        </div>

        {/* Add todo form */}
        <form
          class="p-2 border-b border-gray-200 dark:border-gray-700"
          onSubmit={handleAddTodo}
        >
          <div class="flex gap-2">
            <input
              type="text"
              placeholder="Add a todo..."
              value={newTodoTitle()}
              onInput={(e) => setNewTodoTitle(e.currentTarget.value)}
              class="flex-1 px-3 py-1.5 text-sm border rounded bg-white dark:bg-gray-800 border-gray-300 dark:border-gray-600 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <button
              type="submit"
              class="px-3 py-1.5 text-sm font-medium rounded bg-blue-500 text-white hover:bg-blue-600 disabled:opacity-50"
              disabled={!newTodoTitle().trim()}
            >
              Add
            </button>
          </div>
        </form>

        {/* Todo list */}
        <TodoList
          todos={todos()}
          onStatusChange={handleStatusChange}
          onDelete={handleDelete}
        />
      </div>
    </Show>
  );
};
