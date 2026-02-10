import { rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { appRouter } from './trpc';
import { resetWorkspaceService, resetDomainService } from '@services/index';

let workforceHome = '';

beforeEach(() => {
  workforceHome = join(tmpdir(), `workforce-trpc-test-${Date.now()}`);
  process.env.WORKFORCE_HOME = workforceHome;
  resetWorkspaceService();
  resetDomainService();
});

afterEach(async () => {
  await rm(workforceHome, { recursive: true, force: true });
});

describe('tRPC router', () => {
  it('exposes workspace and board procedures', async () => {
    const caller = appRouter.createCaller({ requestId: 'test_req' });

    const workspace = await caller.workspace.current();
    expect(workspace.id).toBeTruthy();

    const board = await caller.board.get();
    expect(board.counts).toBeDefined();
    expect(board.lanes).toBeDefined();
  });

  it('supports stream.cancel mutation', async () => {
    const caller = appRouter.createCaller({ requestId: 'test_req' });
    const result = await caller.stream.cancel();
    expect(result.ok).toBe(true);
  });
});
