/**
 * WorktreeService Tests
 *
 * Tests for git worktree creation, merging, archiving, deletion, and state tracking.
 * Uses real temporary git repositories for integration testing.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdir, rm, writeFile } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { execFileNoThrow } from '../utils/execFileNoThrow';
import { createWorktreeService } from './worktree';
import type { WorktreeService } from './types';

const TEST_BASE = join(tmpdir(), 'workforce-worktree-test-' + Date.now());

/** Create a temporary git repo with an initial commit */
async function createTestRepo(name: string): Promise<string> {
  const repoPath = join(TEST_BASE, 'repos', name);
  await mkdir(repoPath, { recursive: true });

  await execFileNoThrow('git', ['init'], { cwd: repoPath });
  await execFileNoThrow('git', ['config', 'user.email', 'test@test.com'], { cwd: repoPath });
  await execFileNoThrow('git', ['config', 'user.name', 'Test'], { cwd: repoPath });

  await writeFile(join(repoPath, 'README.md'), '# Test Repo\n');
  await execFileNoThrow('git', ['add', '.'], { cwd: repoPath });
  await execFileNoThrow('git', ['commit', '-m', 'Initial commit'], { cwd: repoPath });

  return repoPath;
}

/** Create a fresh service with isolated worktree base */
function freshService(name: string): WorktreeService {
  return createWorktreeService(join(TEST_BASE, 'worktrees', name));
}

describe('WorktreeService', () => {
  beforeAll(async () => {
    await mkdir(TEST_BASE, { recursive: true });
  });

  afterAll(async () => {
    await rm(TEST_BASE, { recursive: true, force: true });
  });

  describe('create', () => {
    it('should create a worktree for a session', async () => {
      const repo = await createTestRepo('create-test');
      const service = freshService('create-test');

      const info = await service.create('sess_test1', repo);

      expect(info.sessionId).toBe('sess_test1');
      expect(info.branch).toBe('workforce/sess_test1');
      expect(info.status).toBe('active');
      expect(info.repoRoot).toBe(repo);
      expect(info.path).toContain('workforce-sess_test1');
      expect(info.createdAt).toBeLessThanOrEqual(Date.now());

      // Verify the worktree actually exists in git
      const result = await execFileNoThrow('git', ['worktree', 'list'], { cwd: repo });
      expect(result.stdout).toContain('workforce-sess_test1');

      service.dispose();
    });

    it('should use custom branch name when provided', async () => {
      const repo = await createTestRepo('custom-branch');
      const service = freshService('custom-branch');

      const info = await service.create('sess_custom', repo, 'feature/my-branch');
      expect(info.branch).toBe('feature/my-branch');

      service.dispose();
    });

    it('should throw if worktree already exists for session', async () => {
      const repo = await createTestRepo('dup-test');
      const service = freshService('dup-test');

      await service.create('sess_dup', repo);

      await expect(service.create('sess_dup', repo)).rejects.toThrow(
        'Worktree already exists for session'
      );

      service.dispose();
    });
  });

  describe('getForSession', () => {
    it('should return worktree info for existing session', async () => {
      const repo = await createTestRepo('get-test');
      const service = freshService('get-test');

      const created = await service.create('sess_get', repo);
      const found = service.getForSession('sess_get');

      expect(found).not.toBeNull();
      expect(found!.sessionId).toBe('sess_get');
      expect(found!.path).toBe(created.path);

      service.dispose();
    });

    it('should return null for non-existent session', () => {
      const service = freshService('get-null');
      expect(service.getForSession('sess_nonexistent')).toBeNull();
      service.dispose();
    });
  });

  describe('list', () => {
    it('should list worktrees for a specific repo', async () => {
      const repo = await createTestRepo('list-test');
      const service = freshService('list-test');

      await service.create('sess_a', repo);
      await service.create('sess_b', repo);

      const list = await service.list(repo);
      expect(list).toHaveLength(2);

      const sessionIds = list.map((w) => w.sessionId).sort();
      expect(sessionIds).toEqual(['sess_a', 'sess_b']);

      service.dispose();
    });
  });

  describe('getDiff', () => {
    it('should return diff for modified worktree', async () => {
      const repo = await createTestRepo('diff-test');
      const service = freshService('diff-test');

      const info = await service.create('sess_diff', repo);

      // Make a change in the worktree
      await writeFile(join(info.path, 'new-file.txt'), 'Hello from agent\n');
      await execFileNoThrow('git', ['add', '.'], { cwd: info.path });

      const diff = await service.getDiff('sess_diff');
      expect(diff).toContain('new-file.txt');
      expect(diff).toContain('Hello from agent');

      service.dispose();
    });

    it('should return empty string for clean worktree', async () => {
      const repo = await createTestRepo('clean-diff');
      const service = freshService('clean-diff');

      await service.create('sess_clean', repo);

      const diff = await service.getDiff('sess_clean');
      expect(diff).toBe('');

      service.dispose();
    });

    it('should throw for non-existent session', async () => {
      const service = freshService('diff-throw');
      await expect(service.getDiff('sess_nope')).rejects.toThrow('Worktree not found');
      service.dispose();
    });
  });

  describe('merge', () => {
    it('should merge worktree changes back to main branch', async () => {
      const repo = await createTestRepo('merge-test');
      const service = freshService('merge-test');

      const info = await service.create('sess_merge', repo);

      // Make a commit in the worktree
      await writeFile(join(info.path, 'agent-output.txt'), 'Agent work\n');
      await execFileNoThrow('git', ['add', '.'], { cwd: info.path });
      await execFileNoThrow('git', ['commit', '-m', 'Agent work done'], { cwd: info.path });

      // Merge back
      const result = await service.merge('sess_merge');
      expect(result.success).toBe(true);

      // Verify the merge happened on the main branch
      const logResult = await execFileNoThrow('git', ['log', '--oneline', '-5'], { cwd: repo });
      expect(logResult.stdout).toContain('Agent work done');

      // Verify worktree state updated
      const updated = service.getForSession('sess_merge');
      expect(updated?.status).toBe('merged');

      service.dispose();
    });

    it('should throw for non-existent worktree', async () => {
      const service = freshService('merge-throw');
      await expect(service.merge('sess_fake')).rejects.toThrow('Worktree not found');
      service.dispose();
    });

    it('should throw for non-active worktree', async () => {
      const repo = await createTestRepo('merge-archived');
      const service = freshService('merge-archived');

      await service.create('sess_archived', repo);
      await service.archive('sess_archived');

      await expect(service.merge('sess_archived')).rejects.toThrow(
        'Cannot merge worktree in state: archived'
      );

      service.dispose();
    });
  });

  describe('archive', () => {
    it('should archive a worktree', async () => {
      const repo = await createTestRepo('archive-test');
      const service = freshService('archive-test');

      await service.create('sess_arch', repo);
      await service.archive('sess_arch');

      const info = service.getForSession('sess_arch');
      expect(info?.status).toBe('archived');

      // Worktree directory should be removed from git
      const listResult = await execFileNoThrow('git', ['worktree', 'list'], { cwd: repo });
      expect(listResult.stdout).not.toContain('workforce-sess_arch');

      service.dispose();
    });

    it('should throw for non-existent session', async () => {
      const service = freshService('archive-throw');
      await expect(service.archive('sess_nope')).rejects.toThrow('Worktree not found');
      service.dispose();
    });
  });

  describe('delete', () => {
    it('should fully remove worktree and branch', async () => {
      const repo = await createTestRepo('delete-test');
      const service = freshService('delete-test');

      await service.create('sess_del', repo);
      await service.delete('sess_del');

      expect(service.getForSession('sess_del')).toBeNull();

      const listResult = await execFileNoThrow('git', ['worktree', 'list'], { cwd: repo });
      expect(listResult.stdout).not.toContain('workforce-sess_del');

      // Branch should be deleted too
      const branchResult = await execFileNoThrow('git', ['branch', '--list', 'workforce/sess_del'], { cwd: repo });
      expect(branchResult.stdout.trim()).toBe('');

      service.dispose();
    });

    it('should throw for non-existent session', async () => {
      const service = freshService('delete-throw');
      await expect(service.delete('sess_nope')).rejects.toThrow('Worktree not found');
      service.dispose();
    });
  });

  describe('persistence', () => {
    it('should persist and reload worktree state', async () => {
      const repo = await createTestRepo('persist-test');
      const wtBase = join(TEST_BASE, 'worktrees', 'persist-test');

      // Create with first instance
      const service1 = createWorktreeService(wtBase);
      await service1.create('sess_persist', repo);
      service1.dispose();

      // Reload with second instance — trigger init via list()
      const service2 = createWorktreeService(wtBase);
      await service2.list(repo);
      const found = service2.getForSession('sess_persist');

      expect(found).not.toBeNull();
      expect(found!.sessionId).toBe('sess_persist');
      expect(found!.status).toBe('active');
      expect(found!.repoRoot).toBe(repo);

      service2.dispose();
    });
  });
});
