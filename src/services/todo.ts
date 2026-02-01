/**
 * TodoService - Task tracking
 *
 * Provides:
 * - Todo CRUD operations
 * - Status transitions (pending -> in_progress -> completed)
 * - Filtering and search
 * - Persistence to disk
 */

import type { TodoService, Todo, TodoFilter, TodoStatus } from './types';

function generateTodoId(): string {
  return `todo_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

class TodoServiceImpl implements TodoService {
  private todos = new Map<string, Todo>();
  private dirty = false;

  create(title: string, description?: string): Todo {
    const now = Date.now();
    const todo: Todo = {
      id: generateTodoId(),
      title,
      description,
      status: 'pending',
      createdAt: now,
      updatedAt: now,
    };

    this.todos.set(todo.id, todo);
    this.dirty = true;
    return todo;
  }

  get(todoId: string): Todo | null {
    return this.todos.get(todoId) ?? null;
  }

  update(todoId: string, updates: Partial<Omit<Todo, 'id' | 'createdAt'>>): Todo | null {
    const todo = this.todos.get(todoId);
    if (!todo) return null;

    Object.assign(todo, updates, { updatedAt: Date.now() });
    this.dirty = true;
    return todo;
  }

  delete(todoId: string): boolean {
    const deleted = this.todos.delete(todoId);
    if (deleted) this.dirty = true;
    return deleted;
  }

  list(filter?: TodoFilter): Todo[] {
    let todos = Array.from(this.todos.values());

    if (filter?.status) {
      const statuses = Array.isArray(filter.status) ? filter.status : [filter.status];
      todos = todos.filter((t) => statuses.includes(t.status));
    }

    if (filter?.search) {
      const query = filter.search.toLowerCase();
      todos = todos.filter(
        (t) =>
          t.title.toLowerCase().includes(query) ||
          t.description?.toLowerCase().includes(query)
      );
    }

    return todos.sort((a, b) => {
      // Sort by priority (higher first), then by creation time (newer first)
      const priorityDiff = (b.priority ?? 0) - (a.priority ?? 0);
      if (priorityDiff !== 0) return priorityDiff;
      return b.createdAt - a.createdAt;
    });
  }

  complete(todoId: string): Todo | null {
    return this.updateStatus(todoId, 'completed');
  }

  start(todoId: string): Todo | null {
    return this.updateStatus(todoId, 'in_progress');
  }

  cancel(todoId: string): Todo | null {
    return this.updateStatus(todoId, 'cancelled');
  }

  private updateStatus(todoId: string, status: TodoStatus): Todo | null {
    const todo = this.todos.get(todoId);
    if (!todo) return null;

    todo.status = status;
    todo.updatedAt = Date.now();

    if (status === 'completed') {
      todo.completedAt = Date.now();
    }

    this.dirty = true;
    return todo;
  }

  getPending(): Todo[] {
    return this.list({ status: 'pending' });
  }

  async flush(): Promise<void> {
    if (!this.dirty) return;

    // TODO: Implement persistence to disk
    this.dirty = false;
  }

  dispose(): void {
    this.todos.clear();
    this.dirty = false;
  }
}

let _instance: TodoService | null = null;

export function getTodoService(): TodoService {
  return (_instance ??= new TodoServiceImpl());
}

export function resetTodoService(): void {
  if (_instance) {
    _instance.dispose();
    _instance = null;
  }
}
