import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdir, rm, writeFile, realpath } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { GitService } from '@/services/git';

describe('GitService (router backing)', () => {
  let repoDir: string;
  let svc: GitService;

  beforeEach(async () => {
    repoDir = join(tmpdir(), `git-router-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    await mkdir(repoDir, { recursive: true });

    const { execFileNoThrow } = await import('@/utils/execFileNoThrow');
    const git = (...args: string[]) => execFileNoThrow('git', args, { cwd: repoDir });

    await git('init');
    await git('config', 'user.email', 'test@test.com');
    await git('config', 'user.name', 'Test User');

    // Create initial commit so branch exists
    await writeFile(join(repoDir, 'README.md'), '# Test\n');
    await git('add', 'README.md');
    await git('commit', '-m', 'Initial commit');

    svc = new GitService({ cwd: repoDir });
  });

  afterEach(async () => {
    svc.dispose();
    await rm(repoDir, { recursive: true, force: true });
  });

  it('isRepo returns true for git repo', async () => {
    expect(await svc.isRepo()).toBe(true);
  });

  it('isRepo returns false for non-git dir', async () => {
    const tmpDir = join(tmpdir(), `non-git-${Date.now()}`);
    await mkdir(tmpDir, { recursive: true });
    const nonGit = new GitService({ cwd: tmpDir });
    expect(await nonGit.isRepo()).toBe(false);
    nonGit.dispose();
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('getStatus returns clean status after commit', async () => {
    const status = await svc.getStatus();
    expect(status).not.toBeNull();
    expect(status!.isClean).toBe(true);
    expect(status!.staged).toEqual([]);
    expect(status!.unstaged).toEqual([]);
    expect(status!.untracked).toEqual([]);
  });

  it('getStatus detects untracked files', async () => {
    await writeFile(join(repoDir, 'new.txt'), 'hello');
    const status = await svc.getStatus(true);
    expect(status!.isClean).toBe(false);
    expect(status!.untracked).toContain('new.txt');
  });

  it('add stages a file', async () => {
    await writeFile(join(repoDir, 'staged.txt'), 'staged');
    const ok = await svc.add('staged.txt');
    expect(ok).toBe(true);

    const status = await svc.getStatus(true);
    expect(status!.staged).toHaveLength(1);
    expect(status!.staged[0].path).toBe('staged.txt');
    expect(status!.staged[0].status).toBe('added');
  });

  it('reset unstages a file', async () => {
    await writeFile(join(repoDir, 'unstage.txt'), 'data');
    await svc.add('unstage.txt');

    const ok = await svc.reset('unstage.txt');
    expect(ok).toBe(true);

    const status = await svc.getStatus(true);
    expect(status!.staged).toHaveLength(0);
    expect(status!.untracked).toContain('unstage.txt');
  });

  it('commit creates a commit with staged files', async () => {
    await writeFile(join(repoDir, 'commit.txt'), 'content');
    await svc.add('commit.txt');
    const result = await svc.commit('Test commit');
    expect(result.success).toBe(true);
    expect(result.hash).toBeTruthy();

    const status = await svc.getStatus(true);
    expect(status!.isClean).toBe(true);
  });

  it('commit fails without staged files', async () => {
    const result = await svc.commit('Empty commit');
    expect(result.success).toBe(false);
    expect(result.error).toBeTruthy();
  });

  it('getBranches returns current branch', async () => {
    const branches = await svc.getBranches();
    expect(branches.length).toBeGreaterThan(0);
    const current = branches.find((b) => b.isCurrent);
    expect(current).toBeTruthy();
  });

  it('getLog returns commit history', async () => {
    const log = await svc.getLog(5);
    expect(log.length).toBeGreaterThan(0);
    expect(log[0].subject).toBe('Initial commit');
    expect(log[0].author).toBe('Test User');
  });

  it('getDiff returns empty for clean repo', async () => {
    const diff = await svc.getDiff();
    expect(diff).toBe('');
  });

  it('getDiff returns diff for modified files', async () => {
    await writeFile(join(repoDir, 'README.md'), '# Modified\n');
    const diff = await svc.getDiff();
    expect(diff).toContain('Modified');
  });

  it('getRoot returns repository root', async () => {
    const root = await svc.getRoot();
    // macOS: /var → /private/var symlink; resolve both to compare
    const resolvedRepo = await realpath(repoDir);
    expect(root).toBe(resolvedRepo);
  });
});
