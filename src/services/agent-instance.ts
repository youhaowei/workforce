import { query as sdkQuery } from '@anthropic-ai/claude-agent-sdk';
import { homedir } from 'os';
import type { StreamResult, TokenDelta } from './types';
import { getEventBus } from '@shared/event-bus';

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
  /** Workspace-level tool allowlist — passed to SDK if non-empty */
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

  // eslint-disable-next-line complexity
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

      const sdkOptions: Record<string, unknown> = {
        abortController: this.abortController,
        cwd: this.options.cwd,
        env: this.options.env ?? buildSdkEnv(),
        includePartialMessages: true,
      };

      if (this.options.allowedTools?.length) {
        sdkOptions.allowedTools = this.options.allowedTools;
      }

      const queryStream = sdkQuery({ prompt: fullPrompt, options: sdkOptions });

      for await (const message of queryStream) {
        const now = Date.now();

        bus.emit({
          type: 'RawSdkMessage',
          sdkMessageType: message.type,
          payload: message,
          timestamp: now,
        });

        if (message.type === 'result') {
          bus.emit({
            type: 'QueryResult',
            subtype: message.subtype,
            durationMs: message.duration_ms,
            durationApiMs: message.duration_api_ms,
            numTurns: message.num_turns,
            totalCostUsd: message.total_cost_usd,
            result: 'result' in message ? message.result : undefined,
            structuredOutput: 'structured_output' in message ? message.structured_output : undefined,
            usage: {
              inputTokens: message.usage.input_tokens,
              outputTokens: message.usage.output_tokens,
              cacheReadInputTokens: message.usage.cache_read_input_tokens,
              cacheCreationInputTokens: message.usage.cache_creation_input_tokens,
            },
            modelUsage: Object.fromEntries(
              Object.entries(message.modelUsage).map(([model, usage]) => [
                model,
                {
                  inputTokens: usage.inputTokens,
                  outputTokens: usage.outputTokens,
                  cacheReadInputTokens: usage.cacheReadInputTokens,
                  cacheCreationInputTokens: usage.cacheCreationInputTokens,
                  webSearchRequests: usage.webSearchRequests,
                  costUSD: usage.costUSD,
                  contextWindow: usage.contextWindow,
                  maxOutputTokens: usage.maxOutputTokens,
                },
              ])
            ),
            errors: 'errors' in message ? message.errors : undefined,
            timestamp: now,
          });
          continue;
        }

        if (message.type !== 'stream_event') continue;
        const event = message.event;
        if (event.type !== 'content_block_delta' || !('delta' in event)) continue;
        const delta = event.delta as { type: string; text?: string };
        if (delta.type !== 'text_delta' || !delta.text) continue;

        const tokenDelta: TokenDelta = {
          token: delta.text,
          index: tokenIndex++,
        };
        bus.emit({
          type: 'TokenDelta',
          token: tokenDelta.token,
          index: tokenDelta.index,
          timestamp: now,
        });
        yield tokenDelta;
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
