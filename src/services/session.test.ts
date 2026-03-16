/**
 * Session Service Tests
 *
 * Tests for JSONL session persistence, streaming deltas, crash recovery,
 * consolidation, and lifecycle management.
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll, afterAll } from 'vitest';
import { mkdir, writeFile, rm, readFile, readdir } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { resetSessionService, createSessionService } from './session';
import {
  JSONL_VERSION,
  replaySession,
  replaySessionMetadata,
  appendRecord,
  appendRecords,
  writeRecords,
  consolidateSession,
} from './session-journal';

// Each test suite gets its own temp root
const TEST_ROOT = join(tmpdir(), 'workforce-session-test-' + Date.now());
let testIdx = 0;
function nextDir(): string {
  return join(TEST_ROOT, `case-${testIdx++}`);
}

/** Parse all JSONL lines from a file. */
async function readJsonl(filePath: string): Promise<unknown[]> {
  const raw = await readFile(filePath, 'utf-8');
  return raw
    .split('\n')
    .filter((l) => l.trim().length > 0)
    .map((l) => JSON.parse(l));
}

describe('SessionService', () => {
  beforeAll(async () => {
    await mkdir(TEST_ROOT, { recursive: true });
  });

  afterAll(async () => {
    await rm(TEST_ROOT, { recursive: true, force: true });
  });

  beforeEach(() => {
    resetSessionService();
  });

  afterEach(() => {
    resetSessionService();
  });

  // ─── create ────────────────────────────────────────────────────────────────

  describe('create', () => {
    it('should create a new session with generated ID', async () => {
      const dir = nextDir();
      const service = createSessionService(dir);
      const session = await service.create('Test Session');

      expect(session.id).toMatch(/^sess_/);
      expect(session.title).toBe('Test Session');
      expect(session.messages).toEqual([]);
      expect(session.createdAt).toBeLessThanOrEqual(Date.now());
      expect(session.updatedAt).toBe(session.createdAt);
    });

    it('should create session without title', async () => {
      const dir = nextDir();
      const service = createSessionService(dir);
      const session = await service.create();

      expect(session.title).toBeUndefined();
    });

    it('should persist session as JSONL to disk', async () => {
      const dir = nextDir();
      const service = createSessionService(dir);
      const session = await service.create('Persisted');

      const filePath = join(dir, `${session.id}.jsonl`);
      const records = await readJsonl(filePath);

      expect(records).toHaveLength(1);
      const header = records[0] as Record<string, unknown>;
      expect(header.t).toBe('header');
      expect(header.v).toBe(JSONL_VERSION);
      expect(header.title).toBe('Persisted');
      expect(header.id).toBe(session.id);
    });
  });

  // ─── get ───────────────────────────────────────────────────────────────────

  describe('get', () => {
    it('should return session by ID', async () => {
      const dir = nextDir();
      const service = createSessionService(dir);
      const created = await service.create('Get Test');
      const retrieved = await service.get(created.id);

      expect(retrieved).not.toBeNull();
      expect(retrieved!.id).toBe(created.id);
      expect(retrieved!.title).toBe('Get Test');
    });

    it('should return null for non-existent session', async () => {
      const dir = nextDir();
      const service = createSessionService(dir);
      const retrieved = await service.get('non-existent-id');

      expect(retrieved).toBeNull();
    });

    it('should use cache on repeated access', async () => {
      const dir = nextDir();
      const service = createSessionService(dir);
      const created = await service.create('Cached');

      const first = await service.get(created.id);
      const second = await service.get(created.id);

      expect(first).toBe(second); // Same reference
    });

    it('should reload from disk when service is recreated', async () => {
      const dir = nextDir();
      const service = createSessionService(dir);
      const session = await service.create('Reload Test');

      // Recreate service (simulates restart)
      const fresh = createSessionService(dir);
      const loaded = await fresh.get(session.id);

      expect(loaded).not.toBeNull();
      expect(loaded!.id).toBe(session.id);
      expect(loaded!.title).toBe('Reload Test');
    });
  });

  // ─── updateSession ─────────────────────────────────────────────────────────

  describe('updateSession', () => {
    it('should update session and persist via meta record', async () => {
      const dir = nextDir();
      const service = createSessionService(dir);
      const session = await service.create('Save Test');

      await service.updateSession(session.id, { title: 'Updated Title' });

      // Reload and verify
      const fresh = createSessionService(dir);
      const loaded = await fresh.get(session.id);

      expect(loaded).not.toBeNull();
      expect(loaded!.title).toBe('Updated Title');
    });

    it('should update updatedAt timestamp', async () => {
      const dir = nextDir();
      const service = createSessionService(dir);
      const session = await service.create('Timestamp Test');
      const originalUpdatedAt = session.updatedAt;

      await new Promise((resolve) => setTimeout(resolve, 10));
      await service.updateSession(session.id, { title: session.title });

      expect(session.updatedAt).toBeGreaterThan(originalUpdatedAt);
    });

    it('should append meta record to JSONL', async () => {
      const dir = nextDir();
      const service = createSessionService(dir);
      const session = await service.create('Meta Test');

      await service.updateSession(session.id, { title: 'New Title' });

      const filePath = join(dir, `${session.id}.jsonl`);
      const records = await readJsonl(filePath);

      expect(records.length).toBeGreaterThanOrEqual(2); // header + meta
      const meta = records[records.length - 1] as Record<string, unknown>;
      expect(meta.t).toBe('meta');
      expect((meta.patch as Record<string, unknown>).title).toBe('New Title');
    });

    it('should throw when saving a deleted/untracked session', async () => {
      const dir = nextDir();
      const service = createSessionService(dir);
      const session = await service.create('Doomed');

      await service.delete(session.id);

      // updateSession() on a stale ID must hard-fail, not silently create a corrupt file
      await expect(service.updateSession(session.id, { title: 'Ghost' })).rejects.toThrow('Session not found');
    });
  });

  // ─── recordMessage ─────────────────────────────────────────────────────────

  describe('recordMessage', () => {
    it('should add a message and persist it', async () => {
      const dir = nextDir();
      const service = createSessionService(dir);
      const session = await service.create('Msg Test');

      await service.recordMessage(session.id, {
        id: 'msg_1',
        role: 'user',
        content: 'Hello',
        timestamp: Date.now(),
      });

      // Verify in-memory
      const got = await service.get(session.id);
      expect(got!.messages).toHaveLength(1);
      expect(got!.messages[0].content).toBe('Hello');

      // Verify on disk (reload)
      const fresh = createSessionService(dir);
      const loaded = await fresh.get(session.id);
      expect(loaded!.messages).toHaveLength(1);
      expect(loaded!.messages[0].content).toBe('Hello');
    });

    it('should throw for non-existent session', async () => {
      const dir = nextDir();
      const service = createSessionService(dir);

      await expect(
        service.recordMessage('non-existent', {
          id: 'msg_1', role: 'user', content: 'x', timestamp: 1,
        }),
      ).rejects.toThrow('Session not found');
    });

    it('should persist as message record in JSONL', async () => {
      const dir = nextDir();
      const service = createSessionService(dir);
      const session = await service.create('Persist Msg');

      await service.recordMessage(session.id, {
        id: 'msg_u1',
        role: 'user',
        content: 'Test content',
        timestamp: 1700000000000,
      });

      const filePath = join(dir, `${session.id}.jsonl`);
      const records = await readJsonl(filePath);
      const msgRecord = records.find(
        (r) => (r as Record<string, unknown>).t === 'message',
      ) as Record<string, unknown>;

      expect(msgRecord).toBeTruthy();
      expect(msgRecord.id).toBe('msg_u1');
      expect(msgRecord.role).toBe('user');
      expect(msgRecord.content).toBe('Test content');
    });
  });

  // ─── getMessages ───────────────────────────────────────────────────────────

  describe('getMessages', () => {
    it('should return all messages', async () => {
      const dir = nextDir();
      const service = createSessionService(dir);
      const session = await service.create('All Msgs');

      await service.recordMessage(session.id, {
        id: 'msg_1', role: 'user', content: 'First', timestamp: 1,
      });
      await service.recordMessage(session.id, {
        id: 'msg_2', role: 'user', content: 'Second', timestamp: 2,
      });

      const msgs = await service.getMessages(session.id);
      expect(msgs).toHaveLength(2);
      expect(msgs[0].content).toBe('First');
      expect(msgs[1].content).toBe('Second');
    });

    it('should support pagination', async () => {
      const dir = nextDir();
      const service = createSessionService(dir);
      const session = await service.create('Paginated');

      for (let i = 0; i < 5; i++) {
        await service.recordMessage(session.id, {
          id: `msg_${i}`, role: 'user', content: `Msg ${i}`, timestamp: i,
        });
      }

      const page1 = await service.getMessages(session.id, { limit: 2, offset: 0 });
      expect(page1).toHaveLength(2);
      expect(page1[0].content).toBe('Msg 0');
      expect(page1[1].content).toBe('Msg 1');

      const page2 = await service.getMessages(session.id, { limit: 2, offset: 2 });
      expect(page2).toHaveLength(2);
      expect(page2[0].content).toBe('Msg 2');
    });

    it('should throw for non-existent session', async () => {
      const dir = nextDir();
      const service = createSessionService(dir);

      await expect(service.getMessages('non-existent')).rejects.toThrow('Session not found');
    });
  });

  // ─── Streaming Persistence ─────────────────────────────────────────────────

  describe('streaming persistence', () => {
    it('should persist stream lifecycle and finalize correctly', async () => {
      const dir = nextDir();
      const service = createSessionService(dir);
      const session = await service.create('Stream Test');

      // Start stream
      await service.recordStreamStart(session.id, 'msg_a1');

      // Append deltas
      await service.recordStreamDelta(session.id, 'msg_a1', 'Hello ', 0);
      await service.recordStreamDelta(session.id, 'msg_a1', 'world!', 1);

      // Finalize
      await service.recordStreamEnd(session.id, 'msg_a1', 'Hello world!', 'end_turn');

      // Wait for consolidation
      await new Promise((resolve) => setTimeout(resolve, 600));

      // Verify in-memory
      const got = await service.get(session.id);
      expect(got!.messages).toHaveLength(1);
      expect(got!.messages[0].id).toBe('msg_a1');
      expect(got!.messages[0].role).toBe('assistant');
      expect(got!.messages[0].content).toBe('Hello world!');
    });

    it('should replay finalized message from disk', async () => {
      const dir = nextDir();
      const service = createSessionService(dir);
      const session = await service.create('Replay Test');

      await service.recordStreamStart(session.id, 'msg_a2');
      await service.recordStreamDelta(session.id, 'msg_a2', 'delta1 ', 0);
      await service.recordStreamDelta(session.id, 'msg_a2', 'delta2', 1);
      await service.recordStreamEnd(session.id, 'msg_a2', 'delta1 delta2', 'end_turn');

      // Wait for consolidation
      await new Promise((resolve) => setTimeout(resolve, 600));

      // Reload from disk
      const fresh = createSessionService(dir);
      const loaded = await fresh.get(session.id);

      expect(loaded!.messages).toHaveLength(1);
      expect(loaded!.messages[0].content).toBe('delta1 delta2');
      expect(loaded!.messages[0].role).toBe('assistant');
    });

    it('should reconstruct from deltas on crash (no message_final)', async () => {
      const dir = nextDir();
      const sessionsDir = dir;
      await mkdir(sessionsDir, { recursive: true });

      // Manually write JSONL simulating a crash mid-stream
      const sessionId = 'sess_crashed';
      const records = [
        { t: 'header', v: JSONL_VERSION, id: sessionId, createdAt: 1, updatedAt: 1, metadata: {} },
        { t: 'message', id: 'msg_u1', role: 'user', content: 'Hi', timestamp: 1 },
        { t: 'message_start', id: 'msg_a1', role: 'assistant', timestamp: 2 },
        { t: 'message_delta', id: 'msg_a1', delta: 'Part ', seq: 0 },
        { t: 'message_delta', id: 'msg_a1', delta: 'one', seq: 1 },
        // No message_final — simulates crash
      ];
      const content = records.map((r) => JSON.stringify(r)).join('\n') + '\n';
      await writeFile(join(sessionsDir, `${sessionId}.jsonl`), content, 'utf-8');

      // Replay should reconstruct the partial message
      const result = await replaySession(sessionsDir, sessionId);

      expect(result).not.toBeNull();
      const session = result!.session;
      expect(session.messages).toHaveLength(2); // user msg + reconstructed assistant
      expect(session.messages[1].role).toBe('assistant');
      expect(session.messages[1].content).toBe('Part one');
    });

    it('should handle out-of-order deltas via seq sorting', async () => {
      const dir = nextDir();
      await mkdir(dir, { recursive: true });

      const sessionId = 'sess_ooo';
      const records = [
        { t: 'header', v: JSONL_VERSION, id: sessionId, createdAt: 1, updatedAt: 1, metadata: {} },
        { t: 'message_start', id: 'msg_a1', role: 'assistant', timestamp: 1 },
        { t: 'message_delta', id: 'msg_a1', delta: 'B ', seq: 1 },
        { t: 'message_delta', id: 'msg_a1', delta: 'A ', seq: 0 },
        { t: 'message_delta', id: 'msg_a1', delta: 'C', seq: 2 },
        // No final — crash recovery
      ];
      await writeFile(
        join(dir, `${sessionId}.jsonl`),
        records.map((r) => JSON.stringify(r)).join('\n') + '\n',
        'utf-8',
      );

      const result = await replaySession(dir, sessionId);
      const session = result!.session;
      expect(session.messages[0].content).toBe('A B C');
    });

    it('should preserve partial content on abort', async () => {
      const dir = nextDir();
      const service = createSessionService(dir);
      const session = await service.create('Abort Test');

      await service.recordStreamStart(session.id, 'msg_a3');
      await service.recordStreamDelta(session.id, 'msg_a3', 'partial ', 0);
      await service.recordStreamDelta(session.id, 'msg_a3', 'content', 1);
      await service.recordStreamAbort(session.id, 'msg_a3', 'user_cancelled');

      // Reload from disk
      const fresh = createSessionService(dir);
      const loaded = await fresh.get(session.id);

      // Abort should reconstruct partial content
      expect(loaded!.messages).toHaveLength(1);
      expect(loaded!.messages[0].content).toBe('partial content');
      expect(loaded!.messages[0].role).toBe('assistant');
    });

    it('should skip orphan deltas without message_start', async () => {
      const dir = nextDir();
      await mkdir(dir, { recursive: true });

      const sessionId = 'sess_orphan';
      const records = [
        { t: 'header', v: JSONL_VERSION, id: sessionId, createdAt: 1, updatedAt: 1, metadata: {} },
        // Delta without a preceding message_start
        { t: 'message_delta', id: 'msg_a1', delta: 'orphan', seq: 0 },
      ];
      await writeFile(
        join(dir, `${sessionId}.jsonl`),
        records.map((r) => JSON.stringify(r)).join('\n') + '\n',
        'utf-8',
      );

      const result = await replaySession(dir, sessionId);
      const session = result!.session;
      expect(session.messages).toHaveLength(0);
    });
  });

  // ─── resume ────────────────────────────────────────────────────────────────

  describe('resume', () => {
    it('should resume existing session', async () => {
      const dir = nextDir();
      const service = createSessionService(dir);
      const created = await service.create('Resume Test');

      const resumed = await service.resume(created.id);

      expect(resumed.id).toBe(created.id);
      expect(service.getCurrent()).toBe(resumed);
    });

    it('should throw for non-existent session', async () => {
      const dir = nextDir();
      const service = createSessionService(dir);

      await expect(service.resume('non-existent')).rejects.toThrow('Session not found');
    });
  });

  // ─── fork ──────────────────────────────────────────────────────────────────

  describe('fork', () => {
    it('should create new session with parent history', async () => {
      const dir = nextDir();
      const service = createSessionService(dir);
      const parent = await service.create('Parent');

      await service.recordMessage(parent.id, {
        id: 'msg_1',
        role: 'user',
        content: 'Original message',
        timestamp: Date.now(),
      });

      const forked = await service.fork(parent.id);

      expect(forked.id).not.toBe(parent.id);
      expect(forked.parentId).toBe(parent.id);
      expect(forked.title).toBe('Parent (fork)');
      expect(forked.messages).toHaveLength(1);
      expect(forked.messages[0].content).toBe('Original message');
    });

    it('should persist forked session as JSONL', async () => {
      const dir = nextDir();
      const service = createSessionService(dir);
      const parent = await service.create('Fork Parent');

      await service.recordMessage(parent.id, {
        id: 'msg_1', role: 'user', content: 'Inherited', timestamp: 1,
      });

      const forked = await service.fork(parent.id);

      const filePath = join(dir, `${forked.id}.jsonl`);
      const records = await readJsonl(filePath);

      const header = records[0] as Record<string, unknown>;
      expect(header.t).toBe('header');
      expect(header.parentId).toBe(parent.id);

      // Message should be present (either as message or message_final)
      const msgRecord = records.find(
        (r) =>
          ((r as Record<string, unknown>).t === 'message' ||
            (r as Record<string, unknown>).t === 'message_final') &&
          (r as Record<string, unknown>).content === 'Inherited',
      );
      expect(msgRecord).toBeTruthy();
    });

    it('should throw for non-existent parent', async () => {
      const dir = nextDir();
      const service = createSessionService(dir);

      await expect(service.fork('non-existent')).rejects.toThrow('Session not found');
    });

    it('should clear all messages when truncating with -1', async () => {
      const dir = nextDir();
      const service = createSessionService(dir);
      const session = await service.create('ClearAll');
      await service.recordMessage(session.id, { id: 'msg_1', role: 'user', content: 'First', timestamp: 1 });
      await service.recordMessage(session.id, { id: 'msg_2', role: 'assistant', content: 'Reply', timestamp: 2 });

      const truncated = await service.truncate(session.id, -1);
      expect(truncated.messages).toHaveLength(0);

      // Verify persistence — reload from disk
      const reloaded = await service.get(session.id);
      expect(reloaded!.messages).toHaveLength(0);
    });

    it('should throw when forking an empty session', async () => {
      const dir = nextDir();
      const service = createSessionService(dir);
      const empty = await service.create('Empty');

      await expect(service.fork(empty.id)).rejects.toThrow('Cannot fork an empty session');
    });

    it('should fork at a specific message index', async () => {
      const dir = nextDir();
      const service = createSessionService(dir);
      const parent = await service.create('Parent');

      await service.recordMessage(parent.id, { id: 'msg_1', role: 'user', content: 'First', timestamp: 1 });
      await service.recordMessage(parent.id, { id: 'msg_2', role: 'user', content: 'Second', timestamp: 2 });
      await service.recordMessage(parent.id, { id: 'msg_3', role: 'user', content: 'Third', timestamp: 3 });

      const forked = await service.fork(parent.id, { atMessageIndex: 1 });

      expect(forked.messages).toHaveLength(2);
      expect(forked.messages[0].content).toBe('First');
      expect(forked.messages[1].content).toBe('Second');
      expect(forked.parentId).toBe(parent.id);
    });

    it('should store forkAtMessageId in forked session metadata', async () => {
      const dir = nextDir();
      const service = createSessionService(dir);
      const parent = await service.create('Parent');

      await service.recordMessage(parent.id, { id: 'msg_1', role: 'user', content: 'A', timestamp: 1 });
      await service.recordMessage(parent.id, { id: 'msg_2', role: 'user', content: 'B', timestamp: 2 });

      const forked = await service.fork(parent.id, { atMessageIndex: 0 });

      expect(forked.metadata.forkAtMessageId).toBe('msg_1');
    });

    it('should preserve parent session when forking', async () => {
      const dir = nextDir();
      const service = createSessionService(dir);
      const parent = await service.create('Parent');

      await service.recordMessage(parent.id, { id: 'msg_1', role: 'user', content: 'A', timestamp: 1 });
      await service.recordMessage(parent.id, { id: 'msg_2', role: 'user', content: 'B', timestamp: 2 });

      await service.fork(parent.id, { atMessageIndex: 0 });

      const parentAfter = await service.get(parent.id);
      expect(parentAfter!.messages).toHaveLength(2);
    });

    it('should throw for invalid message index', async () => {
      const dir = nextDir();
      const service = createSessionService(dir);
      const parent = await service.create('Parent');

      await service.recordMessage(parent.id, { id: 'msg_1', role: 'user', content: 'A', timestamp: 1 });

      await expect(service.fork(parent.id, { atMessageIndex: 5 })).rejects.toThrow('Invalid message index');
      await expect(service.fork(parent.id, { atMessageIndex: -2 })).rejects.toThrow('Invalid message index');
    });

    it('should persist fork-at-index JSONL with correct messages', async () => {
      const dir = nextDir();
      const service = createSessionService(dir);
      const parent = await service.create('Parent');

      await service.recordMessage(parent.id, { id: 'msg_1', role: 'user', content: 'A', timestamp: 1 });
      await service.recordMessage(parent.id, { id: 'msg_2', role: 'user', content: 'B', timestamp: 2 });

      const forked = await service.fork(parent.id, { atMessageIndex: 0 });

      const filePath = join(dir, `${forked.id}.jsonl`);
      const records = await readJsonl(filePath);
      const msgRecords = records.filter((r) => (r as Record<string, unknown>).t === 'message' || (r as Record<string, unknown>).t === 'message_final');

      expect(msgRecords).toHaveLength(1);
      expect((msgRecords[0] as Record<string, unknown>).content).toBe('A');
    });
  });

  // ─── truncate ─────────────────────────────────────────────────────────────

  describe('truncate', () => {
    it('should truncate session to specified message index', async () => {
      const dir = nextDir();
      const service = createSessionService(dir);
      const session = await service.create('Truncate Test');

      await service.recordMessage(session.id, { id: 'msg_1', role: 'user', content: 'Keep', timestamp: 1 });
      await service.recordMessage(session.id, { id: 'msg_2', role: 'user', content: 'Remove', timestamp: 2 });
      await service.recordMessage(session.id, { id: 'msg_3', role: 'user', content: 'Also remove', timestamp: 3 });

      const truncated = await service.truncate(session.id, 0);

      expect(truncated.messages).toHaveLength(1);
      expect(truncated.messages[0].content).toBe('Keep');
    });

    it('should persist truncation to disk', async () => {
      const dir = nextDir();
      const service = createSessionService(dir);
      const session = await service.create('Persist Truncate');

      await service.recordMessage(session.id, { id: 'msg_1', role: 'user', content: 'A', timestamp: 1 });
      await service.recordMessage(session.id, { id: 'msg_2', role: 'user', content: 'B', timestamp: 2 });

      await service.truncate(session.id, 0);

      // Reload from disk
      const fresh = createSessionService(dir);
      const loaded = await fresh.get(session.id);

      expect(loaded!.messages).toHaveLength(1);
      expect(loaded!.messages[0].content).toBe('A');
    });

    it('should update updatedAt timestamp', async () => {
      const dir = nextDir();
      const service = createSessionService(dir);
      const session = await service.create('Timestamp Test');

      await service.recordMessage(session.id, { id: 'msg_1', role: 'user', content: 'A', timestamp: 1 });
      await service.recordMessage(session.id, { id: 'msg_2', role: 'user', content: 'B', timestamp: 2 });

      const before = session.updatedAt;
      const truncated = await service.truncate(session.id, 0);

      expect(truncated.updatedAt).toBeGreaterThanOrEqual(before);
    });

    it('should throw for non-existent session', async () => {
      const dir = nextDir();
      const service = createSessionService(dir);

      await expect(service.truncate('non-existent', 0)).rejects.toThrow('Session not found');
    });

    it('should throw for out-of-range index', async () => {
      const dir = nextDir();
      const service = createSessionService(dir);
      const session = await service.create('Range Test');

      await service.recordMessage(session.id, { id: 'msg_1', role: 'user', content: 'A', timestamp: 1 });

      await expect(service.truncate(session.id, 5)).rejects.toThrow('Invalid message index');
      await expect(service.truncate(session.id, -2)).rejects.toThrow('Invalid message index');
    });

    it('should be idempotent when truncating to last message', async () => {
      const dir = nextDir();
      const service = createSessionService(dir);
      const session = await service.create('Idempotent Test');

      await service.recordMessage(session.id, { id: 'msg_1', role: 'user', content: 'A', timestamp: 1 });
      await service.recordMessage(session.id, { id: 'msg_2', role: 'user', content: 'B', timestamp: 2 });

      const truncated = await service.truncate(session.id, 1);

      expect(truncated.messages).toHaveLength(2);
      expect(truncated.messages[0].content).toBe('A');
      expect(truncated.messages[1].content).toBe('B');
    });
  });

  // ─── list ──────────────────────────────────────────────────────────────────

  describe('list', () => {
    it('should list sessions sorted by updatedAt', async () => {
      const dir = nextDir();
      const service = createSessionService(dir);

      const session1 = await service.create('First');
      await new Promise((resolve) => setTimeout(resolve, 10));
      const session2 = await service.create('Second');
      await new Promise((resolve) => setTimeout(resolve, 10));
      const session3 = await service.create('Third');

      const list = await service.list();

      const ids = list.map((s) => s.id);
      expect(ids.indexOf(session3.id)).toBeLessThan(ids.indexOf(session2.id));
      expect(ids.indexOf(session2.id)).toBeLessThan(ids.indexOf(session1.id));
    });

    it('should support pagination', async () => {
      const dir = nextDir();
      const service = createSessionService(dir);

      await service.create('A');
      await service.create('B');
      await service.create('C');

      const page1 = await service.list({ limit: 2, offset: 0 });
      const page2 = await service.list({ limit: 2, offset: 2 });

      expect(page1.length).toBeLessThanOrEqual(2);
      expect(page2.length).toBeLessThanOrEqual(2);
    });

    it('should filter by orgId', async () => {
      const dir = nextDir();
      const service = createSessionService(dir);

      await service.createWorkAgent({ templateId: 't', goal: 'Org1 task', orgId: 'org_a' });
      await service.createWorkAgent({ templateId: 't', goal: 'Org2 task', orgId: 'org_b' });
      await service.create('Chat session');

      const org1 = await service.list({ orgId: 'org_a' });
      expect(org1).toHaveLength(1);
      expect(org1[0].metadata.orgId).toBe('org_a');

      const org2 = await service.list({ orgId: 'org_b' });
      expect(org2).toHaveLength(1);

      const all = await service.list();
      expect(all).toHaveLength(3);
    });
  });

  // ─── search ────────────────────────────────────────────────────────────────

  describe('search', () => {
    it('should find sessions by title', async () => {
      const dir = nextDir();
      const service = createSessionService(dir);

      await service.create('TypeScript Project');
      await service.create('Python Script');

      const results = await service.search('typescript');

      expect(results.length).toBeGreaterThanOrEqual(1);
      expect(results[0].session.title).toContain('TypeScript');
      expect(results[0].score).toBe(2.0);
    });

    it('should find sessions by message content', async () => {
      const dir = nextDir();
      const service = createSessionService(dir);

      const session = await service.create('Code Help');
      await service.recordMessage(session.id, {
        id: 'msg_1',
        role: 'user',
        content: 'How do I implement authentication?',
        timestamp: Date.now(),
      });

      const results = await service.search('authentication');

      expect(results.length).toBeGreaterThanOrEqual(1);
      expect(results[0].matchedText).toContain('authentication');
    });

    it('should return empty for no matches', async () => {
      const dir = nextDir();
      const service = createSessionService(dir);
      await service.create('Something');

      const results = await service.search('xyznonexistent');
      expect(results).toEqual([]);
    });
  });

  // ─── delete ────────────────────────────────────────────────────────────────

  describe('delete', () => {
    it('should delete session from cache and disk', async () => {
      const dir = nextDir();
      const service = createSessionService(dir);
      const session = await service.create('To Delete');
      const filePath = join(dir, `${session.id}.jsonl`);

      await service.delete(session.id);

      expect(await service.get(session.id)).toBeNull();
      await expect(readFile(filePath)).rejects.toThrow();
    });

    it('should clear current session if deleted', async () => {
      const dir = nextDir();
      const service = createSessionService(dir);
      const session = await service.create('Current');
      await service.resume(session.id);

      expect(service.getCurrent()).not.toBeNull();

      await service.delete(session.id);

      expect(service.getCurrent()).toBeNull();
    });

    it('should clean up internal tracking maps so getChildren returns empty', async () => {
      const dir = nextDir();
      const service = createSessionService(dir);
      const parent = await service.create('Parent');
      const child = await service.create('Child', parent.id);

      // Before delete, getChildren should return the child
      let children = await service.getChildren(parent.id);
      expect(children).toHaveLength(1);

      await service.delete(child.id);

      // After delete, getChildren should not return the deleted child
      children = await service.getChildren(parent.id);
      expect(children).toHaveLength(0);
    });
  });

  // ─── Corruption Recovery ───────────────────────────────────────────────────

  describe('corruption recovery', () => {
    it('should handle corrupted JSONL and create backup', async () => {
      const dir = nextDir();
      await mkdir(dir, { recursive: true });

      const sessionId = 'sess_corrupted';
      await writeFile(join(dir, `${sessionId}.jsonl`), '{ invalid json }}}', 'utf-8');

      const session = await replaySession(dir, sessionId);
      expect(session).toBeNull();

      // Backup should be created
      const files = await readdir(dir);
      const backupFiles = files.filter((f) => f.includes('.corrupt.'));
      expect(backupFiles.length).toBeGreaterThanOrEqual(1);
    });

    it('should handle invalid header type', async () => {
      const dir = nextDir();
      await mkdir(dir, { recursive: true });

      const sessionId = 'sess_bad_header';
      await writeFile(
        join(dir, `${sessionId}.jsonl`),
        JSON.stringify({ t: 'message', seq: 0, ts: 1, id: 'x', role: 'user', content: '' }) + '\n',
        'utf-8',
      );

      const session = await replaySession(dir, sessionId);
      expect(session).toBeNull();
    });

    it('should skip malformed lines after header', async () => {
      const dir = nextDir();
      await mkdir(dir, { recursive: true });

      const sessionId = 'sess_malformed_line';
      const lines = [
        JSON.stringify({ t: 'header', v: JSONL_VERSION, seq: 0, ts: 1, id: sessionId, createdAt: 1, metadata: {} }),
        '{{bad json}}',
        JSON.stringify({ t: 'message', seq: 1, ts: 1, id: 'msg_1', role: 'user', content: 'Good' }),
      ];
      await writeFile(join(dir, `${sessionId}.jsonl`), lines.join('\n') + '\n', 'utf-8');

      const result = await replaySession(dir, sessionId);
      expect(result).not.toBeNull();
      const session = result!.session;
      expect(session.messages).toHaveLength(1);
      expect(session.messages[0].content).toBe('Good');
    });
  });

  // ─── Consolidation ────────────────────────────────────────────────────────────

  describe('consolidation', () => {
    it('should produce clean JSONL with header + messages only', async () => {
      const dir = nextDir();
      await mkdir(dir, { recursive: true });

      const session = {
        id: 'sess_consolidate',
        title: 'Consolidate Me',
        createdAt: 1000,
        updatedAt: 2000,
        messages: [
          { id: 'msg_1', role: 'user' as const, content: 'Hello', timestamp: 1000 },
          { id: 'msg_2', role: 'assistant' as const, content: 'Hi there', timestamp: 1001 },
        ],
        metadata: { key: 'value' },
      };

      // First write a noisy JSONL (deltas, meta patches, etc.)
      const noisyRecords = [
        { t: 'header', v: JSONL_VERSION, id: session.id, createdAt: 1000, updatedAt: 1000, metadata: {} },
        { t: 'message', id: 'msg_1', role: 'user', content: 'Hello', timestamp: 1000 },
        { t: 'message_start', id: 'msg_2', role: 'assistant', timestamp: 1001 },
        { t: 'message_delta', id: 'msg_2', delta: 'Hi ', seq: 0 },
        { t: 'message_delta', id: 'msg_2', delta: 'there', seq: 1 },
        { t: 'message_final', id: 'msg_2', role: 'assistant', content: 'Hi there', timestamp: 1001, stopReason: 'end_turn' },
        { t: 'meta', updatedAt: 2000, patch: { key: 'value', title: 'Consolidate Me' } },
      ];
      const noisyContent = noisyRecords.map((r) => JSON.stringify(r)).join('\n') + '\n';
      await writeFile(join(dir, `${session.id}.jsonl`), noisyContent, 'utf-8');

      // Run consolidation
      await consolidateSession(dir, session);

      // Read consolidated file
      const records = await readJsonl(join(dir, `${session.id}.jsonl`));

      // Should be clean: header + message + message_final
      expect(records).toHaveLength(3);

      const header = records[0] as Record<string, unknown>;
      expect(header.t).toBe('header');
      expect(header.title).toBe('Consolidate Me');
      expect(header.ts).toBe(2000);
      expect((header.metadata as Record<string, unknown>).key).toBe('value');

      const msg1 = records[1] as Record<string, unknown>;
      expect(msg1.t).toBe('message');
      expect(msg1.content).toBe('Hello');

      const msg2 = records[2] as Record<string, unknown>;
      expect(msg2.t).toBe('message_final');
      expect(msg2.content).toBe('Hi there');
    });

    it('should use atomic write (tmp + rename)', async () => {
      const dir = nextDir();
      await mkdir(dir, { recursive: true });

      const session = {
        id: 'sess_atomic',
        createdAt: 1, updatedAt: 1,
        messages: [],
        metadata: {},
      };

      await writeRecords(dir, session.id, [
        { t: 'header', v: JSONL_VERSION, seq: 0, ts: 1, id: session.id, createdAt: 1, metadata: {} },
      ]);

      await consolidateSession(dir, session);

      // No .tmp file should remain
      const files = await readdir(dir);
      expect(files.filter((f) => f.endsWith('.tmp'))).toHaveLength(0);

      // JSONL file should exist
      expect(files.filter((f) => f.endsWith('.jsonl'))).toHaveLength(1);
    });
  });

  // ─── replaySession ─────────────────────────────────────────────────────────

  describe('replaySession', () => {
    it('should return null for non-existent file', async () => {
      const dir = nextDir();
      await mkdir(dir, { recursive: true });

      const result = await replaySession(dir, 'non_existent');
      expect(result).toBeNull();
    });

    it('should return null for empty file', async () => {
      const dir = nextDir();
      await mkdir(dir, { recursive: true });

      await writeFile(join(dir, 'sess_empty.jsonl'), '', 'utf-8');

      const result = await replaySession(dir, 'sess_empty');
      expect(result).toBeNull();
    });

    it('should apply meta patches in order', async () => {
      const dir = nextDir();
      await mkdir(dir, { recursive: true });

      const sessionId = 'sess_meta_order';
      const lines = [
        JSON.stringify({ t: 'header', v: JSONL_VERSION, seq: 0, ts: 1, id: sessionId, title: 'V1', createdAt: 1, metadata: {} }),
        JSON.stringify({ t: 'meta', seq: 1, ts: 2, patch: { title: 'V2', color: 'blue' } }),
        JSON.stringify({ t: 'meta', seq: 2, ts: 3, patch: { title: 'V3' } }),
      ];
      await writeFile(join(dir, `${sessionId}.jsonl`), lines.join('\n') + '\n', 'utf-8');

      const result = await replaySession(dir, sessionId);
      const session = result!.session;
      expect(session.title).toBe('V3');
      expect(session.updatedAt).toBe(3);
      expect(session.metadata.color).toBe('blue');
    });

    it('should prioritize message_final over deltas', async () => {
      const dir = nextDir();
      await mkdir(dir, { recursive: true });

      const sessionId = 'sess_final_wins';
      const records = [
        { t: 'header', v: JSONL_VERSION, id: sessionId, createdAt: 1, updatedAt: 1, metadata: {} },
        { t: 'message_start', id: 'msg_a1', role: 'assistant', timestamp: 1 },
        { t: 'message_delta', id: 'msg_a1', delta: 'partial ', seq: 0 },
        { t: 'message_delta', id: 'msg_a1', delta: 'text', seq: 1 },
        // Final has different (authoritative) content
        { t: 'message_final', id: 'msg_a1', role: 'assistant', content: 'Authoritative final content', timestamp: 2, stopReason: 'end_turn' },
      ];
      await writeFile(
        join(dir, `${sessionId}.jsonl`),
        records.map((r) => JSON.stringify(r)).join('\n') + '\n',
        'utf-8',
      );

      const result = await replaySession(dir, sessionId);
      const session = result!.session;
      expect(session.messages).toHaveLength(1);
      expect(session.messages[0].content).toBe('Authoritative final content');
    });
  });

  // ─── appendRecord / writeRecords ───────────────────────────────────────────

  describe('appendRecord / writeRecords', () => {
    it('appendRecord should create dir and append', async () => {
      const dir = join(nextDir(), 'sub');
      // dir doesn't exist yet

      await appendRecord(dir, 'sess_x', {
        t: 'header', v: JSONL_VERSION, seq: 0, ts: 1, id: 'sess_x', createdAt: 1, metadata: {},
      });

      const content = await readFile(join(dir, 'sess_x.jsonl'), 'utf-8');
      const parsed = JSON.parse(content.trim());
      expect(parsed.t).toBe('header');
    });

    it('writeRecords should overwrite existing file', async () => {
      const dir = nextDir();
      await mkdir(dir, { recursive: true });

      await writeRecords(dir, 'sess_y', [
        { t: 'header', v: JSONL_VERSION, seq: 0, ts: 1, id: 'sess_y', createdAt: 1, metadata: {} },
        { t: 'message', seq: 1, ts: 1, id: 'msg_1', role: 'user', content: 'First' },
      ]);

      // Overwrite with different content
      await writeRecords(dir, 'sess_y', [
        { t: 'header', v: JSONL_VERSION, seq: 0, ts: 2, id: 'sess_y', createdAt: 1, metadata: {} },
      ]);

      const records = await readJsonl(join(dir, 'sess_y.jsonl'));
      expect(records).toHaveLength(1); // Only header, message gone
    });
  });

  // ─── getCurrent / setCurrent ───────────────────────────────────────────────

  describe('getCurrent / setCurrent', () => {
    it('should manage current session', async () => {
      const dir = nextDir();
      const service = createSessionService(dir);

      expect(service.getCurrent()).toBeNull();

      const session = await service.create('Current Test');
      service.setCurrent(session);

      expect(service.getCurrent()).toBe(session);

      service.setCurrent(null);
      expect(service.getCurrent()).toBeNull();
    });
  });

  // ─── createWorkAgent ───────────────────────────────────────────────────────

  describe('createWorkAgent', () => {
    it('should create a WorkAgent session with lifecycle metadata', async () => {
      const dir = nextDir();
      const service = createSessionService(dir);
      const session = await service.createWorkAgent({
        templateId: 'tmpl_test',
        goal: 'Review PR #42',
        orgId: 'ws_test',
      });

      expect(session.id).toMatch(/^sess_/);
      expect(session.title).toBe('Review PR #42');
      expect(session.metadata.type).toBe('workagent');
      expect(session.metadata.templateId).toBe('tmpl_test');
      expect(session.metadata.orgId).toBe('ws_test');

      const lifecycle = session.metadata.lifecycle as { state: string; stateHistory: unknown[] };
      expect(lifecycle.state).toBe('created');
      expect(lifecycle.stateHistory).toEqual([]);
    });

    it('should persist parentId in header when provided via config', async () => {
      const dir = nextDir();
      const service = createSessionService(dir);
      const parent = await service.create('Parent Session');

      const child = await service.createWorkAgent({
        templateId: 'tmpl_test',
        goal: 'Child task',
        orgId: 'ws_test',
        parentId: parent.id,
      });

      expect(child.parentId).toBe(parent.id);

      // Reload from disk — parentId must be in the header record
      const fresh = createSessionService(dir);
      const loaded = await fresh.get(child.id);
      expect(loaded!.parentId).toBe(parent.id);

      // Metadata-only replay should also have it
      const listed = await fresh.list();
      const found = listed.find((s) => s.id === child.id);
      expect(found!.parentId).toBe(parent.id);
    });
  });

  // ─── transitionState ───────────────────────────────────────────────────────

  describe('transitionState', () => {
    it('should transition created → active', async () => {
      const dir = nextDir();
      const service = createSessionService(dir);
      const session = await service.createWorkAgent({
        templateId: 'tmpl_test',
        goal: 'Test task',
        orgId: 'ws_test',
      });

      const updated = await service.transitionState(session.id, 'active', 'Starting work');

      const lifecycle = updated.metadata.lifecycle as { state: string; stateHistory: Array<{ from: string; to: string }> };
      expect(lifecycle.state).toBe('active');
      expect(lifecycle.stateHistory).toHaveLength(1);
      expect(lifecycle.stateHistory[0].from).toBe('created');
      expect(lifecycle.stateHistory[0].to).toBe('active');
    });

    it('should reject invalid transitions', async () => {
      const dir = nextDir();
      const service = createSessionService(dir);
      const session = await service.createWorkAgent({
        templateId: 'tmpl_test',
        goal: 'Test task',
        orgId: 'ws_test',
      });

      await expect(
        service.transitionState(session.id, 'completed', 'Skip to done'),
      ).rejects.toThrow('Invalid state transition');
    });

    it('should allow active → paused → active', async () => {
      const dir = nextDir();
      const service = createSessionService(dir);
      const session = await service.createWorkAgent({
        templateId: 'tmpl_test',
        goal: 'Test task',
        orgId: 'ws_test',
      });

      await service.transitionState(session.id, 'active', 'Start');
      await service.transitionState(session.id, 'paused', 'Waiting for review');
      const resumed = await service.transitionState(session.id, 'active', 'Review done');

      const lifecycle = resumed.metadata.lifecycle as { state: string; stateHistory: unknown[] };
      expect(lifecycle.state).toBe('active');
      expect(lifecycle.stateHistory).toHaveLength(3);
    });

    it('should reject transitions from terminal states', async () => {
      const dir = nextDir();
      const service = createSessionService(dir);
      const session = await service.createWorkAgent({
        templateId: 'tmpl_test',
        goal: 'Test task',
        orgId: 'ws_test',
      });

      await service.transitionState(session.id, 'active', 'Start');
      await service.transitionState(session.id, 'completed', 'Done');

      await expect(
        service.transitionState(session.id, 'active', 'Try again'),
      ).rejects.toThrow('Invalid state transition');
    });

    it('should persist lifecycle transition as meta record', async () => {
      const dir = nextDir();
      const service = createSessionService(dir);
      const session = await service.createWorkAgent({
        templateId: 'tmpl_test',
        goal: 'Test task',
        orgId: 'ws_test',
      });

      await service.transitionState(session.id, 'active', 'Go');

      // Reload from disk
      const fresh = createSessionService(dir);
      const loaded = await fresh.get(session.id);
      const lifecycle = loaded!.metadata.lifecycle as { state: string };
      expect(lifecycle.state).toBe('active');
    });
  });

  // ─── listByState ───────────────────────────────────────────────────────────

  describe('listByState', () => {
    it('should filter sessions by lifecycle state', async () => {
      const dir = nextDir();
      const service = createSessionService(dir);

      const s1 = await service.createWorkAgent({ templateId: 't', goal: 'Task 1', orgId: 'ws1' });
      const s2 = await service.createWorkAgent({ templateId: 't', goal: 'Task 2', orgId: 'ws1' });
      await service.createWorkAgent({ templateId: 't', goal: 'Task 3', orgId: 'ws1' });

      await service.transitionState(s1.id, 'active', 'Start');
      await service.transitionState(s2.id, 'active', 'Start');
      await service.transitionState(s2.id, 'completed', 'Done');

      const active = await service.listByState('active');
      expect(active).toHaveLength(1);
      expect(active[0].id).toBe(s1.id);

      const created = await service.listByState('created');
      expect(created).toHaveLength(1);

      const completed = await service.listByState('completed');
      expect(completed).toHaveLength(1);
      expect(completed[0].id).toBe(s2.id);
    });

    it('should filter by orgId', async () => {
      const dir = nextDir();
      const service = createSessionService(dir);

      await service.createWorkAgent({ templateId: 't', goal: 'WS1 task', orgId: 'ws1' });
      await service.createWorkAgent({ templateId: 't', goal: 'WS2 task', orgId: 'ws2' });

      const ws1Created = await service.listByState('created', 'ws1');
      expect(ws1Created).toHaveLength(1);
      expect(ws1Created[0].metadata.orgId).toBe('ws1');
    });
  });

  // ─── getChildren ───────────────────────────────────────────────────────────

  describe('getChildren', () => {
    it('should return child sessions', async () => {
      const dir = nextDir();
      const service = createSessionService(dir);

      const parent = await service.create('Parent');
      await service.recordMessage(parent.id, { id: 'msg_1', role: 'user', content: 'Hi', timestamp: 1 });
      const child1 = await service.fork(parent.id);
      const child2 = await service.fork(parent.id);

      const children = await service.getChildren(parent.id);
      expect(children).toHaveLength(2);
      expect(children.map((c) => c.id)).toContain(child1.id);
      expect(children.map((c) => c.id)).toContain(child2.id);
    });

    it('should return empty array for no children', async () => {
      const dir = nextDir();
      const service = createSessionService(dir);

      const session = await service.create('Alone');
      const children = await service.getChildren(session.id);
      expect(children).toEqual([]);
    });
  });

  // ─── parentId persistence ────────────────────────────────────────────────

  describe('parentId persistence', () => {
    it('create() with parentId should persist it in the header record', async () => {
      const dir = nextDir();
      const service = createSessionService(dir);

      // parentId is immutable lineage — set at creation time
      const session = await service.create('Child Session', 'sess_parent_abc');
      expect(session.parentId).toBe('sess_parent_abc');

      // Reload from disk — parentId must survive
      const fresh = createSessionService(dir);
      const loaded = await fresh.get(session.id);

      expect(loaded).not.toBeNull();
      expect(loaded!.parentId).toBe('sess_parent_abc');
    });

    it('parentId should survive through metadata-only replay (list)', async () => {
      const dir = nextDir();
      const service = createSessionService(dir);

      const session = await service.create('Child', 'sess_parent_xyz');

      // Simulate restart — list uses metadata-only replay
      const fresh = createSessionService(dir);
      const listed = await fresh.list();
      const found = listed.find((s) => s.id === session.id);

      expect(found).not.toBeNull();
      expect(found!.parentId).toBe('sess_parent_xyz');
    });

    it('legacy meta-patched parentId should survive replay (backward compat)', async () => {
      const dir = nextDir();
      await mkdir(dir, { recursive: true });

      // Simulate legacy data: parentId set via meta patch (old orchestration pattern)
      const sessionId = 'sess_legacy_parent';
      const lines = [
        JSON.stringify({
          t: 'header', v: JSONL_VERSION, id: sessionId, title: 'Legacy',
          createdAt: 1, updatedAt: 1, metadata: {},
        }),
        JSON.stringify({
          t: 'meta', updatedAt: 2, patch: { parentId: 'sess_old_parent' },
        }),
      ];
      await writeFile(join(dir, `${sessionId}.jsonl`), lines.join('\n') + '\n', 'utf-8');

      // Full replay should pick up parentId from meta patch
      const result = await replaySession(dir, sessionId);
      const session = result!.session;
      expect(session.parentId).toBe('sess_old_parent');

      // Metadata-only replay reads only the header — won't see the meta patch.
      // After consolidation (which runs automatically), the header will include parentId.
      const meta = await replaySessionMetadata(dir, sessionId);
      expect(meta!.parentId).toBeUndefined();
    });

    it('parentId from header should survive when no meta patch overrides it', async () => {
      const dir = nextDir();
      await mkdir(dir, { recursive: true });

      // Fork sets parentId in the header record
      const sessionId = 'sess_has_parent';
      const lines = [
        JSON.stringify({
          t: 'header', v: JSONL_VERSION, id: sessionId, title: 'Forked',
          createdAt: 1, updatedAt: 1, parentId: 'sess_original', metadata: {},
        }),
      ];
      await writeFile(join(dir, `${sessionId}.jsonl`), lines.join('\n') + '\n', 'utf-8');

      // Full replay
      const result = await replaySession(dir, sessionId);
      const session = result!.session;
      expect(session.parentId).toBe('sess_original');

      // Metadata-only replay
      const meta = await replaySessionMetadata(dir, sessionId);
      expect(meta!.parentId).toBe('sess_original');
    });

    it('updateSession() should not overwrite parentId even if metadata contains parentId', async () => {
      const dir = nextDir();
      const service = createSessionService(dir);
      const session = await service.create('Child', 'sess_original_parent');

      // Save with metadata that sneaks in a parentId — should be stripped
      await service.updateSession(session.id, {
        metadata: { ...session.metadata, parentId: 'sess_evil_override' },
      });

      // Reload from disk — original parentId from header should survive
      const fresh = createSessionService(dir);
      const loaded = await fresh.get(session.id);
      expect(loaded!.parentId).toBe('sess_original_parent');
    });

    it('updateSession() should not affect parentId — getChildren() remains consistent', async () => {
      const dir = nextDir();
      const service = createSessionService(dir);
      const parent = await service.create('Parent');
      const child = await service.create('Child', parent.id);

      // Verify getChildren returns the child
      let children = await service.getChildren(parent.id);
      expect(children).toHaveLength(1);
      expect(children[0].id).toBe(child.id);

      // updateSession() with metadata that contains a parentId — should be stripped
      await service.updateSession(child.id, {
        metadata: { ...child.metadata, parentId: 'sess_wrong_parent' },
      });

      // In-memory getChildren should still find the child under the original parent
      children = await service.getChildren(parent.id);
      expect(children).toHaveLength(1);
      expect(children[0].id).toBe(child.id);

      // And the child should NOT appear under the wrong parent
      const wrongChildren = await service.getChildren('sess_wrong_parent');
      expect(wrongChildren).toHaveLength(0);
    });
  });

  // ─── getMessages after lazy init ────────────────────────────────────────

  describe('getMessages after lazy init', () => {
    it('getMessages should return full messages after restart (lazy load)', async () => {
      const dir = nextDir();
      const service = createSessionService(dir);

      const session = await service.create('Lazy Msg Test');
      await service.recordMessage(session.id, {
        id: 'msg_lm1', role: 'user', content: 'First message', timestamp: 1,
      });
      await service.recordMessage(session.id, {
        id: 'msg_lm2', role: 'user', content: 'Second message', timestamp: 2,
      });

      // Simulate restart — messages not loaded at init
      const fresh = createSessionService(dir);
      const listed = await fresh.list();
      const stub = listed.find((s) => s.id === session.id);
      expect(stub!.messageCount).toBe(0); // metadata-only summary

      // getMessages triggers full replay via get()
      const msgs = await fresh.getMessages(session.id);
      expect(msgs).toHaveLength(2);
      expect(msgs[0].content).toBe('First message');
      expect(msgs[1].content).toBe('Second message');
    });
  });

  // ─── Consolidation under lock ──────────────────────────────────────────────

  describe('consolidation under lock', () => {
    it('append after finalize should survive consolidation', async () => {
      const dir = nextDir();
      const service = createSessionService(dir);
      const session = await service.create('Race Test');

      // Stream → finalize (triggers consolidation after 100ms)
      await service.recordStreamStart(session.id, 'msg_a1');
      await service.recordStreamDelta(session.id, 'msg_a1', 'Hello', 0);
      await service.recordStreamEnd(session.id, 'msg_a1', 'Hello', 'end_turn');

      // Immediately add a user message (races with scheduled consolidation)
      await service.recordMessage(session.id, {
        id: 'msg_u1', role: 'user', content: 'Follow up', timestamp: Date.now(),
      });

      // Wait for consolidation to complete
      await new Promise((resolve) => setTimeout(resolve, 300));

      // Verify both messages survive on disk
      const fresh = createSessionService(dir);
      const loaded = await fresh.get(session.id);
      expect(loaded!.messages).toHaveLength(2);
      expect(loaded!.messages[0].content).toBe('Hello');
      expect(loaded!.messages[1].content).toBe('Follow up');
    });
  });

  // ─── Lazy Loading (Fix #2) ─────────────────────────────────────────────────

  describe('lazy loading', () => {
    it('list() should return sessions with empty messages after restart', async () => {
      const dir = nextDir();
      const service = createSessionService(dir);

      // Create sessions with messages
      const s1 = await service.create('Session A');
      await service.recordMessage(s1.id, {
        id: 'msg_1', role: 'user', content: 'Hello from A', timestamp: Date.now(),
      });
      const s2 = await service.create('Session B');
      await service.recordMessage(s2.id, {
        id: 'msg_2', role: 'user', content: 'Hello from B', timestamp: Date.now(),
      });

      // Simulate restart — new service instance reads from disk
      const fresh = createSessionService(dir);
      const listed = await fresh.list();

      expect(listed).toHaveLength(2);
      // Metadata should be intact
      expect(listed.map((s) => s.title).sort()).toEqual(['Session A', 'Session B']);
      // Message history should NOT be loaded yet (metadata-only replay)
      for (const s of listed) {
        expect(s.messageCount).toBe(0);
        expect(s.lastMessagePreview).toBeUndefined();
      }
    });

    it('get() should lazily load full messages on demand', async () => {
      const dir = nextDir();
      const service = createSessionService(dir);

      const original = await service.create('Lazy Session');
      await service.recordMessage(original.id, {
        id: 'msg_lazy', role: 'user', content: 'Lazy content', timestamp: Date.now(),
      });

      // Simulate restart
      const fresh = createSessionService(dir);

      // list() gives metadata-only
      const listed = await fresh.list();
      const stub = listed.find((s) => s.id === original.id);
      expect(stub!.messageCount).toBe(0);

      // get() triggers full replay
      const loaded = await fresh.get(original.id);
      expect(loaded).not.toBeNull();
      expect(loaded!.messages).toHaveLength(1);
      expect(loaded!.messages[0].content).toBe('Lazy content');
    });

    it('get() should cache full load — second call returns same reference', async () => {
      const dir = nextDir();
      const service = createSessionService(dir);

      const s = await service.create('Cache Test');
      await service.recordMessage(s.id, {
        id: 'msg_c', role: 'user', content: 'cached', timestamp: Date.now(),
      });

      const fresh = createSessionService(dir);
      const first = await fresh.get(s.id);
      const second = await fresh.get(s.id);

      expect(first).toBe(second); // Same reference — no second replay
    });

    it('search() should find messages after lazy load', async () => {
      const dir = nextDir();
      const service = createSessionService(dir);

      const s = await service.create('Search Me');
      await service.recordMessage(s.id, {
        id: 'msg_s', role: 'user', content: 'unique_search_keyword_xyz', timestamp: Date.now(),
      });

      // Simulate restart
      const fresh = createSessionService(dir);

      // search() iterates sessions — at this point messages are empty
      // so searching message content won't find it unless search triggers load
      // The current implementation iterates in-memory messages, so this tests
      // that metadata-only sessions with empty messages won't false-positive
      const results = await fresh.search('unique_search_keyword_xyz');

      // Message search won't match because messages aren't loaded yet.
      // Only title search works against metadata-only sessions.
      // This verifies the lazy-loading contract: no false positives from
      // sessions that haven't been fully loaded.
      expect(results).toEqual([]);

      // After a get() triggers full load, search should find it
      await fresh.get(s.id);
      const afterLoad = await fresh.search('unique_search_keyword_xyz');
      expect(afterLoad).toHaveLength(1);
      expect(afterLoad[0].matchedText).toContain('unique_search_keyword_xyz');
    });

    it('replaySessionMetadata should read only the header line', async () => {
      const dir = nextDir();
      await mkdir(dir, { recursive: true });

      // Header has everything consolidation bakes in: title, metadata, updatedAt
      const sessionId = 'sess_meta_only';
      const lines = [
        JSON.stringify({ t: 'header', v: JSONL_VERSION, seq: 0, ts: 500, id: sessionId, title: 'Consolidated Title', createdAt: 1, metadata: { foo: 'bar', baz: 42 } }),
        JSON.stringify({ t: 'message', seq: 1, ts: 600, id: 'msg_1', role: 'user', content: 'Hello' }),
        JSON.stringify({ t: 'meta', seq: 2, ts: 700, patch: { title: 'Post-Consolidation Rename' } }),
      ];
      await writeFile(join(dir, `${sessionId}.jsonl`), lines.join('\n') + '\n', 'utf-8');

      const session = await replaySessionMetadata(dir, sessionId);

      expect(session).not.toBeNull();
      // Only the header is read — body records are ignored
      expect(session!.title).toBe('Consolidated Title');
      expect(session!.updatedAt).toBe(500);
      expect(session!.metadata).toEqual({ foo: 'bar', baz: 42 });
      expect(session!.messages).toEqual([]);
    });

    it('replaySessionMetadata should return null for non-existent file', async () => {
      const dir = nextDir();
      await mkdir(dir, { recursive: true });

      const result = await replaySessionMetadata(dir, 'nonexistent');
      expect(result).toBeNull();
    });
  });

  // ─── Batch Delta Persistence (Fix #3) ─────────────────────────────────────

  describe('batch delta persistence', () => {
    it('recordStreamDeltaBatch should write all deltas in single I/O', async () => {
      const dir = nextDir();
      const service = createSessionService(dir);
      const session = await service.create('Batch Test');

      await service.recordStreamStart(session.id, 'msg_batch');

      // Batch 5 deltas at once
      await service.recordStreamDeltaBatch(session.id, 'msg_batch', [
        { delta: 'Hello ', seq: 0 },
        { delta: 'world, ', seq: 1 },
        { delta: 'this ', seq: 2 },
        { delta: 'is ', seq: 3 },
        { delta: 'batched!', seq: 4 },
      ]);

      // Verify JSONL file has all 5 delta records
      const filePath = join(dir, `${session.id}.jsonl`);
      const records = await readJsonl(filePath);
      const deltas = records.filter((r) => (r as Record<string, unknown>).t === 'message_delta');
      expect(deltas).toHaveLength(5);

      // Verify order preserved (server assigns seq; values are monotonically increasing)
      const seqs = deltas.map((d) => (d as Record<string, unknown>).seq as number);
      for (let i = 1; i < seqs.length; i++) {
        expect(seqs[i]).toBeGreaterThan(seqs[i - 1]);
      }
    });

    it('batch deltas should be recoverable on crash (no finalize)', async () => {
      const dir = nextDir();
      await mkdir(dir, { recursive: true });

      // Manually write JSONL simulating batch deltas followed by crash
      const sessionId = 'sess_batch_crash';
      const records = [
        { t: 'header', v: JSONL_VERSION, id: sessionId, createdAt: 1, updatedAt: 1, metadata: {} },
        { t: 'message_start', id: 'msg_b1', role: 'assistant', timestamp: 2 },
        { t: 'message_delta', id: 'msg_b1', delta: 'Batch ', seq: 0 },
        { t: 'message_delta', id: 'msg_b1', delta: 'recovery ', seq: 1 },
        { t: 'message_delta', id: 'msg_b1', delta: 'test', seq: 2 },
        // No message_final — crash
      ];
      await writeFile(
        join(dir, `${sessionId}.jsonl`),
        records.map((r) => JSON.stringify(r)).join('\n') + '\n',
        'utf-8',
      );

      // Replay should reconstruct from orphaned deltas
      const result = await replaySession(dir, sessionId);
      expect(result).not.toBeNull();
      const session = result!.session;
      expect(session.messages).toHaveLength(1);
      expect(session.messages[0].content).toBe('Batch recovery test');
      expect(session.messages[0].role).toBe('assistant');
    });

    it('recordStreamDeltaBatch should no-op for empty array', async () => {
      const dir = nextDir();
      const service = createSessionService(dir);
      const session = await service.create('Empty Batch');

      const fileBefore = await readJsonl(join(dir, `${session.id}.jsonl`));

      // Empty batch — should not append anything
      await service.recordStreamDeltaBatch(session.id, 'msg_noop', []);

      const fileAfter = await readJsonl(join(dir, `${session.id}.jsonl`));
      expect(fileAfter).toHaveLength(fileBefore.length);
    });

    it('appendRecords should write multiple records atomically', async () => {
      const dir = nextDir();
      await mkdir(dir, { recursive: true });

      const sessionId = 'sess_multi';
      // Write header first
      await writeRecords(dir, sessionId, [
        { t: 'header', v: JSONL_VERSION, seq: 0, ts: 1, id: sessionId, createdAt: 1, metadata: {} },
      ]);

      // Batch append multiple records
      await appendRecords(dir, sessionId, [
        { t: 'message', seq: 1, ts: 1, id: 'msg_1', role: 'user', content: 'First' },
        { t: 'message', seq: 2, ts: 2, id: 'msg_2', role: 'user', content: 'Second' },
        { t: 'message', seq: 3, ts: 3, id: 'msg_3', role: 'user', content: 'Third' },
      ]);

      const records = await readJsonl(join(dir, `${sessionId}.jsonl`));
      expect(records).toHaveLength(4); // header + 3 messages
      expect((records[1] as Record<string, unknown>).content).toBe('First');
      expect((records[3] as Record<string, unknown>).content).toBe('Third');
    });

    it('appendRecords should no-op for empty array', async () => {
      const dir = nextDir();
      await mkdir(dir, { recursive: true });

      const sessionId = 'sess_empty_batch';
      await writeRecords(dir, sessionId, [
        { t: 'header', v: JSONL_VERSION, seq: 0, ts: 1, id: sessionId, createdAt: 1, metadata: {} },
      ]);

      await appendRecords(dir, sessionId, []);

      const records = await readJsonl(join(dir, `${sessionId}.jsonl`));
      expect(records).toHaveLength(1); // Just the header
    });
  });

  // ─── updatedAt persistence (Fix #5) ──────────────────────────────────────

  describe('updatedAt persistence', () => {
    it('recordMessage should durably advance updatedAt on disk', async () => {
      const dir = nextDir();
      const service = createSessionService(dir);
      const session = await service.create('UpdatedAt Test');
      const createdAt = session.updatedAt;

      await new Promise((resolve) => setTimeout(resolve, 10));

      await service.recordMessage(session.id, {
        id: 'msg_u1', role: 'user', content: 'Hello', timestamp: Date.now(),
      });

      // In-memory updatedAt should have advanced
      const got = await service.get(session.id);
      expect(got!.updatedAt).toBeGreaterThan(createdAt);

      // Reload from disk — updatedAt must survive without a separate meta record
      const fresh = createSessionService(dir);
      const loaded = await fresh.get(session.id);
      expect(loaded!.updatedAt).toBeGreaterThan(createdAt);
    });

    it('recordStreamEnd should durably advance updatedAt on disk', async () => {
      const dir = nextDir();
      const service = createSessionService(dir);
      const session = await service.create('Finalize UpdatedAt');
      const createdAt = session.updatedAt;

      await service.recordStreamStart(session.id, 'msg_a1');
      await service.recordStreamDelta(session.id, 'msg_a1', 'Hi', 0);

      await new Promise((resolve) => setTimeout(resolve, 10));
      await service.recordStreamEnd(session.id, 'msg_a1', 'Hi', 'end_turn');

      // Wait for consolidation to settle
      await new Promise((resolve) => setTimeout(resolve, 300));

      // Reload from disk
      const fresh = createSessionService(dir);
      const loaded = await fresh.get(session.id);
      expect(loaded!.updatedAt).toBeGreaterThan(createdAt);
    });

    it('full replay derives updatedAt from message timestamps (metadata replay uses header only)', async () => {
      const dir = nextDir();
      await mkdir(dir, { recursive: true });

      const sessionId = 'sess_updatedAt_meta';
      const lines = [
        JSON.stringify({ t: 'header', v: JSONL_VERSION, seq: 0, ts: 100, id: sessionId, createdAt: 100, metadata: {} }),
        JSON.stringify({ t: 'message', seq: 1, ts: 500, id: 'msg_1', role: 'user', content: 'Hello' }),
        JSON.stringify({ t: 'message_final', seq: 2, ts: 800, id: 'msg_a1', role: 'assistant', content: 'Hi', stopReason: 'end_turn' }),
      ];
      await writeFile(join(dir, `${sessionId}.jsonl`), lines.join('\n') + '\n', 'utf-8');

      // Full replay picks up updatedAt from message records
      const fullResult = await replaySession(dir, sessionId);
      const full = fullResult!.session;
      expect(full.updatedAt).toBe(800);

      // Metadata replay reads only the header — returns the header's updatedAt.
      // After consolidation, the header's updatedAt would be 800 too.
      const meta = await replaySessionMetadata(dir, sessionId);
      expect(meta!.updatedAt).toBe(100);
    });

    it('message_start should advance updatedAt in full replay', async () => {
      const dir = nextDir();
      await mkdir(dir, { recursive: true });

      // Scenario: only a header + message_start (stream started, never finalized)
      const sessionId = 'sess_start_only';
      const lines = [
        JSON.stringify({ t: 'header', v: JSONL_VERSION, seq: 0, ts: 1, id: sessionId, createdAt: 1, metadata: {} }),
        JSON.stringify({ t: 'message_start', seq: 1, ts: 10, id: 'msg_s1', role: 'assistant' }),
      ];
      await writeFile(join(dir, `${sessionId}.jsonl`), lines.join('\n') + '\n', 'utf-8');

      const fullResult = await replaySession(dir, sessionId);
      const full = fullResult!.session;
      expect(full.updatedAt).toBe(10);

      // Metadata replay only reads the header — returns header's updatedAt
      const meta = await replaySessionMetadata(dir, sessionId);
      expect(meta!.updatedAt).toBe(1);
    });

    it('message_abort should advance updatedAt in full replay', async () => {
      const dir = nextDir();
      await mkdir(dir, { recursive: true });

      // Scenario: header + message_start + message_abort (stream started then aborted)
      const sessionId = 'sess_abort_ts';
      const lines = [
        JSON.stringify({ t: 'header', v: JSONL_VERSION, seq: 0, ts: 1, id: sessionId, createdAt: 1, metadata: {} }),
        JSON.stringify({ t: 'message_start', seq: 1, ts: 10, id: 'msg_a1', role: 'assistant' }),
        JSON.stringify({ t: 'message_abort', seq: 2, ts: 20, id: 'msg_a1', reason: 'cancelled' }),
      ];
      await writeFile(join(dir, `${sessionId}.jsonl`), lines.join('\n') + '\n', 'utf-8');

      const fullResult = await replaySession(dir, sessionId);
      const full = fullResult!.session;
      expect(full.updatedAt).toBe(20);
    });

    it('replaySessionMetadata reads only the header (ignores body records)', async () => {
      const dir = nextDir();
      await mkdir(dir, { recursive: true });

      // Header says updatedAt=1, but body records have much later timestamps.
      // Metadata replay should only use the header value — body is deferred to full replay.
      const sessionId = 'sess_header_only';
      const lines = [
        JSON.stringify({ t: 'header', v: JSONL_VERSION, seq: 0, ts: 1, id: sessionId, title: 'Original', createdAt: 1, metadata: { foo: 'bar' } }),
        JSON.stringify({ t: 'meta', seq: 1, ts: 50, patch: { title: 'Renamed' } }),
        JSON.stringify({ t: 'message', seq: 2, ts: 100, id: 'msg1', role: 'user', content: 'hello' }),
      ];
      await writeFile(join(dir, `${sessionId}.jsonl`), lines.join('\n') + '\n', 'utf-8');

      const meta = await replaySessionMetadata(dir, sessionId);
      expect(meta).not.toBeNull();
      // Header-only: uses header's updatedAt, title, and metadata
      expect(meta!.updatedAt).toBe(1);
      expect(meta!.title).toBe('Original');
      expect(meta!.metadata).toEqual({ foo: 'bar' });
      expect(meta!.messages).toEqual([]);

      // Full replay sees the body records
      const fullResult = await replaySession(dir, sessionId);
      const full = fullResult!.session;
      expect(full.updatedAt).toBe(100);
      expect(full.title).toBe('Renamed');
    });

    it('recordMessage with old timestamp should still advance durable updatedAt', async () => {
      const dir = nextDir();
      const service = createSessionService(dir);
      const session = await service.create('Old Timestamp Test');
      const createdAt = session.updatedAt;

      // Add a message with a very old timestamp (simulates delayed/replayed message)
      await service.recordMessage(session.id, {
        id: 'msg_old', role: 'user', content: 'Old message', timestamp: 1,
      });

      // Reload from disk
      const fresh = createSessionService(dir);
      const loaded = await fresh.get(session.id);

      // updatedAt must have advanced beyond the header's createdAt
      // because the record timestamp is floored to Date.now()
      expect(loaded!.updatedAt).toBeGreaterThanOrEqual(createdAt);

      // The stored message timestamp should also be floored
      expect(loaded!.messages[0].timestamp).toBeGreaterThanOrEqual(createdAt);
    });

    it('list() should reflect accurate updatedAt after recordMessage', async () => {
      const dir = nextDir();
      const service = createSessionService(dir);

      const s1 = await service.create('Old Session');
      await new Promise((resolve) => setTimeout(resolve, 10));
      await service.create('New Session');

      // recordMessage triggers consolidation, which bakes updatedAt into the header
      await new Promise((resolve) => setTimeout(resolve, 10));
      await service.recordMessage(s1.id, {
        id: 'msg_bump', role: 'user', content: 'Bump', timestamp: Date.now(),
      });

      // Wait for consolidation to fire (100ms setTimeout in scheduleConsolidation)
      await new Promise((resolve) => setTimeout(resolve, 600));

      // Restart — metadata replay reads only the consolidated header
      const fresh = createSessionService(dir);
      const listed = await fresh.list();

      // s1 should now be first (most recently updated)
      expect(listed[0].id).toBe(s1.id);
      expect(listed[0].updatedAt).toBeGreaterThan(listed[1].updatedAt);
    });
  });

  // ─── Consolidation duplicate prevention (Fix #6) ────────────────────────────

  describe('consolidation duplicate prevention', () => {
    it('recordMessage inside lock should prevent duplicate records after consolidation', async () => {
      const dir = nextDir();
      const service = createSessionService(dir);
      const session = await service.create('Dedup Test');

      // Add a user message
      await service.recordMessage(session.id, {
        id: 'msg_u1', role: 'user', content: 'User message', timestamp: Date.now(),
      });

      // Stream + finalize (triggers consolidation)
      await service.recordStreamStart(session.id, 'msg_a1');
      await service.recordStreamDelta(session.id, 'msg_a1', 'Response', 0);
      await service.recordStreamEnd(session.id, 'msg_a1', 'Response', 'end_turn');

      // Immediately add another message (races with consolidation)
      await service.recordMessage(session.id, {
        id: 'msg_u2', role: 'user', content: 'Follow up', timestamp: Date.now(),
      });

      // Wait for consolidation to complete
      await new Promise((resolve) => setTimeout(resolve, 300));

      // Reload and check — no duplicate messages
      const fresh = createSessionService(dir);
      const loaded = await fresh.get(session.id);

      expect(loaded!.messages).toHaveLength(3);
      expect(loaded!.messages[0].id).toBe('msg_u1');
      expect(loaded!.messages[1].id).toBe('msg_a1');
      expect(loaded!.messages[2].id).toBe('msg_u2');

      // Each message ID should appear exactly once
      const ids = loaded!.messages.map((m) => m.id);
      expect(new Set(ids).size).toBe(ids.length);
    });

    it('concurrent recordMessage calls should not produce duplicates', async () => {
      const dir = nextDir();
      const service = createSessionService(dir);
      const session = await service.create('Concurrent Test');

      // Fire multiple recordMessage calls concurrently
      await Promise.all([
        service.recordMessage(session.id, { id: 'msg_c1', role: 'user', content: 'Msg 1', timestamp: Date.now() }),
        service.recordMessage(session.id, { id: 'msg_c2', role: 'user', content: 'Msg 2', timestamp: Date.now() }),
        service.recordMessage(session.id, { id: 'msg_c3', role: 'user', content: 'Msg 3', timestamp: Date.now() }),
      ]);

      // Reload from disk
      const fresh = createSessionService(dir);
      const loaded = await fresh.get(session.id);

      expect(loaded!.messages).toHaveLength(3);
      const ids = loaded!.messages.map((m) => m.id);
      expect(new Set(ids).size).toBe(3); // All unique
    });
  });

  // ─── Hydration Status ──────────────────────────────────────────────────────

  describe('hydration status', () => {
    it('getHydrationStatus should return "ready" for newly created sessions', async () => {
      const dir = nextDir();
      const service = createSessionService(dir);
      const session = await service.create('Fresh');

      expect(service.getHydrationStatus(session.id)).toBe('ready');
    });

    it('getHydrationStatus should return "cold" for unknown sessions', async () => {
      const dir = nextDir();
      const service = createSessionService(dir);
      await service.create('Init'); // trigger init

      expect(service.getHydrationStatus('non_existent')).toBe('cold');
    });

    it('get() on a cold session should set status to "ready"', async () => {
      const dir = nextDir();
      const service = createSessionService(dir);
      const session = await service.create('Hydrate Me');
      await service.recordMessage(session.id, {
        id: 'msg_h1', role: 'user', content: 'Hello', timestamp: Date.now(),
      });

      // Simulate restart — sessions loaded as cold (header-only)
      const fresh = createSessionService(dir);
      const listed = await fresh.list();
      const stub = listed.find((s) => s.id === session.id);
      expect(stub).toBeTruthy();

      // Before get(), status should be cold (but background rehydration may have started)
      // After get(), status should be ready
      const loaded = await fresh.get(session.id);
      expect(loaded).not.toBeNull();
      expect(loaded!.messages).toHaveLength(1);
      expect(fresh.getHydrationStatus(session.id)).toBe('ready');
    });

    it('background rehydration should eventually set all sessions to ready', async () => {
      const dir = nextDir();
      const service = createSessionService(dir);

      // Create multiple sessions
      const s1 = await service.create('Session 1');
      const s2 = await service.create('Session 2');
      await service.recordMessage(s1.id, {
        id: 'msg_r1', role: 'user', content: 'Hello 1', timestamp: Date.now(),
      });
      await service.recordMessage(s2.id, {
        id: 'msg_r2', role: 'user', content: 'Hello 2', timestamp: Date.now(),
      });

      // Wait for consolidation to bake headers
      await new Promise((resolve) => setTimeout(resolve, 600));

      // Simulate restart
      const fresh = createSessionService(dir);
      await fresh.list(); // triggers ensureInitialized + background rehydration

      // Wait for background rehydration to complete (bounded concurrency: max 3)
      await new Promise((resolve) => setTimeout(resolve, 1000));

      expect(fresh.getHydrationStatus(s1.id)).toBe('ready');
      expect(fresh.getHydrationStatus(s2.id)).toBe('ready');
    });

    it('background rehydration should fix stale metadata from header-only replay', async () => {
      const dir = nextDir();
      await mkdir(dir, { recursive: true });

      // Simulate legacy session: title set via meta patch, not in header
      const sessionId = 'sess_legacy_hydrate';
      const lines = [
        JSON.stringify({
          t: 'header', v: JSONL_VERSION, seq: 0, ts: 1, id: sessionId, title: 'Old Title',
          createdAt: 1, metadata: {},
        }),
        JSON.stringify({
          t: 'meta', seq: 1, ts: 100, patch: { title: 'New Title' },
        }),
        JSON.stringify({
          t: 'message', seq: 2, ts: 200, id: 'msg_1', role: 'user', content: 'Hello',
        }),
      ];
      await writeFile(join(dir, `${sessionId}.jsonl`), lines.join('\n') + '\n', 'utf-8');

      // Fresh service — init reads header-only (stale metadata)
      const service = createSessionService(dir);
      const listed = await service.list();
      const stub = listed.find((s) => s.id === sessionId);

      // Initially has stale header data
      expect(stub!.title).toBe('Old Title');
      expect(stub!.updatedAt).toBe(1);

      // Wait for background rehydration to complete
      await new Promise((resolve) => setTimeout(resolve, 1000));

      // After rehydration, in-memory session should have correct metadata
      const session = service.getCurrent() ?? (await service.list()).find((s) => s.id === sessionId);
      expect(session).toBeTruthy();
      expect(session!.title).toBe('New Title');
      expect(session!.updatedAt).toBe(200);
      expect(service.getHydrationStatus(sessionId)).toBe('ready');

      // The JSONL file should also be consolidated (header now has correct data)
      const records = await readJsonl(join(dir, `${sessionId}.jsonl`));
      const header = records[0] as Record<string, unknown>;
      expect(header.title).toBe('New Title');
      expect(header.ts).toBe(200);
    });

    it('delete should clean up hydration status', async () => {
      const dir = nextDir();
      const service = createSessionService(dir);
      const session = await service.create('Delete Hydration');

      expect(service.getHydrationStatus(session.id)).toBe('ready');

      await service.delete(session.id);

      // After delete, status should fall back to default 'cold'
      expect(service.getHydrationStatus(session.id)).toBe('cold');
    });

    it('delete during background rehydration should prevent resurrection', async () => {
      const dir = nextDir();
      const service = createSessionService(dir);

      // Create a session with messages so background rehydration has work to do
      const session = await service.create('About To Die');
      await service.recordMessage(session.id, {
        id: 'msg_die1', role: 'user', content: 'Hello', timestamp: Date.now(),
      });
      await service.recordMessage(session.id, {
        id: 'msg_die2', role: 'user', content: 'Goodbye', timestamp: Date.now(),
      });

      // Wait for consolidation to write JSONL
      await new Promise((resolve) => setTimeout(resolve, 600));

      // Simulate restart — sessions loaded as cold (header-only)
      const fresh = createSessionService(dir);
      const listed = await fresh.list(); // triggers ensureInitialized + background rehydration
      expect(listed).toHaveLength(1);

      // Immediately delete while background rehydration is in-flight
      await fresh.delete(session.id);

      // Wait for background rehydration to complete (or be cancelled)
      await new Promise((resolve) => setTimeout(resolve, 1000));

      // Session must NOT be resurrected
      const afterDelete = await fresh.list();
      expect(afterDelete).toHaveLength(0);
      expect(await fresh.get(session.id)).toBeNull();

      // JSONL file must NOT be recreated by consolidation
      const { existsSync } = await import('fs');
      expect(existsSync(join(dir, `${session.id}.jsonl`))).toBe(false);
    });

    it('delete during pending consolidation should not recreate file', async () => {
      const dir = nextDir();
      const service = createSessionService(dir);

      // Create session and record a message (which schedules a 500ms consolidation)
      const session = await service.create('Consolidation Victim');
      await service.recordMessage(session.id, {
        id: 'msg_cv1', role: 'user', content: 'About to be deleted', timestamp: Date.now(),
      });

      // Delete immediately — before the 500ms consolidation timer fires
      await service.delete(session.id);

      // Wait for the consolidation timer to fire (600ms > 500ms debounce)
      await new Promise((resolve) => setTimeout(resolve, 600));

      // Session must remain deleted — file must NOT be recreated
      const afterDelete = await service.list();
      expect(afterDelete).toHaveLength(0);
      expect(await service.get(session.id)).toBeNull();

      const { existsSync } = await import('fs');
      expect(existsSync(join(dir, `${session.id}.jsonl`))).toBe(false);
    });

    it('dispose should clear all hydration state', async () => {
      const dir = nextDir();
      const service = createSessionService(dir);
      const session = await service.create('Dispose Hydration');

      expect(service.getHydrationStatus(session.id)).toBe('ready');

      service.dispose();

      // After dispose, status should fall back to default 'cold'
      expect(service.getHydrationStatus(session.id)).toBe('cold');
    });
  });

  // ─── dispose ───────────────────────────────────────────────────────────────

  describe('dispose', () => {
    it('should clear all state', async () => {
      const dir = nextDir();
      const service = createSessionService(dir);
      await service.create('Dispose Test');

      service.dispose();

      expect(service.getCurrent()).toBeNull();
    });
  });
});
