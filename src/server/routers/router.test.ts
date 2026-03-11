import { describe, it, expect, beforeEach, afterEach, afterAll } from 'vitest';
import { mkdir, rm, writeFile } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { createCaller, resetRouterServices } from './index';
import { resetSessionService } from '@/services/session';
import { resetOrgService } from '@/services/org';
import { resetUserService } from '@/services/user';
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
    resetUserService();
    resetTaskService();
    resetTemplateService();
    resetWorktreeService();
    resetRouterServices();
  });

  afterAll(() => {
    resetSessionService();
    resetOrgService();
    resetUserService();
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

    it('debugLog returns ring buffer entries', async () => {
      const result = await caller.health.debugLog({ lines: 10 });
      expect(result).toHaveProperty('entries');
      expect(Array.isArray(result.entries)).toBe(true);
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

  describe('user', () => {
    it('full lifecycle: exists, create, get, update', async () => {
      resetUserService();

      // Initially no user
      expect(await caller.user.exists()).toBe(false);
      expect(await caller.user.get()).toBeNull();

      // Create
      const user = await caller.user.create({ displayName: 'Jane Doe' });
      expect(user).toHaveProperty('id');
      expect(user.displayName).toBe('Jane Doe');
      expect(user.avatarColor).toMatch(/^#/);

      // Get
      const fetched = await caller.user.get();
      expect(fetched).not.toBeNull();
      expect(fetched!.displayName).toBe('Jane Doe');
      expect(await caller.user.exists()).toBe(true);

      // Update
      const updated = await caller.user.update({ displayName: 'Bob' });
      expect(updated.displayName).toBe('Bob');
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

    // ─── fork ──────────────────────────────────────────────────────────

    it('fork creates child session with parent messages', async () => {
      const parent = await caller.session.create({ title: 'Fork Parent' });
      await caller.session.addMessage({
        sessionId: parent.id,
        message: { id: 'msg_1', role: 'user', content: 'Hello', timestamp: 1 },
      });
      await caller.session.addMessage({
        sessionId: parent.id,
        message: { id: 'msg_2', role: 'user', content: 'World', timestamp: 2 },
      });

      const forked = await caller.session.fork({ sessionId: parent.id, atMessageIndex: 0 });

      expect(forked.parentId).toBe(parent.id);
      expect(forked.messages).toHaveLength(1);
      expect(forked.messages[0].content).toBe('Hello');
      expect(forked.title).toBe('Fork Parent (fork)');

      // Parent unchanged
      const parentAfter = await caller.session.get({ sessionId: parent.id });
      expect(parentAfter!.messages).toHaveLength(2);

      await caller.session.delete({ sessionId: forked.id });
      await caller.session.delete({ sessionId: parent.id });
    });

    it('fork rejects non-existent session with NOT_FOUND', async () => {
      await expect(
        caller.session.fork({ sessionId: 'ghost' }),
      ).rejects.toThrow(/not found/i);
    });

    it('fork rejects empty session with BAD_REQUEST', async () => {
      const empty = await caller.session.create({ title: 'Empty' });

      await expect(
        caller.session.fork({ sessionId: empty.id }),
      ).rejects.toThrow(/empty session/i);

      await caller.session.delete({ sessionId: empty.id });
    });

    it('fork rejects out-of-range index with BAD_REQUEST', async () => {
      const session = await caller.session.create({ title: 'Range' });
      await caller.session.addMessage({
        sessionId: session.id,
        message: { id: 'msg_1', role: 'user', content: 'Hi', timestamp: 1 },
      });

      await expect(
        caller.session.fork({ sessionId: session.id, atMessageIndex: 99 }),
      ).rejects.toThrow(/Invalid message index/i);

      await caller.session.delete({ sessionId: session.id });
    });

    // ─── rewind ────────────────────────────────────────────────────────

    it('rewind truncates session to message index', async () => {
      const session = await caller.session.create({ title: 'Rewind' });
      await caller.session.addMessage({
        sessionId: session.id,
        message: { id: 'msg_1', role: 'user', content: 'Keep', timestamp: 1 },
      });
      await caller.session.addMessage({
        sessionId: session.id,
        message: { id: 'msg_2', role: 'user', content: 'Remove', timestamp: 2 },
      });

      const result = await caller.session.rewind({ sessionId: session.id, messageIndex: 0 });

      expect(result.messages).toHaveLength(1);
      expect(result.messages[0].content).toBe('Keep');

      // Verify persistence
      const reloaded = await caller.session.get({ sessionId: session.id });
      expect(reloaded!.messages).toHaveLength(1);

      await caller.session.delete({ sessionId: session.id });
    });

    it('rewind rejects non-existent session with NOT_FOUND', async () => {
      await expect(
        caller.session.rewind({ sessionId: 'ghost', messageIndex: 0 }),
      ).rejects.toThrow(/not found/i);
    });

    it('rewind with -1 clears all messages', async () => {
      const session = await caller.session.create({ title: 'Rewind Clear' });
      await caller.session.addMessage({
        sessionId: session.id,
        message: { id: 'msg_1', role: 'user', content: 'Hi', timestamp: 1 },
      });
      await caller.session.addMessage({
        sessionId: session.id,
        message: { id: 'msg_2', role: 'assistant', content: 'Hello', timestamp: 2 },
      });

      const result = await caller.session.rewind({ sessionId: session.id, messageIndex: -1 });
      expect(result.messages).toHaveLength(0);

      await caller.session.delete({ sessionId: session.id });
    });

    it('rewind rejects out-of-range index with BAD_REQUEST', async () => {
      const session = await caller.session.create({ title: 'Rewind Range' });
      await caller.session.addMessage({
        sessionId: session.id,
        message: { id: 'msg_1', role: 'user', content: 'Hi', timestamp: 1 },
      });

      await expect(
        caller.session.rewind({ sessionId: session.id, messageIndex: 5 }),
      ).rejects.toThrow(/Invalid message index/i);

      await caller.session.delete({ sessionId: session.id });
    });

    // ─── forks query ───────────────────────────────────────────────────

    it('forks query returns fork info keyed by message ID', async () => {
      const parent = await caller.session.create({ title: 'Forks Parent' });
      await caller.session.addMessage({
        sessionId: parent.id,
        message: { id: 'msg_1', role: 'user', content: 'A', timestamp: 1 },
      });
      await caller.session.addMessage({
        sessionId: parent.id,
        message: { id: 'msg_2', role: 'user', content: 'B', timestamp: 2 },
      });

      // Fork at message 0 and message 1
      const fork1 = await caller.session.fork({ sessionId: parent.id, atMessageIndex: 0 });
      const fork2 = await caller.session.fork({ sessionId: parent.id, atMessageIndex: 1 });

      const forks = await caller.session.forks({ sessionId: parent.id });

      expect(forks).toHaveLength(2);
      expect(forks.find((f) => f.sessionId === fork1.id)?.messageId).toBe('msg_1');
      expect(forks.find((f) => f.sessionId === fork2.id)?.messageId).toBe('msg_2');

      await caller.session.delete({ sessionId: fork1.id });
      await caller.session.delete({ sessionId: fork2.id });
      await caller.session.delete({ sessionId: parent.id });
    });

    it('forks query returns empty array for session with no forks', async () => {
      const session = await caller.session.create({ title: 'No Forks' });
      await caller.session.addMessage({
        sessionId: session.id,
        message: { id: 'msg_1', role: 'user', content: 'Hi', timestamp: 1 },
      });

      const forks = await caller.session.forks({ sessionId: session.id });
      expect(forks).toEqual([]);

      await caller.session.delete({ sessionId: session.id });
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
        // @ts-expect-error - Testing validation: missing name
        caller.org.create({}),
      ).rejects.toThrow();
    });

    it('accepts optional fields', async () => {
      const result = await caller.session.list();
      expect(Array.isArray(result)).toBe(true);
    });
  });
});
