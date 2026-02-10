import { query as sdkQuery } from '@anthropic-ai/claude-agent-sdk';
import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk';
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

type EventBus = ReturnType<typeof getEventBus>;

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
    const counters = { tokenIndex: 0, streamEventCount: 0 };

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
      for await (const message of queryStream) {
        messageCount++;
        const now = Date.now();

        for (const tokenDelta of this.handleSdkMessage(message, bus, now, counters)) {
          yield tokenDelta;
        }
      }
      debugLog('Agent', 'Query complete', { totalMessages: messageCount, streamEvents: counters.streamEventCount });
    } catch (err) {
      if (this.abortController?.signal.aborted) {
        yield this.emitCancelledDelta(bus, Date.now(), counters);
        return;
      }
      this.rethrowQueryError(err);
    } finally {
      debugLog('Agent', 'Query finally block, resetting state');
      this.queryInProgress = false;
      this.abortController = null;
    }
  }

  private handleSdkMessage(
    message: SDKMessage,
    bus: EventBus,
    now: number,
    counters: { tokenIndex: number; streamEventCount: number }
  ): TokenDelta[] {
    this.emitRawSdkMessage(bus, message, now);

    switch (message.type) {
      case 'stream_event':
        return this.handleStreamEventMessage(message, bus, now, counters);
      case 'assistant':
        this.handleAssistantMessage(message, bus, now);
        return [];
      case 'result':
        this.handleResultMessage(message, bus, now);
        return [];
      case 'system':
        this.handleSystemMessage(message, bus, now);
        return [];
      case 'tool_progress':
        this.handleToolProgressMessage(message, bus, now);
        return [];
      case 'tool_use_summary':
        this.handleToolUseSummaryMessage(message, bus, now);
        return [];
      case 'auth_status':
        this.handleAuthStatusMessage(message, bus, now);
        return [];
      default:
        debugLog('Agent', `Unhandled message type: ${(message as SDKMessage).type}`);
        return [];
    }
  }

  private emitRawSdkMessage(bus: EventBus, message: SDKMessage, now: number): void {
    bus.emit({
      type: 'RawSdkMessage',
      sdkMessageType: message.type,
      payload: message,
      timestamp: now,
    });
  }

  private handleStreamEventMessage(
    message: Extract<SDKMessage, { type: 'stream_event' }>,
    bus: EventBus,
    now: number,
    counters: { tokenIndex: number; streamEventCount: number }
  ): TokenDelta[] {
    counters.streamEventCount++;
    const event = message.event;

    if (counters.streamEventCount <= 5) {
      debugLog('Agent', `stream_event #${counters.streamEventCount}`, { eventType: event.type });
    }

    switch (event.type) {
      case 'message_start':
        this.emitMessageStart(event, bus, now);
        return [];
      case 'message_stop':
        this.emitMessageStop(bus, now);
        return [];
      case 'content_block_start':
        this.emitContentBlockStart(event, bus, now);
        return [];
      case 'content_block_stop':
        this.emitContentBlockStop(event, bus, now);
        return [];
      case 'content_block_delta':
        return this.handleContentBlockDelta(event, bus, now, counters);
      default:
        return [];
    }
  }

  private emitMessageStart(
    event: Extract<
      Extract<SDKMessage, { type: 'stream_event' }>['event'],
      { type: 'message_start' }
    >,
    bus: EventBus,
    now: number
  ): void {
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
  }

  private emitMessageStop(bus: EventBus, now: number): void {
    bus.emit({
      type: 'MessageStop',
      messageId: '', // SDK doesn't provide ID in stop event
      stopReason: 'end_turn', // Default, actual reason comes from assistant message
      timestamp: now,
    });
  }

  private emitContentBlockStart(
    event: Extract<
      Extract<SDKMessage, { type: 'stream_event' }>['event'],
      { type: 'content_block_start' }
    >,
    bus: EventBus,
    now: number
  ): void {
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
  }

  private emitContentBlockStop(
    event: Extract<
      Extract<SDKMessage, { type: 'stream_event' }>['event'],
      { type: 'content_block_stop' }
    >,
    bus: EventBus,
    now: number
  ): void {
    bus.emit({
      type: 'ContentBlockStop',
      index: event.index,
      timestamp: now,
    });
  }

  private handleContentBlockDelta(
    event: Extract<
      Extract<SDKMessage, { type: 'stream_event' }>['event'],
      { type: 'content_block_delta' }
    >,
    bus: EventBus,
    now: number,
    counters: { tokenIndex: number }
  ): TokenDelta[] {
    if (!('delta' in event)) {
      return [];
    }

    const delta = event.delta as { type: string; text?: string; thinking?: string };
    const tokenDelta = this.createTokenDeltaFromEvent(delta, counters);
    if (tokenDelta) {
      bus.emit({
        type: 'TokenDelta',
        token: tokenDelta.token,
        index: tokenDelta.index,
        timestamp: now,
      });
      return [tokenDelta];
    }

    if (delta.type === 'thinking_delta' && delta.thinking) {
      bus.emit({
        type: 'ThinkingDelta',
        thinking: delta.thinking,
        index: event.index,
        timestamp: now,
      });
    }

    return [];
  }

  private createTokenDeltaFromEvent(
    delta: { type: string; text?: string },
    counters: { tokenIndex: number }
  ): TokenDelta | null {
    if (delta.type !== 'text_delta' || !delta.text) {
      return null;
    }
    return {
      token: delta.text,
      index: counters.tokenIndex++,
    };
  }

  private handleAssistantMessage(
    message: Extract<SDKMessage, { type: 'assistant' }>,
    bus: EventBus,
    now: number
  ): void {
    debugLog('Agent', 'Assistant message received', { contentBlocks: message.message?.content?.length });
    const msg = message.message;

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
        }
        if (block.type === 'tool_use') {
          return {
            type: 'tool_use' as const,
            id: block.id,
            name: block.name,
            input: block.input,
          };
        }
        if (block.type === 'thinking') {
          return { type: 'thinking' as const, thinking: block.thinking };
        }
        return { type: block.type as 'text' };
      }),
      error: message.error,
      timestamp: now,
    });

    for (const block of msg.content) {
      if (block.type !== 'tool_use') {
        continue;
      }
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

  private handleResultMessage(
    message: Extract<SDKMessage, { type: 'result' }>,
    bus: EventBus,
    now: number
  ): void {
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
  }

  private handleSystemMessage(
    message: Extract<SDKMessage, { type: 'system' }>,
    bus: EventBus,
    now: number
  ): void {
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
      return;
    }

    if (message.subtype === 'status') {
      bus.emit({
        type: 'SystemStatus',
        status: message.status,
        permissionMode: message.permissionMode,
        timestamp: now,
      });
      return;
    }

    if (message.subtype === 'hook_started') {
      bus.emit({
        type: 'HookStarted',
        hookId: message.hook_id,
        hookName: message.hook_name,
        hookEvent: message.hook_event,
        timestamp: now,
      });
      return;
    }

    if (message.subtype === 'hook_progress') {
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
      return;
    }

    if (message.subtype === 'hook_response') {
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
      return;
    }

    if (message.subtype === 'task_notification') {
      bus.emit({
        type: 'TaskNotification',
        taskId: message.task_id,
        status: message.status,
        outputFile: message.output_file,
        summary: message.summary,
        timestamp: now,
      });
    }
  }

  private handleToolProgressMessage(
    message: Extract<SDKMessage, { type: 'tool_progress' }>,
    bus: EventBus,
    now: number
  ): void {
    bus.emit({
      type: 'ToolProgress',
      toolUseId: message.tool_use_id,
      toolName: message.tool_name,
      elapsedTimeSeconds: message.elapsed_time_seconds,
      timestamp: now,
    });
  }

  private handleToolUseSummaryMessage(
    message: Extract<SDKMessage, { type: 'tool_use_summary' }>,
    bus: EventBus,
    now: number
  ): void {
    bus.emit({
      type: 'ToolUseSummary',
      summary: message.summary,
      precedingToolUseIds: message.preceding_tool_use_ids,
      timestamp: now,
    });
  }

  private handleAuthStatusMessage(
    message: Extract<SDKMessage, { type: 'auth_status' }>,
    bus: EventBus,
    now: number
  ): void {
    bus.emit({
      type: 'AuthStatus',
      isAuthenticating: message.isAuthenticating,
      output: message.output,
      error: message.error,
      timestamp: now,
    });
  }

  private emitCancelledDelta(
    bus: EventBus,
    now: number,
    counters: { tokenIndex: number }
  ): TokenDelta {
    debugLog('Agent', 'Query cancelled by user');
    const cancelledDelta: TokenDelta = {
      token: ' [cancelled]',
      index: counters.tokenIndex++,
    };
    bus.emit({
      type: 'TokenDelta',
      token: cancelledDelta.token,
      index: cancelledDelta.index,
      timestamp: now,
    });
    return cancelledDelta;
  }

  private rethrowQueryError(err: unknown): never {
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
