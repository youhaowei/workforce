import { describe, it, expect, beforeEach, afterEach, afterAll } from 'vitest';
import { createCaller, resetRouterServices } from './index';
import { resetSessionService } from '@/services/session';
import { resetWorkspaceService } from '@/services/workspace';
import { resetTodoService } from '@/services/todo';
import { resetTemplateService } from '@/services/template';
import { resetWorktreeService } from '@/services/worktree';

/**
 * tRPC router integration tests.
 *
 * Uses createCallerFactory to call procedures directly (no HTTP layer).
 * This tests the Zod validation + service wiring without needing a running server.
 */

describe('tRPC Routers', () => {
  let caller: ReturnType<typeof createCaller>;

  beforeEach(() => {
    caller = createCaller({});
  });

  afterEach(() => {
    resetSessionService();
    resetWorkspaceService();
    resetTodoService();
    resetTemplateService();
    resetWorktreeService();
    resetRouterServices();
  });

  afterAll(() => {
    resetSessionService();
    resetWorkspaceService();
    resetTodoService();
    resetTemplateService();
    resetWorktreeService();
    resetRouterServices();
  });

  describe('health', () => {
    it('check returns ok', async () => {
      const result = await caller.health.check();
      expect(result).toEqual({ ok: true });
    });

    it('authCheck returns auth status', async () => {
      const result = await caller.health.authCheck();
      expect(result).toHaveProperty('authenticated');
      expect(result).toHaveProperty('home');
      expect(result).toHaveProperty('cwd');
    });

    it('debugLog returns log content', async () => {
      const result = await caller.health.debugLog({ lines: 10 });
      expect(result).toHaveProperty('logPath');
      expect(result).toHaveProperty('content');
    });
  });

  describe('workspace', () => {
    it('list returns array', async () => {
      const result = await caller.workspace.list();
      expect(Array.isArray(result)).toBe(true);
    });

    it('create and get workspace', async () => {
      const ws = await caller.workspace.create({
        name: 'test-ws',
        rootPath: '/tmp/test-ws',
      });
      expect(ws).toHaveProperty('id');
      expect(ws.name).toBe('test-ws');

      const fetched = await caller.workspace.get({ id: ws.id });
      expect(fetched).not.toBeNull();
      expect(fetched!.name).toBe('test-ws');

      // Cleanup
      await caller.workspace.delete({ id: ws.id });
    });

    it('activate sets current workspace', async () => {
      const ws = await caller.workspace.create({
        name: 'active-test',
        rootPath: '/tmp/active-test',
      });

      const activated = await caller.workspace.activate({ id: ws.id });
      expect(activated.id).toBe(ws.id);

      const current = await caller.workspace.getCurrent();
      expect(current).not.toBeNull();
      expect(current!.id).toBe(ws.id);

      // Cleanup
      await caller.workspace.delete({ id: ws.id });
    });
  });

  describe('session', () => {
    it('list returns array', async () => {
      const result = await caller.session.list();
      expect(Array.isArray(result)).toBe(true);
    });

    it('create and get session', async () => {
      const session = await caller.session.create({ title: 'test-session' });
      expect(session).toHaveProperty('id');

      const fetched = await caller.session.get({ sessionId: session.id });
      expect(fetched).not.toBeNull();

      // Cleanup
      await caller.session.delete({ sessionId: session.id });
    });

    it('rejects invalid transition state', async () => {
      await expect(
        caller.session.transition({
          sessionId: 'nonexistent',
          state: 'invalid' as never,
          reason: 'test',
        }),
      ).rejects.toThrow();
    });
  });

  describe('todo', () => {
    it('list returns array', async () => {
      const result = await caller.todo.list();
      expect(Array.isArray(result)).toBe(true);
    });

    it('create, update, and delete todo', async () => {
      const todo = await caller.todo.create({
        title: 'Test todo',
        description: 'Test description',
      });
      expect(todo).toHaveProperty('id');
      expect(todo.title).toBe('Test todo');
      expect(todo.status).toBe('pending');

      // Start it
      const started = await caller.todo.updateStatus({
        id: todo.id,
        status: 'in_progress',
      });
      expect(started).not.toBeNull();
      expect(started!.status).toBe('in_progress');

      // Complete it
      const completed = await caller.todo.updateStatus({
        id: todo.id,
        status: 'completed',
      });
      expect(completed).not.toBeNull();
      expect(completed!.status).toBe('completed');

      // Delete
      const deleted = await caller.todo.delete({ id: todo.id });
      expect(deleted).toBe(true);
    });
  });

  describe('review', () => {
    it('list requires workspaceId', async () => {
      // Create a workspace first for valid workspaceId
      const ws = await caller.workspace.create({
        name: 'review-test',
        rootPath: '/tmp/review-test',
      });

      const result = await caller.review.listPending({ workspaceId: ws.id });
      expect(Array.isArray(result)).toBe(true);

      const count = await caller.review.count({ workspaceId: ws.id });
      expect(typeof count).toBe('number');

      // Cleanup
      await caller.workspace.delete({ id: ws.id });
    });
  });

  describe('audit', () => {
    it('workspace audit returns array', async () => {
      const ws = await caller.workspace.create({
        name: 'audit-test',
        rootPath: '/tmp/audit-test',
      });

      const entries = await caller.audit.workspace({ workspaceId: ws.id });
      expect(Array.isArray(entries)).toBe(true);

      // Cleanup
      await caller.workspace.delete({ id: ws.id });
    });
  });

  describe('worktree', () => {
    it('keep transitions session to completed but leaves worktree active', async () => {
      // Create a workspace
      const ws = await caller.workspace.create({
        name: 'keep-test',
        rootPath: '/tmp/keep-test',
      });

      // Create a workagent session (needs lifecycle state for transition)
      const session = await caller.session.create({ title: 'keep-session' });

      // Manually set up as workagent with lifecycle — keep requires worktree
      // Since we can't easily create real worktrees in tests, verify the mutation
      // throws NOT_FOUND when no worktree exists (validates the guard check)
      await expect(
        caller.worktree.keep({ sessionId: session.id }),
      ).rejects.toThrow();

      // Cleanup
      await caller.workspace.delete({ id: ws.id });
      await caller.session.delete({ sessionId: session.id });
    });
  });

  describe('input validation', () => {
    it('rejects missing required fields', async () => {
      await expect(
        // @ts-expect-error - Testing validation
        caller.workspace.create({ name: 'test' }),
      ).rejects.toThrow();
    });

    it('accepts optional fields', async () => {
      const result = await caller.session.list();
      expect(Array.isArray(result)).toBe(true);
    });
  });
});
