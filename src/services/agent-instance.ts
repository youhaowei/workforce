import { query as sdkQuery } from '@anthropic-ai/claude-agent-sdk';
import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import { homedir } from 'os';
import type { StreamResult, AgentStreamEvent } from './types';
import { getEventBus } from '@/shared/event-bus';
import { formatToolInput } from './agent';
import { resolveClaudeCliPath } from './agent-cli-path';

/**
 * Build environment variables for the SDK subprocess.
 * Ensures HOME is set (GUI apps launched from Finder may not have it).
 *
 * NOTE: We intentionally do NOT inject auth tokens from credentials file.
 * The SDK subprocess handles auth internally (token refresh, etc.) just like
 * the Claude CLI does. Injecting expired tokens would break auth.
 */
export function buildSdkEnv(): Record<string, string | undefined> {
  const env = { ...process.env };

  // Ensure HOME is set (GUI apps may not have it)
  if (!env.HOME) {
    env.HOME = homedir();
  }

  return env;
}

/**
 * Classify an error as auth-related based on message content.
 */
export function isAuthError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const msg = err.message.toLowerCase();
  return (
    msg.includes('authentication') ||
    msg.includes('unauthorized') ||
    msg.includes('401') ||
    msg.includes('invalid api key') ||
    msg.includes('api key') ||
    msg.includes('not authenticated') ||
    msg.includes('credential')
  );
}

export class AgentError extends Error {
  constructor(
    message: string,
    public readonly code: AgentErrorCode,
    public readonly cause?: unknown
  ) {
    super(message);
    this.name = 'AgentError';
  }
}

export type AgentErrorCode =
  | 'AUTH_ERROR'
  | 'RATE_LIMIT'
  | 'NETWORK_ERROR'
  | 'STREAM_FAILED'
  | 'CANCELLED'
  | 'TOOL_ERROR'
  | 'UNKNOWN';

export interface AgentInstanceOptions {
  cwd: string;
  systemPrompt?: string;
  env?: Record<string, string | undefined>;
  /** Org-level tool allowlist — passed to SDK if non-empty */
  allowedTools?: string[];
}

// Inline event mapping for the simpler AgentInstance use case.
// Reuses the same SDK message structure as agent.ts but only maps the
// events that AgentInstance needs (a subset of the full mapping).

/** Check if an SDK message is a text_delta stream event. */
function isTextDelta(msg: SDKMessage): boolean {
  if (msg.type !== 'stream_event') return false;
  const se = msg as SDKMessage & { event?: { type?: string; delta?: { type?: string } } };
  return se.event?.type === 'content_block_delta' && se.event?.delta?.type === 'text_delta';
}

/** Extract tool_result events from SDK "user" messages. */
function* extractToolResults(msg: SDKMessage, pendingTools: Map<string, string>): Generator<AgentStreamEvent> {
  if (msg.type !== 'user') return;
  const content = (msg as SDKMessage & { message?: { content?: unknown[] } }).message?.content;
  if (!Array.isArray(content)) return;
  for (const block of content) {
    const b = block as { type?: string; tool_use_id?: string; content?: unknown; is_error?: boolean };
    if (b.type === 'tool_result' && b.tool_use_id) {
      const toolUseId = String(b.tool_use_id);
      const toolName = pendingTools.get(toolUseId) ?? '';
      pendingTools.delete(toolUseId);
      yield { type: 'tool_result', toolUseId, toolName, result: b.content, isError: !!b.is_error };
    }
  }
}

/**
 * An individual agent instance tied to a specific session.
 * Each instance has its own AbortController and working directory,
 * enabling concurrent agents with worktree isolation.
 */
export class AgentInstance {
  private abortController: AbortController;
  private runInProgress = false;

  constructor(
    public readonly sessionId: string,
    private options: AgentInstanceOptions
  ) {
    this.abortController = new AbortController();
  }

  // eslint-disable-next-line complexity -- SDK event dispatch loop; flat branching, not nested logic.
  async *run(prompt: string): StreamResult<AgentStreamEvent> {
    if (this.runInProgress) {
      throw new AgentError('Query already in progress for this instance', 'UNKNOWN');
    }

    this.runInProgress = true;
    this.abortController = new AbortController();
    const bus = getEventBus();
    let tokenIndex = 0;

    try {
      const fullPrompt = this.options.systemPrompt
        ? `${this.options.systemPrompt}\n\n${prompt}`
        : prompt;

      const sdkOptions = {
        model: 'sonnet' as const,
        cwd: this.options.cwd,
        env: this.options.env ?? buildSdkEnv(),
        pathToClaudeCodeExecutable: resolveClaudeCliPath(),
        abortController: this.abortController,
        includePartialMessages: true,
        ...(this.options.allowedTools?.length ? { allowedTools: this.options.allowedTools } : {}),
      };

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const stream = sdkQuery({ prompt: fullPrompt, options: sdkOptions as any });

      // Track pending tools for result synthesis
      const pendingTools = new Map<string, string>();

      try {
        for await (const msg of stream) {
          // Extract tool_result from SDK "user" messages
          yield* extractToolResults(msg, pendingTools);

          yield* this.handleSdkMessage(msg, bus, tokenIndex, pendingTools);
          // Count text deltas from stream events
          if (isTextDelta(msg)) tokenIndex++;
        }

        // Complete remaining tools at stream end
        for (const [toolUseId, toolName] of pendingTools) {
          yield { type: 'tool_result', toolUseId, toolName, result: undefined, isError: false };
        }
      } finally {
        stream.close();
      }
    } catch (err) {
      if (this.abortController.signal.aborted) {
        yield { type: 'token' as const, token: ' [cancelled]' };
      } else {
        throw new AgentError(
          err instanceof Error ? err.message : String(err),
          isAuthError(err) ? 'AUTH_ERROR' : 'STREAM_FAILED',
          err
        );
      }
    } finally {
      this.runInProgress = false;
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any, complexity -- Flat SDK message dispatch; each branch is trivial.
  private *handleSdkMessage(msg: any, bus: ReturnType<typeof getEventBus>, _tokenIndex: number, pendingTools: Map<string, string>): Generator<AgentStreamEvent> {
    const now = Date.now();

    // Pass through raw SDK messages for advanced consumers
    if (msg.type !== 'stream_event' && msg.type !== 'assistant' && msg.type !== 'result' && msg.type !== 'user') {
      bus.emit({ type: 'RawSdkMessage', sdkMessageType: msg.type, payload: msg, timestamp: now });
    }

    // Handle stream events (text deltas, content blocks)
    if (msg.type === 'stream_event') {
      const event = msg.event;
      if (!event) return;

      if (event.type === 'content_block_delta') {
        const delta = event.delta;
        if (delta?.type === 'text_delta' && typeof delta.text === 'string') {
          yield { type: 'token', token: delta.text };
          return;
        }
      }

      if (event.type === 'content_block_start') {
        const block = event.content_block;
        if (block) {
          yield { type: 'content_block_start', index: Number(event.index ?? 0), blockType: block.type, id: block.id, name: block.name };
        }
      }

      if (event.type === 'content_block_stop') {
        yield { type: 'content_block_stop', index: Number(event.index ?? 0) };
      }
      return;
    }

    // Handle assistant messages (extract tool_start events)
    if (msg.type === 'assistant') {
      const m = msg.message;
      if (!m || !Array.isArray(m.content)) return;

      for (const block of m.content) {
        if (block.type === 'tool_use') {
          const toolUseId = String(block.id ?? '');
          const toolName = String(block.name ?? '');
          pendingTools.set(toolUseId, toolName);
          yield { type: 'tool_start', name: toolName, input: formatToolInput(toolName, block.input), toolUseId, inputRaw: block.input };
        }
      }
    }

    // Handle result messages
    if (msg.type === 'result') {
      bus.emit({
        type: 'QueryResult',
        subtype: (msg.subtype ?? 'success') as 'success',
        durationMs: Number(msg.duration_ms ?? 0),
        durationApiMs: Number(msg.duration_api_ms ?? 0),
        numTurns: Number(msg.num_turns ?? 0),
        totalCostUsd: Number(msg.total_cost_usd ?? 0),
        result: msg.result != null ? String(msg.result) : undefined,
        structuredOutput: msg.structured_output,
        usage: {
          inputTokens: Number(msg.usage?.input_tokens ?? 0),
          outputTokens: Number(msg.usage?.output_tokens ?? 0),
          cacheReadInputTokens: Number(msg.usage?.cache_read_input_tokens ?? 0),
          cacheCreationInputTokens: Number(msg.usage?.cache_creation_input_tokens ?? 0),
        },
        modelUsage: msg.modelUsage
          ? Object.fromEntries(
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              Object.entries(msg.modelUsage).map(([model, mu]: [string, any]) => [model, {
                inputTokens: Number(mu.inputTokens ?? 0),
                outputTokens: Number(mu.outputTokens ?? 0),
                cacheReadInputTokens: Number(mu.cacheReadInputTokens ?? 0),
                cacheCreationInputTokens: Number(mu.cacheCreationInputTokens ?? 0),
                webSearchRequests: Number(mu.webSearchRequests ?? 0),
                costUSD: Number(mu.costUSD ?? 0),
                contextWindow: Number(mu.contextWindow ?? 0),
                maxOutputTokens: Number(mu.maxOutputTokens ?? 0),
              }])
            )
          : {},
        errors: Array.isArray(msg.errors) ? msg.errors : undefined,
        timestamp: now,
      });
    }

    // Handle status messages
    if (msg.type === 'system' && msg.subtype === 'status') {
      yield { type: 'status', message: msg.status ? String(msg.status) : 'status update' };
    }
  }

  cancel(): void {
    this.abortController.abort();
  }

  isRunning(): boolean {
    return this.runInProgress;
  }

  dispose(): void {
    this.cancel();
  }
}
