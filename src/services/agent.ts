import { query as sdkQuery } from '@anthropic-ai/claude-agent-sdk';
import { homedir } from 'os';
import type { AgentService, QueryOptions, TokenDelta, StreamResult } from './types';
import { getEventBus } from '@shared/event-bus';
import { debugLog } from '@shared/debug-log';

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
    debugLog('Agent', 'query() called', { queryInProgress: this.queryInProgress });

    if (this.queryInProgress) {
      debugLog('Agent', 'Query already in progress, rejecting');
      throw new AgentError('Query already in progress', 'UNKNOWN');
    }

    this.queryInProgress = true;
    this.abortController = new AbortController();
    debugLog('Agent', 'Query started, set queryInProgress=true');
    const bus = getEventBus();
    let tokenIndex = 0;

    try {
      const sdkOptions = {
        abortController: this.abortController,
        cwd: process.cwd(),
        env: buildSdkEnv(),
        // Enable streaming events (content_block_delta) instead of just final messages
        includePartialMessages: true,
      };
      debugLog('Agent', 'Starting query', { prompt: prompt.slice(0, 100), options: { includePartialMessages: sdkOptions.includePartialMessages } });
      const queryStream = sdkQuery({
        prompt,
        options: sdkOptions,
      });

      let messageCount = 0;
      let streamEventCount = 0;
      for await (const message of queryStream) {
        messageCount++;

        // Log all messages to debug streaming
        const eventType = message.type === 'stream_event'
          ? (message as { event?: { type?: string } }).event?.type
          : undefined;

        if (message.type === 'stream_event') {
          streamEventCount++;
          if (streamEventCount <= 5) {
            debugLog('Agent', `stream_event #${streamEventCount}`, { eventType });
          }
        } else {
          debugLog('Agent', `Message #${messageCount}`, { type: message.type, eventType });
        }

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
          // Process tool_use blocks from assistant messages
          // Note: Text content is already streamed via content_block_delta events,
          // so we don't yield it again here to avoid duplication
          debugLog('Agent', 'Assistant message received', { contentBlocks: message.message?.content?.length });
          if (message.message?.content) {
            for (const block of message.message.content) {
              if (block.type === 'tool_use') {
                debugLog('Agent', 'Processing tool_use block', { toolName: block.name });
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
      debugLog('Agent', 'Query complete', { totalMessages: messageCount, streamEvents: streamEventCount });
    } catch (err) {
      if (this.abortController?.signal.aborted) {
        debugLog('Agent', 'Query cancelled by user');
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
          debugLog('Agent', 'Authentication error', {
            error: err instanceof Error ? err.message : String(err),
            HOME: process.env.HOME || homedir(),
            hasApiKey: !!process.env.ANTHROPIC_API_KEY,
            hasAuthToken: !!process.env.ANTHROPIC_AUTH_TOKEN,
          });
        } else {
          debugLog('Agent', 'Query error', { error: err instanceof Error ? err.message : String(err) });
        }

        throw new AgentError(
          err instanceof Error ? err.message : String(err),
          errorCode,
          err
        );
      }
    } finally {
      debugLog('Agent', 'Query finally block, resetting state');
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
