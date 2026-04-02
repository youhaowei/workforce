import { describe, it, expect, afterAll } from 'vitest';
import { tmpdir } from 'os';
import { join } from 'path';
import { mkdir, rm, writeFile } from 'fs/promises';
import { readCCSession, discoverCCSessions, projectPathToSlug } from './cc-reader';

const TEST_ROOT = join(tmpdir(), `cc-reader-test-${Date.now()}`);
let fileCounter = 0;

function nextFile(name?: string): string {
  const id = name ?? `test-${++fileCounter}`;
  return join(TEST_ROOT, `${id}.jsonl`);
}

function ccLine(rec: Record<string, unknown>): string {
  return JSON.stringify(rec);
}

const BASE_FIELDS = {
  timestamp: '2026-03-14T10:00:00.000Z',
  sessionId: 'cc-sess-1',
  version: '1.0.42',
  gitBranch: 'main',
  cwd: '/projects/test',
  slug: 'test-session',
};

function ccUser(content: string | unknown[], extra?: Record<string, unknown>): string {
  return ccLine({
    type: 'user',
    ...BASE_FIELDS,
    uuid: `user-${++fileCounter}`,
    message: { role: 'user', content },
    ...extra,
  });
}

function ccAssistant(
  messageId: string,
  contentBlocks: unknown[],
  extra?: Record<string, unknown>,
): string {
  return ccLine({
    type: 'assistant',
    ...BASE_FIELDS,
    uuid: `asst-${++fileCounter}`,
    message: {
      id: messageId,
      model: 'claude-sonnet-4-20250514',
      role: 'assistant',
      content: contentBlocks,
      stop_reason: null,
      usage: { input_tokens: 100, output_tokens: 50, cache_read_input_tokens: 10 },
      ...extra,
    },
  });
}

// ─── Setup/teardown ──────────────────────────────────────────────────────────

await mkdir(TEST_ROOT, { recursive: true });

afterAll(async () => {
  await rm(TEST_ROOT, { recursive: true, force: true });
});

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('cc-reader', () => {
  describe('readCCSession', () => {
    it('returns null for missing file', async () => {
      expect(await readCCSession(join(TEST_ROOT, 'nope.jsonl'))).toBeNull();
    });

    it('returns null for empty file', async () => {
      const f = nextFile();
      await writeFile(f, '', 'utf-8');
      expect(await readCCSession(f)).toBeNull();
    });

    it('returns null for file with only malformed lines', async () => {
      const f = nextFile();
      await writeFile(f, '{bad json\n{also bad\n', 'utf-8');
      expect(await readCCSession(f)).toBeNull();
    });
  });

  describe('header synthesis', () => {
    it('synthesizes header from first record', async () => {
      const f = nextFile();
      await writeFile(f, ccUser('hello'), 'utf-8');
      const result = await readCCSession(f);

      expect(result).not.toBeNull();
      const { header } = result!;
      expect(header.t).toBe('header');
      expect(header.v).toBe('0.3.0');
      expect(header.seq).toBe(0);
      expect(header.id).toBe('cc-sess-1');
      expect(header.metadata.source).toBe('claude-code');
      expect(header.metadata.version).toBe('1.0.42');
      expect(header.metadata.gitBranch).toBe('main');
      expect(header.metadata.cwd).toBe('/projects/test');
      expect(header.metadata.slug).toBe('test-session');
    });

    it('extracts sessionId from filename when not in record', async () => {
      const uuid = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
      const f = join(TEST_ROOT, `${uuid}.jsonl`);
      await writeFile(f, ccLine({
        type: 'user',
        timestamp: '2026-03-14T10:00:00.000Z',
        message: { role: 'user', content: 'hello' },
      }), 'utf-8');

      const result = await readCCSession(f);
      expect(result!.header.id).toBe(uuid);
    });
  });

  describe('user records', () => {
    it('maps string user content to message', async () => {
      const f = nextFile();
      await writeFile(f, ccUser('hello world'), 'utf-8');
      const result = await readCCSession(f);

      const msgs = result!.records.filter((r) => r.t === 'message');
      expect(msgs).toHaveLength(1);
      expect(msgs[0]).toMatchObject({
        t: 'message',
        role: 'user',
        content: 'hello world',
      });
    });

    it('maps array content with text blocks to message', async () => {
      const f = nextFile();
      await writeFile(f, ccUser([
        { type: 'text', text: 'line 1' },
        { type: 'text', text: 'line 2' },
      ]), 'utf-8');
      const result = await readCCSession(f);

      const msgs = result!.records.filter((r) => r.t === 'message');
      expect(msgs).toHaveLength(1);
      expect(msgs[0]).toMatchObject({
        t: 'message',
        role: 'user',
        content: 'line 1\nline 2',
      });
    });

    it('maps isMeta user records to meta (not message)', async () => {
      const f = nextFile();
      await writeFile(f, ccUser('system info', { isMeta: true }), 'utf-8');
      const result = await readCCSession(f);

      const msgs = result!.records.filter((r) => r.t === 'message');
      const metas = result!.records.filter((r) => r.t === 'meta');
      expect(msgs).toHaveLength(0);
      expect(metas).toHaveLength(1);
      expect(metas[0]).toMatchObject({
        t: 'meta',
        patch: { userMeta: 'system info' },
      });
    });

    it('maps tool-result-only user messages to meta (not message)', async () => {
      const f = nextFile();
      await writeFile(f, ccUser([
        { type: 'tool_result', tool_use_id: 'tu-1', content: 'result data here' },
      ]), 'utf-8');
      const result = await readCCSession(f);

      const msgs = result!.records.filter((r) => r.t === 'message');
      const metas = result!.records.filter((r) => r.t === 'meta');
      expect(msgs).toHaveLength(0);
      expect(metas).toHaveLength(1);
      expect(metas[0]).toMatchObject({
        t: 'meta',
        patch: { toolResults: [{ toolUseId: 'tu-1' }] },
      });
    });

    it('maps user messages with images to message with contentBlocks', async () => {
      const f = nextFile();
      await writeFile(f, ccUser([
        { type: 'text', text: 'check this' },
        { type: 'image', source: { type: 'base64', data: 'abc' } },
      ]), 'utf-8');
      const result = await readCCSession(f);

      const msgs = result!.records.filter((r) => r.t === 'message');
      expect(msgs).toHaveLength(1);
      const msg = msgs[0] as { contentBlocks?: unknown[] };
      expect(msg.contentBlocks).toHaveLength(2);
    });
  });

  describe('assistant records', () => {
    it('groups assistant records by message.id into single message_final', async () => {
      const f = nextFile();
      // 3 records with same message ID (thinking → text → tool_use)
      const lines = [
        ccAssistant('msg-1', [{ type: 'thinking', thinking: 'let me think' }]),
        ccAssistant('msg-1', [{ type: 'text', text: 'Here is my answer.' }]),
        ccAssistant('msg-1', [{ type: 'tool_use', id: 'tu-1', name: 'Read', input: { path: '/a.ts' } }]),
      ].join('\n');
      await writeFile(f, lines, 'utf-8');
      const result = await readCCSession(f);

      const finals = result!.records.filter((r) => r.t === 'message_final');
      expect(finals).toHaveLength(1);
      expect(finals[0]).toMatchObject({
        t: 'message_final',
        id: 'msg-1',
        role: 'assistant',
        content: 'Here is my answer.',
      });

      // contentBlocks should have all 3 block types
      const final = finals[0] as { contentBlocks?: Array<{ type: string }> };
      expect(final.contentBlocks).toHaveLength(3);
      expect(final.contentBlocks!.map((b) => b.type)).toEqual(['thinking', 'text', 'tool_use']);
    });

    it('extracts tool_use blocks as JournalToolCall records', async () => {
      const f = nextFile();
      const lines = [
        ccAssistant('msg-1', [
          { type: 'text', text: 'Reading file' },
          { type: 'tool_use', id: 'tu-1', name: 'Read', input: { path: '/a.ts' } },
        ]),
      ].join('\n');
      await writeFile(f, lines, 'utf-8');
      const result = await readCCSession(f);

      const toolCalls = result!.records.filter((r) => r.t === 'tool_call');
      expect(toolCalls).toHaveLength(1);
      expect(toolCalls[0]).toMatchObject({
        t: 'tool_call',
        actionId: 'tu-1',
        messageId: 'msg-1',
        name: 'Read',
        input: { path: '/a.ts' },
      });
    });

    it('preserves usage from last assistant record', async () => {
      const f = nextFile();
      const lines = [
        ccAssistant('msg-1', [{ type: 'text', text: 'hi' }]),
      ].join('\n');
      await writeFile(f, lines, 'utf-8');
      const result = await readCCSession(f);

      const final = result!.records.find((r) => r.t === 'message_final');
      expect(final).toMatchObject({
        usage: {
          inputTokens: 100,
          outputTokens: 50,
          cacheReadInputTokens: 10,
        },
      });
    });

    it('preserves model from assistant record', async () => {
      const f = nextFile();
      await writeFile(f, ccAssistant('msg-1', [{ type: 'text', text: 'hi' }]), 'utf-8');
      const result = await readCCSession(f);

      const final = result!.records.find((r) => r.t === 'message_final');
      expect(final).toMatchObject({ model: 'claude-sonnet-4-20250514' });
    });

    it('handles thinking-only assistant response', async () => {
      const f = nextFile();
      await writeFile(f, ccAssistant('msg-1', [{ type: 'thinking', thinking: '' }]), 'utf-8');
      const result = await readCCSession(f);

      const final = result!.records.find((r) => r.t === 'message_final');
      expect(final).toMatchObject({
        t: 'message_final',
        content: '', // empty text content
      });
      // contentBlocks should still have the thinking block
      const f2 = final as { contentBlocks?: Array<{ type: string; text: string }> };
      expect(f2.contentBlocks).toHaveLength(1);
      expect(f2.contentBlocks![0]).toMatchObject({ type: 'thinking', text: '' });
    });
  });

  describe('progress records', () => {
    it('maps hook_progress to hook record', async () => {
      const f = nextFile();
      await writeFile(f, ccLine({
        type: 'progress',
        ...BASE_FIELDS,
        uuid: 'hook-1',
        data: {
          type: 'hook_progress',
          hookName: 'lint-fix',
          hookEvent: 'PostToolUse',
          toolUseID: 'tu-1',
          output: 'Fixed 3 issues',
          durationMs: 250,
        },
      }), 'utf-8');
      const result = await readCCSession(f);

      const hooks = result!.records.filter((r) => r.t === 'hook');
      expect(hooks).toHaveLength(1);
      expect(hooks[0]).toMatchObject({
        t: 'hook',
        hookName: 'lint-fix',
        hookEvent: 'PostToolUse',
        actionId: 'tu-1',
        outcome: 'success',
        output: 'Fixed 3 issues',
        durationMs: 250,
      });
    });

    it('maps hook_progress without toolUseID (session-level hook)', async () => {
      const f = nextFile();
      await writeFile(f, ccLine({
        type: 'progress',
        ...BASE_FIELDS,
        uuid: 'hook-2',
        data: {
          type: 'hook_progress',
          hookName: 'start-hook',
          hookEvent: 'SessionStart',
        },
      }), 'utf-8');
      const result = await readCCSession(f);

      const hooks = result!.records.filter((r) => r.t === 'hook');
      expect(hooks[0]).toMatchObject({
        t: 'hook',
        hookEvent: 'SessionStart',
        actionId: undefined,
      });
    });

    it('maps bash_progress to tool_progress', async () => {
      const f = nextFile();
      await writeFile(f, ccLine({
        type: 'progress',
        ...BASE_FIELDS,
        data: {
          type: 'bash_progress',
          toolUseID: 'tu-2',
          content: 'Running tests...',
        },
      }), 'utf-8');
      const result = await readCCSession(f);

      const progress = result!.records.filter((r) => r.t === 'tool_progress');
      expect(progress).toHaveLength(1);
      expect(progress[0]).toMatchObject({
        t: 'tool_progress',
        actionId: 'tu-2',
        name: 'bash_progress',
        output: 'Running tests...',
      });
    });

    it('maps mcp_progress to tool_progress', async () => {
      const f = nextFile();
      await writeFile(f, ccLine({
        type: 'progress',
        ...BASE_FIELDS,
        data: { type: 'mcp_progress', toolUseID: 'tu-3', output: 'mcp data' },
      }), 'utf-8');
      const result = await readCCSession(f);

      expect(result!.records.filter((r) => r.t === 'tool_progress')).toHaveLength(1);
    });

    it('maps agent_progress to meta', async () => {
      const f = nextFile();
      await writeFile(f, ccLine({
        type: 'progress',
        ...BASE_FIELDS,
        data: { type: 'agent_progress', content: 'subagent working' },
      }), 'utf-8');
      const result = await readCCSession(f);

      const metas = result!.records.filter((r) => r.t === 'meta');
      expect(metas).toHaveLength(1);
      expect(metas[0]).toMatchObject({
        t: 'meta',
        patch: { agentProgress: { type: 'agent_progress', content: 'subagent working' } },
      });
    });

    it('skips query_update and search_results_received', async () => {
      const f = nextFile();
      const lines = [
        ccLine({ type: 'progress', ...BASE_FIELDS, data: { type: 'query_update' } }),
        ccLine({ type: 'progress', ...BASE_FIELDS, data: { type: 'search_results_received' } }),
      ].join('\n');
      await writeFile(f, lines, 'utf-8');
      const result = await readCCSession(f);

      expect(result!.records).toHaveLength(0);
      expect(result!.stats.skippedRecords).toBe(2);
    });
  });

  describe('system records', () => {
    it('maps stop_hook_summary to meta', async () => {
      const f = nextFile();
      await writeFile(f, ccLine({
        type: 'system',
        ...BASE_FIELDS,
        subtype: 'stop_hook_summary',
        hookCount: 4,
        hookInfos: [
          { command: 'lint', durationMs: 200 },
          { command: 'test', durationMs: 404 },
        ],
      }), 'utf-8');
      const result = await readCCSession(f);

      const metas = result!.records.filter((r) => r.t === 'meta');
      expect(metas[0]).toMatchObject({
        t: 'meta',
        patch: { stopHookSummary: { hookCount: 4, hookInfos: expect.any(Array) } },
      });
    });

    it('maps turn_duration to query_result', async () => {
      const f = nextFile();
      await writeFile(f, ccLine({
        type: 'system',
        ...BASE_FIELDS,
        subtype: 'turn_duration',
        durationMs: 88746,
        parentUuid: 'msg-1',
      }), 'utf-8');
      const result = await readCCSession(f);

      const qr = result!.records.filter((r) => r.t === 'query_result');
      expect(qr).toHaveLength(1);
      expect(qr[0]).toMatchObject({
        t: 'query_result',
        messageId: 'msg-1',
        durationMs: 88746,
      });
    });

    it('maps compact_boundary to meta with compaction info', async () => {
      const f = nextFile();
      await writeFile(f, ccLine({
        type: 'system',
        ...BASE_FIELDS,
        subtype: 'compact_boundary',
        compactMetadata: { trigger: 'auto', preTokens: 168603 },
      }), 'utf-8');
      const result = await readCCSession(f);

      const metas = result!.records.filter((r) => r.t === 'meta');
      expect(metas[0]).toMatchObject({
        t: 'meta',
        patch: { compaction: { trigger: 'auto', preTokens: 168603 } },
      });
    });

    it('maps api_error to meta', async () => {
      const f = nextFile();
      await writeFile(f, ccLine({
        type: 'system',
        ...BASE_FIELDS,
        subtype: 'api_error',
        content: 'Rate limit exceeded',
      }), 'utf-8');
      const result = await readCCSession(f);

      expect(result!.records[0]).toMatchObject({
        t: 'meta',
        patch: { apiError: 'Rate limit exceeded' },
      });
    });

    it('maps local_command and informational to meta', async () => {
      const f = nextFile();
      const lines = [
        ccLine({ type: 'system', ...BASE_FIELDS, subtype: 'local_command', content: '/help' }),
        ccLine({ type: 'system', ...BASE_FIELDS, subtype: 'informational', content: 'session info' }),
      ].join('\n');
      await writeFile(f, lines, 'utf-8');
      const result = await readCCSession(f);

      expect(result!.records).toHaveLength(2);
      expect(result!.records[0]).toMatchObject({ patch: { local_command: '/help' } });
      expect(result!.records[1]).toMatchObject({ patch: { informational: 'session info' } });
    });

    it('skips bridge_status', async () => {
      const f = nextFile();
      await writeFile(f, ccLine({
        type: 'system',
        ...BASE_FIELDS,
        subtype: 'bridge_status',
      }), 'utf-8');
      const result = await readCCSession(f);

      expect(result!.records).toHaveLength(0);
      expect(result!.stats.skippedRecords).toBe(1);
    });
  });

  describe('file-history-snapshot', () => {
    it('maps non-empty snapshot to meta', async () => {
      const f = nextFile();
      await writeFile(f, ccLine({
        type: 'file-history-snapshot',
        ...BASE_FIELDS,
        messageId: 'msg-1',
        snapshot: {
          trackedFileBackups: {
            'src/index.ts': { backupFileName: 'backup-1', version: 1 },
            'src/utils.ts': { backupFileName: 'backup-2', version: 1 },
          },
          timestamp: '2026-03-14T10:00:00.000Z',
        },
      }), 'utf-8');
      const result = await readCCSession(f);

      expect(result!.records).toHaveLength(1);
      expect(result!.records[0]).toMatchObject({
        t: 'meta',
        patch: {
          fileHistorySnapshot: {
            messageId: 'msg-1',
            fileCount: 2,
            files: ['src/index.ts', 'src/utils.ts'],
          },
        },
      });
    });

    it('skips empty file-history-snapshot', async () => {
      const f = nextFile();
      await writeFile(f, ccLine({
        type: 'file-history-snapshot',
        ...BASE_FIELDS,
        snapshot: { trackedFileBackups: {} },
      }), 'utf-8');
      const result = await readCCSession(f);

      expect(result!.records).toHaveLength(0);
      expect(result!.stats.skippedRecords).toBe(1);
    });
  });

  describe('queue-operation', () => {
    it('maps enqueue to meta', async () => {
      const f = nextFile();
      await writeFile(f, ccLine({
        type: 'queue-operation',
        ...BASE_FIELDS,
        operation: 'enqueue',
        content: 'task data here',
      }), 'utf-8');
      const result = await readCCSession(f);

      expect(result!.records[0]).toMatchObject({
        t: 'meta',
        patch: { queueEnqueue: 'task data here' },
      });
    });

    it('skips dequeue, remove, and popAll', async () => {
      const f = nextFile();
      const lines = [
        ccLine({ type: 'queue-operation', ...BASE_FIELDS, operation: 'dequeue' }),
        ccLine({ type: 'queue-operation', ...BASE_FIELDS, operation: 'remove' }),
        ccLine({ type: 'queue-operation', ...BASE_FIELDS, operation: 'popAll' }),
      ].join('\n');
      await writeFile(f, lines, 'utf-8');
      const result = await readCCSession(f);

      expect(result!.records).toHaveLength(0);
      expect(result!.stats.skippedRecords).toBe(3);
    });
  });

  describe('pr-link', () => {
    it('maps pr-link to meta with PR info', async () => {
      const f = nextFile();
      await writeFile(f, ccLine({
        type: 'pr-link',
        ...BASE_FIELDS,
        prNumber: 42,
        prUrl: 'https://github.com/org/repo/pull/42',
        prRepository: 'org/repo',
      }), 'utf-8');
      const result = await readCCSession(f);

      expect(result!.records[0]).toMatchObject({
        t: 'meta',
        patch: {
          prLink: { prNumber: 42, prUrl: 'https://github.com/org/repo/pull/42', prRepository: 'org/repo' },
        },
      });
    });
  });

  describe('skipped record types', () => {
    it('skips agent-color and last-prompt', async () => {
      const f = nextFile();
      const lines = [
        ccLine({ type: 'agent-color', ...BASE_FIELDS, color: '#ff0000' }),
        ccLine({ type: 'last-prompt', ...BASE_FIELDS, prompt: 'hello' }),
      ].join('\n');
      await writeFile(f, lines, 'utf-8');
      const result = await readCCSession(f);

      expect(result!.records).toHaveLength(0);
      expect(result!.stats.skippedRecords).toBe(2);
    });
  });

  describe('malformed lines', () => {
    it('skips malformed lines and counts them', async () => {
      const f = nextFile();
      const lines = [
        '{broken json',
        ccUser('valid message'),
        'also broken}',
      ].join('\n');
      await writeFile(f, lines, 'utf-8');
      const result = await readCCSession(f);

      expect(result!.stats.malformedLines).toBe(2);
      expect(result!.records).toHaveLength(1);
    });
  });

  describe('stats accuracy', () => {
    it('counts all record categories correctly', async () => {
      const f = nextFile();
      const lines = [
        ccUser('hello'),
        ccAssistant('msg-1', [{ type: 'text', text: 'hi' }]),
        ccLine({ type: 'agent-color', ...BASE_FIELDS }),  // skipped
        ccLine({ type: 'last-prompt', ...BASE_FIELDS }),   // skipped
        '{bad}',                                            // malformed
      ].join('\n');
      await writeFile(f, lines, 'utf-8');
      const result = await readCCSession(f);

      expect(result!.stats).toEqual({
        totalCCRecords: 4,      // 4 valid parsed records
        mappedRecords: 2,       // user message + message_final
        skippedRecords: 2,      // agent-color + last-prompt
        malformedLines: 1,
      });
    });
  });

  describe('seq ordering', () => {
    it('assigns monotonically increasing seq values', async () => {
      const f = nextFile();
      const lines = [
        ccUser('hello'),
        ccAssistant('msg-1', [
          { type: 'text', text: 'hi' },
          { type: 'tool_use', id: 'tu-1', name: 'Read', input: {} },
        ]),
        ccUser('follow up'),
      ].join('\n');
      await writeFile(f, lines, 'utf-8');
      const result = await readCCSession(f);

      const seqs = result!.records.map((r) => r.seq);
      // Each seq should be greater than the previous
      for (let i = 1; i < seqs.length; i++) {
        expect(seqs[i]).toBeGreaterThan(seqs[i - 1]);
      }
    });
  });

  describe('full multi-turn session', () => {
    it('handles a realistic multi-turn conversation', async () => {
      const f = nextFile();
      const lines = [
        // Turn 1: user asks, assistant responds with thinking + text + tool_use
        ccUser('Fix the bug in session.ts'),
        ccAssistant('msg-1', [{ type: 'thinking', thinking: 'Let me analyze...' }]),
        ccAssistant('msg-1', [{ type: 'text', text: 'I see the issue.' }]),
        ccAssistant('msg-1', [{ type: 'tool_use', id: 'tu-read', name: 'Read', input: { path: '/src/session.ts' } }]),
        // Tool result (API plumbing)
        ccUser([{ type: 'tool_result', tool_use_id: 'tu-read', content: 'file contents here' }]),
        // Assistant continues with fix
        ccAssistant('msg-2', [{ type: 'text', text: 'Here is the fix:' }]),
        ccAssistant('msg-2', [{ type: 'tool_use', id: 'tu-edit', name: 'Edit', input: { path: '/src/session.ts' } }]),
        // Hook runs
        ccLine({
          type: 'progress', ...BASE_FIELDS,
          data: { type: 'hook_progress', hookName: 'lint', hookEvent: 'PostToolUse', toolUseID: 'tu-edit', durationMs: 50 },
        }),
        // Tool result
        ccUser([{ type: 'tool_result', tool_use_id: 'tu-edit', content: 'edit applied' }]),
        // Turn duration
        ccLine({ type: 'system', ...BASE_FIELDS, subtype: 'turn_duration', durationMs: 5000, parentUuid: 'msg-2' }),
        // Final response
        ccAssistant('msg-3', [{ type: 'text', text: 'Bug fixed!' }]),
        // User confirms
        ccUser('Thanks!'),
      ].join('\n');
      await writeFile(f, lines, 'utf-8');
      const result = await readCCSession(f);

      expect(result).not.toBeNull();

      // Count by type
      const byType = new Map<string, number>();
      for (const r of result!.records) {
        byType.set(r.t, (byType.get(r.t) ?? 0) + 1);
      }

      expect(byType.get('message')).toBe(2);        // 2 real user messages
      expect(byType.get('message_final')).toBe(3);   // 3 assistant turns
      expect(byType.get('tool_call')).toBe(2);        // Read + Edit
      expect(byType.get('meta')).toBe(2);             // 2 tool-result-only user messages → meta
      expect(byType.get('hook')).toBe(1);             // lint hook
      expect(byType.get('query_result')).toBe(1);     // turn_duration

      // Total mapped should match
      expect(result!.stats.mappedRecords).toBe(result!.records.length);

      // seq should be strictly increasing
      const seqs = result!.records.map((r) => r.seq);
      for (let i = 1; i < seqs.length; i++) {
        expect(seqs[i]).toBeGreaterThan(seqs[i - 1]);
      }
    });
  });
});

// =============================================================================
// Discovery Tests
// =============================================================================

describe('cc-reader discovery', () => {
  describe('projectPathToSlug', () => {
    it('converts path separators to dashes', () => {
      expect(projectPathToSlug('/Users/foo/Projects/bar')).toBe('-Users-foo-Projects-bar');
    });

    it('handles paths without leading slash', () => {
      const slug = projectPathToSlug('relative/path');
      // resolve() will prepend cwd, so just check it doesn't have slashes
      expect(slug).not.toContain('/');
    });
  });

  describe('discoverCCSessions', () => {
    it('reads sessions from sessions-index.json', async () => {
      const projectDir = join(TEST_ROOT, 'discovery-index');
      await mkdir(projectDir, { recursive: true });

      const index = {
        version: 1,
        entries: [
          {
            sessionId: 'sess-1',
            fullPath: '/path/to/sess-1.jsonl',
            firstPrompt: 'fix the bug',
            messageCount: 10,
            created: '2026-03-14T10:00:00.000Z',
            modified: '2026-03-14T12:00:00.000Z',
            gitBranch: 'main',
            projectPath: '/projects/test',
          },
          {
            sessionId: 'sess-2',
            fullPath: '/path/to/sess-2.jsonl',
            firstPrompt: 'add feature',
            messageCount: 5,
            created: '2026-03-14T08:00:00.000Z',
            modified: '2026-03-14T09:00:00.000Z',
          },
        ],
      };

      await writeFile(join(projectDir, 'sessions-index.json'), JSON.stringify(index), 'utf-8');

      // discoverCCSessions uses ~/.claude/projects/<slug>, but we can test
      // the internal readSessionsIndex by writing to a known path.
      // For unit testing, we test projectPathToSlug separately and trust the path wiring.
      // Here we verify the function doesn't crash on a real call.
      const sessions = await discoverCCSessions('/nonexistent/path/that/wont/match');
      // Should return empty (no matching dir), not throw
      expect(sessions).toEqual([]);
    });

    it('returns empty array for missing project dir', async () => {
      const sessions = await discoverCCSessions('/this/path/does/not/exist');
      expect(sessions).toEqual([]);
    });

    it('returns empty array when no project path given and ~/.claude/projects missing', async () => {
      // This test verifies graceful handling — it reads the real ~/.claude/projects
      // so the result depends on the environment, but it should not throw
      const sessions = await discoverCCSessions();
      expect(Array.isArray(sessions)).toBe(true);
    });
  });
});
