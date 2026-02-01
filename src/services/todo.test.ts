/**
 * Todo Service Tests
 *
 * Tests for todo CRUD operations and status management.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { getTodoService, resetTodoService } from './todo';

describe('TodoService', () => {
  beforeEach(() => {
    resetTodoService();
  });

  afterEach(() => {
    resetTodoService();
  });

  describe('create', () => {
    it('should create a todo with generated ID', () => {
      const service = getTodoService();
      const todo = service.create('Test todo');

      expect(todo.id).toMatch(/^todo_/);
      expect(todo.title).toBe('Test todo');
      expect(todo.status).toBe('pending');
    });

    it('should create a todo with description', () => {
      const service = getTodoService();
      const todo = service.create('Task', 'Task description');

      expect(todo.title).toBe('Task');
      expect(todo.description).toBe('Task description');
    });

    it('should set timestamps', () => {
      const service = getTodoService();
      const before = Date.now();
      const todo = service.create('Task');
      const after = Date.now();

      expect(todo.createdAt).toBeGreaterThanOrEqual(before);
      expect(todo.createdAt).toBeLessThanOrEqual(after);
      expect(todo.updatedAt).toBe(todo.createdAt);
    });
  });

  describe('get', () => {
    it('should return todo by ID', () => {
      const service = getTodoService();
      const created = service.create('Test');
      const retrieved = service.get(created.id);

      expect(retrieved).not.toBeNull();
      expect(retrieved!.id).toBe(created.id);
      expect(retrieved!.title).toBe('Test');
    });

    it('should return null for non-existent todo', () => {
      const service = getTodoService();
      const retrieved = service.get('non-existent');

      expect(retrieved).toBeNull();
    });
  });

  describe('update', () => {
    it('should update todo fields', () => {
      const service = getTodoService();
      const todo = service.create('Original');
      const originalUpdatedAt = todo.updatedAt;

      // Wait a bit to ensure timestamp difference
      const updated = service.update(todo.id, { title: 'Modified' });

      expect(updated).not.toBeNull();
      expect(updated!.title).toBe('Modified');
      expect(updated!.updatedAt).toBeGreaterThanOrEqual(originalUpdatedAt);
    });

    it('should return null for non-existent todo', () => {
      const service = getTodoService();
      const updated = service.update('non-existent', { title: 'New' });

      expect(updated).toBeNull();
    });
  });

  describe('delete', () => {
    it('should delete todo', () => {
      const service = getTodoService();
      const todo = service.create('To delete');

      const deleted = service.delete(todo.id);

      expect(deleted).toBe(true);
      expect(service.get(todo.id)).toBeNull();
    });

    it('should return false for non-existent todo', () => {
      const service = getTodoService();
      const deleted = service.delete('non-existent');

      expect(deleted).toBe(false);
    });
  });

  describe('list', () => {
    it('should list all todos', () => {
      const service = getTodoService();
      service.create('Todo 1');
      service.create('Todo 2');
      service.create('Todo 3');

      const todos = service.list();

      expect(todos).toHaveLength(3);
    });

    it('should filter by status', () => {
      const service = getTodoService();
      const t1 = service.create('Pending');
      const t2 = service.create('In Progress');
      const t3 = service.create('Completed');

      service.start(t2.id);
      service.complete(t3.id);

      const pending = service.list({ status: 'pending' });
      const inProgress = service.list({ status: 'in_progress' });
      const completed = service.list({ status: 'completed' });

      expect(pending).toHaveLength(1);
      expect(pending[0].id).toBe(t1.id);

      expect(inProgress).toHaveLength(1);
      expect(inProgress[0].id).toBe(t2.id);

      expect(completed).toHaveLength(1);
      expect(completed[0].id).toBe(t3.id);
    });

    it('should filter by multiple statuses', () => {
      const service = getTodoService();
      const _t1 = service.create('Pending');
      const t2 = service.create('In Progress');
      const t3 = service.create('Completed');

      service.start(t2.id);
      service.complete(t3.id);

      const active = service.list({ status: ['pending', 'in_progress'] });

      expect(active).toHaveLength(2);
    });

    it('should filter by search query', () => {
      const service = getTodoService();
      service.create('Fix bug in auth');
      service.create('Update documentation');
      service.create('Auth refactor');

      const authTodos = service.list({ search: 'auth' });

      expect(authTodos).toHaveLength(2);
    });

    it('should sort by priority and creation time', () => {
      const service = getTodoService();
      const t1 = service.create('Low priority');
      const t2 = service.create('High priority');
      const t3 = service.create('Medium priority');

      service.update(t1.id, { priority: 1 });
      service.update(t2.id, { priority: 10 });
      service.update(t3.id, { priority: 5 });

      const todos = service.list();

      expect(todos[0].id).toBe(t2.id); // Highest priority first
      expect(todos[1].id).toBe(t3.id);
      expect(todos[2].id).toBe(t1.id);
    });
  });

  describe('status transitions', () => {
    it('start should set status to in_progress', () => {
      const service = getTodoService();
      const todo = service.create('Task');

      const started = service.start(todo.id);

      expect(started).not.toBeNull();
      expect(started!.status).toBe('in_progress');
    });

    it('complete should set status to completed', () => {
      const service = getTodoService();
      const todo = service.create('Task');

      const completed = service.complete(todo.id);

      expect(completed).not.toBeNull();
      expect(completed!.status).toBe('completed');
      expect(completed!.completedAt).toBeDefined();
    });

    it('cancel should set status to cancelled', () => {
      const service = getTodoService();
      const todo = service.create('Task');

      const cancelled = service.cancel(todo.id);

      expect(cancelled).not.toBeNull();
      expect(cancelled!.status).toBe('cancelled');
    });
  });

  describe('getPending', () => {
    it('should return only pending todos', () => {
      const service = getTodoService();
      service.create('Pending 1');
      service.create('Pending 2');
      const t3 = service.create('In Progress');

      service.start(t3.id);

      const pending = service.getPending();

      expect(pending).toHaveLength(2);
      expect(pending.every((t) => t.status === 'pending')).toBe(true);
    });
  });

  describe('dispose', () => {
    it('should clear all todos', () => {
      const service = getTodoService();
      service.create('Todo 1');
      service.create('Todo 2');

      service.dispose();

      expect(service.list()).toHaveLength(0);
    });
  });
});
