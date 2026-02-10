import type {
  AgentTemplate,
  ReviewAction,
  ReviewItem,
  SessionEvent,
  WorkAgentSession,
  WorkAgentState,
  WorkOutput,
  WorkOutputDecision,
  WorkflowTemplate,
} from './types';
import { getWorkspaceService } from './workspace';
import { getStorageAdapter } from './storage';

interface WorkspaceState {
  agentTemplates: AgentTemplate[];
  workflowTemplates: WorkflowTemplate[];
  workagents: WorkAgentSession[];
  reviews: ReviewItem[];
  outputs: WorkOutput[];
}

interface WorkspaceContext {
  workspaceId: string;
  workspaceRoot: string;
}

function generateId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

class DomainService {
  private stateCache = new Map<string, WorkspaceState>();

  private async getContext(): Promise<WorkspaceContext> {
    const workspace = await getWorkspaceService().getCurrent();
    return {
      workspaceId: workspace.id,
      workspaceRoot: workspace.rootPath,
    };
  }

  private async loadState(workspaceRoot: string, workspaceId: string): Promise<WorkspaceState> {
    if (this.stateCache.has(workspaceId)) {
      return this.stateCache.get(workspaceId)!;
    }

    const storage = getStorageAdapter();
    const state: WorkspaceState = {
      agentTemplates: await storage.readJson<AgentTemplate[]>(workspaceRoot, 'state/agent-templates.json', []),
      workflowTemplates: await storage.readJson<WorkflowTemplate[]>(workspaceRoot, 'state/workflow-templates.json', []),
      workagents: await storage.readJson<WorkAgentSession[]>(workspaceRoot, 'state/workagents.json', []),
      reviews: await storage.readJson<ReviewItem[]>(workspaceRoot, 'state/reviews.json', []),
      outputs: await storage.readJson<WorkOutput[]>(workspaceRoot, 'state/outputs.json', []),
    };

    this.stateCache.set(workspaceId, state);
    return state;
  }

  private async saveState(workspaceRoot: string, workspaceId: string): Promise<WorkspaceState> {
    const state = this.stateCache.get(workspaceId);
    if (!state) throw new Error(`State not loaded for workspace: ${workspaceId}`);

    const storage = getStorageAdapter();
    await Promise.all([
      storage.writeJson(workspaceRoot, 'state/agent-templates.json', state.agentTemplates),
      storage.writeJson(workspaceRoot, 'state/workflow-templates.json', state.workflowTemplates),
      storage.writeJson(workspaceRoot, 'state/workagents.json', state.workagents),
      storage.writeJson(workspaceRoot, 'state/reviews.json', state.reviews),
      storage.writeJson(workspaceRoot, 'state/outputs.json', state.outputs),
      storage.writeJson(workspaceRoot, 'snapshots/last-state.json', {
        workspaceId,
        updatedAt: Date.now(),
        counts: {
          agentTemplates: state.agentTemplates.length,
          workflowTemplates: state.workflowTemplates.length,
          workagents: state.workagents.length,
          reviews: state.reviews.length,
          outputs: state.outputs.length,
        },
      }),
    ]);

    return state;
  }

  private async appendEvent(
    workspaceRoot: string,
    workspaceId: string,
    stream: string,
    entityId: string,
    action: string,
    payload: Record<string, unknown>
  ): Promise<void> {
    const event: SessionEvent = {
      id: generateId('evt'),
      workspaceId,
      stream,
      entityId,
      action,
      payload,
      timestamp: Date.now(),
    };
    await getStorageAdapter().appendEvent(workspaceRoot, stream, event);
    await getStorageAdapter().appendEvent(workspaceRoot, 'history', event);
  }

  async listAgentTemplates(): Promise<AgentTemplate[]> {
    const ctx = await this.getContext();
    const state = await this.loadState(ctx.workspaceRoot, ctx.workspaceId);
    return state.agentTemplates.filter((t) => !t.archived);
  }

  async createAgentTemplate(input: Omit<AgentTemplate, 'id' | 'workspaceId' | 'createdAt' | 'updatedAt' | 'archived'>): Promise<AgentTemplate> {
    const ctx = await this.getContext();
    const state = await this.loadState(ctx.workspaceRoot, ctx.workspaceId);
    const now = Date.now();

    const created: AgentTemplate = {
      id: generateId('atpl'),
      workspaceId: ctx.workspaceId,
      archived: false,
      createdAt: now,
      updatedAt: now,
      ...input,
    };

    state.agentTemplates.push(created);
    await this.saveState(ctx.workspaceRoot, ctx.workspaceId);
    await this.appendEvent(ctx.workspaceRoot, ctx.workspaceId, 'agent-templates', created.id, 'created', {
      name: created.name,
    });

    return created;
  }

  async updateAgentTemplate(id: string, patch: Partial<AgentTemplate>): Promise<AgentTemplate> {
    const ctx = await this.getContext();
    const state = await this.loadState(ctx.workspaceRoot, ctx.workspaceId);
    const template = state.agentTemplates.find((item) => item.id === id);
    if (!template) throw new Error(`Agent template not found: ${id}`);

    Object.assign(template, patch, { updatedAt: Date.now() });
    await this.saveState(ctx.workspaceRoot, ctx.workspaceId);
    await this.appendEvent(ctx.workspaceRoot, ctx.workspaceId, 'agent-templates', id, 'updated', {
      fields: Object.keys(patch),
    });

    return template;
  }

  async archiveAgentTemplate(id: string): Promise<AgentTemplate> {
    return this.updateAgentTemplate(id, { archived: true });
  }

  async listWorkflowTemplates(): Promise<WorkflowTemplate[]> {
    const ctx = await this.getContext();
    const state = await this.loadState(ctx.workspaceRoot, ctx.workspaceId);
    return state.workflowTemplates.filter((w) => !w.archived);
  }

  async createWorkflowTemplate(input: Omit<WorkflowTemplate, 'id' | 'workspaceId' | 'createdAt' | 'updatedAt' | 'archived'>): Promise<WorkflowTemplate> {
    const ctx = await this.getContext();
    const state = await this.loadState(ctx.workspaceRoot, ctx.workspaceId);
    const now = Date.now();

    const created: WorkflowTemplate = {
      id: generateId('wftpl'),
      workspaceId: ctx.workspaceId,
      archived: false,
      createdAt: now,
      updatedAt: now,
      ...input,
    };

    state.workflowTemplates.push(created);
    await this.saveState(ctx.workspaceRoot, ctx.workspaceId);
    await this.appendEvent(ctx.workspaceRoot, ctx.workspaceId, 'workflow-templates', created.id, 'created', {
      name: created.name,
      stepCount: created.steps.length,
    });

    return created;
  }

  async updateWorkflowTemplate(id: string, patch: Partial<WorkflowTemplate>): Promise<WorkflowTemplate> {
    const ctx = await this.getContext();
    const state = await this.loadState(ctx.workspaceRoot, ctx.workspaceId);
    const workflow = state.workflowTemplates.find((item) => item.id === id);
    if (!workflow) throw new Error(`Workflow template not found: ${id}`);

    Object.assign(workflow, patch, { updatedAt: Date.now() });
    await this.saveState(ctx.workspaceRoot, ctx.workspaceId);
    await this.appendEvent(ctx.workspaceRoot, ctx.workspaceId, 'workflow-templates', id, 'updated', {
      fields: Object.keys(patch),
    });

    return workflow;
  }

  async archiveWorkflowTemplate(id: string): Promise<WorkflowTemplate> {
    return this.updateWorkflowTemplate(id, { archived: true });
  }

  async createWorkAgent(input: {
    title: string;
    goal: string;
    workflowId?: string;
    templateId?: string;
    parentId?: string;
  }): Promise<WorkAgentSession> {
    const ctx = await this.getContext();
    const state = await this.loadState(ctx.workspaceRoot, ctx.workspaceId);
    const now = Date.now();

    const created: WorkAgentSession = {
      id: generateId('wa'),
      workspaceId: ctx.workspaceId,
      title: input.title,
      goal: input.goal,
      workflowId: input.workflowId,
      templateId: input.templateId,
      parentId: input.parentId,
      childIds: [],
      state: 'created',
      progress: 0,
      createdAt: now,
      updatedAt: now,
    };

    state.workagents.push(created);

    if (created.parentId) {
      const parent = state.workagents.find((item) => item.id === created.parentId);
      if (parent && !parent.childIds.includes(created.id)) {
        parent.childIds.push(created.id);
        parent.updatedAt = now;
      }
    }

    await this.saveState(ctx.workspaceRoot, ctx.workspaceId);
    await this.appendEvent(ctx.workspaceRoot, ctx.workspaceId, 'workagents', created.id, 'created', {
      title: created.title,
      parentId: created.parentId,
    });

    return created;
  }

  async listWorkAgents(): Promise<WorkAgentSession[]> {
    const ctx = await this.getContext();
    const state = await this.loadState(ctx.workspaceRoot, ctx.workspaceId);
    return [...state.workagents].sort((a, b) => b.updatedAt - a.updatedAt);
  }

  async getWorkAgent(id: string): Promise<WorkAgentSession | null> {
    const agents = await this.listWorkAgents();
    return agents.find((agent) => agent.id === id) ?? null;
  }

  async updateWorkAgentState(
    id: string,
    stateValue: WorkAgentState,
    options?: { pauseReason?: string; progress?: number }
  ): Promise<WorkAgentSession> {
    const ctx = await this.getContext();
    const state = await this.loadState(ctx.workspaceRoot, ctx.workspaceId);
    const agent = state.workagents.find((item) => item.id === id);
    if (!agent) throw new Error(`WorkAgent not found: ${id}`);

    agent.state = stateValue;
    agent.updatedAt = Date.now();
    if (options?.pauseReason !== undefined) {
      agent.pauseReason = options.pauseReason;
    }
    if (options?.progress !== undefined) {
      agent.progress = options.progress;
    }

    await this.saveState(ctx.workspaceRoot, ctx.workspaceId);
    await this.appendEvent(ctx.workspaceRoot, ctx.workspaceId, 'workagents', id, 'state.changed', {
      state: stateValue,
      pauseReason: options?.pauseReason,
      progress: options?.progress,
    });

    return agent;
  }

  async spawnChild(parentId: string, input: { title: string; goal: string; templateId?: string }): Promise<WorkAgentSession> {
    return this.createWorkAgent({
      title: input.title,
      goal: input.goal,
      templateId: input.templateId,
      parentId,
    });
  }

  async createReview(input: {
    sourceAgentId: string;
    workflowId?: string;
    summary: string;
    recommendation?: string;
  }): Promise<ReviewItem> {
    const ctx = await this.getContext();
    const state = await this.loadState(ctx.workspaceRoot, ctx.workspaceId);
    const created: ReviewItem = {
      id: generateId('review'),
      workspaceId: ctx.workspaceId,
      sourceAgentId: input.sourceAgentId,
      workflowId: input.workflowId,
      summary: input.summary,
      recommendation: input.recommendation,
      status: 'pending',
      createdAt: Date.now(),
    };

    state.reviews.push(created);
    await this.saveState(ctx.workspaceRoot, ctx.workspaceId);
    await this.appendEvent(ctx.workspaceRoot, ctx.workspaceId, 'reviews', created.id, 'created', {
      sourceAgentId: created.sourceAgentId,
    });

    return created;
  }

  async listReviews(): Promise<ReviewItem[]> {
    const ctx = await this.getContext();
    const state = await this.loadState(ctx.workspaceRoot, ctx.workspaceId);
    return [...state.reviews].sort((a, b) => b.createdAt - a.createdAt);
  }

  async resolveReview(id: string, action: ReviewAction, note?: string): Promise<ReviewItem> {
    const ctx = await this.getContext();
    const state = await this.loadState(ctx.workspaceRoot, ctx.workspaceId);
    const review = state.reviews.find((item) => item.id === id);
    if (!review) throw new Error(`Review not found: ${id}`);

    review.status = 'resolved';
    review.resolutionAction = action;
    review.resolutionNote = note;
    review.resolvedAt = Date.now();

    await this.saveState(ctx.workspaceRoot, ctx.workspaceId);
    await this.appendEvent(ctx.workspaceRoot, ctx.workspaceId, 'reviews', id, 'resolved', {
      action,
      note,
    });

    return review;
  }

  async createOutput(input: { agentId: string; branchName: string; worktreePath: string }): Promise<WorkOutput> {
    const ctx = await this.getContext();
    const state = await this.loadState(ctx.workspaceRoot, ctx.workspaceId);
    const now = Date.now();

    const output: WorkOutput = {
      id: generateId('out'),
      workspaceId: ctx.workspaceId,
      agentId: input.agentId,
      branchName: input.branchName,
      worktreePath: input.worktreePath,
      status: 'pending',
      createdAt: now,
      updatedAt: now,
    };

    state.outputs.push(output);
    await this.saveState(ctx.workspaceRoot, ctx.workspaceId);
    await this.appendEvent(ctx.workspaceRoot, ctx.workspaceId, 'outputs', output.id, 'created', {
      agentId: output.agentId,
      branchName: output.branchName,
    });

    return output;
  }

  async listOutputs(): Promise<WorkOutput[]> {
    const ctx = await this.getContext();
    const state = await this.loadState(ctx.workspaceRoot, ctx.workspaceId);
    return [...state.outputs].sort((a, b) => b.updatedAt - a.updatedAt);
  }

  async decideOutput(id: string, decision: WorkOutputDecision): Promise<WorkOutput> {
    const ctx = await this.getContext();
    const state = await this.loadState(ctx.workspaceRoot, ctx.workspaceId);
    const output = state.outputs.find((item) => item.id === id);
    if (!output) throw new Error(`Output not found: ${id}`);

    const statusMap: Record<WorkOutputDecision, WorkOutput['status']> = {
      merge: 'merged',
      keep: 'kept',
      archive: 'archived',
    };

    output.decision = decision;
    output.status = statusMap[decision];
    output.updatedAt = Date.now();

    await this.saveState(ctx.workspaceRoot, ctx.workspaceId);
    await this.appendEvent(ctx.workspaceRoot, ctx.workspaceId, 'outputs', id, 'decision', {
      decision,
      status: output.status,
    });

    return output;
  }

  async recoverOutput(id: string): Promise<WorkOutput> {
    const output = await this.decideOutput(id, 'keep');
    return output;
  }

  async getBoard(): Promise<{
    counts: Record<WorkAgentState, number>;
    lanes: Record<WorkAgentState, WorkAgentSession[]>;
  }> {
    const agents = await this.listWorkAgents();
    const states: WorkAgentState[] = ['created', 'active', 'paused', 'completed', 'failed', 'cancelled'];

    const lanes = Object.fromEntries(states.map((state) => [state, [] as WorkAgentSession[]])) as Record<
      WorkAgentState,
      WorkAgentSession[]
    >;

    for (const agent of agents) {
      lanes[agent.state].push(agent);
    }

    const counts = Object.fromEntries(states.map((state) => [state, lanes[state].length])) as Record<
      WorkAgentState,
      number
    >;

    return { counts, lanes };
  }

  async listHistory(stream = 'history'): Promise<SessionEvent[]> {
    const ctx = await this.getContext();
    const events = await getStorageAdapter().readEvents(ctx.workspaceRoot, stream);
    return events.sort((a, b) => b.timestamp - a.timestamp);
  }

  clearCache(): void {
    this.stateCache.clear();
  }
}

let _instance: DomainService | null = null;

export function getDomainService(): DomainService {
  return (_instance ??= new DomainService());
}

export function resetDomainService(): void {
  if (_instance) {
    _instance.clearCache();
    _instance = null;
  }
}
