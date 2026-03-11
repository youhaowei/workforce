import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Session, WorkAgentConfig } from './types';
import { VALID_TRANSITIONS } from './types';
import type { LifecycleDeps } from './session-lifecycle';
import { createWorkAgent, transitionState, listByState, getChildren } from './session-lifecycle';
import { getEventBus } from '@/shared/event-bus';

vi.mock('./session-journal', () => ({
  writeRecords: vi.fn(),
  JSONL_VERSION: 2,
}));

function makeDeps(sessions?: Map<string, Session>): LifecycleDeps {
  let idCounter = 0;
  const map = sessions ?? new Map<string, Session>();
  return {
    sessions: map,
    sessionsDir: '/tmp/test-sessions',
    generateId: () => `sess-${++idCounter}`,
    registerSession: vi.fn((s: Session) => map.set(s.id, s)),
    writeRecords: vi.fn(),
    ensureInitialized: vi.fn(),
  };
}

function makeConfig(overrides?: Partial<WorkAgentConfig>): WorkAgentConfig {
  return {
    templateId: 'tpl-1',
    goal: 'Test goal',
    orgId: 'org-1',
    ...overrides,
  };
}

function makeSession(id: string, overrides?: Partial<Session>): Session {
  return {
    id,
    createdAt: 1000,
    updatedAt: 1000,
    messages: [],
    metadata: {},
    ...overrides,
  };
}

describe('session-lifecycle', () => {
  let bus: ReturnType<typeof getEventBus>;

  beforeEach(() => {
    bus = getEventBus();
  });

  afterEach(() => {
    bus.dispose();
  });

  describe('createWorkAgent', () => {
    it('creates a session with lifecycle metadata', async () => {
      const deps = makeDeps();
      const session = await createWorkAgent(deps, makeConfig());

      expect(session.id).toBe('sess-1');
      expect(session.title).toBe('Test goal');
      expect(session.metadata.type).toBe('workagent');
      expect(session.metadata.lifecycle).toMatchObject({
        state: 'created',
        stateHistory: [],
      });
      expect(session.metadata.templateId).toBe('tpl-1');
      expect(session.metadata.orgId).toBe('org-1');
    });

    it('registers the session as ready', async () => {
      const deps = makeDeps();
      await createWorkAgent(deps, makeConfig());
      expect(deps.registerSession).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'sess-1' }),
        'ready',
      );
    });

    it('emits SessionChange event', async () => {
      const deps = makeDeps();
      const events: unknown[] = [];
      bus.on('SessionChange', (e) => events.push(e));

      await createWorkAgent(deps, makeConfig());

      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        type: 'SessionChange',
        sessionId: 'sess-1',
        action: 'created',
      });
    });

    it('sets parentId when provided', async () => {
      const deps = makeDeps();
      const session = await createWorkAgent(deps, makeConfig({ parentId: 'parent-1' }));
      expect(session.parentId).toBe('parent-1');
    });

    it('passes workflow metadata', async () => {
      const deps = makeDeps();
      const session = await createWorkAgent(deps, makeConfig({
        workflowId: 'wf-1',
        workflowStepIndex: 2,
        worktreePath: '/tmp/wt',
        repoRoot: '/repo',
      }));
      expect(session.metadata.workflowId).toBe('wf-1');
      expect(session.metadata.workflowStepIndex).toBe(2);
      expect(session.metadata.worktreePath).toBe('/tmp/wt');
      expect(session.metadata.repoRoot).toBe('/repo');
    });
  });

  describe('transitionState', () => {
    it('transitions created → active', async () => {
      const deps = makeDeps();
      const session = await createWorkAgent(deps, makeConfig());
      const updated = await transitionState(deps, session.id, 'active', 'starting work');

      const lifecycle = updated.metadata.lifecycle as { state: string; stateHistory: unknown[] };
      expect(lifecycle.state).toBe('active');
      expect(lifecycle.stateHistory).toHaveLength(1);
      expect(lifecycle.stateHistory[0]).toMatchObject({
        from: 'created',
        to: 'active',
        reason: 'starting work',
        actor: 'system',
      });
    });

    it('transitions active → paused with pauseReason', async () => {
      const deps = makeDeps();
      const session = await createWorkAgent(deps, makeConfig());
      await transitionState(deps, session.id, 'active', 'start');
      const paused = await transitionState(deps, session.id, 'paused', 'waiting for input', 'user');

      const lifecycle = paused.metadata.lifecycle as { state: string; pauseReason?: string };
      expect(lifecycle.state).toBe('paused');
      expect(lifecycle.pauseReason).toBe('waiting for input');
    });

    it('transitions active → failed with failureReason', async () => {
      const deps = makeDeps();
      const session = await createWorkAgent(deps, makeConfig());
      await transitionState(deps, session.id, 'active', 'start');
      const failed = await transitionState(deps, session.id, 'failed', 'out of memory');

      const lifecycle = failed.metadata.lifecycle as { state: string; failureReason?: string };
      expect(lifecycle.state).toBe('failed');
      expect(lifecycle.failureReason).toBe('out of memory');
    });

    it('transitions active → completed with completionSummary', async () => {
      const deps = makeDeps();
      const session = await createWorkAgent(deps, makeConfig());
      await transitionState(deps, session.id, 'active', 'start');
      const completed = await transitionState(deps, session.id, 'completed', 'task done');

      const lifecycle = completed.metadata.lifecycle as { state: string; completionSummary?: string };
      expect(lifecycle.state).toBe('completed');
      expect(lifecycle.completionSummary).toBe('task done');
    });

    it('throws on invalid transition', async () => {
      const deps = makeDeps();
      const session = await createWorkAgent(deps, makeConfig());

      await expect(transitionState(deps, session.id, 'completed', 'skip'))
        .rejects.toThrow(/Invalid state transition: created → completed/);
    });

    it('throws for terminal states', async () => {
      const deps = makeDeps();
      const session = await createWorkAgent(deps, makeConfig());
      await transitionState(deps, session.id, 'active', 'start');
      await transitionState(deps, session.id, 'completed', 'done');

      await expect(transitionState(deps, session.id, 'active', 'restart'))
        .rejects.toThrow(/Invalid state transition: completed → active/);
    });

    it('throws if session not found', async () => {
      const deps = makeDeps();
      await expect(transitionState(deps, 'missing', 'active', 'start'))
        .rejects.toThrow('Session not found: missing');
    });

    it('emits LifecycleTransition event', async () => {
      const deps = makeDeps();
      const session = await createWorkAgent(deps, makeConfig());
      const events: unknown[] = [];
      bus.on('LifecycleTransition', (e) => events.push(e));

      await transitionState(deps, session.id, 'active', 'start', 'agent');

      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        type: 'LifecycleTransition',
        from: 'created',
        to: 'active',
        reason: 'start',
        actor: 'agent',
      });
    });

    it('writes meta record with updated lifecycle', async () => {
      const deps = makeDeps();
      const session = await createWorkAgent(deps, makeConfig());
      await transitionState(deps, session.id, 'active', 'start');

      expect(deps.writeRecords).toHaveBeenCalledWith(
        session.id,
        [expect.objectContaining({ t: 'meta' })],
      );
    });

    it('terminal states have no outgoing transitions', () => {
      expect(VALID_TRANSITIONS.completed).toEqual([]);
      expect(VALID_TRANSITIONS.failed).toEqual([]);
      expect(VALID_TRANSITIONS.cancelled).toEqual([]);
    });
  });

  describe('listByState', () => {
    it('returns sessions matching the state', async () => {
      const sessions = new Map<string, Session>();
      sessions.set('s1', makeSession('s1', { metadata: { lifecycle: { state: 'active', stateHistory: [] } } }));
      sessions.set('s2', makeSession('s2', { metadata: { lifecycle: { state: 'completed', stateHistory: [] } } }));
      sessions.set('s3', makeSession('s3', { metadata: { lifecycle: { state: 'active', stateHistory: [] }, orgId: 'org-1' } }));

      const deps = makeDeps(sessions);
      const result = await listByState(deps, 'active');
      expect(result).toHaveLength(2);
      expect(result.map((s) => s.id).sort()).toEqual(['s1', 's3']);
    });

    it('filters by orgId when provided', async () => {
      const sessions = new Map<string, Session>();
      sessions.set('s1', makeSession('s1', { metadata: { lifecycle: { state: 'active', stateHistory: [] }, orgId: 'org-1' } }));
      sessions.set('s2', makeSession('s2', { metadata: { lifecycle: { state: 'active', stateHistory: [] }, orgId: 'org-2' } }));

      const deps = makeDeps(sessions);
      const result = await listByState(deps, 'active', 'org-1');
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('s1');
    });

    it('returns empty array when no matches', async () => {
      const deps = makeDeps();
      const result = await listByState(deps, 'active');
      expect(result).toEqual([]);
    });

    it('excludes sessions without lifecycle metadata', async () => {
      const sessions = new Map<string, Session>();
      sessions.set('s1', makeSession('s1')); // no lifecycle
      const deps = makeDeps(sessions);
      const result = await listByState(deps, 'created');
      expect(result).toEqual([]);
    });
  });

  describe('getChildren', () => {
    it('returns children sorted by createdAt DESC', async () => {
      const sessions = new Map<string, Session>();
      sessions.set('child-1', makeSession('child-1', { parentId: 'parent-1', createdAt: 1000 }));
      sessions.set('child-2', makeSession('child-2', { parentId: 'parent-1', createdAt: 2000 }));
      sessions.set('other', makeSession('other', { parentId: 'parent-2', createdAt: 3000 }));

      const deps = makeDeps(sessions);
      const result = await getChildren(deps, 'parent-1');
      expect(result).toHaveLength(2);
      expect(result[0].id).toBe('child-2'); // newer first
      expect(result[1].id).toBe('child-1');
    });

    it('returns empty array when no children', async () => {
      const deps = makeDeps();
      const result = await getChildren(deps, 'parent-1');
      expect(result).toEqual([]);
    });
  });
});
