import { describe, it, expect, beforeEach, afterEach, afterAll } from 'vitest';
import { mkdir, rm, writeFile } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { createCaller, resetRouterServices } from './index';
import { resetSessionService } from '@/services/session';
import { resetOrgService } from '@/services/org';
import { resetTaskService } from '@/services/task';
import { resetTemplateService } from '@/services/template';
import { getWorktreeService, resetWorktreeService } from '@/services/worktree';
import { execFileNoThrow } from '@/utils/execFileNoThrow';

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
    resetOrgService();
    resetTaskService();
    resetTemplateService();
    resetWorktreeService();
    resetRouterServices();
  });

  afterAll(() => {
    resetSessionService();
    resetOrgService();
    resetTaskService();
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

  describe('org', () => {
    it('list returns array', async () => {
      const result = await caller.org.list();
      expect(Array.isArray(result)).toBe(true);
    });

    it('create and get org', async () => {
      const ws = await caller.org.create({
        name: 'test-ws',
        rootPath: '/tmp/test-ws',
      });
      expect(ws).toHaveProperty('id');
      expect(ws.name).toBe('test-ws');

      const fetched = await caller.org.get({ id: ws.id });
      expect(fetched).not.toBeNull();
      expect(fetched!.name).toBe('test-ws');

      // Cleanup
      await caller.org.delete({ id: ws.id });
    });

    it('activate sets current org', async () => {
      const ws = await caller.org.create({
        name: 'active-test',
        rootPath: '/tmp/active-test',
      });

      const activated = await caller.org.activate({ id: ws.id });
      expect(activated.id).toBe(ws.id);

      const current = await caller.org.getCurrent();
      expect(current).not.toBeNull();
      expect(current!.id).toBe(ws.id);

      // Cleanup
      await caller.org.delete({ id: ws.id });
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

  describe('task', () => {
    it('list returns array', async () => {
      const result = await caller.task.list();
      expect(Array.isArray(result)).toBe(true);
    });

    it('create, update, and delete task', async () => {
      const task = await caller.task.create({
        title: 'Test task',
        description: 'Test description',
      });
      expect(task).toHaveProperty('id');
      expect(task.title).toBe('Test task');
      expect(task.status).toBe('pending');

      // Start it
      const started = await caller.task.updateStatus({
        id: task.id,
        status: 'in_progress',
      });
      expect(started).not.toBeNull();
      expect(started!.status).toBe('in_progress');

      // Complete it
      const completed = await caller.task.updateStatus({
        id: task.id,
        status: 'completed',
      });
      expect(completed).not.toBeNull();
      expect(completed!.status).toBe('completed');

      // Delete
      const deleted = await caller.task.delete({ id: task.id });
      expect(deleted).toBe(true);
    });
  });

  describe('review', () => {
    it('list requires orgId', async () => {
      // Create an org first for valid orgId
      const ws = await caller.org.create({
        name: 'review-test',
        rootPath: '/tmp/review-test',
      });

      const result = await caller.review.listPending({ orgId: ws.id });
      expect(Array.isArray(result)).toBe(true);

      const count = await caller.review.count({ orgId: ws.id });
      expect(typeof count).toBe('number');

      // Cleanup
      await caller.org.delete({ id: ws.id });
    });
  });

  describe('audit', () => {
    it('org audit returns array', async () => {
      const ws = await caller.org.create({
        name: 'audit-test',
        rootPath: '/tmp/audit-test',
      });

      const entries = await caller.audit.org({ orgId: ws.id });
      expect(Array.isArray(entries)).toBe(true);

      // Cleanup
      await caller.org.delete({ id: ws.id });
    });
  });

  describe('worktree', () => {
    it('keep rejects when no worktree exists', async () => {
      const session = await caller.session.create({ title: 'keep-guard' });

      await expect(
        caller.worktree.keep({ sessionId: session.id }),
      ).rejects.toThrow();

      await caller.session.delete({ sessionId: session.id });
    });

    it('keep transitions session to completed and leaves worktree active', async () => {
      // Set up a temp git repo for a real worktree
      const testDir = join(tmpdir(), 'workforce-keep-test-' + Date.now());
      const repoPath = join(testDir, 'repo');
      await mkdir(repoPath, { recursive: true });
      await execFileNoThrow('git', ['init'], { cwd: repoPath });
      await execFileNoThrow('git', ['config', 'user.email', 'test@test.com'], { cwd: repoPath });
      await execFileNoThrow('git', ['config', 'user.name', 'Test'], { cwd: repoPath });
      await writeFile(join(repoPath, 'README.md'), '# Test\n');
      await execFileNoThrow('git', ['add', '.'], { cwd: repoPath });
      await execFileNoThrow('git', ['commit', '-m', 'init'], { cwd: repoPath });

      // Create session and transition to active (keep requires active → completed)
      const session = await caller.session.create({ title: 'keep-happy' });
      await caller.session.transition({
        sessionId: session.id,
        state: 'active',
        reason: 'test',
      });

      // Create a real worktree for this session
      const worktreeService = getWorktreeService();
      await worktreeService.create(session.id, repoPath);

      // Call keep
      const result = await caller.worktree.keep({ sessionId: session.id });
      expect(result).toEqual({ success: true });

      // Session should be completed
      const updated = await caller.session.get({ sessionId: session.id });
      expect(updated).not.toBeNull();
      const lifecycle = updated!.metadata.lifecycle as { state: string } | undefined;
      expect(lifecycle?.state).toBe('completed');

      // Worktree should still exist
      const wtInfo = worktreeService.getForSession(session.id);
      expect(wtInfo).not.toBeNull();
      expect(wtInfo!.status).toBe('active');

      // Cleanup
      await caller.session.delete({ sessionId: session.id });
      await rm(testDir, { recursive: true, force: true });
    });
  });

  describe('input validation', () => {
    it('rejects missing required fields', async () => {
      await expect(
        // @ts-expect-error - Testing validation
        caller.org.create({ name: 'test' }),
      ).rejects.toThrow();
    });

    it('accepts optional fields', async () => {
      const result = await caller.session.list();
      expect(Array.isArray(result)).toBe(true);
    });
  });
});
