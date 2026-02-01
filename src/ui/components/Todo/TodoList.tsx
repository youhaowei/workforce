/**
 * TodoList - Filtered list of todos
 *
 * Displays todos grouped by status with filter tabs.
 */

import { type Component, For, Show, createSignal, createMemo } from 'solid-js';
import type { Todo, TodoStatus } from '../../../services/types';
import { TodoItem } from './TodoItem';

export interface TodoListProps {
  todos: Todo[];
  onStatusChange?: (todoId: string, status: TodoStatus) => void;
  onDelete?: (todoId: string) => void;
}

type FilterTab = 'all' | 'active' | 'completed';

export const TodoList: Component<TodoListProps> = (props) => {
  const [activeTab, setActiveTab] = createSignal<FilterTab>('active');

  const filteredTodos = createMemo(() => {
    const tab = activeTab();
    switch (tab) {
      case 'active':
        return props.todos.filter(
          (t) => t.status === 'pending' || t.status === 'in_progress'
        );
      case 'completed':
        return props.todos.filter(
          (t) => t.status === 'completed' || t.status === 'cancelled'
        );
      default:
        return props.todos;
    }
  });

  const counts = createMemo(() => ({
    all: props.todos.length,
    active: props.todos.filter(
      (t) => t.status === 'pending' || t.status === 'in_progress'
    ).length,
    completed: props.todos.filter(
      (t) => t.status === 'completed' || t.status === 'cancelled'
    ).length,
  }));

  const tabs: { key: FilterTab; label: string }[] = [
    { key: 'active', label: 'Active' },
    { key: 'completed', label: 'Done' },
    { key: 'all', label: 'All' },
  ];

  return (
    <div class="flex flex-col h-full">
      {/* Filter tabs */}
      <div class="flex border-b border-gray-200 dark:border-gray-700">
        <For each={tabs}>
          {(tab) => (
            <button
              class={`px-3 py-2 text-sm font-medium ${
                activeTab() === tab.key
                  ? 'border-b-2 border-blue-500 text-blue-600 dark:text-blue-400'
                  : 'text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-300'
              }`}
              onClick={() => setActiveTab(tab.key)}
            >
              {tab.label}
              <span class="ml-1 text-xs opacity-60">({counts()[tab.key]})</span>
            </button>
          )}
        </For>
      </div>

      {/* Todo items */}
      <div class="flex-1 overflow-y-auto">
        <Show
          when={filteredTodos().length > 0}
          fallback={
            <div class="p-4 text-center text-gray-400 dark:text-gray-500">
              {activeTab() === 'active'
                ? 'No active todos'
                : activeTab() === 'completed'
                  ? 'No completed todos'
                  : 'No todos yet'}
            </div>
          }
        >
          <div class="divide-y divide-gray-100 dark:divide-gray-800">
            <For each={filteredTodos()}>
              {(todo) => (
                <TodoItem
                  todo={todo}
                  onStatusChange={props.onStatusChange}
                  onDelete={props.onDelete}
                />
              )}
            </For>
          </div>
        </Show>
      </div>
    </div>
  );
};
