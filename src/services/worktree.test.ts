import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdir, rm, writeFile } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { execFileNoThrow } from '../utils/execFileNoThrow';
import { getWorktreeService, resetWorktreeService } from './worktree';
import { resetWorkspaceService } from './workspace';

let workforceHome = '';
let repoRoot = '';

async function git(cwd: string, ...args: string[]) {
  return execFileNoThrow('git', args, { cwd });
}

beforeEach(async () => {
  workforceHome = join(tmpdir(), `workforce-worktree-test-${Date.now()}`);
  repoRoot = join(workforceHome, 'repo');
  process.env.WORKFORCE_HOME = workforceHome;

  await mkdir(repoRoot, { recursive: true });
  await git(repoRoot, 'init');
  await git(repoRoot, 'config', 'user.email', 'test@test.com');
  await git(repoRoot, 'config', 'user.name', 'Test User');
  await writeFile(join(repoRoot, 'README.md'), '# repo\n', 'utf-8');
  await git(repoRoot, 'add', '.');
  await git(repoRoot, 'commit', '-m', 'init');

  resetWorkspaceService();
  resetWorktreeService();
});

afterEach(async () => {
  resetWorktreeService();
  resetWorkspaceService();
  await rm(workforceHome, { recursive: true, force: true });
});

describe('WorktreeService', () => {
  it('creates a git worktree and tracks it in state', async () => {
    const service = getWorktreeService();
    const created = await service.create({
      sessionId: 'sess-1',
      repoRoot,
    });

    expect(created.sessionId).toBe('sess-1');
    expect(created.branch).toBe('workforce/sess-1');
    expect(created.status).toBe('active');

    const listed = await service.list();
    expect(listed).toHaveLength(1);
    expect(listed[0]?.path).toBe(created.path);
  });

  it('archives a worktree by removing checkout and setting status', async () => {
    const service = getWorktreeService();
    await service.create({ sessionId: 'sess-2', repoRoot });

    const archived = await service.archive('sess-2');
    expect(archived.status).toBe('archived');

    const read = await service.getBySession('sess-2');
    expect(read?.status).toBe('archived');
  });
});
