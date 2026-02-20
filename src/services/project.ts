/**
 * ProjectService - Project management and persistence
 *
 * Provides:
 * - Project CRUD with disk persistence
 * - Auto-generated avatar colors from name hash
 *
 * Persistence: ~/.workforce/projects/{id}/project.json
 */

import { readFile, writeFile, readdir, mkdir, rm } from 'fs/promises';
import { join } from 'path';
import { ProjectNotFound } from './types';
import type { Project, ProjectService, Result } from './types';
import { getEventBus } from '@/shared/event-bus';
import { getDataDir } from './data-dir';
import { colorFromName } from '@/shared/palette';

// =============================================================================
// Configuration
// =============================================================================

const PROJECTS_DIR = join(getDataDir(), 'projects');

// =============================================================================
// Helpers
// =============================================================================

function generateId(): string {
  return `proj_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

// =============================================================================
// Service Implementation
// =============================================================================

class ProjectServiceImpl implements ProjectService {
  private projects = new Map<string, Project>();
  private projectsDir: string;
  private initialized = false;
  private initPromise: Promise<void> | null = null;

  constructor(projectsDir?: string) {
    this.projectsDir = projectsDir ?? PROJECTS_DIR;
  }

  private ensureInitialized(): Promise<void> {
    if (this.initialized) return Promise.resolve();
    return (this.initPromise ??= this.doInit());
  }

  private async doInit(): Promise<void> {
    try {
      await mkdir(this.projectsDir, { recursive: true });

      const entries = await readdir(this.projectsDir, { withFileTypes: true });
      const dirs = entries.filter((e) => e.isDirectory());

      for (const dir of dirs) {
        const filePath = join(this.projectsDir, dir.name, 'project.json');
        try {
          const raw = await readFile(filePath, 'utf-8');
          const project = JSON.parse(raw) as Project;
          this.projects.set(project.id, project);
        } catch (err) {
          console.warn(`Skipping unreadable project file ${filePath}:`, err);
        }
      }
    } catch (err) {
      const error = err as NodeJS.ErrnoException;
      if (error.code !== 'ENOENT') {
        // Log and continue — service starts with an empty map.
        // The user will see "No projects" until the underlying issue is resolved.
        console.error('Failed to initialize projects from disk — service will be empty:', error);
      }
    }

    this.initialized = true;
  }

  private async saveProject(project: Project): Promise<void> {
    const dir = join(this.projectsDir, project.id);
    await mkdir(dir, { recursive: true });
    const filePath = join(dir, 'project.json');
    await writeFile(filePath, JSON.stringify(project, null, 2), 'utf-8');
  }

  async create(
    orgId: string,
    name: string,
    rootPath: string,
    opts?: { color?: string; icon?: string },
  ): Promise<Project> {
    await this.ensureInitialized();

    const now = Date.now();
    const project: Project = {
      id: generateId(),
      orgId,
      name,
      rootPath,
      color: opts?.color ?? colorFromName(name),
      icon: opts?.icon,
      createdAt: now,
      updatedAt: now,
    };

    this.projects.set(project.id, project);
    await this.saveProject(project);

    getEventBus().emit({
      type: 'ProjectChange',
      projectId: project.id,
      action: 'created',
      timestamp: now,
    });

    return project;
  }

  async get(id: string): Promise<Project | null> {
    await this.ensureInitialized();
    return this.projects.get(id) ?? null;
  }

  async update(
    id: string,
    updates: Partial<Omit<Project, 'id' | 'orgId' | 'createdAt'>>,
  ): Promise<Result<Project, ProjectNotFound>> {
    await this.ensureInitialized();

    const project = this.projects.get(id);
    if (!project) {
      return { ok: false, error: new ProjectNotFound(id) };
    }

    const updated: Project = {
      ...project,
      ...updates,
      id: project.id,
      orgId: project.orgId,
      createdAt: project.createdAt,
      updatedAt: Date.now(),
    };

    this.projects.set(id, updated);
    await this.saveProject(updated);

    getEventBus().emit({
      type: 'ProjectChange',
      projectId: id,
      action: 'updated',
      timestamp: updated.updatedAt,
    });

    return { ok: true, value: updated };
  }

  async list(orgId?: string): Promise<Project[]> {
    await this.ensureInitialized();
    let results = Array.from(this.projects.values());
    if (orgId) results = results.filter((p) => p.orgId === orgId);
    return results.sort((a, b) => b.updatedAt - a.updatedAt);
  }

  async delete(id: string): Promise<void> {
    await this.ensureInitialized();

    const project = this.projects.get(id);
    if (!project) return;

    // Delete from disk first — only remove from in-memory map on success
    // so a failed rm doesn't leave state diverged (project gone in memory but still on disk).
    await rm(join(this.projectsDir, id), { recursive: true, force: true });
    this.projects.delete(id);

    getEventBus().emit({
      type: 'ProjectChange',
      projectId: id,
      action: 'deleted',
      timestamp: Date.now(),
    });
  }

  dispose(): void {
    this.projects.clear();
    this.initialized = false;
    this.initPromise = null;
  }
}

// =============================================================================
// Singleton Management
// =============================================================================

let _instance: ProjectServiceImpl | null = null;

export function getProjectService(): ProjectService {
  return (_instance ??= new ProjectServiceImpl());
}

export function resetProjectService(): void {
  if (_instance) {
    _instance.dispose();
    _instance = null;
  }
}

/**
 * Create a project service with a custom directory.
 * Useful for testing.
 */
export function createProjectService(projectsDir: string): ProjectService {
  return new ProjectServiceImpl(projectsDir);
}
