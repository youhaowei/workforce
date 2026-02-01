import { query as sdkQuery } from '@anthropic-ai/claude-agent-sdk';
import { homedir } from 'os';
import type { AgentService, QueryOptions, TokenDelta, StreamResult } from './types';
import { getEventBus } from '@shared/event-bus';

/**
 * Build environment variables for the SDK subprocess.
 * Ensures HOME is set (GUI apps launched from Finder may not have it).
 *
 * NOTE: We intentionally do NOT inject auth tokens from credentials file.
 * The SDK subprocess handles auth internally (token refresh, etc.) just like
 * the Claude CLI does. Injecting expired tokens would break auth.
 */
function buildSdkEnv(): Record<string, string | undefined> {
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
function isAuthError(err: unknown): boolean {
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

class AgentServiceImpl implements AgentService {
  private abortController: AbortController | null = null;
  private queryInProgress = false;

  async *query(prompt: string, _options?: QueryOptions): StreamResult<TokenDelta> {
    if (this.queryInProgress) {
      throw new AgentError('Query already in progress', 'UNKNOWN');
    }

    this.queryInProgress = true;
    this.abortController = new AbortController();
    const bus = getEventBus();
    let tokenIndex = 0;

    try {
      const queryStream = sdkQuery({
        prompt,
        options: {
          abortController: this.abortController,
          cwd: process.cwd(),
          env: buildSdkEnv(),
        },
      });

      for await (const message of queryStream) {
        if (message.type === 'stream_event') {
          const event = message.event;
          
          if (event.type === 'content_block_delta' && 'delta' in event) {
            const delta = event.delta as { type: string; text?: string };
            if (delta.type === 'text_delta' && delta.text) {
              const tokenDelta: TokenDelta = {
                token: delta.text,
                index: tokenIndex++,
              };
              bus.emit({
                type: 'TokenDelta',
                token: tokenDelta.token,
                index: tokenDelta.index,
                timestamp: Date.now(),
              });
              yield tokenDelta;
            }
          }
        } else if (message.type === 'assistant') {
          if (message.message?.content) {
            for (const block of message.message.content) {
              if (block.type === 'tool_use') {
                bus.emit({
                  type: 'ToolStart',
                  toolId: block.id,
                  toolName: block.name,
                  args: block.input as Record<string, unknown>,
                  timestamp: Date.now(),
                });
              }
            }
          }
        }
      }
    } catch (err) {
      if (this.abortController?.signal.aborted) {
        const cancelledDelta: TokenDelta = {
          token: ' [cancelled]',
          index: tokenIndex++,
        };
        bus.emit({
          type: 'TokenDelta',
          token: cancelledDelta.token,
          index: cancelledDelta.index,
          timestamp: Date.now(),
        });
        yield cancelledDelta;
      } else {
        // Classify the error for better handling
        const errorCode: AgentErrorCode = isAuthError(err) ? 'AUTH_ERROR' : 'STREAM_FAILED';

        if (errorCode === 'AUTH_ERROR') {
          console.error('[Agent] Authentication error:', err);
          console.error('[Agent] Auth diagnostics:');
          console.error('  HOME:', process.env.HOME || homedir());
          console.error('  ANTHROPIC_API_KEY set:', !!process.env.ANTHROPIC_API_KEY);
          console.error('  ANTHROPIC_AUTH_TOKEN set:', !!process.env.ANTHROPIC_AUTH_TOKEN);
        }

        throw new AgentError(
          err instanceof Error ? err.message : String(err),
          errorCode,
          err
        );
      }
    } finally {
      this.queryInProgress = false;
      this.abortController = null;
    }
  }

  cancel(): void {
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
  }

  isQuerying(): boolean {
    return this.queryInProgress;
  }

  dispose(): void {
    this.cancel();
  }
}

let _instance: AgentServiceImpl | null = null;

export function getAgentService(): AgentService {
  return (_instance ??= new AgentServiceImpl());
}

export function resetAgentService(): void {
  if (_instance) {
    _instance.dispose();
    _instance = null;
  }
}
