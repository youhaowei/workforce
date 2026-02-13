/**
 * Session Service Tests
 *
 * Tests for JSONL session persistence, streaming deltas, crash recovery,
 * compaction, and lifecycle management.
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll, afterAll } from 'vitest';
import { mkdir, writeFile, rm, readFile, readdir } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  resetSessionService,
  createSessionService,
  JSONL_VERSION,
  replaySession,
  replaySessionMetadata,
  appendRecord,
  appendRecords,
  writeRecords,
  compactSession,
} from './session';

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

  // ─── save ──────────────────────────────────────────────────────────────────

  describe('save', () => {
    it('should update session and persist via meta record', async () => {
      const dir = nextDir();
      const service = createSessionService(dir);
      const session = await service.create('Save Test');

      session.title = 'Updated Title';
      await service.save(session);

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
      await service.save(session);

      expect(session.updatedAt).toBeGreaterThan(originalUpdatedAt);
    });

    it('should append meta record to JSONL', async () => {
      const dir = nextDir();
      const service = createSessionService(dir);
      const session = await service.create('Meta Test');

      session.title = 'New Title';
      await service.save(session);

      const filePath = join(dir, `${session.id}.jsonl`);
      const records = await readJsonl(filePath);

      expect(records.length).toBeGreaterThanOrEqual(2); // header + meta
      const meta = records[records.length - 1] as Record<string, unknown>;
      expect(meta.t).toBe('meta');
      expect((meta.patch as Record<string, unknown>).title).toBe('New Title');
    });
  });

  // ─── addMessage ────────────────────────────────────────────────────────────

  describe('addMessage', () => {
    it('should add a message and persist it', async () => {
      const dir = nextDir();
      const service = createSessionService(dir);
      const session = await service.create('Msg Test');

      await service.addMessage(session.id, {
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
        service.addMessage('non-existent', {
          id: 'msg_1', role: 'user', content: 'x', timestamp: 1,
        }),
      ).rejects.toThrow('Session not found');
    });

    it('should persist as message record in JSONL', async () => {
      const dir = nextDir();
      const service = createSessionService(dir);
      const session = await service.create('Persist Msg');

      await service.addMessage(session.id, {
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

      await service.addMessage(session.id, {
        id: 'msg_1', role: 'user', content: 'First', timestamp: 1,
      });
      await service.addMessage(session.id, {
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
        await service.addMessage(session.id, {
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
      await service.startAssistantStream(session.id, 'msg_a1');

      // Append deltas
      await service.appendAssistantDelta(session.id, 'msg_a1', 'Hello ', 0);
      await service.appendAssistantDelta(session.id, 'msg_a1', 'world!', 1);

      // Finalize
      await service.finalizeAssistantMessage(session.id, 'msg_a1', 'Hello world!', 'end_turn');

      // Wait for compaction
      await new Promise((resolve) => setTimeout(resolve, 200));

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

      await service.startAssistantStream(session.id, 'msg_a2');
      await service.appendAssistantDelta(session.id, 'msg_a2', 'delta1 ', 0);
      await service.appendAssistantDelta(session.id, 'msg_a2', 'delta2', 1);
      await service.finalizeAssistantMessage(session.id, 'msg_a2', 'delta1 delta2', 'end_turn');

      // Wait for compaction
      await new Promise((resolve) => setTimeout(resolve, 200));

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
      const session = await replaySession(sessionsDir, sessionId);

      expect(session).not.toBeNull();
      expect(session!.messages).toHaveLength(2); // user msg + reconstructed assistant
      expect(session!.messages[1].role).toBe('assistant');
      expect(session!.messages[1].content).toBe('Part one');
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

      const session = await replaySession(dir, sessionId);
      expect(session!.messages[0].content).toBe('A B C');
    });

    it('should preserve partial content on abort', async () => {
      const dir = nextDir();
      const service = createSessionService(dir);
      const session = await service.create('Abort Test');

      await service.startAssistantStream(session.id, 'msg_a3');
      await service.appendAssistantDelta(session.id, 'msg_a3', 'partial ', 0);
      await service.appendAssistantDelta(session.id, 'msg_a3', 'content', 1);
      await service.abortAssistantStream(session.id, 'msg_a3', 'user_cancelled');

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

      const session = await replaySession(dir, sessionId);
      expect(session!.messages).toHaveLength(0);
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

      await service.addMessage(parent.id, {
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

      await service.addMessage(parent.id, {
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
      await service.addMessage(session.id, {
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
        JSON.stringify({ t: 'message', id: 'x', role: 'user', content: '', timestamp: 1 }) + '\n',
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
        JSON.stringify({ t: 'header', v: JSONL_VERSION, id: sessionId, createdAt: 1, updatedAt: 1, metadata: {} }),
        '{{bad json}}',
        JSON.stringify({ t: 'message', id: 'msg_1', role: 'user', content: 'Good', timestamp: 1 }),
      ];
      await writeFile(join(dir, `${sessionId}.jsonl`), lines.join('\n') + '\n', 'utf-8');

      const session = await replaySession(dir, sessionId);
      expect(session).not.toBeNull();
      expect(session!.messages).toHaveLength(1);
      expect(session!.messages[0].content).toBe('Good');
    });
  });

  // ─── Compaction ────────────────────────────────────────────────────────────

  describe('compaction', () => {
    it('should produce clean JSONL with header + messages only', async () => {
      const dir = nextDir();
      await mkdir(dir, { recursive: true });

      const session = {
        id: 'sess_compact',
        title: 'Compact Me',
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
        { t: 'meta', updatedAt: 2000, patch: { key: 'value', title: 'Compact Me' } },
      ];
      const noisyContent = noisyRecords.map((r) => JSON.stringify(r)).join('\n') + '\n';
      await writeFile(join(dir, `${session.id}.jsonl`), noisyContent, 'utf-8');

      // Run compaction
      await compactSession(dir, session);

      // Read compacted file
      const records = await readJsonl(join(dir, `${session.id}.jsonl`));

      // Should be clean: header + message + message_final
      expect(records).toHaveLength(3);

      const header = records[0] as Record<string, unknown>;
      expect(header.t).toBe('header');
      expect(header.title).toBe('Compact Me');
      expect(header.updatedAt).toBe(2000);
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
        { t: 'header', v: JSONL_VERSION, id: session.id, createdAt: 1, updatedAt: 1, metadata: {} },
      ]);

      await compactSession(dir, session);

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
        JSON.stringify({ t: 'header', v: JSONL_VERSION, id: sessionId, title: 'V1', createdAt: 1, updatedAt: 1, metadata: {} }),
        JSON.stringify({ t: 'meta', updatedAt: 2, patch: { title: 'V2', color: 'blue' } }),
        JSON.stringify({ t: 'meta', updatedAt: 3, patch: { title: 'V3' } }),
      ];
      await writeFile(join(dir, `${sessionId}.jsonl`), lines.join('\n') + '\n', 'utf-8');

      const session = await replaySession(dir, sessionId);
      expect(session!.title).toBe('V3');
      expect(session!.updatedAt).toBe(3);
      expect(session!.metadata.color).toBe('blue');
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

      const session = await replaySession(dir, sessionId);
      expect(session!.messages).toHaveLength(1);
      expect(session!.messages[0].content).toBe('Authoritative final content');
    });
  });

  // ─── appendRecord / writeRecords ───────────────────────────────────────────

  describe('appendRecord / writeRecords', () => {
    it('appendRecord should create dir and append', async () => {
      const dir = join(nextDir(), 'sub');
      // dir doesn't exist yet

      await appendRecord(dir, 'sess_x', {
        t: 'header', v: JSONL_VERSION, id: 'sess_x', createdAt: 1, updatedAt: 1, metadata: {},
      });

      const content = await readFile(join(dir, 'sess_x.jsonl'), 'utf-8');
      const parsed = JSON.parse(content.trim());
      expect(parsed.t).toBe('header');
    });

    it('writeRecords should overwrite existing file', async () => {
      const dir = nextDir();
      await mkdir(dir, { recursive: true });

      await writeRecords(dir, 'sess_y', [
        { t: 'header', v: JSONL_VERSION, id: 'sess_y', createdAt: 1, updatedAt: 1, metadata: {} },
        { t: 'message', id: 'msg_1', role: 'user', content: 'First', timestamp: 1 },
      ]);

      // Overwrite with different content
      await writeRecords(dir, 'sess_y', [
        { t: 'header', v: JSONL_VERSION, id: 'sess_y', createdAt: 1, updatedAt: 2, metadata: {} },
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

  // ─── Lazy Loading (Fix #2) ─────────────────────────────────────────────────

  describe('lazy loading', () => {
    it('list() should return sessions with empty messages after restart', async () => {
      const dir = nextDir();
      const service = createSessionService(dir);

      // Create sessions with messages
      const s1 = await service.create('Session A');
      await service.addMessage(s1.id, {
        id: 'msg_1', role: 'user', content: 'Hello from A', timestamp: Date.now(),
      });
      const s2 = await service.create('Session B');
      await service.addMessage(s2.id, {
        id: 'msg_2', role: 'user', content: 'Hello from B', timestamp: Date.now(),
      });

      // Simulate restart — new service instance reads from disk
      const fresh = createSessionService(dir);
      const listed = await fresh.list();

      expect(listed).toHaveLength(2);
      // Metadata should be intact
      expect(listed.map((s) => s.title).sort()).toEqual(['Session A', 'Session B']);
      // Messages should NOT be loaded yet (metadata-only replay)
      for (const s of listed) {
        expect(s.messages).toEqual([]);
      }
    });

    it('get() should lazily load full messages on demand', async () => {
      const dir = nextDir();
      const service = createSessionService(dir);

      const original = await service.create('Lazy Session');
      await service.addMessage(original.id, {
        id: 'msg_lazy', role: 'user', content: 'Lazy content', timestamp: Date.now(),
      });

      // Simulate restart
      const fresh = createSessionService(dir);

      // list() gives metadata-only
      const listed = await fresh.list();
      const stub = listed.find((s) => s.id === original.id);
      expect(stub!.messages).toEqual([]);

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
      await service.addMessage(s.id, {
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
      await service.addMessage(s.id, {
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

    it('replaySessionMetadata should only read header + meta records', async () => {
      const dir = nextDir();
      await mkdir(dir, { recursive: true });

      const sessionId = 'sess_meta_only';
      const lines = [
        JSON.stringify({ t: 'header', v: JSONL_VERSION, id: sessionId, title: 'Original', createdAt: 1, updatedAt: 1, metadata: { foo: 'bar' } }),
        JSON.stringify({ t: 'message', id: 'msg_1', role: 'user', content: 'Hello', timestamp: 2 }),
        JSON.stringify({ t: 'meta', updatedAt: 3, patch: { title: 'Updated', baz: 42 } }),
        JSON.stringify({ t: 'message_start', id: 'msg_a1', role: 'assistant', timestamp: 4 }),
        JSON.stringify({ t: 'message_delta', id: 'msg_a1', delta: 'Hi', seq: 0 }),
        JSON.stringify({ t: 'message_final', id: 'msg_a1', role: 'assistant', content: 'Hi', timestamp: 5, stopReason: 'end_turn' }),
      ];
      await writeFile(join(dir, `${sessionId}.jsonl`), lines.join('\n') + '\n', 'utf-8');

      const session = await replaySessionMetadata(dir, sessionId);

      expect(session).not.toBeNull();
      // Title should reflect meta patch
      expect(session!.title).toBe('Updated');
      expect(session!.updatedAt).toBe(3);
      // Metadata from header + patch
      expect(session!.metadata.foo).toBe('bar');
      expect(session!.metadata.baz).toBe(42);
      // Messages should be empty
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
    it('appendAssistantDeltaBatch should write all deltas in single I/O', async () => {
      const dir = nextDir();
      const service = createSessionService(dir);
      const session = await service.create('Batch Test');

      await service.startAssistantStream(session.id, 'msg_batch');

      // Batch 5 deltas at once
      await service.appendAssistantDeltaBatch(session.id, 'msg_batch', [
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

      // Verify order preserved
      expect((deltas[0] as Record<string, unknown>).seq).toBe(0);
      expect((deltas[4] as Record<string, unknown>).seq).toBe(4);
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
      const session = await replaySession(dir, sessionId);
      expect(session).not.toBeNull();
      expect(session!.messages).toHaveLength(1);
      expect(session!.messages[0].content).toBe('Batch recovery test');
      expect(session!.messages[0].role).toBe('assistant');
    });

    it('appendAssistantDeltaBatch should no-op for empty array', async () => {
      const dir = nextDir();
      const service = createSessionService(dir);
      const session = await service.create('Empty Batch');

      const fileBefore = await readJsonl(join(dir, `${session.id}.jsonl`));

      // Empty batch — should not append anything
      await service.appendAssistantDeltaBatch(session.id, 'msg_noop', []);

      const fileAfter = await readJsonl(join(dir, `${session.id}.jsonl`));
      expect(fileAfter).toHaveLength(fileBefore.length);
    });

    it('appendRecords should write multiple records atomically', async () => {
      const dir = nextDir();
      await mkdir(dir, { recursive: true });

      const sessionId = 'sess_multi';
      // Write header first
      await writeRecords(dir, sessionId, [
        { t: 'header', v: JSONL_VERSION, id: sessionId, createdAt: 1, updatedAt: 1, metadata: {} },
      ]);

      // Batch append multiple records
      await appendRecords(dir, sessionId, [
        { t: 'message', id: 'msg_1', role: 'user', content: 'First', timestamp: 1 },
        { t: 'message', id: 'msg_2', role: 'user', content: 'Second', timestamp: 2 },
        { t: 'message', id: 'msg_3', role: 'user', content: 'Third', timestamp: 3 },
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
        { t: 'header', v: JSONL_VERSION, id: sessionId, createdAt: 1, updatedAt: 1, metadata: {} },
      ]);

      await appendRecords(dir, sessionId, []);

      const records = await readJsonl(join(dir, `${sessionId}.jsonl`));
      expect(records).toHaveLength(1); // Just the header
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
