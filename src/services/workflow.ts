/**
 * WorkflowService - Workflow template management and DAG execution ordering
 *
 * Provides:
 * - Workflow template CRUD with disk persistence
 * - DAG validation (cycle detection, orphan step detection)
 * - Topological sort for execution order (parallel batches)
 * - Archiving
 *
 * Persistence: ~/.workforce/orgs/{orgId}/workflows/{id}.json
 */

import { readFile, writeFile, readdir, mkdir } from 'fs/promises';
import { join } from 'path';
import type { WorkflowTemplate, WorkflowStep, WorkflowService } from './types';
import { getDataDir } from './data-dir';

// =============================================================================
// Configuration
// =============================================================================

const DEFAULT_ORGS_DIR = join(getDataDir(), 'orgs');

// =============================================================================
// Helpers
// =============================================================================

function generateId(): string {
  return `wf_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Topological sort using Kahn's algorithm.
 * Returns an array of parallel batches (each batch contains step IDs that can run concurrently).
 */
// oxlint-disable-next-line complexity
function topologicalSort(steps: WorkflowStep[]): { batches: string[][]; errors: string[] } {
  const errors: string[] = [];
  const stepIds = new Set(steps.map((s) => s.id));

  // Validate that all dependsOn references exist
  for (const step of steps) {
    for (const dep of step.dependsOn) {
      if (!stepIds.has(dep)) {
        errors.push(`Step "${step.id}" depends on non-existent step "${dep}"`);
      }
    }
  }

  if (errors.length > 0) {
    return { batches: [], errors };
  }

  // Build in-degree map and adjacency list
  const inDegree = new Map<string, number>();
  const dependents = new Map<string, string[]>();

  for (const step of steps) {
    inDegree.set(step.id, step.dependsOn.length);
    if (!dependents.has(step.id)) {
      dependents.set(step.id, []);
    }
    for (const dep of step.dependsOn) {
      const list = dependents.get(dep) ?? [];
      list.push(step.id);
      dependents.set(dep, list);
    }
  }

  const batches: string[][] = [];
  const remaining = new Set(stepIds);

  while (remaining.size > 0) {
    // Collect steps with zero in-degree
    const batch: string[] = [];
    for (const id of remaining) {
      if ((inDegree.get(id) ?? 0) === 0) {
        batch.push(id);
      }
    }

    if (batch.length === 0) {
      // Cycle detected — remaining steps all have unmet dependencies
      errors.push(`Cycle detected involving steps: ${Array.from(remaining).join(', ')}`);
      return { batches, errors };
    }

    batches.push(batch);

    // Remove batch from graph
    for (const id of batch) {
      remaining.delete(id);
      for (const dep of dependents.get(id) ?? []) {
        inDegree.set(dep, (inDegree.get(dep) ?? 1) - 1);
      }
    }
  }

  return { batches, errors };
}

// =============================================================================
// Service Implementation
// =============================================================================

class WorkflowServiceImpl implements WorkflowService {
  private cache = new Map<string, WorkflowTemplate>();
  private orgsDir: string;

  constructor(orgsDir?: string) {
    this.orgsDir = orgsDir ?? DEFAULT_ORGS_DIR;
  }

  private workflowDir(orgId: string): string {
    return join(this.orgsDir, orgId, 'workflows');
  }

  private workflowPath(orgId: string, id: string): string {
    return join(this.workflowDir(orgId), `${id}.json`);
  }

  private cacheKey(orgId: string, id: string): string {
    return `${orgId}:${id}`;
  }

  async create(
    orgId: string,
    template: Omit<WorkflowTemplate, 'id' | 'createdAt' | 'updatedAt' | 'archived'>
  ): Promise<WorkflowTemplate> {
    const now = Date.now();
    const workflow: WorkflowTemplate = {
      ...template,
      id: generateId(),
      createdAt: now,
      updatedAt: now,
      archived: false,
    };

    // Validate before saving
    const validation = this.validate(workflow);
    if (!validation.valid) {
      throw new Error(`Invalid workflow: ${validation.errors.join('; ')}`);
    }

    await mkdir(this.workflowDir(orgId), { recursive: true });
    await writeFile(this.workflowPath(orgId, workflow.id), JSON.stringify(workflow, null, 2), 'utf-8');

    this.cache.set(this.cacheKey(orgId, workflow.id), workflow);
    return workflow;
  }

  async get(orgId: string, id: string): Promise<WorkflowTemplate | null> {
    const key = this.cacheKey(orgId, id);
    if (this.cache.has(key)) {
      return this.cache.get(key)!;
    }

    try {
      const raw = await readFile(this.workflowPath(orgId, id), 'utf-8');
      const workflow = JSON.parse(raw) as WorkflowTemplate;
      this.cache.set(key, workflow);
      return workflow;
    } catch {
      return null;
    }
  }

  async update(
    orgId: string,
    id: string,
    updates: Partial<WorkflowTemplate>
  ): Promise<WorkflowTemplate> {
    const existing = await this.get(orgId, id);
    if (!existing) {
      throw new Error(`Workflow not found: ${id}`);
    }

    const updated: WorkflowTemplate = {
      ...existing,
      ...updates,
      id: existing.id,
      createdAt: existing.createdAt,
      updatedAt: Date.now(),
    };

    if (updates.steps) {
      const validation = this.validate(updated);
      if (!validation.valid) {
        throw new Error(`Invalid workflow update: ${validation.errors.join('; ')}`);
      }
    }

    await writeFile(this.workflowPath(orgId, id), JSON.stringify(updated, null, 2), 'utf-8');
    this.cache.set(this.cacheKey(orgId, id), updated);
    return updated;
  }

  async list(
    orgId: string,
    options?: { includeArchived?: boolean }
  ): Promise<WorkflowTemplate[]> {
    const dir = this.workflowDir(orgId);
    try {
      const files = await readdir(dir);
      const workflows: WorkflowTemplate[] = [];

      for (const file of files) {
        if (!file.endsWith('.json')) continue;
        try {
          const raw = await readFile(join(dir, file), 'utf-8');
          const workflow = JSON.parse(raw) as WorkflowTemplate;
          if (!options?.includeArchived && workflow.archived) continue;
          workflows.push(workflow);
          this.cache.set(this.cacheKey(orgId, workflow.id), workflow);
        } catch {
          // Skip corrupted files
        }
      }

      return workflows;
    } catch {
      return [];
    }
  }

  async archive(orgId: string, id: string): Promise<void> {
    const existing = await this.get(orgId, id);
    if (!existing) {
      throw new Error(`Workflow not found: ${id}`);
    }

    existing.archived = true;
    existing.updatedAt = Date.now();

    await writeFile(this.workflowPath(orgId, id), JSON.stringify(existing, null, 2), 'utf-8');
    this.cache.set(this.cacheKey(orgId, id), existing);
  }

  validate(template: Partial<WorkflowTemplate>): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    if (!template.name?.trim()) {
      errors.push('Workflow name is required');
    }

    if (!template.steps || template.steps.length === 0) {
      errors.push('Workflow must have at least one step');
    }

    if (template.steps) {
      // Check for duplicate step IDs
      const ids = new Set<string>();
      for (const step of template.steps) {
        if (!step.id?.trim()) {
          errors.push('All steps must have an id');
        }
        if (ids.has(step.id)) {
          errors.push(`Duplicate step id: ${step.id}`);
        }
        ids.add(step.id);

        if (!step.name?.trim()) {
          errors.push(`Step "${step.id}" must have a name`);
        }

        if (step.type === 'agent' && !step.templateId) {
          errors.push(`Agent step "${step.id}" must have a templateId`);
        }

        if (step.type === 'review_gate' && !step.reviewPrompt) {
          errors.push(`Review gate "${step.id}" must have a reviewPrompt`);
        }
      }

      // Check DAG validity (cycles, broken deps)
      if (template.steps.length > 0) {
        const sortResult = topologicalSort(template.steps as WorkflowStep[]);
        errors.push(...sortResult.errors);
      }
    }

    return { valid: errors.length === 0, errors };
  }

  async getExecutionOrder(orgId: string, workflowId: string): Promise<string[][]> {
    const workflow = await this.get(orgId, workflowId);
    if (!workflow) {
      throw new Error(`Workflow not found: ${workflowId}`);
    }

    const result = topologicalSort(workflow.steps);
    if (result.errors.length > 0) {
      throw new Error(`Invalid workflow DAG: ${result.errors.join('; ')}`);
    }

    return result.batches;
  }

  dispose(): void {
    this.cache.clear();
  }
}

// =============================================================================
// Factory
// =============================================================================

/**
 * Create a WorkflowService with a custom orgs directory.
 * Useful for testing.
 */
export function createWorkflowService(orgsDir?: string): WorkflowService {
  return new WorkflowServiceImpl(orgsDir);
}
