/**
 * BackgroundService - Async task management
 *
 * Provides:
 * - Submit tasks to run in background
 * - Priority-based task scheduling
 * - Task status tracking and cancellation
 * - Wait for task completion
 */

import type {
  BackgroundService,
  BackgroundTask,
  BackgroundTaskOptions,
  TaskStatus,
} from './types';
import { getEventBus } from '@/shared/event-bus';

function generateTaskId(): string {
  return `task_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

interface InternalTask extends BackgroundTask {
  promise: Promise<unknown>;
  abortController: AbortController;
}

class BackgroundServiceImpl implements BackgroundService {
  private tasks = new Map<string, InternalTask>();

  submit<T>(fn: () => Promise<T>, options?: BackgroundTaskOptions): string {
    const id = generateTaskId();
    const abortController = new AbortController();
    const now = Date.now();

    const task: InternalTask = {
      id,
      name: options?.name ?? `Task ${id}`,
      status: 'pending',
      priority: options?.priority ?? 'normal',
      createdAt: now,
      promise: Promise.resolve(),
      abortController,
    };

    this.tasks.set(id, task);
    this.emitTaskUpdate(task);

    task.promise = this.runTask(task, fn);

    return id;
  }

  private async runTask<T>(task: InternalTask, fn: () => Promise<T>): Promise<T> {
    task.status = 'running';
    task.startedAt = Date.now();
    this.emitTaskUpdate(task);

    try {
      const result = await fn();
      task.status = 'completed';
      task.result = result;
      task.completedAt = Date.now();
      this.emitTaskUpdate(task);
      return result;
    } catch (err) {
      task.status = 'failed';
      task.error = err instanceof Error ? err.message : String(err);
      task.completedAt = Date.now();
      this.emitTaskUpdate(task);
      throw err;
    }
  }

  private emitTaskUpdate(task: BackgroundTask): void {
    getEventBus().emit({
      type: 'TaskUpdate',
      taskId: task.id,
      status: task.status,
      progress: task.progress,
      message: task.name,
      timestamp: Date.now(),
    });
  }

  getTask(taskId: string): BackgroundTask | null {
    const task = this.tasks.get(taskId);
    if (!task) return null;

    // Return a copy without internal fields
    const { promise: _, abortController: __, ...publicTask } = task;
    return publicTask;
  }

  cancel(taskId: string): boolean {
    const task = this.tasks.get(taskId);
    if (!task || task.status !== 'running') {
      return false;
    }

    task.abortController.abort();
    task.status = 'cancelled';
    task.completedAt = Date.now();
    this.emitTaskUpdate(task);
    return true;
  }

  list(filter?: { status?: TaskStatus }): BackgroundTask[] {
    let tasks = Array.from(this.tasks.values());

    if (filter?.status) {
      tasks = tasks.filter((t) => t.status === filter.status);
    }

    return tasks.map(({ promise: _, abortController: __, ...t }) => t);
  }

  async waitFor<T>(taskId: string): Promise<T> {
    const task = this.tasks.get(taskId);
    if (!task) {
      throw new Error(`Task not found: ${taskId}`);
    }

    await task.promise;
    return task.result as T;
  }

  runningCount(): number {
    return Array.from(this.tasks.values()).filter((t) => t.status === 'running').length;
  }

  dispose(): void {
    for (const task of this.tasks.values()) {
      if (task.status === 'running') {
        task.abortController.abort();
      }
    }
    this.tasks.clear();
  }
}

let _instance: BackgroundService | null = null;

export function getBackgroundService(): BackgroundService {
  return (_instance ??= new BackgroundServiceImpl());
}

export function resetBackgroundService(): void {
  if (_instance) {
    _instance.dispose();
    _instance = null;
  }
}
