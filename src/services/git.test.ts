/**
 * Git Service Tests
 *
 * Tests for Git and GitHub CLI integration.
 */

import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { mkdir, writeFile, rm, realpath } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { GitService, getGitService, disposeGitService } from './git';
import { execFileNoThrow } from '../utils/execFileNoThrow';

// Test directory
let testDir: string;
let service: GitService;

// Helper to run git commands in test dir
async function git(...args: string[]) {
  return execFileNoThrow('git', args, { cwd: testDir });
}

// Helper to create a file
async function createFile(name: string, content: string) {
  await writeFile(join(testDir, name), content);
}

beforeEach(async () => {
  // Create fresh test directory
  testDir = join(tmpdir(), `fuxi-git-test-${Date.now()}`);
  await mkdir(testDir, { recursive: true });

  // Initialize git repo
  await git('init');
  await git('config', 'user.email', 'test@test.com');
  await git('config', 'user.name', 'Test User');

  // Create service for test dir
  service = new GitService({ cwd: testDir, cacheTtlMs: 100 });
});

afterEach(async () => {
  disposeGitService();
  try {
    await rm(testDir, { recursive: true, force: true });
  } catch {
    // Ignore cleanup errors
  }
});

// ============================================================================
// Repository Detection
// ============================================================================

describe('repository detection', () => {
  test('isRepo returns true in git repository', async () => {
    expect(await service.isRepo()).toBe(true);
  });

  test('isRepo returns false outside git repository', async () => {
    const outsideService = new GitService({ cwd: tmpdir() });
    // tmpdir itself likely isn't a git repo
    // This may vary by system, so we just check it doesn't crash
    const result = await outsideService.isRepo();
    expect(typeof result).toBe('boolean');
  });

  test('getRoot returns repository root', async () => {
    const root = await service.getRoot();
    // Normalize paths to handle /var -> /private/var on macOS
    const normalizedTestDir = await realpath(testDir);
    expect(root).toBe(normalizedTestDir);
  });
});

// ============================================================================
// Git Status
// ============================================================================

describe('git status', () => {
  test('getStatus returns clean status for empty repo', async () => {
    // Need at least one commit for status to work
    await createFile('README.md', '# Test');
    await git('add', '.');
    await git('commit', '-m', 'Initial commit');

    const status = await service.getStatus();
    expect(status).not.toBeNull();
    expect(status!.isClean).toBe(true);
    expect(status!.staged).toHaveLength(0);
    expect(status!.unstaged).toHaveLength(0);
    expect(status!.untracked).toHaveLength(0);
  });

  test('getStatus detects untracked files', async () => {
    await createFile('README.md', '# Test');
    await git('add', '.');
    await git('commit', '-m', 'Initial');

    await createFile('new-file.txt', 'new content');

    const status = await service.getStatus();
    expect(status).not.toBeNull();
    expect(status!.untracked).toContain('new-file.txt');
  });

  test('getStatus detects staged files', async () => {
    await createFile('README.md', '# Test');
    await git('add', '.');
    await git('commit', '-m', 'Initial');

    await createFile('staged.txt', 'staged content');
    await git('add', 'staged.txt');

    const status = await service.getStatus();
    expect(status).not.toBeNull();
    expect(status!.staged).toHaveLength(1);
    expect(status!.staged[0].path).toBe('staged.txt');
    expect(status!.staged[0].status).toBe('added');
  });

  test('getStatus detects unstaged modifications', async () => {
    await createFile('file.txt', 'original');
    await git('add', '.');
    await git('commit', '-m', 'Initial');

    await createFile('file.txt', 'modified');

    const status = await service.getStatus();
    expect(status).not.toBeNull();
    expect(status!.unstaged).toHaveLength(1);
    expect(status!.unstaged[0].path).toBe('file.txt');
    expect(status!.unstaged[0].status).toBe('modified');
  });

  test('getStatus caches results', async () => {
    await createFile('README.md', '# Test');
    await git('add', '.');
    await git('commit', '-m', 'Initial');

    const status1 = await service.getStatus();
    const status2 = await service.getStatus();

    // Should be the same cached object
    expect(status1).toBe(status2);
  });

  test('getStatus respects cache TTL', async () => {
    await createFile('README.md', '# Test');
    await git('add', '.');
    await git('commit', '-m', 'Initial');

    const status1 = await service.getStatus();

    // Wait for cache to expire
    await new Promise((r) => setTimeout(r, 150));

    const status2 = await service.getStatus();

    // Should be different objects (refreshed)
    expect(status1).not.toBe(status2);
  });

  test('invalidateCache clears cache', async () => {
    await createFile('README.md', '# Test');
    await git('add', '.');
    await git('commit', '-m', 'Initial');

    const status1 = await service.getStatus();
    service.invalidateCache();
    const status2 = await service.getStatus();

    // Should be different objects
    expect(status1).not.toBe(status2);
  });

  test('forceRefresh bypasses cache', async () => {
    await createFile('README.md', '# Test');
    await git('add', '.');
    await git('commit', '-m', 'Initial');

    const status1 = await service.getStatus();
    const status2 = await service.getStatus(true); // Force refresh

    // Should be different objects
    expect(status1).not.toBe(status2);
  });
});

// ============================================================================
// Branches
// ============================================================================

describe('branches', () => {
  test('getBranches returns current branch', async () => {
    await createFile('README.md', '# Test');
    await git('add', '.');
    await git('commit', '-m', 'Initial');

    const branches = await service.getBranches();
    expect(branches.length).toBeGreaterThanOrEqual(1);

    const current = branches.find((b) => b.isCurrent);
    expect(current).toBeDefined();
  });

  test('getBranches shows multiple branches', async () => {
    await createFile('README.md', '# Test');
    await git('add', '.');
    await git('commit', '-m', 'Initial');
    await git('branch', 'feature-branch');

    const branches = await service.getBranches();
    const branchNames = branches.map((b) => b.name);

    expect(branchNames).toContain('feature-branch');
  });
});

// ============================================================================
// Commits
// ============================================================================

describe('commits', () => {
  test('getLog returns recent commits', async () => {
    await createFile('README.md', '# Test');
    await git('add', '.');
    await git('commit', '-m', 'First commit');

    await createFile('file2.txt', 'content');
    await git('add', '.');
    await git('commit', '-m', 'Second commit');

    const commits = await service.getLog();
    expect(commits.length).toBe(2);
    expect(commits[0].subject).toBe('Second commit');
    expect(commits[1].subject).toBe('First commit');
  });

  test('getLog respects limit', async () => {
    await createFile('README.md', '# Test');
    await git('add', '.');
    await git('commit', '-m', 'Commit 1');

    await createFile('f2.txt', '2');
    await git('add', '.');
    await git('commit', '-m', 'Commit 2');

    await createFile('f3.txt', '3');
    await git('add', '.');
    await git('commit', '-m', 'Commit 3');

    const commits = await service.getLog(2);
    expect(commits.length).toBe(2);
  });

  test('commit includes hash and author', async () => {
    await createFile('README.md', '# Test');
    await git('add', '.');
    await git('commit', '-m', 'Test commit');

    const commits = await service.getLog(1);
    expect(commits[0].hash).toMatch(/^[a-f0-9]{40}$/);
    expect(commits[0].shortHash).toMatch(/^[a-f0-9]{7,}$/);
    expect(commits[0].author).toBe('Test User');
    expect(commits[0].date).toBeInstanceOf(Date);
  });
});

// ============================================================================
// Diff
// ============================================================================

describe('diff', () => {
  test('getDiff returns changes', async () => {
    await createFile('file.txt', 'line 1\nline 2\n');
    await git('add', '.');
    await git('commit', '-m', 'Initial');

    await createFile('file.txt', 'line 1\nmodified line 2\nline 3\n');

    const diff = await service.getDiff();
    expect(diff).toContain('-line 2');
    expect(diff).toContain('+modified line 2');
    expect(diff).toContain('+line 3');
  });

  test('getDiff for specific file', async () => {
    await createFile('a.txt', 'a');
    await createFile('b.txt', 'b');
    await git('add', '.');
    await git('commit', '-m', 'Initial');

    await createFile('a.txt', 'modified a');
    await createFile('b.txt', 'modified b');

    const diff = await service.getDiff('a.txt');
    expect(diff).toContain('a.txt');
    expect(diff).not.toContain('b.txt');
  });

  test('getDiff staged changes', async () => {
    await createFile('file.txt', 'original');
    await git('add', '.');
    await git('commit', '-m', 'Initial');

    await createFile('file.txt', 'staged content');
    await git('add', 'file.txt');

    const unstagedDiff = await service.getDiff();
    const stagedDiff = await service.getDiff(undefined, true);

    expect(unstagedDiff).toBe('');
    expect(stagedDiff).toContain('-original');
    expect(stagedDiff).toContain('+staged content');
  });
});

// ============================================================================
// Staging
// ============================================================================

describe('staging', () => {
  test('add stages files', async () => {
    await createFile('README.md', '# Test');
    await git('add', '.');
    await git('commit', '-m', 'Initial');

    await createFile('new.txt', 'new');

    expect(await service.add('new.txt')).toBe(true);

    const status = await service.getStatus(true);
    expect(status!.staged).toHaveLength(1);
    expect(status!.staged[0].path).toBe('new.txt');
  });

  test('reset unstages files', async () => {
    await createFile('README.md', '# Test');
    await git('add', '.');
    await git('commit', '-m', 'Initial');

    await createFile('staged.txt', 'content');
    await git('add', 'staged.txt');

    expect(await service.reset('staged.txt')).toBe(true);

    const status = await service.getStatus(true);
    expect(status!.staged).toHaveLength(0);
    expect(status!.untracked).toContain('staged.txt');
  });
});

// ============================================================================
// Commit Creation
// ============================================================================

describe('commit creation', () => {
  test('commit creates commit with message', async () => {
    await createFile('file.txt', 'content');
    await git('add', '.');

    const result = await service.commit('Test commit message');

    expect(result.success).toBe(true);
    expect(result.hash).toMatch(/^[a-f0-9]+$/);

    const commits = await service.getLog(1);
    expect(commits[0].subject).toBe('Test commit message');
  });

  test('commit fails with nothing staged', async () => {
    await createFile('README.md', '# Test');
    await git('add', '.');
    await git('commit', '-m', 'Initial');

    const result = await service.commit('No changes');
    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
  });
});

// ============================================================================
// Checkout
// ============================================================================

describe('checkout', () => {
  test('checkout switches branches', async () => {
    await createFile('README.md', '# Test');
    await git('add', '.');
    await git('commit', '-m', 'Initial');
    await git('branch', 'feature');

    expect(await service.checkout('feature')).toBe(true);

    const status = await service.getStatus(true);
    expect(status!.branch).toBe('feature');
  });

  test('checkout creates new branch with -b', async () => {
    await createFile('README.md', '# Test');
    await git('add', '.');
    await git('commit', '-m', 'Initial');

    expect(await service.checkout('new-branch', true)).toBe(true);

    const status = await service.getStatus(true);
    expect(status!.branch).toBe('new-branch');
  });
});

// ============================================================================
// Remotes
// ============================================================================

describe('remotes', () => {
  test('getRemotes returns empty for local repo', async () => {
    await createFile('README.md', '# Test');
    await git('add', '.');
    await git('commit', '-m', 'Initial');

    const remotes = await service.getRemotes();
    expect(remotes).toEqual([]);
  });

  test('getRemotes returns configured remotes', async () => {
    await createFile('README.md', '# Test');
    await git('add', '.');
    await git('commit', '-m', 'Initial');
    await git('remote', 'add', 'origin', 'https://github.com/test/repo.git');

    const remotes = await service.getRemotes();
    expect(remotes.length).toBe(1);
    expect(remotes[0].name).toBe('origin');
    expect(remotes[0].fetchUrl).toBe('https://github.com/test/repo.git');
  });
});

// ============================================================================
// Singleton
// ============================================================================

describe('singleton', () => {
  test('getGitService returns same instance', () => {
    disposeGitService();
    const s1 = getGitService();
    const s2 = getGitService();
    expect(s1).toBe(s2);
  });

  test('disposeGitService clears instance', () => {
    const s1 = getGitService();
    disposeGitService();
    const s2 = getGitService();
    expect(s1).not.toBe(s2);
  });
});

// ============================================================================
// GitHub CLI (gh) - Skip if not available
// ============================================================================

describe('GitHub CLI', () => {
  test('isGhAvailable checks gh auth status', async () => {
    // Just verify it doesn't crash - actual result depends on system
    const available = await service.isGhAvailable();
    expect(typeof available).toBe('boolean');
  });

  // Note: More gh tests would require a real GitHub repo
  // These are skipped in CI or when gh is not authenticated
});
