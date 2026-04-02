import { createSession } from 'unifai';
import type { AgentEvent } from 'unifai';
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

      const session = createSession('claude', {
        model: 'sonnet',
        cwd: this.options.cwd,
        env: this.options.env ?? buildSdkEnv(),
        pathToClaudeCodeExecutable: resolveClaudeCliPath(),
        abortController: this.abortController,
        includePartialMessages: true,
        includeRawEvents: true,
        ...(this.options.allowedTools?.length ? { allowedTools: this.options.allowedTools } : {}),
      });

      try {
        for await (const event of session.send(fullPrompt)) {
          yield* this.handleEvent(event, bus, tokenIndex);
          if (event.type === 'text_delta') tokenIndex++;
        }
      } finally {
        session.close();
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

  private *handleEvent(event: AgentEvent, bus: ReturnType<typeof getEventBus>, _tokenIndex: number): Generator<AgentStreamEvent> {
    const now = Date.now();

    // Pass through raw SDK messages for advanced consumers
    if (event.type === 'raw') {
      bus.emit({
        type: 'RawSdkMessage',
        sdkMessageType: event.eventType,
        payload: event.data,
        timestamp: now,
      });
      return;
    }

    if (event.type === 'text_delta') {
      yield { type: 'token', token: event.text };
      return;
    }

    if (event.type === 'tool_start') {
      yield { type: 'tool_start', name: event.toolName, input: formatToolInput(event.toolName, event.input), toolUseId: event.toolUseId, inputRaw: event.input };
    }

    if (event.type === 'tool_result') {
      yield { type: 'tool_result', toolUseId: event.toolUseId, toolName: event.toolName, result: event.result, isError: event.isError };
    }

    if (event.type === 'content_block_start') {
      yield { type: 'content_block_start', index: event.index, blockType: event.blockType, id: event.id, name: event.name };
    }

    if (event.type === 'content_block_stop') {
      yield { type: 'content_block_stop', index: event.index };
    }

    if (event.type === 'status') {
      yield { type: 'status', message: event.message };
    }

    if (event.type === 'session_complete') {
      bus.emit({
        type: 'QueryResult',
        subtype: (event.subtype ?? 'success') as 'success',
        durationMs: event.durationMs,
        durationApiMs: event.durationApiMs ?? 0,
        numTurns: event.numTurns,
        totalCostUsd: event.costUsd ?? 0,
        result: event.result,
        structuredOutput: event.structuredOutput,
        usage: {
          inputTokens: event.usage.inputTokens,
          outputTokens: event.usage.outputTokens,
          cacheReadInputTokens: event.usage.cacheReadTokens ?? 0,
          cacheCreationInputTokens: event.usage.cacheCreationTokens ?? 0,
        },
        modelUsage: event.modelUsage
          ? Object.fromEntries(
              Object.entries(event.modelUsage).map(([model, mu]) => [
                model,
                {
                  inputTokens: mu.inputTokens,
                  outputTokens: mu.outputTokens,
                  cacheReadInputTokens: mu.cacheReadTokens,
                  cacheCreationInputTokens: mu.cacheCreationTokens,
                  webSearchRequests: mu.webSearchRequests ?? 0,
                  costUSD: mu.costUsd ?? 0,
                  contextWindow: mu.contextWindow ?? 0,
                  maxOutputTokens: mu.maxOutputTokens ?? 0,
                },
              ])
            )
          : {},
        errors: event.errors,
        timestamp: now,
      });
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
