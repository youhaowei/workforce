import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Session, JournalRecord } from './types';
import type { StreamingDeps } from './session-streaming';
import {
  recordStreamStart,
  recordStreamDelta,
  recordStreamDeltaBatch,
  recordStreamEnd,
  recordStreamBlocks,
  recordStreamAbort,
} from './session-streaming';
import { AppendLock } from './session-journal';

function makeSession(id = 'sess-1'): Session {
  return {
    id,
    createdAt: 1000,
    updatedAt: 1000,
    messages: [],
    metadata: {},
  };
}

function makeDeps(sessions?: Map<string, Session>): StreamingDeps & {
  written: JournalRecord[][];
  appended: JournalRecord[];
  consolidated: string[];
} {
  const map = sessions ?? new Map([['sess-1', makeSession()]]);
  const written: JournalRecord[][] = [];
  const appended: JournalRecord[] = [];
  const consolidated: string[] = [];

  return {
    sessions: map,
    sessionsDir: '/tmp/test-sessions',
    appendLock: new AppendLock(),
    ensureInitialized: vi.fn(),
    writeRecords: vi.fn(async (_sid: string, records: JournalRecord[]) => {
      written.push(records);
    }),
    scheduleConsolidation: vi.fn((sid: string) => {
      consolidated.push(sid);
    }),
    written,
    appended,
    consolidated,
  };
}

// Mock appendRecord from session-journal (used by recordStreamEnd)
vi.mock('./session-journal', async (importOriginal) => {
  const orig = await importOriginal<typeof import('./session-journal')>();
  return {
    ...orig,
    appendRecord: vi.fn(),
  };
});

import { appendRecord } from './session-journal';
const mockAppendRecord = vi.mocked(appendRecord);

describe('session-streaming', () => {
  let deps: ReturnType<typeof makeDeps>;

  beforeEach(() => {
    deps = makeDeps();
    vi.clearAllMocks();
  });

  describe('recordStreamStart', () => {
    it('writes a message_start record', async () => {
      await recordStreamStart(deps, 'sess-1', 'msg-1');
      expect(deps.ensureInitialized).toHaveBeenCalled();
      expect(deps.written).toHaveLength(1);
      const record = deps.written[0][0];
      expect(record).toMatchObject({
        t: 'message_start',
        id: 'msg-1',
        role: 'assistant',
      });
      expect(record).toHaveProperty('timestamp');
    });

    it('includes meta when provided', async () => {
      await recordStreamStart(deps, 'sess-1', 'msg-1', { model: 'opus' });
      const record = deps.written[0][0];
      expect(record).toMatchObject({ meta: { model: 'opus' } });
    });

    it('throws if session not found', async () => {
      await expect(recordStreamStart(deps, 'missing', 'msg-1'))
        .rejects.toThrow('Session not found: missing');
    });
  });

  describe('recordStreamDelta', () => {
    it('writes a message_delta record', async () => {
      await recordStreamDelta(deps, 'sess-1', 'msg-1', 'hello ', 0);
      expect(deps.written).toHaveLength(1);
      expect(deps.written[0][0]).toMatchObject({
        t: 'message_delta',
        id: 'msg-1',
        delta: 'hello ',
        seq: 0,
      });
    });
  });

  describe('recordStreamDeltaBatch', () => {
    it('writes multiple deltas in a single call', async () => {
      const deltas = [
        { delta: 'hello ', seq: 0 },
        { delta: 'world', seq: 1 },
      ];
      await recordStreamDeltaBatch(deps, 'sess-1', 'msg-1', deltas);
      expect(deps.written).toHaveLength(1);
      expect(deps.written[0]).toHaveLength(2);
      expect(deps.written[0][0]).toMatchObject({ t: 'message_delta', seq: 0 });
      expect(deps.written[0][1]).toMatchObject({ t: 'message_delta', seq: 1 });
    });

    it('skips write for empty deltas', async () => {
      await recordStreamDeltaBatch(deps, 'sess-1', 'msg-1', []);
      expect(deps.written).toHaveLength(0);
    });
  });

  describe('recordStreamEnd', () => {
    it('pushes message to session and writes message_final', async () => {
      await recordStreamEnd(deps, 'sess-1', 'msg-1', 'hello world', 'end_turn');

      const session = deps.sessions.get('sess-1')!;
      expect(session.messages).toHaveLength(1);
      expect(session.messages[0]).toMatchObject({
        id: 'msg-1',
        role: 'assistant',
        content: 'hello world',
      });
      expect(session.updatedAt).toBeGreaterThan(1000);

      // Verify journal persistence via appendRecord
      expect(mockAppendRecord).toHaveBeenCalledWith(
        deps.sessionsDir,
        'sess-1',
        expect.objectContaining({ t: 'message_final', id: 'msg-1', content: 'hello world' }),
      );
    });

    it('schedules consolidation after write', async () => {
      await recordStreamEnd(deps, 'sess-1', 'msg-1', 'content', 'end_turn');
      expect(deps.consolidated).toEqual(['sess-1']);
    });

    it('includes toolActivities and contentBlocks when provided', async () => {
      const toolActivities = [{ name: 'search', input: 'query' }];
      const contentBlocks = [{ type: 'text' as const, text: 'hello' }];

      await recordStreamEnd(deps, 'sess-1', 'msg-1', 'content', 'end_turn', toolActivities, contentBlocks);

      const session = deps.sessions.get('sess-1')!;
      expect(session.messages[0].toolActivities).toEqual(toolActivities);
      expect(session.messages[0].contentBlocks).toEqual(contentBlocks);
    });

    it('omits toolActivities/contentBlocks when empty arrays', async () => {
      await recordStreamEnd(deps, 'sess-1', 'msg-1', 'content', 'end_turn', [], []);

      const session = deps.sessions.get('sess-1')!;
      expect(session.messages[0].toolActivities).toBeUndefined();
      expect(session.messages[0].contentBlocks).toBeUndefined();
    });

    it('throws if session not found', async () => {
      await expect(recordStreamEnd(deps, 'missing', 'msg-1', 'content', 'end_turn'))
        .rejects.toThrow('Session not found: missing');
    });
  });

  describe('recordStreamBlocks', () => {
    it('writes a message_blocks record', async () => {
      const blocks = [{ type: 'text' as const, text: 'hello' }];
      await recordStreamBlocks(deps, 'sess-1', 'msg-1', blocks);
      expect(deps.written[0][0]).toMatchObject({
        t: 'message_blocks',
        id: 'msg-1',
        contentBlocks: blocks,
      });
    });

    it('includes toolActivities when provided', async () => {
      const blocks = [{ type: 'text' as const, text: 'hello' }];
      const activities = [{ name: 'tool', input: 'args' }];
      await recordStreamBlocks(deps, 'sess-1', 'msg-1', blocks, activities);
      expect(deps.written[0][0]).toMatchObject({
        toolActivities: activities,
      });
    });

    it('omits toolActivities when empty', async () => {
      const blocks = [{ type: 'text' as const, text: 'hello' }];
      await recordStreamBlocks(deps, 'sess-1', 'msg-1', blocks, []);
      expect(deps.written[0][0]).not.toHaveProperty('toolActivities');
    });
  });

  describe('recordStreamAbort', () => {
    it('writes a message_abort record', async () => {
      await recordStreamAbort(deps, 'sess-1', 'msg-1', 'user cancelled');
      expect(deps.written[0][0]).toMatchObject({
        t: 'message_abort',
        id: 'msg-1',
        reason: 'user cancelled',
      });
      expect(deps.written[0][0]).toHaveProperty('timestamp');
    });
  });
});
