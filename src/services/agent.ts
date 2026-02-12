import { query as sdkQuery } from '@anthropic-ai/claude-agent-sdk';
import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import { homedir } from 'os';
import type { AgentService, QueryOptions, TokenDelta, StreamResult } from './types';
import { getEventBus } from '@/shared/event-bus';
import { debugLog } from '@/shared/debug-log';
import { buildSdkEnv, isAuthError, AgentError } from './agent-instance';
import type { AgentErrorCode } from './agent-instance';

// Re-export for backward compatibility
export { AgentInstance, AgentError, buildSdkEnv, isAuthError } from './agent-instance';
export type { AgentInstanceOptions, AgentErrorCode } from './agent-instance';

class AgentServiceImpl implements AgentService {
  private abortController: AbortController | null = null;
  private queryInProgress = false;

  // eslint-disable-next-line complexity
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
        const now = Date.now();

        // Emit raw SDK message for advanced consumers
        bus.emit({
          type: 'RawSdkMessage',
          sdkMessageType: message.type,
          payload: message,
          timestamp: now,
        });

        // Handle each SDK message type
        switch (message.type) {
          case 'stream_event': {
            streamEventCount++;
            const event = message.event;

            if (streamEventCount <= 5) {
              debugLog('Agent', `stream_event #${streamEventCount}`, { eventType: event.type });
            }

            // Handle different stream event types
            switch (event.type) {
              case 'message_start': {
                const msg = event.message;
                bus.emit({
                  type: 'MessageStart',
                  messageId: msg.id,
                  model: msg.model,
                  stopReason: msg.stop_reason,
                  usage: {
                    inputTokens: msg.usage.input_tokens,
                    outputTokens: msg.usage.output_tokens,
                    cacheReadInputTokens: msg.usage.cache_read_input_tokens ?? undefined,
                    cacheCreationInputTokens: msg.usage.cache_creation_input_tokens ?? undefined,
                  },
                  timestamp: now,
                });
                break;
              }

              case 'message_stop': {
                bus.emit({
                  type: 'MessageStop',
                  messageId: '', // SDK doesn't provide ID in stop event
                  stopReason: 'end_turn', // Default, actual reason comes from assistant message
                  timestamp: now,
                });
                break;
              }

              case 'content_block_start': {
                const block = event.content_block;
                bus.emit({
                  type: 'ContentBlockStart',
                  index: event.index,
                  contentBlock: {
                    type: block.type as 'text' | 'tool_use' | 'thinking',
                    id: 'id' in block ? block.id : undefined,
                    name: 'name' in block ? block.name : undefined,
                    text: 'text' in block ? block.text : undefined,
                  },
                  timestamp: now,
                });
                break;
              }

              case 'content_block_stop': {
                bus.emit({
                  type: 'ContentBlockStop',
                  index: event.index,
                  timestamp: now,
                });
                break;
              }

              case 'content_block_delta': {
                // eslint-disable-next-line max-depth
                if ('delta' in event) {
                  const delta = event.delta as { type: string; text?: string; thinking?: string };

                  // eslint-disable-next-line max-depth
                  if (delta.type === 'text_delta' && delta.text) {
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
                  } else if (delta.type === 'thinking_delta' && delta.thinking) {
                    bus.emit({
                      type: 'ThinkingDelta',
                      thinking: delta.thinking,
                      index: event.index,
                      timestamp: now,
                    });
                  }
                }
                break;
              }
            }
            break;
          }

          case 'assistant': {
            debugLog('Agent', 'Assistant message received', { contentBlocks: message.message?.content?.length });
            const msg = message.message;

            // Emit full assistant message event
            bus.emit({
              type: 'AssistantMessage',
              messageId: msg.id,
              uuid: message.uuid,
              sessionId: message.session_id,
              model: msg.model,
              stopReason: msg.stop_reason,
              usage: {
                inputTokens: msg.usage.input_tokens,
                outputTokens: msg.usage.output_tokens,
                cacheReadInputTokens: msg.usage.cache_read_input_tokens ?? undefined,
                cacheCreationInputTokens: msg.usage.cache_creation_input_tokens ?? undefined,
              },
              content: msg.content.map((block: { type: string; text?: string; id?: string; name?: string; input?: unknown; thinking?: string }) => {
                if (block.type === 'text') {
                  return { type: 'text' as const, text: block.text };
                } else if (block.type === 'tool_use') {
                  return {
                    type: 'tool_use' as const,
                    id: block.id,
                    name: block.name,
                    input: block.input,
                  };
                } else if (block.type === 'thinking') {
                  return { type: 'thinking' as const, thinking: block.thinking };
                }
                return { type: block.type as 'text' };
              }),
              error: message.error,
              timestamp: now,
            });

            // Also emit individual ToolStart events for tool_use blocks
            for (const block of msg.content) {
              if (block.type === 'tool_use') {
                debugLog('Agent', 'Processing tool_use block', { toolName: block.name });
                bus.emit({
                  type: 'ToolStart',
                  toolId: block.id,
                  toolName: block.name,
                  args: block.input as Record<string, unknown>,
                  timestamp: now,
                });
              }
            }
            break;
          }

          case 'result': {
            debugLog('Agent', 'Result message received', { subtype: message.subtype });
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
            break;
          }

          case 'system': {
            // Handle system message subtypes
            if (message.subtype === 'init') {
              debugLog('Agent', 'System init message received');
              bus.emit({
                type: 'SystemInit',
                claudeCodeVersion: message.claude_code_version,
                cwd: message.cwd,
                model: message.model,
                tools: message.tools,
                mcpServers: message.mcp_servers,
                permissionMode: message.permissionMode,
                slashCommands: message.slash_commands,
                skills: message.skills,
                sessionId: message.session_id,
                timestamp: now,
              });
            } else if (message.subtype === 'status') {
              bus.emit({
                type: 'SystemStatus',
                status: message.status,
                permissionMode: message.permissionMode,
                timestamp: now,
              });
            } else if (message.subtype === 'hook_started') {
              bus.emit({
                type: 'HookStarted',
                hookId: message.hook_id,
                hookName: message.hook_name,
                hookEvent: message.hook_event,
                timestamp: now,
              });
            } else if (message.subtype === 'hook_progress') {
              bus.emit({
                type: 'HookProgress',
                hookId: message.hook_id,
                hookName: message.hook_name,
                hookEvent: message.hook_event,
                stdout: message.stdout,
                stderr: message.stderr,
                output: message.output,
                timestamp: now,
              });
            } else if (message.subtype === 'hook_response') {
              bus.emit({
                type: 'HookResponse',
                hookId: message.hook_id,
                hookName: message.hook_name,
                hookEvent: message.hook_event,
                outcome: message.outcome,
                output: message.output,
                exitCode: message.exit_code,
                timestamp: now,
              });
            } else if (message.subtype === 'task_notification') {
              bus.emit({
                type: 'TaskNotification',
                taskId: message.task_id,
                status: message.status,
                outputFile: message.output_file,
                summary: message.summary,
                timestamp: now,
              });
            }
            break;
          }

          case 'tool_progress': {
            bus.emit({
              type: 'ToolProgress',
              toolUseId: message.tool_use_id,
              toolName: message.tool_name,
              elapsedTimeSeconds: message.elapsed_time_seconds,
              timestamp: now,
            });
            break;
          }

          case 'tool_use_summary': {
            bus.emit({
              type: 'ToolUseSummary',
              summary: message.summary,
              precedingToolUseIds: message.preceding_tool_use_ids,
              timestamp: now,
            });
            break;
          }

          case 'auth_status': {
            bus.emit({
              type: 'AuthStatus',
              isAuthenticating: message.isAuthenticating,
              output: message.output,
              error: message.error,
              timestamp: now,
            });
            break;
          }

          default: {
            // Log unhandled message types for debugging
            debugLog('Agent', `Unhandled message type: ${(message as SDKMessage).type}`);
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

// =============================================================================
// Singleton AgentService (for main chat)
// =============================================================================

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
