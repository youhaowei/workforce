/**
 * WorkspaceService - Workspace management and persistence
 *
 * Provides:
 * - Workspace CRUD with disk persistence
 * - Current workspace tracking
 * - Settings management (allowed tools, cost caps)
 *
 * Persistence: ~/.workforce/workspaces/{id}/workspace.json
 */

import { readFile, writeFile, readdir, mkdir, rm } from 'fs/promises';
import { join } from 'path';
import type { Workspace, WorkspaceSettings, WorkspaceService } from './types';
import { getEventBus } from '@/shared/event-bus';
import { getDataDir } from './data-dir';

// =============================================================================
// Configuration
// =============================================================================

const WORKSPACES_DIR = join(getDataDir(), 'workspaces');

// =============================================================================
// Helpers
// =============================================================================

function generateId(): string {
  return `ws_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function defaultSettings(): WorkspaceSettings {
  return {
    allowedTools: [],
  };
}

// =============================================================================
// Service Implementation
// =============================================================================

class WorkspaceServiceImpl implements WorkspaceService {
  private workspaces = new Map<string, Workspace>();
  private currentWorkspace: Workspace | null = null;
  private workspacesDir: string;
  private initialized = false;

  constructor(workspacesDir?: string) {
    this.workspacesDir = workspacesDir ?? WORKSPACES_DIR;
  }

  private async ensureInitialized(): Promise<void> {
    if (this.initialized) return;

    try {
      await mkdir(this.workspacesDir, { recursive: true });

      const entries = await readdir(this.workspacesDir, { withFileTypes: true });
      const dirs = entries.filter((e) => e.isDirectory());

      for (const dir of dirs) {
        const filePath = join(this.workspacesDir, dir.name, 'workspace.json');
        try {
          const raw = await readFile(filePath, 'utf-8');
          const workspace = JSON.parse(raw) as Workspace;
          this.workspaces.set(workspace.id, workspace);
        } catch {
          // Skip unreadable workspace files
        }
      }
    } catch (err) {
      const error = err as NodeJS.ErrnoException;
      if (error.code !== 'ENOENT') {
        console.error('Failed to initialize workspaces:', error);
      }
    }

    this.initialized = true;
  }

  private async saveWorkspace(workspace: Workspace): Promise<void> {
    const dir = join(this.workspacesDir, workspace.id);
    await mkdir(dir, { recursive: true });
    const filePath = join(dir, 'workspace.json');
    await writeFile(filePath, JSON.stringify(workspace, null, 2), 'utf-8');
  }

  async create(name: string, rootPath: string): Promise<Workspace> {
    await this.ensureInitialized();

    const now = Date.now();
    const workspace: Workspace = {
      id: generateId(),
      name,
      rootPath,
      createdAt: now,
      updatedAt: now,
      settings: defaultSettings(),
    };

    this.workspaces.set(workspace.id, workspace);
    await this.saveWorkspace(workspace);

    getEventBus().emit({
      type: 'WorkspaceChange',
      workspaceId: workspace.id,
      action: 'created',
      timestamp: now,
    });

    return workspace;
  }

  async get(id: string): Promise<Workspace | null> {
    await this.ensureInitialized();
    return this.workspaces.get(id) ?? null;
  }

  async update(
    id: string,
    updates: Partial<Omit<Workspace, 'id' | 'createdAt'>>
  ): Promise<Workspace> {
    await this.ensureInitialized();

    const workspace = this.workspaces.get(id);
    if (!workspace) {
      throw new Error(`Workspace not found: ${id}`);
    }

    const updated: Workspace = {
      ...workspace,
      ...updates,
      id: workspace.id,
      createdAt: workspace.createdAt,
      updatedAt: Date.now(),
    };

    this.workspaces.set(id, updated);
    await this.saveWorkspace(updated);

    getEventBus().emit({
      type: 'WorkspaceChange',
      workspaceId: id,
      action: 'updated',
      timestamp: updated.updatedAt,
    });

    return updated;
  }

  async list(): Promise<Workspace[]> {
    await this.ensureInitialized();
    return Array.from(this.workspaces.values()).sort(
      (a, b) => b.updatedAt - a.updatedAt
    );
  }

  async delete(id: string): Promise<void> {
    await this.ensureInitialized();

    const workspace = this.workspaces.get(id);
    if (!workspace) return;

    this.workspaces.delete(id);

    if (this.currentWorkspace?.id === id) {
      this.currentWorkspace = null;
    }

    try {
      await rm(join(this.workspacesDir, id), { recursive: true, force: true });
    } catch {
      // Ignore file deletion errors
    }

    getEventBus().emit({
      type: 'WorkspaceChange',
      workspaceId: id,
      action: 'deleted',
      timestamp: Date.now(),
    });
  }

  getCurrent(): Workspace | null {
    return this.currentWorkspace;
  }

  setCurrent(workspace: Workspace | null): void {
    this.currentWorkspace = workspace;

    if (workspace) {
      getEventBus().emit({
        type: 'WorkspaceChange',
        workspaceId: workspace.id,
        action: 'switched',
        timestamp: Date.now(),
      });
    }
  }

  dispose(): void {
    this.workspaces.clear();
    this.currentWorkspace = null;
    this.initialized = false;
  }
}

// =============================================================================
// Singleton Management
// =============================================================================

let _instance: WorkspaceServiceImpl | null = null;

export function getWorkspaceService(): WorkspaceService {
  return (_instance ??= new WorkspaceServiceImpl());
}

export function resetWorkspaceService(): void {
  if (_instance) {
    _instance.dispose();
    _instance = null;
  }
}

/**
 * Create a workspace service with a custom directory.
 * Useful for testing.
 */
export function createWorkspaceService(workspacesDir: string): WorkspaceService {
  return new WorkspaceServiceImpl(workspacesDir);
}
