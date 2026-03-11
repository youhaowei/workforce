import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { getBackgroundService, resetBackgroundService } from './background';
import { getEventBus } from '@/shared/event-bus';

describe('BackgroundService', () => {
  beforeEach(() => resetBackgroundService());
  afterEach(() => {
    resetBackgroundService();
    getEventBus().dispose();
  });

  describe('submit', () => {
    it('returns a task ID', () => {
      const svc = getBackgroundService();
      const id = svc.submit(async () => 'done');
      expect(id).toMatch(/^task_/);
    });

    it('task transitions pending → running → completed', async () => {
      const svc = getBackgroundService();
      const statuses: string[] = [];
      const bus = getEventBus();
      bus.on('TaskUpdate', (e) => statuses.push(e.status));

      const id = svc.submit(async () => 'result');

      // Let microtask complete
      await svc.waitFor(id);

      expect(statuses).toEqual(['pending', 'running', 'completed']);
      const task = svc.getTask(id)!;
      expect(task.status).toBe('completed');
      expect(task.result).toBe('result');
      expect(task.createdAt).toBeDefined();
      expect(task.startedAt).toBeDefined();
      expect(task.completedAt).toBeDefined();
    });

    it('task transitions to failed on error', async () => {
      const svc = getBackgroundService();
      const id = svc.submit(async () => { throw new Error('boom'); });

      await expect(svc.waitFor(id)).rejects.toThrow('boom');

      const task = svc.getTask(id)!;
      expect(task.status).toBe('failed');
      expect(task.error).toBe('boom');
      expect(task.completedAt).toBeDefined();
    });

    it('uses custom name and priority', () => {
      const svc = getBackgroundService();
      const id = svc.submit(async () => null, { name: 'My Task', priority: 'high' });
      const task = svc.getTask(id)!;
      expect(task.name).toBe('My Task');
      expect(task.priority).toBe('high');
    });
  });

  describe('getTask', () => {
    it('returns null for unknown ID', () => {
      const svc = getBackgroundService();
      expect(svc.getTask('missing')).toBeNull();
    });

    it('returns a copy without internal fields', () => {
      const svc = getBackgroundService();
      const id = svc.submit(async () => null);
      const task = svc.getTask(id)!;
      expect(task).not.toHaveProperty('promise');
      expect(task).not.toHaveProperty('abortController');
    });
  });

  describe('cancel', () => {
    it('cancels a running task', async () => {
      const svc = getBackgroundService();
      let resolve!: () => void;
      const id = svc.submit(async () => new Promise<void>((r) => { resolve = r; }));

      // Wait for task to start running
      await new Promise((r) => setTimeout(r, 0));

      const cancelled = svc.cancel(id);
      expect(cancelled).toBe(true);
      expect(svc.getTask(id)!.status).toBe('cancelled');

      // Cleanup: resolve the promise so the test doesn't hang
      resolve();
    });

    it('returns false for non-running task', async () => {
      const svc = getBackgroundService();
      const id = svc.submit(async () => 'done');
      await svc.waitFor(id);
      expect(svc.cancel(id)).toBe(false);
    });

    it('returns false for unknown task', () => {
      const svc = getBackgroundService();
      expect(svc.cancel('missing')).toBe(false);
    });
  });

  describe('list', () => {
    it('lists all tasks', async () => {
      const svc = getBackgroundService();
      svc.submit(async () => 'a');
      svc.submit(async () => 'b');
      const tasks = svc.list();
      expect(tasks).toHaveLength(2);
      // No internal fields
      expect(tasks[0]).not.toHaveProperty('promise');
    });

    it('filters by status', async () => {
      const svc = getBackgroundService();
      const id = svc.submit(async () => 'a');
      await svc.waitFor(id);
      svc.submit(async () => new Promise(() => {}) /* cleaned up by dispose() in afterEach */); // never resolves

      await new Promise((r) => setTimeout(r, 0));

      const completed = svc.list({ status: 'completed' });
      expect(completed).toHaveLength(1);
      const running = svc.list({ status: 'running' });
      expect(running).toHaveLength(1);
    });
  });

  describe('waitFor', () => {
    it('resolves with task result', async () => {
      const svc = getBackgroundService();
      const id = svc.submit(async () => 42);
      const result = await svc.waitFor<number>(id);
      expect(result).toBe(42);
    });

    it('throws for unknown task', async () => {
      const svc = getBackgroundService();
      await expect(svc.waitFor('missing')).rejects.toThrow('Task not found: missing');
    });
  });

  describe('runningCount', () => {
    it('counts running tasks', async () => {
      const svc = getBackgroundService();
      const id = svc.submit(async () => 'done');
      await svc.waitFor(id);
      svc.submit(async () => new Promise(() => {}) /* cleaned up by dispose() in afterEach */); // stays running

      await new Promise((r) => setTimeout(r, 0));

      expect(svc.runningCount()).toBe(1);
    });
  });

  describe('dispose', () => {
    it('aborts running tasks and clears', () => {
      const svc = getBackgroundService();
      svc.submit(async () => new Promise(() => {}) /* cleaned up by dispose() in afterEach */);
      svc.dispose();
      expect(svc.list()).toEqual([]);
    });
  });

  describe('singleton', () => {
    it('getBackgroundService returns same instance', () => {
      expect(getBackgroundService()).toBe(getBackgroundService());
    });

    it('resetBackgroundService clears and recreates', () => {
      const svc = getBackgroundService();
      svc.submit(async () => null);
      resetBackgroundService();
      expect(getBackgroundService().list()).toEqual([]);
    });
  });
});
