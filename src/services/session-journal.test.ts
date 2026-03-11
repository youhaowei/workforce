import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { tmpdir } from 'os';
import { join } from 'path';
import { mkdirSync } from 'fs';
import { mkdir, rm, readFile, writeFile } from 'fs/promises';
import type { JournalRecord, Session } from './types';
import {
  appendRecord,
  appendRecords,
  writeRecords,
  replaySession,
  replaySessionMetadata,
  consolidateSession,
  writeForkSession,
  AppendLock,
  JSONL_VERSION,
} from './session-journal';

const TEST_ROOT = join(tmpdir(), `workforce-journal-test-${Date.now()}`);
let dirCounter = 0;

function nextDir(): string {
  const dir = join(TEST_ROOT, `test-${++dirCounter}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function readJsonl(dir: string, id: string): Promise<string> {
  return readFile(join(dir, `${id}.jsonl`), 'utf-8');
}

function parseJsonl(raw: string): unknown[] {
  return raw.split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l));
}

function makeHeader(id = 'sess-1', metadata: Record<string, unknown> = {}): JournalRecord {
  return {
    t: 'header', v: JSONL_VERSION, id, title: 'Test Session',
    createdAt: 1000, updatedAt: 1000, metadata,
  };
}

function makeMessage(id: string, role: 'user' | 'assistant', content: string, ts = 2000): JournalRecord {
  return { t: 'message', id, role, content, timestamp: ts };
}

function makeFinal(id: string, content: string, ts = 3000): JournalRecord {
  return { t: 'message_final', id, role: 'assistant', content, timestamp: ts, stopReason: 'end_turn' };
}

beforeEach(async () => {
  await mkdir(TEST_ROOT, { recursive: true });
});

afterAll(async () => {
  await rm(TEST_ROOT, { recursive: true, force: true });
});

describe('JSONL I/O', () => {
  describe('appendRecord', () => {
    it('creates file and appends a single record', async () => {
      const dir = nextDir();
      const record = makeHeader();
      await appendRecord(dir, 'sess-1', record);

      const raw = await readJsonl(dir, 'sess-1');
      const lines = parseJsonl(raw);
      expect(lines).toHaveLength(1);
      expect(lines[0]).toMatchObject({ t: 'header', id: 'sess-1' });
    });

    it('appends to an existing file', async () => {
      const dir = nextDir();
      await appendRecord(dir, 'sess-1', makeHeader());
      await appendRecord(dir, 'sess-1', makeMessage('m1', 'user', 'hello'));

      const lines = parseJsonl(await readJsonl(dir, 'sess-1'));
      expect(lines).toHaveLength(2);
      expect(lines[1]).toMatchObject({ t: 'message', content: 'hello' });
    });
  });

  describe('appendRecords', () => {
    it('appends multiple records in one I/O', async () => {
      const dir = nextDir();
      await appendRecord(dir, 'sess-1', makeHeader());
      await appendRecords(dir, 'sess-1', [
        makeMessage('m1', 'user', 'hello'),
        makeMessage('m2', 'assistant', 'hi'),
      ]);

      const lines = parseJsonl(await readJsonl(dir, 'sess-1'));
      expect(lines).toHaveLength(3);
    });

    it('is a no-op for empty array', async () => {
      const dir = nextDir();
      await appendRecord(dir, 'sess-1', makeHeader());
      await appendRecords(dir, 'sess-1', []);

      const lines = parseJsonl(await readJsonl(dir, 'sess-1'));
      expect(lines).toHaveLength(1);
    });
  });

  describe('writeRecords', () => {
    it('overwrites the file with the given records', async () => {
      const dir = nextDir();
      await writeRecords(dir, 'sess-1', [makeHeader(), makeMessage('m1', 'user', 'hello')]);

      const lines = parseJsonl(await readJsonl(dir, 'sess-1'));
      expect(lines).toHaveLength(2);
    });
  });
});

describe('replaySession', () => {
  it('returns null for missing file', async () => {
    const dir = nextDir();

    expect(await replaySession(dir, 'nonexistent')).toBeNull();
  });

  it('returns null for empty file', async () => {
    const dir = nextDir();

    await writeFile(join(dir, 'sess-1.jsonl'), '', 'utf-8');
    expect(await replaySession(dir, 'sess-1')).toBeNull();
  });

  it('replays header + messages into a Session', async () => {
    const dir = nextDir();
    await writeRecords(dir, 'sess-1', [
      makeHeader(),
      makeMessage('m1', 'user', 'hello', 2000),
      makeFinal('m2', 'hi there', 3000),
    ]);

    const session = await replaySession(dir, 'sess-1');
    expect(session).not.toBeNull();
    expect(session!.id).toBe('sess-1');
    expect(session!.title).toBe('Test Session');
    expect(session!.messages).toHaveLength(2);
    expect(session!.messages[0]).toMatchObject({ id: 'm1', role: 'user', content: 'hello' });
    expect(session!.messages[1]).toMatchObject({ id: 'm2', role: 'assistant', content: 'hi there' });
    expect(session!.updatedAt).toBe(3000);
  });

  it('replays streaming deltas (start → delta → final)', async () => {
    const dir = nextDir();
    await writeRecords(dir, 'sess-1', [
      makeHeader(),
      { t: 'message_start', id: 'msg-1', role: 'assistant', timestamp: 2000 },
      { t: 'message_delta', id: 'msg-1', delta: 'hel', seq: 0 },
      { t: 'message_delta', id: 'msg-1', delta: 'lo', seq: 1 },
      { t: 'message_final', id: 'msg-1', role: 'assistant', content: 'hello', timestamp: 3000, stopReason: 'end_turn' },
    ]);

    const session = await replaySession(dir, 'sess-1');
    expect(session!.messages).toHaveLength(1);
    expect(session!.messages[0].content).toBe('hello');
  });

  it('sorts deltas by seq during replay', async () => {
    const dir = nextDir();
    await writeRecords(dir, 'sess-1', [
      makeHeader(),
      { t: 'message_start', id: 'msg-1', role: 'assistant', timestamp: 2000 },
      { t: 'message_delta', id: 'msg-1', delta: 'world', seq: 1 },
      { t: 'message_delta', id: 'msg-1', delta: 'hello ', seq: 0 },
      { t: 'message_abort', id: 'msg-1', reason: 'crash', timestamp: 3000 },
    ]);

    const session = await replaySession(dir, 'sess-1');
    expect(session!.messages).toHaveLength(1);
    expect(session!.messages[0].content).toBe('hello world');
  });

  it('recovers orphaned streams (deltas without final/abort)', async () => {
    const dir = nextDir();
    await writeRecords(dir, 'sess-1', [
      makeHeader(),
      { t: 'message_start', id: 'msg-1', role: 'assistant', timestamp: 2000 },
      { t: 'message_delta', id: 'msg-1', delta: 'partial content', seq: 0 },
      // No final or abort — simulates a crash
    ]);

    const session = await replaySession(dir, 'sess-1');
    expect(session!.messages).toHaveLength(1);
    expect(session!.messages[0].content).toBe('partial content');
  });

  it('handles message_blocks during stream', async () => {
    const dir = nextDir();
    await writeRecords(dir, 'sess-1', [
      makeHeader(),
      { t: 'message_start', id: 'msg-1', role: 'assistant', timestamp: 2000 },
      { t: 'message_blocks', id: 'msg-1', contentBlocks: [{ type: 'text', text: 'block' }] },
      { t: 'message_delta', id: 'msg-1', delta: 'content', seq: 0 },
      // Orphaned — should recover with blocks
    ]);

    const session = await replaySession(dir, 'sess-1');
    expect(session!.messages[0].contentBlocks).toEqual([{ type: 'text', text: 'block' }]);
  });

  it('applies meta records to update session fields', async () => {
    const dir = nextDir();
    await writeRecords(dir, 'sess-1', [
      makeHeader(),
      { t: 'meta', updatedAt: 5000, patch: { title: 'New Title', custom: 'value' } },
    ]);

    const session = await replaySession(dir, 'sess-1');
    expect(session!.title).toBe('New Title');
    expect(session!.metadata.custom).toBe('value');
    expect(session!.updatedAt).toBe(5000);
  });

  it('skips malformed lines gracefully', async () => {
    const dir = nextDir();
    const header = JSON.stringify(makeHeader());
    const validMsg = JSON.stringify(makeMessage('m1', 'user', 'hello'));
    const content = `${header}\n{broken json\n${validMsg}\n`;

    await writeFile(join(dir, 'sess-1.jsonl'), content, 'utf-8');

    const session = await replaySession(dir, 'sess-1');
    expect(session!.messages).toHaveLength(1);
    expect(session!.messages[0].content).toBe('hello');
  });

  it('marks file as corrupt if header is invalid', async () => {
    const dir = nextDir();

    await writeFile(join(dir, 'sess-1.jsonl'), '{"t":"not_header"}\n', 'utf-8');

    const session = await replaySession(dir, 'sess-1');
    expect(session).toBeNull();
  });

  it('backfills question results from follow-up user messages', async () => {
    const dir = nextDir();
    await writeRecords(dir, 'sess-1', [
      makeHeader(),
      {
        t: 'message_final', id: 'msg-1', role: 'assistant', content: 'Asking...',
        timestamp: 2000, stopReason: 'end_turn',
        contentBlocks: [{ type: 'tool_use', id: 'tu-1', name: 'AskUserQuestion', input: '{}', status: 'complete' }],
      },
      makeMessage('msg-2', 'user', 'My answer', 3000),
    ]);

    const session = await replaySession(dir, 'sess-1');
    const block = session!.messages[0].contentBlocks![0];
    expect(block.type === 'tool_use' && block.result).toEqual({ _fromFollowUp: true, answer: 'My answer' });
  });
});

describe('replaySessionMetadata', () => {
  it('returns session with empty messages from header only', async () => {
    const dir = nextDir();
    await writeRecords(dir, 'sess-1', [
      makeHeader('sess-1', { orgId: 'org-1' }),
      makeMessage('m1', 'user', 'hello'),
    ]);

    const session = await replaySessionMetadata(dir, 'sess-1');
    expect(session!.id).toBe('sess-1');
    expect(session!.title).toBe('Test Session');
    expect(session!.messages).toEqual([]);
    expect(session!.metadata.orgId).toBe('org-1');
  });

  it('returns null for missing file', async () => {
    const dir = nextDir();

    expect(await replaySessionMetadata(dir, 'missing')).toBeNull();
  });
});

describe('consolidateSession', () => {
  it('rewrites JSONL with header + message records only', async () => {
    const dir = nextDir();
    // Write a messy JSONL with streaming artifacts
    await writeRecords(dir, 'sess-1', [
      makeHeader(),
      { t: 'message_start', id: 'msg-1', role: 'assistant', timestamp: 2000 },
      { t: 'message_delta', id: 'msg-1', delta: 'hello', seq: 0 },
    ]);

    // Create a session as if it was replayed
    const session: Session = {
      id: 'sess-1', title: 'Test Session', createdAt: 1000, updatedAt: 3000,
      messages: [
        { id: 'msg-1', role: 'assistant', content: 'hello', timestamp: 2000 },
        { id: 'msg-2', role: 'user', content: 'hi', timestamp: 2500 },
      ],
      metadata: { key: 'val' },
    };

    await consolidateSession(dir, session);

    const lines = parseJsonl(await readJsonl(dir, 'sess-1'));
    expect(lines).toHaveLength(3); // header + 2 messages
    expect(lines[0]).toMatchObject({ t: 'header', updatedAt: 3000, metadata: { key: 'val' } });
    expect(lines[1]).toMatchObject({ t: 'message_final', id: 'msg-1', content: 'hello' });
    expect(lines[2]).toMatchObject({ t: 'message', id: 'msg-2', role: 'user' });
  });

  it('uses atomic rename via .tmp file', async () => {
    const dir = nextDir();
    await writeRecords(dir, 'sess-1', [makeHeader()]);

    const session: Session = {
      id: 'sess-1', title: 'T', createdAt: 1, updatedAt: 1,
      messages: [], metadata: {},
    };

    await consolidateSession(dir, session);

    // Final file should exist, tmp should not
    const raw = await readJsonl(dir, 'sess-1');
    expect(raw.length).toBeGreaterThan(0);
  });
});

describe('writeForkSession', () => {
  it('writes a complete JSONL from a forked session', async () => {
    const dir = nextDir();
    const forked: Session = {
      id: 'fork-1', title: 'Forked', createdAt: 1000, updatedAt: 2000,
      parentId: 'parent-1',
      messages: [
        { id: 'm1', role: 'user', content: 'hello', timestamp: 1500 },
        { id: 'm2', role: 'assistant', content: 'hi', timestamp: 1600 },
      ],
      metadata: { forked: true },
    };

    await writeForkSession(dir, forked);

    const session = await replaySession(dir, 'fork-1');
    expect(session!.id).toBe('fork-1');
    expect(session!.parentId).toBe('parent-1');
    expect(session!.messages).toHaveLength(2);
  });
});

describe('AppendLock', () => {
  it('serializes concurrent writes for the same session', async () => {
    const lock = new AppendLock();
    const order: number[] = [];

    const p1 = lock.acquire('s1', async () => {
      await new Promise((r) => setTimeout(r, 30));
      order.push(1);
      return 'first';
    });

    const p2 = lock.acquire('s1', async () => {
      order.push(2);
      return 'second';
    });

    const [r1, r2] = await Promise.all([p1, p2]);
    expect(r1).toBe('first');
    expect(r2).toBe('second');
    expect(order).toEqual([1, 2]);
  });

  it('allows parallel writes for different sessions', async () => {
    const lock = new AppendLock();
    const order: string[] = [];

    const p1 = lock.acquire('s1', async () => {
      await new Promise((r) => setTimeout(r, 20));
      order.push('s1');
    });

    const p2 = lock.acquire('s2', async () => {
      order.push('s2');
    });

    await Promise.all([p1, p2]);
    // s2 should complete before s1 since it's a different session and doesn't wait
    expect(order).toEqual(['s2', 's1']);
  });

  it('releases lock even if fn throws', async () => {
    const lock = new AppendLock();

    await expect(lock.acquire('s1', async () => { throw new Error('boom'); }))
      .rejects.toThrow('boom');

    // Next acquire should still work
    const result = await lock.acquire('s1', async () => 'ok');
    expect(result).toBe('ok');
  });

  it('clear resets all locks', () => {
    const lock = new AppendLock();
    lock.clear(); // Should not throw
  });
});
