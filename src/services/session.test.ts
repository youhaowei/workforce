/**
 * Session Service JSONL tests.
 */

import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { appendFile, mkdir, readFile, readdir, rm, writeFile } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { createSessionService, resetSessionService, SESSION_JSONL_VERSION } from './session';

const ROOT_DIR = join(tmpdir(), `workforce-session-jsonl-test-${Date.now()}`);

let testDir = '';

async function waitFor(condition: () => Promise<boolean>, timeoutMs = 1500): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await condition()) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`Timed out after ${timeoutMs}ms`);
}

describe('SessionService (JSONL)', () => {
  beforeEach(async () => {
    resetSessionService();
    testDir = join(ROOT_DIR, `case-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
    await mkdir(testDir, { recursive: true });
  });

  afterEach(async () => {
    resetSessionService();
    if (testDir) {
      for (let attempt = 0; attempt < 5; attempt += 1) {
        try {
          await rm(testDir, { recursive: true, force: true });
          break;
        } catch (err) {
          const error = err as NodeJS.ErrnoException;
          if (error.code !== 'ENOTEMPTY' || attempt === 4) {
            throw err;
          }
          await new Promise((resolve) => setTimeout(resolve, 20));
        }
      }
    }
  });

  afterAll(async () => {
    await rm(ROOT_DIR, { recursive: true, force: true });
  });

  it('persists sessions as .jsonl with a header record', async () => {
    const service = createSessionService(testDir);
    const session = await service.create('Persisted');

    const filePath = join(testDir, `${session.id}.jsonl`);
    const lines = (await readFile(filePath, 'utf-8')).trim().split('\n');
    const header = JSON.parse(lines[0]!);

    expect(header.type).toBe('header');
    expect(header.version).toBe(SESSION_JSONL_VERSION);
    expect(header.sessionId).toBe(session.id);
    expect(header.title).toBe('Persisted');
  });

  it('replays assistant stream deterministically using message_final', async () => {
    const service = createSessionService(testDir);
    const session = await service.create('Replay Final');

    await service.addMessage(session.id, {
      id: 'msg_user_1',
      role: 'user',
      content: 'Hello',
      timestamp: Date.now(),
    });

    await service.startAssistantStream(session.id, 'msg_assistant_1');
    await service.appendAssistantDelta(session.id, 'msg_assistant_1', 'Hel', 0);
    await service.appendAssistantDelta(session.id, 'msg_assistant_1', 'lo', 1);
    await service.finalizeAssistantMessage(session.id, 'msg_assistant_1', 'Hello world', 'end_turn');

    const fresh = createSessionService(testDir);
    const loaded = await fresh.get(session.id);

    expect(loaded).not.toBeNull();
    const assistant = loaded!.messages.find((message) => message.id === 'msg_assistant_1');
    expect(assistant).toBeTruthy();
    expect(assistant!.content).toBe('Hello world');
  });

  it('reconstructs partial assistant output after crash without message_final', async () => {
    const service = createSessionService(testDir);
    const session = await service.create('Crash Mid Stream');

    await service.startAssistantStream(session.id, 'msg_partial');
    await service.appendAssistantDelta(session.id, 'msg_partial', 'ial', 2);
    await service.appendAssistantDelta(session.id, 'msg_partial', 'Part', 0);
    await service.appendAssistantDelta(session.id, 'msg_partial', ' ', 1);

    const fresh = createSessionService(testDir);
    const loaded = await fresh.get(session.id);

    expect(loaded).not.toBeNull();
    const partial = loaded!.messages.find((message) => message.id === 'msg_partial');
    expect(partial).toBeTruthy();
    expect(partial!.content).toBe('Part ial');
  });

  it('skips malformed JSONL lines during replay', async () => {
    const service = createSessionService(testDir);
    const session = await service.create('Malformed Replay');
    const filePath = join(testDir, `${session.id}.jsonl`);

    await appendFile(filePath, '{ this is malformed json\n', 'utf-8');
    await appendFile(
      filePath,
      `${JSON.stringify({
        type: 'message',
        updatedAt: Date.now(),
        message: {
          id: 'msg_user_malformed',
          role: 'user',
          content: 'survives',
          timestamp: Date.now(),
        },
      })}\n`,
      'utf-8',
    );

    const fresh = createSessionService(testDir);
    const loaded = await fresh.get(session.id);

    expect(loaded).not.toBeNull();
    expect(loaded!.messages.some((message) => message.id === 'msg_user_malformed')).toBe(true);
  });

  it('persists metadata/title updates independently through meta records', async () => {
    const service = createSessionService(testDir);
    const session = await service.create('Old Title');

    session.title = 'New Title';
    session.metadata = {
      ...session.metadata,
      foo: 'bar',
      nested: { a: 1 },
    };
    await service.save(session);

    const fresh = createSessionService(testDir);
    const loaded = await fresh.get(session.id);

    expect(loaded).not.toBeNull();
    expect(loaded!.title).toBe('New Title');
    expect(loaded!.metadata.foo).toBe('bar');
    expect((loaded!.metadata.nested as { a: number }).a).toBe(1);

    const filePath = join(testDir, `${session.id}.jsonl`);
    const lines = (await readFile(filePath, 'utf-8')).trim().split('\n');
    const metaLines = lines.map((line) => JSON.parse(line)).filter((record) => record.type === 'meta');
    expect(metaLines.length).toBeGreaterThan(0);
    expect(metaLines[metaLines.length - 1]?.title).toBe('New Title');
  });

  it('compacts finalized streams by removing superseded deltas', async () => {
    const service = createSessionService(testDir);
    const session = await service.create('Compaction');

    await service.startAssistantStream(session.id, 'msg_finalized');
    await service.appendAssistantDelta(session.id, 'msg_finalized', 'Hello', 0);
    await service.appendAssistantDelta(session.id, 'msg_finalized', ' world', 1);
    await service.finalizeAssistantMessage(session.id, 'msg_finalized', 'Hello world', 'end_turn');

    const filePath = join(testDir, `${session.id}.jsonl`);

    await waitFor(async () => {
      const content = await readFile(filePath, 'utf-8');
      return !content.includes('"type":"message_delta"');
    });

    const content = await readFile(filePath, 'utf-8');
    expect(content.includes('"type":"message_final"')).toBe(true);
  });

  it('supports .jsonl-only runtime (legacy .json is ignored)', async () => {
    const legacySessionId = 'sess_legacy_only_json';
    await writeFile(
      join(testDir, `${legacySessionId}.json`),
      JSON.stringify({
        version: 1,
        session: {
          id: legacySessionId,
          title: 'Legacy',
          createdAt: Date.now(),
          updatedAt: Date.now(),
          messages: [],
          metadata: {},
        },
      }),
      'utf-8',
    );

    const service = createSessionService(testDir);
    const loaded = await service.get(legacySessionId);

    expect(loaded).toBeNull();
  });

  it('renames unrecoverable files with invalid header to .corrupt.<ts>', async () => {
    const sessionId = 'sess_invalid_header';
    const filePath = join(testDir, `${sessionId}.jsonl`);

    await writeFile(filePath, `${JSON.stringify({ type: 'meta', updatedAt: Date.now() })}\n`, 'utf-8');

    const service = createSessionService(testDir);
    const loaded = await service.get(sessionId);

    expect(loaded).toBeNull();

    const files = await readdir(testDir);
    expect(files.some((file) => file.startsWith(`${sessionId}.jsonl.corrupt.`))).toBe(true);
  });

  it('supports get(includeMessages:false) and getMessages pagination', async () => {
    const service = createSessionService(testDir);
    const session = await service.create('Read APIs');

    await service.addMessage(session.id, {
      id: 'msg_1',
      role: 'user',
      content: 'one',
      timestamp: Date.now(),
    });
    await service.addMessage(session.id, {
      id: 'msg_2',
      role: 'assistant',
      content: 'two',
      timestamp: Date.now() + 1,
    });

    const summary = await service.get(session.id, { includeMessages: false });
    expect(summary).not.toBeNull();
    expect(summary!.messages).toEqual([]);

    const page = await service.getMessages(session.id, { offset: 1, limit: 1 });
    expect(page).toHaveLength(1);
    expect(page[0].id).toBe('msg_2');
  });

  it('maintains lifecycle transitions for workagent sessions', async () => {
    const service = createSessionService(testDir);
    const session = await service.createWorkAgent({
      templateId: 'tmpl',
      goal: 'Run task',
      orgId: 'org_1',
    });

    const active = await service.transitionState(session.id, 'active', 'Starting');
    const paused = await service.transitionState(active.id, 'paused', 'Waiting');

    const lifecycle = paused.metadata.lifecycle as {
      state: string;
      stateHistory: Array<{ from: string; to: string }>;
      pauseReason?: string;
    };

    expect(lifecycle.state).toBe('paused');
    expect(lifecycle.pauseReason).toBe('Waiting');
    expect(lifecycle.stateHistory).toHaveLength(2);
    expect(lifecycle.stateHistory[0]?.from).toBe('created');
    expect(lifecycle.stateHistory[0]?.to).toBe('active');
  });
});
