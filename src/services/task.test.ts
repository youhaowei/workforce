/**
 * TaskService Tests
 *
 * Tests for task CRUD, status management, and disk persistence.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdir, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { createTaskService } from './task';
import type { TaskService } from './types';

const TEST_DIR = join(tmpdir(), 'workforce-task-test-' + Date.now());

function freshService(): TaskService {
  return createTaskService(TEST_DIR);
}

describe('TaskService', () => {
  beforeAll(async () => {
    await mkdir(TEST_DIR, { recursive: true });
  });

  afterAll(async () => {
    await rm(TEST_DIR, { recursive: true, force: true });
  });

  describe('create', () => {
    it('should create a task with generated ID', async () => {
      const service = freshService();
      const task = await service.create('Test task');

      expect(task.id).toMatch(/^task_/);
      expect(task.title).toBe('Test task');
      expect(task.status).toBe('pending');

      service.dispose();
    });

    it('should create a task with description', async () => {
      const service = freshService();
      const task = await service.create('Task', 'Task description');

      expect(task.title).toBe('Task');
      expect(task.description).toBe('Task description');

      service.dispose();
    });

    it('should set timestamps', async () => {
      const service = freshService();
      const before = Date.now();
      const task = await service.create('Task');
      const after = Date.now();

      expect(task.createdAt).toBeGreaterThanOrEqual(before);
      expect(task.createdAt).toBeLessThanOrEqual(after);
      expect(task.updatedAt).toBe(task.createdAt);

      service.dispose();
    });
  });

  describe('get', () => {
    it('should return task by ID', async () => {
      const service = freshService();
      const created = await service.create('Test');
      const retrieved = await service.get(created.id);

      expect(retrieved).not.toBeNull();
      expect(retrieved!.id).toBe(created.id);
      expect(retrieved!.title).toBe('Test');

      service.dispose();
    });

    it('should return null for non-existent task', async () => {
      const service = freshService();
      const retrieved = await service.get('non-existent');

      expect(retrieved).toBeNull();

      service.dispose();
    });
  });

  describe('update', () => {
    it('should update task fields', async () => {
      const service = freshService();
      const task = await service.create('Original');
      const originalUpdatedAt = task.updatedAt;

      const updated = await service.update(task.id, { title: 'Modified' });

      expect(updated).not.toBeNull();
      expect(updated!.title).toBe('Modified');
      expect(updated!.updatedAt).toBeGreaterThanOrEqual(originalUpdatedAt);

      service.dispose();
    });

    it('should return null for non-existent task', async () => {
      const service = freshService();
      const updated = await service.update('non-existent', { title: 'New' });

      expect(updated).toBeNull();

      service.dispose();
    });
  });

  describe('delete', () => {
    it('should delete task', async () => {
      const service = freshService();
      const task = await service.create('To delete');

      const deleted = await service.delete(task.id);

      expect(deleted).toBe(true);
      expect(await service.get(task.id)).toBeNull();

      service.dispose();
    });

    it('should return false for non-existent task', async () => {
      const service = freshService();
      const deleted = await service.delete('non-existent');

      expect(deleted).toBe(false);

      service.dispose();
    });
  });

  describe('list', () => {
    it('should list all tasks', async () => {
      const dir = join(TEST_DIR, 'list-all');
      const service = createTaskService(dir);
      await service.create('Task 1');
      await service.create('Task 2');
      await service.create('Task 3');

      const tasks = await service.list();

      expect(tasks).toHaveLength(3);

      service.dispose();
    });

    it('should filter by status', async () => {
      const dir = join(TEST_DIR, 'list-filter');
      const service = createTaskService(dir);
      const t1 = await service.create('Pending');
      const t2 = await service.create('In Progress');
      const t3 = await service.create('Completed');

      await service.start(t2.id);
      await service.complete(t3.id);

      const pending = await service.list({ status: 'pending' });
      const inProgress = await service.list({ status: 'in_progress' });
      const completed = await service.list({ status: 'completed' });

      expect(pending).toHaveLength(1);
      expect(pending[0].id).toBe(t1.id);

      expect(inProgress).toHaveLength(1);
      expect(inProgress[0].id).toBe(t2.id);

      expect(completed).toHaveLength(1);
      expect(completed[0].id).toBe(t3.id);

      service.dispose();
    });

    it('should filter by multiple statuses', async () => {
      const dir = join(TEST_DIR, 'list-multi');
      const service = createTaskService(dir);
      await service.create('Pending');
      const t2 = await service.create('In Progress');
      const t3 = await service.create('Completed');

      await service.start(t2.id);
      await service.complete(t3.id);

      const active = await service.list({ status: ['pending', 'in_progress'] });

      expect(active).toHaveLength(2);

      service.dispose();
    });

    it('should filter by search query', async () => {
      const dir = join(TEST_DIR, 'list-search');
      const service = createTaskService(dir);
      await service.create('Fix bug in auth');
      await service.create('Update documentation');
      await service.create('Auth refactor');

      const authTasks = await service.list({ search: 'auth' });

      expect(authTasks).toHaveLength(2);

      service.dispose();
    });

    it('should sort by priority and creation time', async () => {
      const dir = join(TEST_DIR, 'list-sort');
      const service = createTaskService(dir);
      const t1 = await service.create('Low priority');
      const t2 = await service.create('High priority');
      const t3 = await service.create('Medium priority');

      await service.update(t1.id, { priority: 1 });
      await service.update(t2.id, { priority: 10 });
      await service.update(t3.id, { priority: 5 });

      const tasks = await service.list();

      expect(tasks[0].id).toBe(t2.id); // Highest priority first
      expect(tasks[1].id).toBe(t3.id);
      expect(tasks[2].id).toBe(t1.id);

      service.dispose();
    });
  });

  describe('status transitions', () => {
    it('start should set status to in_progress', async () => {
      const service = freshService();
      const task = await service.create('Task');

      const started = await service.start(task.id);

      expect(started).not.toBeNull();
      expect(started!.status).toBe('in_progress');

      service.dispose();
    });

    it('complete should set status to completed', async () => {
      const service = freshService();
      const task = await service.create('Task');

      const completed = await service.complete(task.id);

      expect(completed).not.toBeNull();
      expect(completed!.status).toBe('completed');
      expect(completed!.completedAt).toBeDefined();

      service.dispose();
    });

    it('cancel should set status to cancelled', async () => {
      const service = freshService();
      const task = await service.create('Task');

      const cancelled = await service.cancel(task.id);

      expect(cancelled).not.toBeNull();
      expect(cancelled!.status).toBe('cancelled');

      service.dispose();
    });
  });

  describe('getPending', () => {
    it('should return only pending tasks', async () => {
      const dir = join(TEST_DIR, 'pending');
      const service = createTaskService(dir);
      await service.create('Pending 1');
      await service.create('Pending 2');
      const t3 = await service.create('In Progress');

      await service.start(t3.id);

      const pending = await service.getPending();

      expect(pending).toHaveLength(2);
      expect(pending.every((t) => t.status === 'pending')).toBe(true);

      service.dispose();
    });
  });

  describe('persistence', () => {
    it('should persist tasks across service instances', async () => {
      const dir = join(TEST_DIR, 'persist');
      const service1 = createTaskService(dir);
      const task = await service1.create('Persisted task');
      await service1.start(task.id);
      service1.dispose();

      const service2 = createTaskService(dir);
      const tasks = await service2.list();
      expect(tasks).toHaveLength(1);
      expect(tasks[0].title).toBe('Persisted task');
      expect(tasks[0].status).toBe('in_progress');

      service2.dispose();
    });

    it('should persist deletes across service instances', async () => {
      const dir = join(TEST_DIR, 'persist-delete');
      const service1 = createTaskService(dir);
      const task = await service1.create('To delete');
      await service1.delete(task.id);
      service1.dispose();

      const service2 = createTaskService(dir);
      const tasks = await service2.list();
      expect(tasks).toHaveLength(0);

      service2.dispose();
    });

    it('should persist updates across service instances', async () => {
      const dir = join(TEST_DIR, 'persist-update');
      const service1 = createTaskService(dir);
      const task = await service1.create('Original');
      await service1.update(task.id, { title: 'Updated', priority: 5 });
      service1.dispose();

      const service2 = createTaskService(dir);
      const found = await service2.get(task.id);
      expect(found).not.toBeNull();
      expect(found!.title).toBe('Updated');
      expect(found!.priority).toBe(5);

      service2.dispose();
    });
  });

  describe('dispose', () => {
    it('should clear cache so next access reloads from disk', async () => {
      const dir = join(TEST_DIR, 'dispose');
      const service = createTaskService(dir);
      await service.create('Task 1');
      await service.create('Task 2');

      service.dispose();

      // After dispose + re-init, tasks reload from disk
      const tasks = await service.list();
      expect(tasks).toHaveLength(2);

      service.dispose();
    });
  });
});
