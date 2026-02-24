import { createSession, getSupportedModels } from 'unifai';
import type { AgentEvent, UnifaiSession, Usage } from 'unifai';
import { homedir } from 'os';
import type { AgentService, AgentModelInfo, QueryOptions, AgentStreamEvent, StreamResult } from './types';
import type { QueryResultEvent, HookResponseEvent, TaskNotificationEvent } from '@/shared/event-types';
import type { EventBus } from '@/shared/event-bus';
import { getEventBus } from '@/shared/event-bus';
import { debugLog } from '@/shared/debug-log';
import { buildSdkEnv, isAuthError, AgentError } from './agent-instance';
import type { AgentErrorCode } from './agent-instance';

// Re-export for backward compatibility
export { AgentInstance, AgentError, buildSdkEnv, isAuthError } from './agent-instance';
export type { AgentInstanceOptions, AgentErrorCode } from './agent-instance';

function truncateStr(s: string, max = 80) {
  return s.length > max ? s.slice(0, max) + '...' : s;
}

/** Maps tool name → the arg key that best summarizes the invocation. */
const TOOL_SUMMARY_KEY: Record<string, string> = {
  Read: 'file_path', Edit: 'file_path', Write: 'file_path',
  Bash: 'command', Glob: 'pattern', Task: 'description',
};

/** Format tool input args into a human-readable one-liner for the activity trace. */
export function formatToolInput(name: string, input: unknown): string {
  const args = (input ?? {}) as Record<string, unknown>;
  const key = TOOL_SUMMARY_KEY[name];
  if (key) return truncateStr(String(args[key] ?? ''));
  if (name === 'Grep') {
    const suffix = args.path ? ` in ${args.path}` : '';
    return truncateStr(`${args.pattern ?? ''}${suffix}`);
  }
  return truncateStr(JSON.stringify(input ?? '').slice(0, 120));
}

const VALID_SUBTYPES: ReadonlySet<string> = new Set([
  'success', 'error_during_execution', 'error_max_turns',
  'error_max_budget_usd', 'error_max_structured_output_retries',
]);

function validSubtype(s: string | undefined): QueryResultEvent['subtype'] {
  return s && VALID_SUBTYPES.has(s) ? s as QueryResultEvent['subtype'] : 'success';
}

/** Map unifai Usage (camelCase) → workforce bus usage (with "Input" suffix). */
function toBusUsage(u: Usage) {
  return {
    inputTokens: u.inputTokens,
    outputTokens: u.outputTokens,
    cacheReadInputTokens: u.cacheReadTokens,
    cacheCreationInputTokens: u.cacheCreationTokens,
  };
}

class AgentServiceImpl implements AgentService {
  private abortController: AbortController | null = null;
  private queryInProgress = false;
  private session: UnifaiSession | null = null;
  private supportedModelsCache: AgentModelInfo[] | null = null;
  private supportedModelsCacheAt = 0;
  /** Whether the agent is currently in plan mode (between EnterPlanMode and ExitPlanMode). */
  private inPlanMode = false;
  /** Tracks the last Write to a .md file while in plan mode, used for plan detection. */
  private lastPlanPath: string | null = null;

  async *query(prompt: string, options?: QueryOptions): StreamResult<AgentStreamEvent> {
    debugLog('Agent', 'query() called', { queryInProgress: this.queryInProgress });

    if (this.queryInProgress) {
      debugLog('Agent', 'Query already in progress, rejecting');
      throw new AgentError('Query already in progress', 'UNKNOWN');
    }

    this.queryInProgress = true;
    this.abortController = new AbortController();
    this.lastPlanPath = null;
    this.inPlanMode = false;
    debugLog('Agent', 'Query started, set queryInProgress=true');
    const bus = getEventBus();
    let tokenIndex = 0;

    try {
      debugLog('Agent', 'Starting query', {
        prompt: prompt.slice(0, 100),
        options: {
          model: options?.model,
          maxThinkingTokens: options?.maxThinkingTokens,
          permissionMode: options?.permissionMode,
        },
      });

      this.session = createSession('claude', {
        model: options?.model ?? 'sonnet',
        sdkVersion: 'v1',
        cwd: process.cwd(),
        env: buildSdkEnv(),
        abortController: this.abortController,
        includePartialMessages: true,
        includeRawEvents: true,
        ...(options?.maxThinkingTokens !== undefined ? { maxThinkingTokens: options.maxThinkingTokens } : {}),
        ...(options?.permissionMode ? { permissionMode: options.permissionMode } : {}),
        ...(options?.permissionMode === 'bypassPermissions' ? { allowDangerouslySkipPermissions: true } : {}),
      });

      try {
        let lastMessageId = '';

        for await (const event of this.session.send(prompt)) {
          yield* this.handleEvent(event, bus, tokenIndex, lastMessageId);
          if (event.type === 'text_delta') tokenIndex++;
          if (event.type === 'message_start') lastMessageId = event.messageId;
        }
      } finally {
        this.session.close();
        this.session = null;
      }

      debugLog('Agent', 'Query complete');
    } catch (err) {
      yield* this.handleQueryError(err, bus, tokenIndex);
    } finally {
      debugLog('Agent', 'Query finally block, resetting state');
      this.queryInProgress = false;
      this.abortController = null;
    }
  }

  private *handleEvent(
    event: AgentEvent,
    bus: EventBus,
    tokenIndex: number,
    lastMessageId: string,
  ): Generator<AgentStreamEvent> {
    const now = Date.now();

    switch (event.type) {
      case 'text_delta':
        yield { type: 'token', token: event.text };
        break;
      case 'thinking_delta':
        bus.emit({ type: 'ThinkingDelta', thinking: event.text, index: event.index ?? 0, timestamp: now });
        break;
      case 'raw':
        bus.emit({ type: 'RawSdkMessage', sdkMessageType: event.eventType, payload: event.data, timestamp: now });
        break;
      default:
        this.emitBusEvent(event, bus, now, lastMessageId);
        // Yield stream events for tool activity and system status (keeps SSE alive + feeds UI trace)
        if (event.type === 'tool_start') {
          if (event.toolName === 'EnterPlanMode') this.inPlanMode = true;
          // Track last Write to .md file only while in plan mode
          if (this.inPlanMode && event.toolName === 'Write') {
            const filePath = String((event.input as Record<string, unknown>).file_path ?? '');
            if (filePath.endsWith('.md')) this.lastPlanPath = filePath;
          }
          // Detect ExitPlanMode → yield plan_ready
          if (event.toolName === 'ExitPlanMode' && this.lastPlanPath) {
            this.inPlanMode = false;
            yield { type: 'plan_ready', path: this.lastPlanPath };
            this.lastPlanPath = null;
          }
          yield { type: 'tool_start', name: event.toolName, input: formatToolInput(event.toolName, event.input) };
        } else if (event.type === 'status') {
          yield { type: 'status', message: event.message };
        }
        break;
    }
  }

  // eslint-disable-next-line complexity -- Flat dispatch to domain handlers; each case is a trivial delegation.
  private emitBusEvent(event: AgentEvent, bus: EventBus, now: number, lastMessageId: string) {
    switch (event.type) {
      case 'message_start':
      case 'message_stop':
      case 'content_block_start':
      case 'content_block_stop':
      case 'assistant_message':
        this.emitMessageEvent(event, bus, now, lastMessageId);
        break;
      case 'tool_start':
      case 'tool_progress':
      case 'tool_summary':
        this.emitToolEvent(event, bus, now);
        break;
      case 'session_init':
      case 'status':
      case 'session_complete':
      case 'auth_status':
      case 'error':
        this.emitLifecycleEvent(event, bus, now);
        break;
      case 'hook_started':
      case 'hook_progress':
      case 'hook_response':
      case 'task_notification':
        this.emitHookOrTaskEvent(event, bus, now);
        break;
      // text_complete, turn_complete, tool_result — intentionally unhandled
    }
  }

  private emitMessageEvent(
    event: Extract<AgentEvent, { type: 'message_start' | 'message_stop' | 'content_block_start' | 'content_block_stop' | 'assistant_message' }>,
    bus: EventBus,
    now: number,
    lastMessageId: string,
  ) {
    switch (event.type) {
      case 'message_start':
        bus.emit({ type: 'MessageStart', messageId: event.messageId, model: event.model, stopReason: event.stopReason, usage: toBusUsage(event.usage), timestamp: now });
        break;
      case 'message_stop':
        bus.emit({ type: 'MessageStop', messageId: lastMessageId, stopReason: 'end_turn', timestamp: now });
        break;
      case 'content_block_start':
        bus.emit({ type: 'ContentBlockStart', index: event.index, contentBlock: { type: event.blockType, id: event.id, name: event.name }, timestamp: now });
        break;
      case 'content_block_stop':
        bus.emit({ type: 'ContentBlockStop', index: event.index, timestamp: now });
        break;
      case 'assistant_message':
        debugLog('Agent', 'Assistant message received', { contentBlocks: event.content.length });
        bus.emit({
          type: 'AssistantMessage',
          messageId: event.messageId,
          uuid: event.uuid ?? '',
          sessionId: event.sessionId,
          model: event.model,
          stopReason: event.stopReason,
          usage: toBusUsage(event.usage),
          content: event.content,
          error: event.error,
          timestamp: now,
        });
        break;
    }
  }

  private emitToolEvent(
    event: Extract<AgentEvent, { type: 'tool_start' | 'tool_progress' | 'tool_summary' }>,
    bus: EventBus,
    now: number,
  ) {
    switch (event.type) {
      case 'tool_start':
        debugLog('Agent', 'Processing tool_use block', { toolName: event.toolName });
        bus.emit({ type: 'ToolStart', toolId: event.toolUseId, toolName: event.toolName, args: event.input, timestamp: now });
        break;
      case 'tool_progress':
        bus.emit({ type: 'ToolProgress', toolUseId: event.toolUseId, toolName: event.toolName, elapsedTimeSeconds: event.elapsedSeconds, timestamp: now });
        break;
      case 'tool_summary':
        bus.emit({ type: 'ToolUseSummary', summary: event.summary, precedingToolUseIds: event.precedingToolUseIds ?? [], timestamp: now });
        break;
    }
  }

  private emitLifecycleEvent(
    event: Extract<AgentEvent, { type: 'session_init' | 'status' | 'session_complete' | 'auth_status' | 'error' }>,
    bus: EventBus,
    now: number,
  ) {
    switch (event.type) {
      case 'session_init':
        debugLog('Agent', 'System init message received');
        bus.emit({
          type: 'SystemInit',
          claudeCodeVersion: event.claudeCodeVersion ?? '',
          cwd: event.cwd ?? '',
          model: event.model ?? '',
          tools: event.tools ?? [],
          mcpServers: event.mcpServers ?? [],
          permissionMode: event.permissionMode ?? '',
          slashCommands: event.slashCommands ?? [],
          skills: event.skills ?? [],
          sessionId: event.sessionId,
          timestamp: now,
        });
        break;
      case 'status':
        bus.emit({ type: 'SystemStatus', status: event.message === 'compacting' ? 'compacting' : null, permissionMode: event.permissionMode, timestamp: now });
        break;
      case 'session_complete':
        debugLog('Agent', 'Result message received', { subtype: event.subtype });
        this.emitSessionComplete(event, bus, now);
        break;
      case 'auth_status':
        bus.emit({ type: 'AuthStatus', isAuthenticating: event.isAuthenticating, output: event.output, error: event.error, timestamp: now });
        break;
      case 'error':
        bus.emit({ type: 'BridgeError', source: 'unifai', error: event.message, code: event.code, timestamp: now });
        break;
    }
  }

  private emitHookOrTaskEvent(
    event: Extract<AgentEvent, { type: 'hook_started' | 'hook_progress' | 'hook_response' | 'task_notification' }>,
    bus: EventBus,
    now: number,
  ) {
    switch (event.type) {
      case 'hook_started':
        bus.emit({ type: 'HookStarted', hookId: event.hookId, hookName: event.hookName, hookEvent: event.hookEvent, timestamp: now });
        break;
      case 'hook_progress':
        bus.emit({ type: 'HookProgress', hookId: event.hookId, hookName: event.hookName, hookEvent: event.hookEvent, stdout: event.stdout, stderr: event.stderr, output: event.output, timestamp: now });
        break;
      case 'hook_response': {
        // Cast to narrow member satisfies TS includes() signature; all three values are checked at runtime
        const outcome = (['success', 'error', 'cancelled'] as const).includes(event.outcome as 'success') ? event.outcome as HookResponseEvent['outcome'] : 'error';
        bus.emit({ type: 'HookResponse', hookId: event.hookId, hookName: event.hookName, hookEvent: event.hookEvent, outcome, output: event.output, exitCode: event.exitCode, timestamp: now });
        break;
      }
      case 'task_notification': {
        // Cast to narrow member satisfies TS includes() signature; all three values are checked at runtime
        const status = (['completed', 'failed', 'stopped'] as const).includes(event.status as 'completed') ? event.status as TaskNotificationEvent['status'] : 'failed';
        bus.emit({ type: 'TaskNotification', taskId: event.taskId, status, outputFile: event.outputFile, summary: event.summary, timestamp: now });
        break;
      }
    }
  }

  private emitSessionComplete(
    event: Extract<AgentEvent, { type: 'session_complete' }>,
    bus: EventBus,
    now: number,
  ) {
    bus.emit({
      type: 'QueryResult',
      subtype: validSubtype(event.subtype),
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

  private *handleQueryError(err: unknown, _bus: EventBus, _tokenIndex: number): Generator<AgentStreamEvent> {
    if (this.abortController?.signal.aborted) {
      debugLog('Agent', 'Query cancelled by user');
      yield { type: 'token', token: ' [cancelled]' };
      return;
    }

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

  async getSupportedModels(): Promise<AgentModelInfo[]> {
    const now = Date.now();
    if (this.supportedModelsCache && now - this.supportedModelsCacheAt < 5 * 60_000) {
      return this.supportedModelsCache;
    }

    try {
      const models = await getSupportedModels('claude', { cwd: process.cwd(), env: buildSdkEnv() });
      const normalized: AgentModelInfo[] = models.map((m) => ({
        id: m.id,
        displayName: m.displayName,
        description: m.description,
      }));
      this.supportedModelsCache = normalized;
      this.supportedModelsCacheAt = now;
      return normalized;
    } catch (err) {
      debugLog('Agent', 'getSupportedModels failed', { error: err instanceof Error ? err.message : String(err) });
      return [];
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
