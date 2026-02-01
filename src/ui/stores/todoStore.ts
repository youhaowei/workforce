/**
 * Todo Store - Reactive todo state management
 *
 * Provides SolidJS reactive state for todos.
 */

import { createStore } from 'solid-js/store';
import type { Todo, TodoStatus } from '../../services/types';
import { getTodoService } from '../../services/todo';

export interface TodoState {
  todos: Todo[];
  loading: boolean;
}

export function createTodoStore() {
  const [state, setState] = createStore<TodoState>({
    todos: [],
    loading: false,
  });

  const service = getTodoService();

  // Initial load
  const refresh = () => {
    setState('todos', service.list());
  };

  // Actions
  const create = (title: string, description?: string) => {
    service.create(title, description);
    refresh();
  };

  const updateStatus = (todoId: string, status: TodoStatus) => {
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
    refresh();
  };

  const deleteTodo = (todoId: string) => {
    service.delete(todoId);
    refresh();
  };

  const update = (todoId: string, updates: Partial<Todo>) => {
    service.update(todoId, updates);
    refresh();
  };

  // Initialize
  refresh();

  return {
    state,
    refresh,
    create,
    updateStatus,
    deleteTodo,
    update,
  };
}

// Singleton store
let _store: ReturnType<typeof createTodoStore> | null = null;

export function getTodoStore() {
  return (_store ??= createTodoStore());
}

export function resetTodoStore() {
  _store = null;
}
