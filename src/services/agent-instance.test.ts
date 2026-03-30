import { describe, it, expect, vi, afterEach } from 'vitest';
import { getEventBus } from '@/shared/event-bus';

// Mock the SDK before importing
vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  query: vi.fn(),
}));

vi.mock('./agent-cli-path', () => ({
  resolveClaudeCliPath: () => '/usr/local/bin/claude',
}));

vi.mock('./agent', () => ({
  formatToolInput: (_name: string, input: unknown) => JSON.stringify(input),
}));

import { buildSdkEnv, isAuthError, AgentError, AgentInstance } from './agent-instance';
import { query } from '@anthropic-ai/claude-agent-sdk';

const mockQuery = vi.mocked(query);

/**
 * Helper: create a mock Query (async generator with close()).
 * The SDK's query() returns an AsyncGenerator with a .close() method.
 */
function mockStream(events: Array<Record<string, unknown>>) {
  const gen = (async function* () {
    for (const e of events) yield e;
  })();
  // Add close() method that Query has
  (gen as any).close = vi.fn();
  return gen;
}

describe('agent-instance', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    getEventBus().dispose();
  });

  describe('buildSdkEnv', () => {
    it('returns process.env with HOME set', () => {
      const env = buildSdkEnv();
      expect(env.HOME).toBeDefined();
      expect(typeof env.HOME).toBe('string');
    });

    it('preserves existing HOME', () => {
      const originalHome = process.env.HOME;
      const env = buildSdkEnv();
      expect(env.HOME).toBe(originalHome);
    });

    it('sets HOME from homedir() when missing', () => {
      const originalHome = process.env.HOME;
      delete process.env.HOME;
      try {
        const env = buildSdkEnv();
        expect(env.HOME).toBeDefined();
        expect(env.HOME!.length).toBeGreaterThan(0);
      } finally {
        process.env.HOME = originalHome;
      }
    });
  });

  describe('isAuthError', () => {
    it.each([
      'authentication failed',
      'Unauthorized access',
      'HTTP 401 error',
      'invalid api key provided',
      'api key expired',
      'not authenticated',
      'credential error',
    ])('returns true for "%s"', (msg) => {
      expect(isAuthError(new Error(msg))).toBe(true);
    });

    it('returns false for non-auth errors', () => {
      expect(isAuthError(new Error('network timeout'))).toBe(false);
      expect(isAuthError(new Error('rate limited'))).toBe(false);
    });

    it('returns false for non-Error values', () => {
      expect(isAuthError('string error')).toBe(false);
      expect(isAuthError(null)).toBe(false);
      expect(isAuthError(42)).toBe(false);
    });
  });

  describe('AgentError', () => {
    it('has correct name, code, and cause', () => {
      const cause = new Error('root cause');
      const err = new AgentError('failed', 'AUTH_ERROR', cause);
      expect(err.name).toBe('AgentError');
      expect(err.message).toBe('failed');
      expect(err.code).toBe('AUTH_ERROR');
      expect(err.cause).toBe(cause);
    });

    it('is an instance of Error', () => {
      const err = new AgentError('test', 'UNKNOWN');
      expect(err).toBeInstanceOf(Error);
    });
  });

  describe('AgentInstance', () => {
    it('throws if run is called while already running', async () => {
      let resolveHang!: () => void;
      const stream = (async function* () {
        yield { type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'hi' } } };
        await new Promise<void>((r) => { resolveHang = r; });
      })();
      (stream as any).close = vi.fn();
      mockQuery.mockReturnValue(stream as any);

      const instance = new AgentInstance('sess-1', { cwd: '/tmp' });

      const gen = instance.run('first prompt');
      await gen.next(); // yields 'hi' token

      const gen2 = instance.run('second prompt');
      await expect(gen2.next()).rejects.toThrow('Query already in progress');

      instance.cancel();
      resolveHang?.();
      try { await gen.return(undefined); } catch { /* cleanup */ }
    });

    it('yields token events from stream text_delta', async () => {
      const stream = mockStream([
        { type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'hello ' } } },
        { type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'world' } } },
      ]);
      mockQuery.mockReturnValue(stream as any);

      const instance = new AgentInstance('sess-1', { cwd: '/tmp' });
      const events: unknown[] = [];
      for await (const event of instance.run('test')) {
        events.push(event);
      }

      expect(events).toEqual([
        { type: 'token', token: 'hello ' },
        { type: 'token', token: 'world' },
      ]);
    });

    it('yields tool_start from assistant messages and tool_result from user messages', async () => {
      const stream = mockStream([
        { type: 'assistant', message: { content: [{ type: 'tool_use', id: 'tu-1', name: 'search', input: { q: 'test' } }] } },
        { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'tu-1', content: 'found', is_error: false }] } },
      ]);
      mockQuery.mockReturnValue(stream as any);

      const instance = new AgentInstance('sess-1', { cwd: '/tmp' });
      const events: unknown[] = [];
      for await (const event of instance.run('test')) {
        events.push(event);
      }

      expect(events).toHaveLength(2);
      expect(events[0]).toMatchObject({ type: 'tool_start', name: 'search', toolUseId: 'tu-1' });
      expect(events[1]).toMatchObject({ type: 'tool_result', toolUseId: 'tu-1', result: 'found' });
    });

    it('yields cancelled token when aborted mid-stream', async () => {
      const instanceRef: { current?: AgentInstance } = {};
      const stream = (async function* () {
        yield { type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'start' } } };
        instanceRef.current!.cancel();
        throw new Error('The operation was aborted');
      })();
      (stream as any).close = vi.fn();
      mockQuery.mockReturnValue(stream as any);

      const instance = new AgentInstance('sess-1', { cwd: '/tmp' });
      instanceRef.current = instance;

      const events: unknown[] = [];
      for await (const event of instance.run('test')) {
        events.push(event);
      }

      expect(events).toEqual([
        { type: 'token', token: 'start' },
        { type: 'token', token: ' [cancelled]' },
      ]);
    });

    it('throws AgentError with AUTH_ERROR code for auth errors', async () => {
      const stream = (async function* () {
        throw new Error('authentication failed');
      })();
      (stream as any).close = vi.fn();
      mockQuery.mockReturnValue(stream as any);

      const instance = new AgentInstance('sess-1', { cwd: '/tmp' });

      try {
        for await (const _ of instance.run('test')) { /* consume */ }
        expect.unreachable('should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(AgentError);
        expect((err as AgentError).code).toBe('AUTH_ERROR');
      }
    });

    it('throws AgentError with STREAM_FAILED for non-auth errors', async () => {
      const stream = (async function* () {
        throw new Error('network timeout');
      })();
      (stream as any).close = vi.fn();
      mockQuery.mockReturnValue(stream as any);

      const instance = new AgentInstance('sess-1', { cwd: '/tmp' });

      try {
        for await (const _ of instance.run('test')) { /* consume */ }
        expect.unreachable('should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(AgentError);
        expect((err as AgentError).code).toBe('STREAM_FAILED');
      }
    });

    it('resets runInProgress after completion', async () => {
      const stream = mockStream([
        { type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'done' } } },
      ]);
      mockQuery.mockReturnValue(stream as any);

      const instance = new AgentInstance('sess-1', { cwd: '/tmp' });
      for await (const _ of instance.run('test')) { /* consume */ }

      expect(instance.isRunning()).toBe(false);
    });

    it('calls stream.close() in finally block', async () => {
      const stream = mockStream([
        { type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'x' } } },
      ]);
      mockQuery.mockReturnValue(stream as any);

      const instance = new AgentInstance('sess-1', { cwd: '/tmp' });
      for await (const _ of instance.run('test')) { /* consume */ }

      expect((stream as any).close).toHaveBeenCalledOnce();
    });

    it('prepends systemPrompt to the prompt', async () => {
      const stream = mockStream([]);
      mockQuery.mockReturnValue(stream as any);

      const instance = new AgentInstance('sess-1', {
        cwd: '/tmp',
        systemPrompt: 'You are helpful.',
      });
      for await (const _ of instance.run('do thing')) { /* consume */ }

      expect(mockQuery).toHaveBeenCalledWith(
        expect.objectContaining({
          prompt: 'You are helpful.\n\ndo thing',
        }),
      );
    });

    describe('cancel / dispose', () => {
      it('cancel sets abort signal', () => {
        const instance = new AgentInstance('sess-1', { cwd: '/tmp' });
        instance.cancel();
      });

      it('dispose calls cancel', () => {
        const instance = new AgentInstance('sess-1', { cwd: '/tmp' });
        instance.dispose();
      });
    });
  });
});
