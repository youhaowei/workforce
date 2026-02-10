/**
 * Shared mock helpers for OrchestrationService tests.
 */

import { getEventBus } from '@shared/event-bus';
import type {
  Session,
  SessionService,
  TemplateService,
  WorktreeService,
  WorkflowService,
  ReviewService,
  ReviewItem,
  ReviewAction,
  AgentTemplate,
  WorkflowTemplate,
  WorktreeInfo,
  LifecycleState,
} from '../types';

/** Counter for unique IDs in mocks */
let _idCounter = 0;

export function resetIdCounter(): void {
  _idCounter = 0;
}

export function mockSession(overrides: Partial<Session> = {}): Session {
  _idCounter++;
  return {
    id: `sess_${_idCounter}`,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    messages: [],
    metadata: {},
    ...overrides,
  };
}

export function mockTemplate(overrides: Partial<AgentTemplate> = {}): AgentTemplate {
  return {
    id: 'tpl_test',
    name: 'Test Template',
    description: 'A test template',
    systemPrompt: 'You are a test agent',
    skills: [],
    tools: [],
    constraints: ['Be concise'],
    reasoningIntensity: 'medium',
    archived: false,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...overrides,
  };
}

export function createMockSessionService(): SessionService {
  const sessions = new Map<string, Session>();
  let currentSession: Session | null = null;

  return {
    async create(title?: string) {
      const session = mockSession({ title });
      sessions.set(session.id, session);
      return session;
    },
    async get(sessionId: string) {
      return sessions.get(sessionId) ?? null;
    },
    async save(session: Session) {
      sessions.set(session.id, session);
    },
    async resume(sessionId: string) {
      const s = sessions.get(sessionId);
      if (!s) throw new Error('Session not found');
      return s;
    },
    async fork(sessionId: string) {
      const parent = sessions.get(sessionId);
      if (!parent) throw new Error('Session not found');
      const child = mockSession({ parentId: parent.id });
      sessions.set(child.id, child);
      return child;
    },
    async list() {
      return Array.from(sessions.values());
    },
    async search() {
      return [];
    },
    async delete(sessionId: string) {
      sessions.delete(sessionId);
    },
    getCurrent: () => currentSession,
    setCurrent: (s: Session | null) => { currentSession = s; },
    async createWorkAgent(config) {
      const session = mockSession({
        metadata: {
          type: 'workagent',
          lifecycle: { state: 'created', stateHistory: [] },
          ...config,
        },
      });
      sessions.set(session.id, session);
      return session;
    },
    async transitionState(sessionId: string, newState: LifecycleState, reason: string, actor = 'system') {
      const session = sessions.get(sessionId);
      if (!session) throw new Error('Session not found');
      const meta = session.metadata as Record<string, unknown>;
      const lifecycle = (meta.lifecycle as Record<string, unknown>) ?? { state: 'created', stateHistory: [] };
      const history = (lifecycle.stateHistory as Array<unknown>) ?? [];
      history.push({ from: lifecycle.state, to: newState, reason, actor, timestamp: Date.now() });
      lifecycle.state = newState;
      lifecycle.stateHistory = history;
      meta.lifecycle = lifecycle;
      session.metadata = meta;
      sessions.set(sessionId, session);
      return session;
    },
    async listByState(state: LifecycleState) {
      return Array.from(sessions.values()).filter((s) => {
        const meta = s.metadata as Record<string, unknown>;
        const lifecycle = meta.lifecycle as { state: string } | undefined;
        return lifecycle?.state === state;
      });
    },
    async getChildren(parentSessionId: string) {
      return Array.from(sessions.values()).filter((s) => s.parentId === parentSessionId);
    },
    dispose() {
      sessions.clear();
    },
  };
}

export function createMockTemplateService(templates: AgentTemplate[] = [mockTemplate()]): TemplateService {
  const map = new Map(templates.map((t) => [`${t.id}`, t]));

  return {
    async create() { return mockTemplate(); },
    async get(_wsId: string, id: string) { return map.get(id) ?? null; },
    async update() { return mockTemplate(); },
    async duplicate() { return mockTemplate(); },
    async archive() {},
    async list() { return Array.from(map.values()); },
    validate() { return { valid: true, errors: [], warnings: [] }; },
    fromProfile() { return mockTemplate(); },
    dispose() {},
  };
}

export function createMockWorktreeService(): WorktreeService {
  const worktrees = new Map<string, WorktreeInfo>();

  return {
    async create(sessionId: string, repoRoot: string, branchName?: string) {
      const info: WorktreeInfo = {
        path: `/tmp/worktree-${sessionId}`,
        branch: branchName ?? `workforce/${sessionId}`,
        sessionId,
        repoRoot,
        createdAt: Date.now(),
        status: 'active',
      };
      worktrees.set(sessionId, info);
      return info;
    },
    async list() { return Array.from(worktrees.values()); },
    async merge() { return { success: true }; },
    async archive() {},
    async delete() {},
    getForSession(sessionId: string) { return worktrees.get(sessionId) ?? null; },
    async getDiff() { return ''; },
    dispose() { worktrees.clear(); },
  };
}

export function createMockWorkflowService(workflows: WorkflowTemplate[] = []): WorkflowService {
  const map = new Map(workflows.map((w) => [w.id, w]));

  return {
    async create() { return workflows[0]!; },
    async get(_wsId: string, id: string) { return map.get(id) ?? null; },
    async update() { return workflows[0]!; },
    async list() { return workflows; },
    async archive() {},
    validate() { return { valid: true, errors: [] }; },
    async getExecutionOrder(_wsId: string, workflowId: string) {
      const wf = map.get(workflowId);
      if (!wf) throw new Error('Workflow not found');
      // Simple: return each step in its own batch for testing
      return wf.steps.map((s) => [s.id]);
    },
    dispose() {},
  };
}

export function createMockReviewService(): ReviewService {
  const items = new Map<string, ReviewItem>();
  let revIdCounter = 0;

  return {
    async create(input) {
      revIdCounter++;
      const item: ReviewItem = {
        id: `rev_${revIdCounter}`,
        sessionId: input.sessionId,
        workspaceId: input.workspaceId,
        workflowId: input.workflowId,
        workflowStepId: input.workflowStepId,
        type: input.type,
        title: input.title,
        summary: input.summary,
        context: input.context,
        status: 'pending',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      items.set(item.id, item);

      getEventBus().emit({
        type: 'ReviewItemChange',
        reviewItemId: item.id,
        sessionId: item.sessionId,
        workspaceId: item.workspaceId,
        action: 'created',
        timestamp: Date.now(),
      });

      return item;
    },
    async get(id: string) {
      return items.get(id) ?? null;
    },
    async listPending() {
      return Array.from(items.values()).filter((i) => i.status === 'pending');
    },
    async list() {
      return Array.from(items.values());
    },
    async resolve(id: string, workspaceId: string, action: ReviewAction, comment?: string) {
      const item = items.get(id);
      if (!item) throw new Error('Review item not found');
      item.status = 'resolved';
      item.resolution = { action, comment, resolvedAt: Date.now() };
      item.updatedAt = Date.now();
      items.set(id, item);

      getEventBus().emit({
        type: 'ReviewItemChange',
        reviewItemId: id,
        sessionId: item.sessionId,
        workspaceId,
        action: 'resolved',
        timestamp: Date.now(),
      });

      return item;
    },
    async pendingCount() {
      return Array.from(items.values()).filter((i) => i.status === 'pending').length;
    },
    dispose() {
      items.clear();
    },
  };
}
