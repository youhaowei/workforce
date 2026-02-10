import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { join } from 'path';
import { tmpdir } from 'os';
import { mkdir, rm, writeFile } from 'fs/promises';
import {
  getDomainService,
  resetDomainService,
  resetWorkAgentOrchestrationService,
  resetWorktreeService,
  resetWorkspaceService,
} from './index';
import { getWorkAgentOrchestrationService } from './orchestration';
import { execFileNoThrow } from '../utils/execFileNoThrow';

let workforceHome = '';
let repoRoot = '';

async function git(cwd: string, ...args: string[]) {
  return execFileNoThrow('git', args, { cwd });
}

beforeEach(async () => {
  workforceHome = join(tmpdir(), `workforce-orchestration-test-${Date.now()}`);
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
  resetDomainService();
  resetWorkAgentOrchestrationService();
  resetWorktreeService();
});

afterEach(async () => {
  resetWorktreeService();
  await rm(workforceHome, { recursive: true, force: true });
});

describe('WorkAgentOrchestrationService', () => {
  it('spawns workagent and transitions it to active by default', async () => {
    const service = getWorkAgentOrchestrationService();
    const agent = await service.spawn({
      title: 'Spawned Agent',
      goal: 'Run orchestration test',
    });

    expect(agent.state).toBe('active');
    expect(agent.progress).toBeGreaterThanOrEqual(1);
  });

  it('spawns child and computes aggregate progress', async () => {
    const service = getWorkAgentOrchestrationService();

    const parent = await getDomainService().createWorkAgent({
      title: 'Parent',
      goal: 'Parent goal',
    });

    const childA = await service.spawnChild(parent.id, {
      title: 'Child A',
      goal: 'A',
      activate: false,
    });
    await service.complete(childA.id, 100);

    const childB = await service.spawnChild(parent.id, {
      title: 'Child B',
      goal: 'B',
      activate: false,
    });
    await service.fail(childB.id, 'test failure');

    const childC = await service.spawnChild(parent.id, {
      title: 'Child C',
      goal: 'C',
      activate: false,
    });
    await service.pause(childC.id, 'paused for review');

    const progress = await service.getAggregateProgress(parent.id);

    expect(progress.total).toBe(3);
    expect(progress.completed).toBe(1);
    expect(progress.failed).toBe(1);
    expect(progress.paused).toBe(1);
    expect(progress.progress).toBe(Math.round((2 / 3) * 100));
  });

  it('supports pause/resume/cancel lifecycle APIs', async () => {
    const service = getWorkAgentOrchestrationService();
    const agent = await service.spawn({
      title: 'Lifecycle Agent',
      goal: 'Lifecycle validation',
    });

    const paused = await service.pause(agent.id, 'manual pause');
    expect(paused.state).toBe('paused');
    expect(paused.pauseReason).toBe('manual pause');

    const resumed = await service.resume(agent.id);
    expect(resumed.state).toBe('active');

    const cancelled = await service.cancel(agent.id, 'manual cancel');
    expect(cancelled.state).toBe('cancelled');
  });

  it('creates and archives worktree when isolation is enabled', async () => {
    const service = getWorkAgentOrchestrationService();
    const agent = await service.spawn({
      title: 'Isolated Agent',
      goal: 'Work in isolated tree',
      isolateWorktree: true,
      repoRoot,
    });

    const outputs = await getDomainService().listOutputs();
    const output = outputs.find((item) => item.agentId === agent.id);
    expect(output).toBeTruthy();
    expect(output?.branchName).toContain(agent.id);
    expect(output?.worktreePath).toContain(`agent-${agent.id}`);

    await service.complete(agent.id, 100);
  });
});
