/**
 * TaskService - Task tracking with disk persistence
 *
 * Provides:
 * - Task CRUD operations
 * - Status transitions (pending -> in_progress -> completed)
 * - Filtering and search
 * - Write-through persistence to ~/.workforce/tasks/{id}.json
 */

import { readFile, writeFile, readdir, mkdir, rm } from "fs/promises";
import { join } from "path";
import type { TaskService, Task, TaskFilter, TaskStatus } from "./types";
import { getDataDir } from "./data-dir";

// =============================================================================
// Configuration
// =============================================================================

const DEFAULT_TASKS_DIR = join(getDataDir(), "tasks");

// =============================================================================
// Helpers
// =============================================================================

function generateTaskId(): string {
  return `task_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

// =============================================================================
// Service Implementation
// =============================================================================

class TaskServiceImpl implements TaskService {
  private cache = new Map<string, Task>();
  private tasksDir: string;
  private initialized = false;

  constructor(tasksDir?: string) {
    this.tasksDir = tasksDir ?? DEFAULT_TASKS_DIR;
  }

  private taskPath(id: string): string {
    return join(this.tasksDir, `${id}.json`);
  }

  private async ensureInitialized(): Promise<void> {
    if (this.initialized) return;
    this.initialized = true;

    try {
      await mkdir(this.tasksDir, { recursive: true });
      const files = await readdir(this.tasksDir);

      for (const file of files) {
        if (!file.endsWith(".json")) continue;
        try {
          const raw = await readFile(join(this.tasksDir, file), "utf-8");
          const task = JSON.parse(raw) as Task;
          this.cache.set(task.id, task);
        } catch {
          // Skip corrupted files
        }
      }
    } catch {
      // Directory doesn't exist yet — that's fine
    }
  }

  private async persist(task: Task): Promise<void> {
    await mkdir(this.tasksDir, { recursive: true });
    await writeFile(this.taskPath(task.id), JSON.stringify(task, null, 2), "utf-8");
  }

  async create(title: string, description?: string): Promise<Task> {
    await this.ensureInitialized();
    const now = Date.now();
    const task: Task = {
      id: generateTaskId(),
      title,
      description,
      status: "pending",
      createdAt: now,
      updatedAt: now,
    };

    this.cache.set(task.id, task);
    await this.persist(task);
    return task;
  }

  async get(taskId: string): Promise<Task | null> {
    await this.ensureInitialized();
    return this.cache.get(taskId) ?? null;
  }

  async update(
    taskId: string,
    updates: Partial<Omit<Task, "id" | "createdAt">>,
  ): Promise<Task | null> {
    await this.ensureInitialized();
    const task = this.cache.get(taskId);
    if (!task) return null;

    Object.assign(task, updates, { updatedAt: Date.now() });
    await this.persist(task);
    return task;
  }

  async delete(taskId: string): Promise<boolean> {
    await this.ensureInitialized();
    const existed = this.cache.delete(taskId);
    if (existed) {
      try {
        await rm(this.taskPath(taskId));
      } catch {
        // File may not exist — that's fine
      }
    }
    return existed;
  }

  async list(filter?: TaskFilter): Promise<Task[]> {
    await this.ensureInitialized();
    let tasks = Array.from(this.cache.values());

    if (filter?.status) {
      const statuses = Array.isArray(filter.status) ? filter.status : [filter.status];
      tasks = tasks.filter((t) => statuses.includes(t.status));
    }

    if (filter?.search) {
      const query = filter.search.toLowerCase();
      tasks = tasks.filter(
        (t) =>
          t.title.toLowerCase().includes(query) || t.description?.toLowerCase().includes(query),
      );
    }

    return tasks.sort((a, b) => {
      // Sort by priority (higher first), then by creation time (newer first)
      const priorityDiff = (b.priority ?? 0) - (a.priority ?? 0);
      if (priorityDiff !== 0) return priorityDiff;
      return b.createdAt - a.createdAt;
    });
  }

  async complete(taskId: string): Promise<Task | null> {
    return this.updateStatus(taskId, "completed");
  }

  async start(taskId: string): Promise<Task | null> {
    return this.updateStatus(taskId, "in_progress");
  }

  async cancel(taskId: string): Promise<Task | null> {
    return this.updateStatus(taskId, "cancelled");
  }

  private async updateStatus(taskId: string, status: TaskStatus): Promise<Task | null> {
    await this.ensureInitialized();
    const task = this.cache.get(taskId);
    if (!task) return null;

    task.status = status;
    task.updatedAt = Date.now();

    if (status === "completed") {
      task.completedAt = Date.now();
    }

    await this.persist(task);
    return task;
  }

  async getPending(): Promise<Task[]> {
    return this.list({ status: "pending" });
  }

  async flush(): Promise<void> {
    // Write-through: all mutations persist immediately, nothing to flush
  }

  dispose(): void {
    this.cache.clear();
    this.initialized = false;
  }
}

// =============================================================================
// Singleton
// =============================================================================

let _instance: TaskService | null = null;

export function getTaskService(): TaskService {
  return (_instance ??= new TaskServiceImpl());
}

export function resetTaskService(): void {
  if (_instance) {
    _instance.dispose();
    _instance = null;
  }
}

/**
 * Create a task service with a custom tasks directory.
 * Useful for testing.
 */
export function createTaskService(tasksDir: string): TaskService {
  return new TaskServiceImpl(tasksDir);
}
