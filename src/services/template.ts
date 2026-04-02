/**
 * TemplateService - Agent template management and persistence
 *
 * Provides:
 * - Agent template CRUD with disk persistence
 * - Template validation
 * - Duplication and archiving
 * - Migration from legacy AgentProfile
 *
 * Persistence: ~/.workforce/orgs/{orgId}/templates/{id}.json
 */

import { readFile, writeFile, readdir, mkdir } from 'fs/promises';
import { join } from 'path';
import { getLogService } from './log';
import type {
  AgentTemplate,
  AgentProfile,
  TemplateValidation,
  TemplateService,
} from './types';
import { getDataDir } from './data-dir';

// =============================================================================
// Configuration
// =============================================================================

const ORGS_DIR = join(getDataDir(), 'orgs');

// =============================================================================
// Helpers
// =============================================================================

function generateId(): string {
  return `tmpl_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function templatesDir(orgsDir: string, orgId: string): string {
  return join(orgsDir, orgId, 'templates');
}

// =============================================================================
// Service Implementation
// =============================================================================

class TemplateServiceImpl implements TemplateService {
  /** Cache: orgId → Map<templateId, template> */
  private cache = new Map<string, Map<string, AgentTemplate>>();
  private orgsDir: string;

  constructor(orgsDir?: string) {
    this.orgsDir = orgsDir ?? ORGS_DIR;
  }

  private async ensureOrgLoaded(orgId: string): Promise<Map<string, AgentTemplate>> {
    if (this.cache.has(orgId)) {
      return this.cache.get(orgId)!;
    }

    const templates = new Map<string, AgentTemplate>();
    const dir = templatesDir(this.orgsDir, orgId);

    try {
      await mkdir(dir, { recursive: true });
      const entries = await readdir(dir, { withFileTypes: true });
      const jsonFiles = entries.filter(
        (e) => e.isFile() && e.name.endsWith('.json')
      );

      for (const file of jsonFiles) {
        try {
          const raw = await readFile(join(dir, file.name), 'utf-8');
          const template = JSON.parse(raw) as AgentTemplate;
          templates.set(template.id, template);
        } catch {
          // Skip unreadable template files
        }
      }
    } catch (err) {
      const error = err as NodeJS.ErrnoException;
      if (error.code !== 'ENOENT') {
        getLogService().error('general', `Failed to load templates for org ${orgId}`, { error: String(error) });
      }
    }

    this.cache.set(orgId, templates);
    return templates;
  }

  private async saveTemplate(orgId: string, template: AgentTemplate): Promise<void> {
    const dir = templatesDir(this.orgsDir, orgId);
    await mkdir(dir, { recursive: true });
    const filePath = join(dir, `${template.id}.json`);
    await writeFile(filePath, JSON.stringify(template, null, 2), 'utf-8');
  }

  async create(
    orgId: string,
    input: Omit<AgentTemplate, 'id' | 'createdAt' | 'updatedAt' | 'archived'>
  ): Promise<AgentTemplate> {
    const templates = await this.ensureOrgLoaded(orgId);

    const now = Date.now();
    const template: AgentTemplate = {
      ...input,
      id: generateId(),
      archived: false,
      createdAt: now,
      updatedAt: now,
    };

    templates.set(template.id, template);
    await this.saveTemplate(orgId, template);

    return template;
  }

  async get(orgId: string, id: string): Promise<AgentTemplate | null> {
    const templates = await this.ensureOrgLoaded(orgId);
    return templates.get(id) ?? null;
  }

  async update(
    orgId: string,
    id: string,
    updates: Partial<AgentTemplate>
  ): Promise<AgentTemplate> {
    const templates = await this.ensureOrgLoaded(orgId);

    const existing = templates.get(id);
    if (!existing) {
      throw new Error(`Template not found: ${id}`);
    }

    const updated: AgentTemplate = {
      ...existing,
      ...updates,
      id: existing.id,
      createdAt: existing.createdAt,
      updatedAt: Date.now(),
    };

    templates.set(id, updated);
    await this.saveTemplate(orgId, updated);

    return updated;
  }

  async duplicate(orgId: string, id: string): Promise<AgentTemplate> {
    const templates = await this.ensureOrgLoaded(orgId);

    const source = templates.get(id);
    if (!source) {
      throw new Error(`Template not found: ${id}`);
    }

    const now = Date.now();
    const duplicate: AgentTemplate = {
      ...source,
      id: generateId(),
      name: `${source.name} (copy)`,
      archived: false,
      createdAt: now,
      updatedAt: now,
    };

    templates.set(duplicate.id, duplicate);
    await this.saveTemplate(orgId, duplicate);

    return duplicate;
  }

  async archive(orgId: string, id: string): Promise<void> {
    await this.update(orgId, id, { archived: true });
  }

  async list(
    orgId: string,
    options?: { includeArchived?: boolean }
  ): Promise<AgentTemplate[]> {
    const templates = await this.ensureOrgLoaded(orgId);
    const all = Array.from(templates.values());

    if (options?.includeArchived) {
      return all.sort((a, b) => b.updatedAt - a.updatedAt);
    }

    return all
      .filter((t) => !t.archived)
      .sort((a, b) => b.updatedAt - a.updatedAt);
  }

  validate(template: Partial<AgentTemplate>): TemplateValidation {
    const errors: Array<{ field: string; message: string }> = [];
    const warnings: Array<{ field: string; message: string }> = [];

    if (!template.name?.trim()) {
      errors.push({ field: 'name', message: 'Name is required' });
    }

    if (!template.description?.trim()) {
      errors.push({ field: 'description', message: 'Description is required' });
    }

    if (!template.systemPrompt?.trim()) {
      errors.push({ field: 'systemPrompt', message: 'System prompt is required' });
    }

    if (template.systemPrompt && template.systemPrompt.length > 100_000) {
      errors.push({ field: 'systemPrompt', message: 'System prompt exceeds 100,000 characters' });
    }

    if (template.maxTokens !== undefined && template.maxTokens < 1) {
      errors.push({ field: 'maxTokens', message: 'Max tokens must be positive' });
    }

    if (template.temperature !== undefined && (template.temperature < 0 || template.temperature > 2)) {
      errors.push({ field: 'temperature', message: 'Temperature must be between 0 and 2' });
    }

    if (!template.tools || template.tools.length === 0) {
      warnings.push({ field: 'tools', message: 'No tools specified — agent will have no tool access' });
    }

    if (!template.constraints || template.constraints.length === 0) {
      warnings.push({ field: 'constraints', message: 'No constraints defined — agent will have no behavioral guardrails' });
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
    };
  }

  fromProfile(profile: AgentProfile): AgentTemplate {
    const now = Date.now();
    return {
      id: generateId(),
      name: profile.name,
      description: profile.description,
      systemPrompt: profile.systemPrompt,
      skills: [],
      tools: profile.tools ?? [],
      constraints: [],
      reasoningIntensity: 'medium',
      maxTokens: profile.maxTokens,
      temperature: profile.temperature,
      archived: false,
      createdAt: now,
      updatedAt: now,
    };
  }

  dispose(): void {
    this.cache.clear();
  }
}

// =============================================================================
// Singleton Management
// =============================================================================

let _instance: TemplateServiceImpl | null = null;

export function getTemplateService(): TemplateService {
  return (_instance ??= new TemplateServiceImpl());
}

export function resetTemplateService(): void {
  if (_instance) {
    _instance.dispose();
    _instance = null;
  }
}

/**
 * Create a template service with a custom orgs directory.
 * Useful for testing.
 */
export function createTemplateService(orgsDir: string): TemplateService {
  return new TemplateServiceImpl(orgsDir);
}
