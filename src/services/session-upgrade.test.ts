import { describe, it, expect, vi, afterEach } from 'vitest';
import { mkdir, writeFile, readFile } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { rmSync } from 'fs';
import { JSONL_VERSION } from './session-journal';

// Mock artifact service to avoid real file I/O
const mockArtifactCreate = vi.fn().mockResolvedValue({ id: 'art_test' });
const mockArtifactList = vi.fn().mockResolvedValue([]);
vi.mock('./artifact', () => ({
  getArtifactService: () => ({
    ensureInitialized: vi.fn().mockResolvedValue(undefined),
    list: mockArtifactList,
    create: mockArtifactCreate,
  }),
}));

import { loadSession, SESSION_SCHEMA_VERSION } from './session-upgrade';

let testCounter = 0;
function nextDir() {
  return join(tmpdir(), `workforce-upgrade-test-${process.pid}-${++testCounter}`);
}

function jsonlLines(...records: Record<string, unknown>[]) {
  return records.map((r) => JSON.stringify(r)).join('\n') + '\n';
}

describe('session-upgrade', () => {
  const dirs: string[] = [];

  afterEach(() => {
    mockArtifactCreate.mockClear();
    mockArtifactList.mockClear();
    dirs.forEach((d) => rmSync(d, { recursive: true, force: true }));
    dirs.length = 0;
  });

  function makeDir() {
    const dir = nextDir();
    dirs.push(dir);
    return dir;
  }

  async function writeSession(dir: string, sessionId: string, metadata: Record<string, unknown> = {}, extraRecords: Record<string, unknown>[] = []) {
    await mkdir(dir, { recursive: true });
    const header = { t: 'header', v: JSONL_VERSION, seq: 0, ts: 1, id: sessionId, createdAt: 1, metadata };
    const msg = { t: 'message', seq: 1, ts: 2, id: 'msg_1', role: 'user', content: 'Hello' };
    await writeFile(join(dir, `${sessionId}.jsonl`), jsonlLines(header, msg, ...extraRecords), 'utf-8');
  }

  it('upgrades session from 0.3.0 to current version', async () => {
    const dir = makeDir();
    await writeSession(dir, 'sess_old');

    const result = await loadSession(dir, 'sess_old');
    expect(result).not.toBeNull();
    expect(result!.session.messages).toHaveLength(1);
    expect(result!.session.messages[0].content).toBe('Hello');
    expect(result!.session.metadata._schemaVersion).toBe(SESSION_SCHEMA_VERSION as string);
  });

  it('skips upgrade when already at current version', async () => {
    const dir = makeDir();
    await writeSession(dir, 'sess_current', { _schemaVersion: SESSION_SCHEMA_VERSION as string });

    const result = await loadSession(dir, 'sess_current');
    expect(result).not.toBeNull();
    expect(result!.upgraded).toBe(false);
    expect(result!.session.messages).toHaveLength(1);
  });

  it('preserves all messages after upgrade (no data loss)', async () => {
    const dir = makeDir();
    await mkdir(dir, { recursive: true });
    const header = { t: 'header', v: JSONL_VERSION, seq: 0, ts: 1, id: 'sess_preserve', createdAt: 1, metadata: {} };
    const msgs = Array.from({ length: 10 }, (_, i) => ({
      t: 'message', seq: i + 1, ts: i + 2, id: `msg_${i}`, role: i % 2 === 0 ? 'user' : 'assistant', content: `Message ${i}`,
    }));
    await writeFile(join(dir, 'sess_preserve.jsonl'), jsonlLines(header, ...msgs), 'utf-8');

    const result = await loadSession(dir, 'sess_preserve');
    expect(result).not.toBeNull();
    expect(result!.session.messages).toHaveLength(10);
    // Verify all messages are intact
    for (let i = 0; i < 10; i++) {
      expect(result!.session.messages[i].content).toBe(`Message ${i}`);
    }
  });

  it('appends version stamp without overwriting journal', async () => {
    const dir = makeDir();
    await writeSession(dir, 'sess_append');

    await loadSession(dir, 'sess_append');

    // Read raw JSONL — should have original lines + appended meta record
    const raw = await readFile(join(dir, 'sess_append.jsonl'), 'utf-8');
    const lines = raw.trim().split('\n');
    expect(lines.length).toBeGreaterThanOrEqual(3); // header + message + meta stamp

    // First line should still be the header
    const header = JSON.parse(lines[0]);
    expect(header.t).toBe('header');
    expect(header.id).toBe('sess_append');

    // Last line should be the version stamp
    const lastRecord = JSON.parse(lines[lines.length - 1]);
    expect(lastRecord.t).toBe('meta');
    expect(lastRecord.patch._schemaVersion).toBe(SESSION_SCHEMA_VERSION as string);
  });

  it('is idempotent — second load does not re-upgrade', async () => {
    const dir = makeDir();
    await writeSession(dir, 'sess_idem');

    const result1 = await loadSession(dir, 'sess_idem');
    expect(result1!.session.metadata._schemaVersion).toBe(SESSION_SCHEMA_VERSION as string);

    const result2 = await loadSession(dir, 'sess_idem');
    expect(result2!.upgraded).toBe(false);
    expect(result2!.session.messages).toHaveLength(1);
  });

  it('runs CC plan extraction for claude-code sessions', async () => {
    const dir = makeDir();
    const metadata = { source: 'claude-code' };
    const toolCalls = [
      { t: 'tool_call', seq: 2, ts: 3, actionId: 'tc_1', messageId: 'msg_1', name: 'EnterPlanMode', input: {} },
      { t: 'tool_call', seq: 3, ts: 4, actionId: 'tc_2', messageId: 'msg_1', name: 'Write', input: { file_path: '/plans/test.md', content: '# Test Plan\n\nDo stuff' } },
      { t: 'tool_call', seq: 4, ts: 5, actionId: 'tc_3', messageId: 'msg_1', name: 'ExitPlanMode', input: {} },
    ];
    await writeSession(dir, 'sess_cc', metadata, toolCalls);

    mockArtifactCreate.mockClear();
    mockArtifactList.mockClear();

    const result = await loadSession(dir, 'sess_cc');
    expect(result).not.toBeNull();
    expect(result!.upgraded).toBe(true);

    expect(mockArtifactCreate).toHaveBeenCalledOnce();
    expect(mockArtifactCreate).toHaveBeenCalledWith(expect.objectContaining({
      orgId: '',
      title: 'Test Plan',
      filePath: '/plans/test.md',
      mimeType: 'text/markdown',
    }));
  });

  it('passes orgId from session metadata to artifact creation', async () => {
    const dir = makeDir();
    const metadata = { source: 'claude-code', orgId: 'org-from-session' };
    const toolCalls = [
      { t: 'tool_call', seq: 2, ts: 3, actionId: 'tc_1', messageId: 'msg_1', name: 'EnterPlanMode', input: {} },
      { t: 'tool_call', seq: 3, ts: 4, actionId: 'tc_2', messageId: 'msg_1', name: 'Write', input: { file_path: '/plans/org.md', content: '# Org Plan\n\nDo stuff' } },
      { t: 'tool_call', seq: 4, ts: 5, actionId: 'tc_3', messageId: 'msg_1', name: 'ExitPlanMode', input: {} },
    ];
    await writeSession(dir, 'sess_cc_org', metadata, toolCalls);

    mockArtifactCreate.mockClear();
    mockArtifactList.mockClear();

    await loadSession(dir, 'sess_cc_org');

    expect(mockArtifactCreate).toHaveBeenCalledWith(expect.objectContaining({
      orgId: 'org-from-session',
    }));
  });

  it('skips plan extraction for non-CC sessions', async () => {
    const dir = makeDir();
    await writeSession(dir, 'sess_native', { source: 'workforce' });

    mockArtifactCreate.mockClear();

    await loadSession(dir, 'sess_native');

    expect(mockArtifactCreate).not.toHaveBeenCalled();
  });

  it('returns null for nonexistent session', async () => {
    const dir = makeDir();
    await mkdir(dir, { recursive: true });

    const result = await loadSession(dir, 'sess_nope');
    expect(result).toBeNull();
  });
});
