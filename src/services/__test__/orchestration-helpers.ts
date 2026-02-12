/**
 * Shared mock helpers for OrchestrationService tests.
 */

import { getEventBus } from '@/shared/event-bus';
import type {
  Session,
  SessionService,
  TemplateService,
  WorktreeService,
  WorkflowService,
  OrgService,
  Org,
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
    async get(sessionId: string, options?: { includeMessages?: boolean }) {
      const session = sessions.get(sessionId) ?? null;
      if (!session) return null;
      if (options?.includeMessages === false) {
        return { ...session, messages: [] };
      }
      return session;
    },
    async getMessages(sessionId: string, options?: { limit?: number; offset?: number }) {
      const session = sessions.get(sessionId);
      if (!session) throw new Error('Session not found');
      const offset = options?.offset ?? 0;
      const limit = options?.limit ?? session.messages.length;
      return session.messages.slice(offset, offset + limit);
    },
    async save(session: Session) {
      sessions.set(session.id, session);
    },
    async addMessage(sessionId: string, message) {
      const session = sessions.get(sessionId);
      if (!session) throw new Error('Session not found');
      session.messages.push(message);
      session.updatedAt = Date.now();
      sessions.set(session.id, session);
    },
    async startAssistantStream(sessionId: string, messageId: string) {
      const session = sessions.get(sessionId);
      if (!session) throw new Error('Session not found');
      session.messages.push({
        id: messageId,
        role: 'assistant',
        content: '',
        timestamp: Date.now(),
      });
      session.updatedAt = Date.now();
      sessions.set(session.id, session);
    },
    async appendAssistantDelta(sessionId: string, messageId: string, delta: string) {
      const session = sessions.get(sessionId);
      if (!session) throw new Error('Session not found');
      let msg = session.messages.find((m) => m.id === messageId);
      if (!msg) {
        msg = { id: messageId, role: 'assistant', content: '', timestamp: Date.now() };
        session.messages.push(msg);
      }
      msg.content += delta;
      session.updatedAt = Date.now();
      sessions.set(session.id, session);
    },
    async finalizeAssistantMessage(sessionId: string, messageId: string, fullContent: string) {
      const session = sessions.get(sessionId);
      if (!session) throw new Error('Session not found');
      let msg = session.messages.find((m) => m.id === messageId);
      if (!msg) {
        msg = { id: messageId, role: 'assistant', content: '', timestamp: Date.now() };
        session.messages.push(msg);
      }
      msg.content = fullContent;
      session.updatedAt = Date.now();
      sessions.set(session.id, session);
    },
    async abortAssistantStream(_sessionId: string, _messageId: string, _reason: string) {},
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

export function createMockOrgService(orgs: Org[] = []): OrgService {
  const map = new Map(orgs.map((o) => [o.id, o]));
  let current: Org | null = null;

  return {
    async create(name: string, rootPath: string) {
      const org: Org = {
        id: `org_${++_idCounter}`,
        name,
        rootPath,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        settings: { allowedTools: [] },
      };
      map.set(org.id, org);
      return org;
    },
    async get(id: string) { return map.get(id) ?? null; },
    async update(id: string, updates: Partial<Omit<Org, 'id' | 'createdAt'>>) {
      const org = map.get(id);
      if (!org) throw new Error('Org not found');
      const updated = { ...org, ...updates, id: org.id, createdAt: org.createdAt, updatedAt: Date.now() };
      map.set(id, updated);
      return updated;
    },
    async list() { return Array.from(map.values()); },
    async delete(id: string) { map.delete(id); },
    getCurrent: () => current,
    setCurrent: (o: Org | null) => { current = o; },
    dispose() { map.clear(); current = null; },
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
        orgId: input.orgId,
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
        orgId: item.orgId,
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
    async resolve(id: string, orgId: string, action: ReviewAction, comment?: string) {
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
        orgId,
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
