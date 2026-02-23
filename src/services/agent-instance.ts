import { createSession } from 'unifai';
import type { AgentEvent } from 'unifai';
import { homedir } from 'os';
import type { StreamResult, TokenDelta } from './types';
import { getEventBus } from '@/shared/event-bus';

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
  private queryInProgress = false;

  constructor(
    public readonly sessionId: string,
    private options: AgentInstanceOptions
  ) {
    this.abortController = new AbortController();
  }

  async *query(prompt: string): StreamResult<TokenDelta> {
    if (this.queryInProgress) {
      throw new AgentError('Query already in progress for this instance', 'UNKNOWN');
    }

    this.queryInProgress = true;
    this.abortController = new AbortController();
    const bus = getEventBus();
    let tokenIndex = 0;

    try {
      const fullPrompt = this.options.systemPrompt
        ? `${this.options.systemPrompt}\n\n${prompt}`
        : prompt;

      const session = createSession('claude', {
        model: 'sonnet',
        sdkVersion: 'v1',
        cwd: this.options.cwd,
        env: this.options.env ?? buildSdkEnv(),
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
        yield { token: ' [cancelled]', index: tokenIndex++ };
      } else {
        throw new AgentError(
          err instanceof Error ? err.message : String(err),
          isAuthError(err) ? 'AUTH_ERROR' : 'STREAM_FAILED',
          err
        );
      }
    } finally {
      this.queryInProgress = false;
    }
  }

  private *handleEvent(event: AgentEvent, bus: ReturnType<typeof getEventBus>, tokenIndex: number): Generator<TokenDelta> {
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
      const tokenDelta: TokenDelta = { token: event.text, index: tokenIndex };
      bus.emit({ type: 'TokenDelta', token: tokenDelta.token, index: tokenDelta.index, timestamp: now });
      yield tokenDelta;
      return;
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

  isQuerying(): boolean {
    return this.queryInProgress;
  }

  dispose(): void {
    this.cancel();
  }
}
