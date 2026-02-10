import { mkdir, readFile, readdir, writeFile } from 'fs/promises';
import { homedir } from 'os';
import { join } from 'path';
import type { Workspace } from './types';

interface WorkspaceConfig {
  currentWorkspaceId?: string;
}

function rootDir(): string {
  return process.env.WORKFORCE_HOME || join(homedir(), '.workforce');
}

function workspacesDir(): string {
  return join(rootDir(), 'workspaces');
}

function configPath(): string {
  return join(rootDir(), 'config.json');
}

const DEFAULT_AGENT_TEMPLATE_SCHEMA = {
  type: 'object',
  required: ['name', 'description'],
  properties: {
    name: { type: 'string', minLength: 1 },
    description: { type: 'string', minLength: 1 },
    skills: { type: 'array', items: { type: 'string' }, default: [] },
    tools: { type: 'array', items: { type: 'string' }, default: [] },
    constraints: { type: 'array', items: { type: 'string' }, default: [] },
    reasoningIntensity: {
      type: 'string',
      enum: ['low', 'medium', 'high'],
      default: 'medium',
    },
  },
} as const;

const DEFAULT_AGENT_TEMPLATE_UI = {
  title: 'Agent Template',
  description: 'Define reusable agent behavior and permissions.',
  order: ['name', 'description', 'skills', 'tools', 'constraints', 'reasoningIntensity'],
  fields: {
    name: { widget: 'text', label: 'Name', placeholder: 'Code Reviewer' },
    description: { widget: 'textarea', label: 'Description', placeholder: 'What this agent does...' },
    skills: { widget: 'tags', label: 'Skills' },
    tools: { widget: 'tags', label: 'Tools' },
    constraints: { widget: 'tags', label: 'Constraints' },
    reasoningIntensity: {
      widget: 'select',
      label: 'Reasoning Intensity',
      options: [
        { label: 'Low', value: 'low' },
        { label: 'Medium', value: 'medium' },
        { label: 'High', value: 'high' },
      ],
    },
  },
} as const;

const DEFAULT_WORKFLOW_TEMPLATE_SCHEMA = {
  type: 'object',
  required: ['name', 'description', 'steps'],
  properties: {
    name: { type: 'string', minLength: 1 },
    description: { type: 'string', minLength: 1 },
    steps: {
      type: 'array',
      items: {
        type: 'object',
        required: ['id', 'name'],
        properties: {
          id: { type: 'string' },
          name: { type: 'string' },
          templateId: { type: 'string' },
          dependsOn: { type: 'array', items: { type: 'string' }, default: [] },
          parallelGroup: { type: 'string' },
          reviewGate: { type: 'boolean', default: false },
        },
      },
      minItems: 1,
    },
  },
} as const;

const DEFAULT_WORKFLOW_TEMPLATE_UI = {
  title: 'Workflow Template',
  description: 'Define multi-step workflows with dependencies and review gates.',
  order: ['name', 'description', 'steps'],
  fields: {
    name: { widget: 'text', label: 'Name', placeholder: 'Implement + test + review' },
    description: { widget: 'textarea', label: 'Description' },
    steps: {
      widget: 'json',
      label: 'Steps JSON',
      description: 'Each step requires id + name; optional templateId/dependsOn/reviewGate.',
    },
  },
} as const;

function generateId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

async function ensureDir(path: string): Promise<void> {
  await mkdir(path, { recursive: true });
}

async function readJson<T>(path: string, fallback: T): Promise<T> {
  try {
    const raw = await readFile(path, 'utf-8');
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await writeFile(path, JSON.stringify(value, null, 2), 'utf-8');
}

async function seedWorkspaceDefinitions(workspaceRoot: string): Promise<void> {
  const defRoot = join(workspaceRoot, 'definitions', 'forms');
  await ensureDir(defRoot);

  const files: Array<{ path: string; content: unknown }> = [
    { path: join(defRoot, 'agent-template.schema.json'), content: DEFAULT_AGENT_TEMPLATE_SCHEMA },
    { path: join(defRoot, 'agent-template.ui.json'), content: DEFAULT_AGENT_TEMPLATE_UI },
    { path: join(defRoot, 'workflow-template.schema.json'), content: DEFAULT_WORKFLOW_TEMPLATE_SCHEMA },
    { path: join(defRoot, 'workflow-template.ui.json'), content: DEFAULT_WORKFLOW_TEMPLATE_UI },
  ];

  for (const file of files) {
    const existing = await readJson(file.path, null as unknown);
    if (existing == null) {
      await writeJson(file.path, file.content);
    }
  }
}

class WorkspaceService {
  private initialized = false;

  private async ensureInitialized(): Promise<void> {
    if (this.initialized) return;
    await ensureDir(rootDir());
    await ensureDir(workspacesDir());
    this.initialized = true;
  }

  private async readConfig(): Promise<WorkspaceConfig> {
    await this.ensureInitialized();
    return readJson<WorkspaceConfig>(configPath(), {});
  }

  private async writeConfig(config: WorkspaceConfig): Promise<void> {
    await this.ensureInitialized();
    await writeJson(configPath(), config);
  }

  private workspaceMetaPath(workspaceId: string): string {
    return join(workspacesDir(), workspaceId, 'workspace.json');
  }

  async create(name: string): Promise<Workspace> {
    await this.ensureInitialized();
    const now = Date.now();
    const id = generateId('ws');
    const rootPath = join(workspacesDir(), id);

    const workspace: Workspace = {
      id,
      name,
      rootPath,
      createdAt: now,
      updatedAt: now,
    };

    await ensureDir(rootPath);
    await ensureDir(join(rootPath, 'state'));
    await ensureDir(join(rootPath, 'events'));
    await ensureDir(join(rootPath, 'snapshots'));
    await ensureDir(join(rootPath, 'worktrees'));
    await seedWorkspaceDefinitions(rootPath);
    await writeJson(this.workspaceMetaPath(id), workspace);

    const config = await this.readConfig();
    if (!config.currentWorkspaceId) {
      config.currentWorkspaceId = id;
      await this.writeConfig(config);
    }

    return workspace;
  }

  async list(): Promise<Workspace[]> {
    await this.ensureInitialized();
    const entries = await readdir(workspacesDir(), { withFileTypes: true });
    const workspaces: Workspace[] = [];

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const meta = await readJson<Workspace | null>(this.workspaceMetaPath(entry.name), null);
      if (meta) workspaces.push(meta);
    }

    return workspaces.sort((a, b) => b.updatedAt - a.updatedAt);
  }

  async getCurrent(): Promise<Workspace> {
    await this.ensureInitialized();
    const config = await this.readConfig();

    if (!config.currentWorkspaceId) {
      const existing = await this.list();
      if (existing.length > 0) {
        config.currentWorkspaceId = existing[0].id;
        await this.writeConfig(config);
      } else {
        const created = await this.create('Default Workspace');
        config.currentWorkspaceId = created.id;
        await this.writeConfig(config);
        return created;
      }
    }

    const meta = await readJson<Workspace | null>(
      this.workspaceMetaPath(config.currentWorkspaceId),
      null
    );

    if (!meta) {
      const created = await this.create('Recovered Workspace');
      config.currentWorkspaceId = created.id;
      await this.writeConfig(config);
      return created;
    }

    return meta;
  }

  async switch(workspaceId: string): Promise<Workspace> {
    const workspace = await readJson<Workspace | null>(this.workspaceMetaPath(workspaceId), null);
    if (!workspace) {
      throw new Error(`Workspace not found: ${workspaceId}`);
    }

    const config = await this.readConfig();
    config.currentWorkspaceId = workspaceId;
    await this.writeConfig(config);

    return workspace;
  }

  async getWorkspaceRoot(): Promise<string> {
    const current = await this.getCurrent();
    return current.rootPath;
  }
}

let _workspaceService: WorkspaceService | null = null;

export function getWorkspaceService(): WorkspaceService {
  return (_workspaceService ??= new WorkspaceService());
}

export function resetWorkspaceService(): void {
  _workspaceService = null;
}
