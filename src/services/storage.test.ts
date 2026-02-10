import { mkdir, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { LocalStorageAdapter } from './storage';

let testDir = '';

beforeEach(async () => {
  testDir = join(tmpdir(), `workforce-storage-test-${Date.now()}`);
  await mkdir(testDir, { recursive: true });
});

afterEach(async () => {
  await rm(testDir, { recursive: true, force: true });
});

describe('LocalStorageAdapter', () => {
  it('writes and reads json payloads', async () => {
    const adapter = new LocalStorageAdapter();

    await adapter.writeJson(testDir, 'state/test.json', { ok: true });
    const value = await adapter.readJson(testDir, 'state/test.json', { ok: false });

    expect(value).toEqual({ ok: true });
  });

  it('appends and reads jsonl events', async () => {
    const adapter = new LocalStorageAdapter();

    await adapter.appendEvent(testDir, 'history', {
      id: 'evt_1',
      workspaceId: 'ws_1',
      stream: 'history',
      entityId: 'entity_1',
      action: 'created',
      payload: { ok: true },
      timestamp: Date.now(),
    });

    const events = await adapter.readEvents(testDir, 'history');
    expect(events).toHaveLength(1);
    expect(events[0].entityId).toBe('entity_1');
  });
});
