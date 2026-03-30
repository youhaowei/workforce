/* eslint-disable max-lines -- SDK event mapping adds unavoidable bulk; splitting would hurt cohesion. */
import { query as sdkQuery } from '@anthropic-ai/claude-agent-sdk';
import type { Query, PermissionResult, SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import { homedir } from 'os';
import type { AgentService, AgentModelInfo, AgentQuestion, RunOptions, AgentStreamEvent, StreamResult } from './types';
import type { QueryResultEvent, HookResponseEvent, TaskNotificationEvent } from '@/shared/event-types';
import type { EventBus } from '@/shared/event-bus';
import { getEventBus } from '@/shared/event-bus';
import { createLogger } from 'tracey';
import { buildSdkEnv, isAuthError, AgentError } from './agent-instance';
import type { AgentErrorCode } from './agent-instance';
import { ModelCache, readLastUsedModelSync, writeLastUsedModel } from './agent-models';
import { resolveClaudeCliPath } from './agent-cli-path';

const log = createLogger('Agent');

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

// =============================================================================
// SDK Event Mapping (ported from unifai providers/claude.ts)
// =============================================================================

/** Usage stats extracted from SDK messages. */
interface Usage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens?: number;
  cacheCreationTokens?: number;
}

/** Per-model usage breakdown from result messages. */
interface ModelUsage extends Usage {
  webSearchRequests?: number;
  costUsd?: number;
  contextWindow?: number;
  maxOutputTokens?: number;
}

/** Content block in an assistant message. */
type SdkContentBlock =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: unknown }
  | { type: 'thinking'; thinking: string };

/** Internal normalized event type (superset of AgentStreamEvent for bus emission). */
type AgentEvent =
  | { type: 'text_delta'; text: string }
  | { type: 'thinking_delta'; text: string; index?: number }
  | { type: 'text_complete'; text: string; isIntermediate?: boolean }
  | { type: 'message_start'; messageId: string; model: string; stopReason: string | null; usage: Usage }
  | { type: 'message_stop' }
  | { type: 'content_block_start'; index: number; blockType: string; id?: string; name?: string }
  | { type: 'content_block_stop'; index: number }
  | { type: 'tool_start'; toolUseId: string; toolName: string; input: unknown }
  | { type: 'tool_result'; toolUseId: string; toolName: string; result: unknown; isError: boolean }
  | { type: 'tool_progress'; toolUseId: string; toolName: string; elapsedSeconds: number }
  | { type: 'tool_summary'; summary: string; precedingToolUseIds?: string[] }
  | { type: 'assistant_message'; messageId: string; uuid?: string; sessionId: string; model: string; stopReason: string | null; usage: Usage; content: SdkContentBlock[]; error?: string }
  | { type: 'session_init'; sessionId: string; model?: string; tools?: string[]; cwd?: string; claudeCodeVersion?: string; mcpServers?: unknown[]; permissionMode?: string; slashCommands?: unknown[]; skills?: unknown[] }
  | { type: 'session_complete'; subtype?: string; result?: string; structuredOutput?: unknown; usage: Usage; durationMs: number; durationApiMs?: number; numTurns: number; costUsd?: number; modelUsage?: Record<string, ModelUsage>; errors?: string[] }
  | { type: 'status'; message: string; permissionMode?: string }
  | { type: 'auth_status'; isAuthenticating: boolean; output: string[]; error?: string }
  | { type: 'error'; message: string; code: string; recoverable: boolean }
  | { type: 'raw'; provider: string; eventType: string; data: unknown }
  | { type: 'hook_started'; hookId: string; hookName: string; hookEvent: string }
  | { type: 'hook_progress'; hookId: string; hookName: string; hookEvent: string; stdout: string; stderr: string; output: string }
  | { type: 'hook_response'; hookId: string; hookName: string; hookEvent: string; outcome: string; output: string; exitCode?: number }
  | { type: 'task_notification'; taskId: string; status: string; outputFile: string; summary: string }
  | { type: 'agent_question'; id: string; questions: AgentQuestion[] }
  | { type: 'agent_question_response'; id: string; answers: Record<string, string[]> }
  | { type: 'approval_request'; id: string; kind: 'command' | 'file_change'; description: string; detail: unknown }
  | { type: 'approval_response'; id: string; decision: string };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function extractUsage(raw: any): Usage {
  return {
    inputTokens: Number(raw?.input_tokens ?? 0),
    outputTokens: Number(raw?.output_tokens ?? 0),
    cacheReadTokens: raw?.cache_read_input_tokens != null ? Number(raw.cache_read_input_tokens) : undefined,
    cacheCreationTokens: raw?.cache_creation_input_tokens != null ? Number(raw.cache_creation_input_tokens) : undefined,
  };
}

/** Flush all pending tools as tool_result events (used at turn boundaries). */
function* flushPendingTools(pendingTools: Map<string, string>): Generator<AgentEvent> {
  for (const [toolUseId, toolName] of pendingTools) {
    yield { type: 'tool_result', toolUseId, toolName, result: undefined, isError: false };
  }
  pendingTools.clear();
}

/** Extract tool_result events from SDK "user" messages (tool responses). */
function* extractToolResults(msg: SDKMessage, pendingTools: Map<string, string>): Generator<AgentEvent> {
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

/** Map a single Claude SDK message to zero or more internal AgentEvents. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any, complexity
function* mapSdkMessage(msg: any, includeRaw: boolean): Generator<AgentEvent> {
  if (includeRaw) {
    yield { type: 'raw', provider: 'claude', eventType: String(msg.type), data: msg };
  }

  switch (msg.type) {
    case 'system':
      yield* mapSystemMessage(msg);
      break;
    case 'stream_event':
      yield* mapStreamEvent(msg);
      break;
    case 'assistant':
      yield* mapAssistantMessage(msg);
      break;
    case 'result':
      yield* mapResultMessage(msg);
      break;
    case 'tool_progress':
      yield { type: 'tool_progress', toolUseId: String(msg.tool_use_id ?? ''), toolName: String(msg.tool_name ?? ''), elapsedSeconds: Number(msg.elapsed_time_seconds ?? 0) };
      break;
    case 'tool_use_summary':
      yield { type: 'tool_summary', summary: String(msg.summary ?? ''), precedingToolUseIds: Array.isArray(msg.preceding_tool_use_ids) ? msg.preceding_tool_use_ids : undefined };
      break;
    case 'auth_status':
      yield { type: 'auth_status', isAuthenticating: Boolean(msg.isAuthenticating), output: Array.isArray(msg.output) ? msg.output : [], error: msg.error ? String(msg.error) : undefined };
      break;
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any, complexity
function* mapSystemMessage(msg: any): Generator<AgentEvent> {
  switch (msg.subtype) {
    case 'init':
      yield {
        type: 'session_init', sessionId: String(msg.session_id ?? ''), model: msg.model ? String(msg.model) : undefined,
        tools: Array.isArray(msg.tools) ? msg.tools : undefined, cwd: msg.cwd ? String(msg.cwd) : undefined,
        claudeCodeVersion: msg.claude_code_version ? String(msg.claude_code_version) : undefined,
        mcpServers: Array.isArray(msg.mcp_servers) ? msg.mcp_servers : undefined,
        permissionMode: msg.permissionMode ? String(msg.permissionMode) : undefined,
        slashCommands: Array.isArray(msg.slash_commands) ? msg.slash_commands : undefined,
        skills: Array.isArray(msg.skills) ? msg.skills : undefined,
      };
      break;
    case 'status':
      yield { type: 'status', message: msg.status ? String(msg.status) : 'status update', permissionMode: msg.permissionMode ? String(msg.permissionMode) : undefined };
      break;
    case 'hook_started':
      yield { type: 'hook_started', hookId: String(msg.hook_id ?? ''), hookName: String(msg.hook_name ?? ''), hookEvent: String(msg.hook_event ?? '') };
      break;
    case 'hook_progress':
      yield { type: 'hook_progress', hookId: String(msg.hook_id ?? ''), hookName: String(msg.hook_name ?? ''), hookEvent: String(msg.hook_event ?? ''), stdout: String(msg.stdout ?? ''), stderr: String(msg.stderr ?? ''), output: String(msg.output ?? '') };
      break;
    case 'hook_response':
      yield { type: 'hook_response', hookId: String(msg.hook_id ?? ''), hookName: String(msg.hook_name ?? ''), hookEvent: String(msg.hook_event ?? ''), outcome: String(msg.outcome ?? ''), output: String(msg.output ?? ''), exitCode: msg.exit_code != null ? Number(msg.exit_code) : undefined };
      break;
    case 'task_notification':
      yield { type: 'task_notification', taskId: String(msg.task_id ?? ''), status: String(msg.status ?? ''), outputFile: String(msg.output_file ?? ''), summary: String(msg.summary ?? '') };
      break;
    default:
      yield { type: 'status', message: `[${msg.subtype}] ${msg.summary ?? msg.message ?? ''}`.trim() };
      break;
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any, complexity
function* mapStreamEvent(msg: any): Generator<AgentEvent> {
  const event = msg.event;
  if (!event) return;

  switch (event.type) {
    case 'message_start': {
      const m = event.message;
      if (m) {
        yield { type: 'message_start', messageId: String(m.id ?? ''), model: String(m.model ?? ''), stopReason: m.stop_reason ?? null, usage: extractUsage(m.usage) };
      }
      break;
    }
    case 'message_stop':
      yield { type: 'message_stop' };
      break;
    case 'content_block_start': {
      const block = event.content_block;
      if (block) {
        yield { type: 'content_block_start', index: Number(event.index ?? 0), blockType: block.type as string, id: 'id' in block ? String(block.id) : undefined, name: 'name' in block ? String(block.name) : undefined };
      }
      break;
    }
    case 'content_block_stop':
      yield { type: 'content_block_stop', index: Number(event.index ?? 0) };
      break;
    case 'content_block_delta': {
      const delta = event.delta;
      if (!delta) return;
      if (delta.type === 'text_delta' && typeof delta.text === 'string') {
        yield { type: 'text_delta', text: delta.text };
      } else if (delta.type === 'thinking_delta') {
        const text = typeof delta.thinking === 'string' ? delta.thinking : String(delta.text ?? '');
        if (text) yield { type: 'thinking_delta', text, index: event.index != null ? Number(event.index) : undefined };
      }
      break;
    }
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function* mapAssistantMessage(msg: any): Generator<AgentEvent> {
  const m = msg.message;
  if (!m) return;
  const contentArr = m.content;
  if (!Array.isArray(contentArr)) return;

  const content: SdkContentBlock[] = contentArr.map((block: { type: string; text?: string; id?: string; name?: string; input?: unknown; thinking?: string }): SdkContentBlock => {
    if (block.type === 'text') return { type: 'text', text: block.text ?? '' };
    if (block.type === 'tool_use') return { type: 'tool_use', id: block.id ?? '', name: block.name ?? '', input: block.input };
    if (block.type === 'thinking') return { type: 'thinking', thinking: block.thinking ?? '' };
    return { type: 'text', text: '' };
  });

  yield {
    type: 'assistant_message', messageId: String(m.id ?? ''), uuid: msg.uuid ? String(msg.uuid) : undefined,
    sessionId: String(msg.session_id ?? ''), model: String(m.model ?? ''), stopReason: m.stop_reason ?? null,
    usage: extractUsage(m.usage), content, error: msg.error ? String(msg.error) : undefined,
  };

  for (const block of contentArr) {
    switch (block.type) {
      case 'text':
        yield { type: 'text_complete', text: String(block.text ?? '') };
        break;
      case 'tool_use':
        yield { type: 'tool_start', toolUseId: String(block.id ?? ''), toolName: String(block.name ?? ''), input: block.input };
        break;
    }
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any, complexity
function* mapResultMessage(msg: any): Generator<AgentEvent> {
  const usage = extractUsage(msg.usage);

  let modelUsage: Record<string, ModelUsage> | undefined;
  if (msg.modelUsage && typeof msg.modelUsage === 'object') {
    modelUsage = {};
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for (const [model, mu] of Object.entries(msg.modelUsage) as [string, any][]) {
      modelUsage[model] = {
        inputTokens: Number(mu.inputTokens ?? 0), outputTokens: Number(mu.outputTokens ?? 0),
        cacheReadTokens: Number(mu.cacheReadInputTokens ?? 0), cacheCreationTokens: Number(mu.cacheCreationInputTokens ?? 0),
        webSearchRequests: mu.webSearchRequests != null ? Number(mu.webSearchRequests) : undefined,
        costUsd: mu.costUSD != null ? Number(mu.costUSD) : undefined,
        contextWindow: mu.contextWindow != null ? Number(mu.contextWindow) : undefined,
        maxOutputTokens: mu.maxOutputTokens != null ? Number(mu.maxOutputTokens) : undefined,
      };
    }
  }

  yield {
    type: 'session_complete', subtype: msg.subtype ? String(msg.subtype) : undefined,
    result: msg.result != null ? String(msg.result) : undefined, structuredOutput: msg.structured_output,
    usage, durationMs: Number(msg.duration_ms ?? 0), durationApiMs: msg.duration_api_ms != null ? Number(msg.duration_api_ms) : undefined,
    numTurns: Number(msg.num_turns ?? 0), costUsd: msg.total_cost_usd != null ? Number(msg.total_cost_usd) : undefined,
    modelUsage, errors: Array.isArray(msg.errors) ? msg.errors : undefined,
  };

  if (msg.subtype && msg.subtype !== 'success') {
    const errors: string[] = Array.isArray(msg.errors) ? msg.errors : [];
    yield { type: 'error', message: errors.length > 0 ? errors.join('; ') : `Session ended with: ${msg.subtype}`, code: String(msg.subtype), recoverable: false };
  }
}

// =============================================================================
// canUseTool bridge (question + approval handling)
// =============================================================================

let nextInteractionId = 1;

type PendingQuestionResolver = (answers: Record<string, string[]>) => void;

export type ApprovalDecision = 'approve' | 'approve_session' | 'deny' | 'cancel';

interface CanUseToolHandlers {
  onQuestion: (request: { id: string; questions: AgentQuestion[] }) => Promise<{ answers: Record<string, string[]> }>;
  onApproval: (request: { id: string; toolName: string; input: unknown; description: string }) => Promise<ApprovalDecision>;
}

/**
 * Build the canUseTool callback that bridges the SDK's tool approval gate
 * to our question/approval handlers. This is called before every tool execution.
 */
function buildCanUseTool(
  handlers: CanUseToolHandlers,
// eslint-disable-next-line @typescript-eslint/no-explicit-any
): (toolName: string, input: any) => Promise<PermissionResult> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return async (toolName: string, input: any): Promise<PermissionResult> => {
    // Handle AskUserQuestion → route through onQuestion callback
    if (toolName === 'AskUserQuestion') {
      const questions: AgentQuestion[] = Array.isArray(input?.questions)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ? input.questions.map((q: any, i: number) => ({
            id: q.id ?? `q_${i}`,
            header: q.header ?? '',
            question: typeof q === 'string' ? q : (q.question ?? q.text ?? ''),
            freeform: true,
            secret: false,
            multiSelect: q.multiSelect ?? false,
            options: Array.isArray(q.options)
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              ? q.options.map((o: any) => ({
                  label: typeof o === 'string' ? o : (o.label ?? o.value ?? ''),
                  description: typeof o === 'string' ? '' : (o.description ?? ''),
                }))
              : undefined,
          }))
        : [];

      const requestId = `claude_input_${nextInteractionId++}`;

      const response = await handlers.onQuestion({ id: requestId, questions });

      // Map back to Claude format: answers keyed by question text
      const claudeAnswers: Record<string, string> = {};
      for (const [qId, answers] of Object.entries(response.answers)) {
        const question = questions.find((q) => q.id === qId);
        const key = question?.question ?? qId;
        claudeAnswers[key] = answers[0] ?? '';
      }

      return { behavior: 'allow', updatedInput: { ...input, answers: claudeAnswers } };
    }

    // All other tools: route through approval callback
    const approvalId = `claude_approval_${nextInteractionId++}`;
    const description = `Tool: ${toolName}`;

    const decision = await handlers.onApproval({ id: approvalId, toolName, input, description });

    if (decision === 'approve' || decision === 'approve_session') {
      return { behavior: 'allow', updatedInput: input };
    }
    return { behavior: 'deny', message: decision === 'cancel' ? 'Cancelled by user' : 'Denied by user' };
  };
}

/**
 * Process mapped SDK events: backfill text, track tool lifecycle, yield all events.
 * Extracted to keep `send()` nesting within eslint max-depth.
 */
function* processEventBatch(
  events: Iterable<AgentEvent>,
  streamedTextThisTurn: { value: boolean },
  pendingTools: Map<string, string>,
): Generator<AgentEvent> {
  for (const event of events) {
    if (event.type === 'message_start') streamedTextThisTurn.value = false;
    if (event.type === 'text_delta') streamedTextThisTurn.value = true;

    // Backfill text when stream events were suppressed (extended thinking)
    if (event.type === 'assistant_message' && !streamedTextThisTurn.value) {
      for (const block of event.content) {
        if (block.type === 'text' && block.text) {
          yield { type: 'content_block_start', index: 0, blockType: 'text' as const };
          yield { type: 'text_delta', text: block.text };
          yield { type: 'content_block_stop', index: 0 };
        }
      }
    }

    // Track tools from both assistant messages and stream events
    if (event.type === 'tool_start') {
      pendingTools.set(event.toolUseId, event.toolName);
    } else if (event.type === 'content_block_start' && event.blockType === 'tool_use' && event.id && event.name) {
      pendingTools.set(event.id, event.name);
    } else if (event.type === 'tool_result') {
      pendingTools.delete(event.toolUseId);
    }

    yield event;
  }
}

// =============================================================================
// SDK Session Wrapper
// =============================================================================

/** Thin wrapper around the SDK Query for lifecycle management. */
class SdkSession {
  private currentQuery: Query | null = null;
  private abortController: AbortController;
  private _sessionId: string | null = null;

  constructor(private readonly abortCtrl: AbortController) {
    this.abortController = abortCtrl;
  }

  get sessionId() { return this._sessionId; }

  /**
   * Send a message and stream back normalized AgentEvents.
   * Ports unifai's ClaudeV1ProviderSession.send() logic.
   */
  // eslint-disable-next-line complexity, max-depth -- SDK stream requires nested control flow for tool tracking
  async *send(
    message: string,
    options: {
      model?: string;
      permissionMode?: string;
      maxThinkingTokens?: number;
      allowDangerouslySkipPermissions?: boolean;
      cwd?: string;
      env?: Record<string, string | undefined>;
      includeRawEvents?: boolean;
    },
    canUseTool: (toolName: string, input: Record<string, unknown>) => Promise<PermissionResult>,
  ): AsyncGenerator<AgentEvent> {
    const sdkOptions = {
      model: options.model,
      abortController: this.abortController,
      includePartialMessages: true,
      cwd: options.cwd,
      env: options.env,
      permissionMode: options.permissionMode as 'default' | 'acceptEdits' | 'bypassPermissions' | 'plan' | 'dontAsk' | undefined,
      allowDangerouslySkipPermissions: options.allowDangerouslySkipPermissions,
      pathToClaudeCodeExecutable: resolveClaudeCliPath(),
      resume: this._sessionId ?? undefined,
      ...(options.maxThinkingTokens !== undefined ? { maxThinkingTokens: options.maxThinkingTokens } : {}),
      canUseTool,
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const stream = sdkQuery({ prompt: message, options: sdkOptions as any });
    this.currentQuery = stream;
    const includeRaw = options.includeRawEvents ?? false;

    // Track pending tools for result synthesis
    const pendingTools = new Map<string, string>(); // toolUseId → toolName
    const streamedTextThisTurn = { value: false };

    try {
      for await (const msg of stream) {

        // Track session ID from init
        if (msg.type === 'system' && (msg as SDKMessage & { subtype?: string }).subtype === 'init') {
          this._sessionId = (msg as SDKMessage & { session_id?: string }).session_id ?? null;
        }

        // Extract tool_result from SDK "user" messages
        if (msg.type === 'user') {
          yield* extractToolResults(msg, pendingTools);
        }

        // Synthesize tool_result at turn boundaries for unresolved tools
        if (msg.type === 'stream_event' && pendingTools.size > 0) {
          const se = msg as SDKMessage & { event?: { type?: string } };
          if (se.event?.type === 'message_start') {
            yield* flushPendingTools(pendingTools);
          }
        }

        yield* processEventBatch(mapSdkMessage(msg, includeRaw), streamedTextThisTurn, pendingTools);
      }

      // Complete remaining tools at stream end
      for (const [toolUseId, toolName] of pendingTools) {
        yield { type: 'tool_result', toolUseId, toolName, result: undefined, isError: false };
      }

    } finally {
      this.currentQuery = null;
    }
  }

  abort() {
    this.abortController.abort();
  }

  close() {
    if (this.currentQuery) {
      this.currentQuery.close();
      this.currentQuery = null;
    }
  }
}

// =============================================================================
// AgentService Implementation
// =============================================================================

/** Map internal Usage → workforce bus usage format. */
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
  private runInProgress = false;
  private session: SdkSession | null = null;
  private modelCache = new ModelCache();
  /** Whether the agent is currently in plan mode (between EnterPlanMode and ExitPlanMode). */
  private inPlanMode = false;
  /** Tracks the last Write to a .md file while in plan mode, used for plan detection. */
  private lastPlanPath: string | null = null;
  /** Pre-created session kept alive between queries for fast startup. */
  private warmSession: SdkSession | null = null;
  /** Model of the warm session (used to check reusability). */
  private warmSessionModel: string | null = null;
  /** Permission mode of the warm session (reuse only when it matches). */
  private warmSessionPermissionMode: string | null = null;

  /** Pending agent questions — keyed by requestId, resolved when UI submits answers. */
  private pendingQuestions = new Map<string, PendingQuestionResolver>();
  /** Questions data for pending requests — used to restore question on reconnect. */
  private pendingQuestionData = new Map<string, AgentQuestion[]>();
  /** Buffer for events emitted by the canUseTool callback (flushed in the query loop). */
  private pendingQuestionEvents: AgentStreamEvent[] = [];

  /** Pending tool approvals — keyed by requestId, resolved when UI submits decision. */
  private pendingApprovals = new Map<string, (decision: ApprovalDecision) => void>();
  /** Approval data for pending requests — used to restore on reconnect. */
  private pendingApprovalData = new Map<string, { toolName: string; input: unknown; description: string }>();
  /** Buffer for approval events (flushed in the query loop). */
  private pendingApprovalEvents: AgentStreamEvent[] = [];

  constructor() {
    this.warmUp();
  }

  /** Callback that blocks the agent stream until the user answers a question. */
  private handleAgentQuestion = (request: { id: string; questions: AgentQuestion[] }): Promise<{ answers: Record<string, string[]> }> => {
    return new Promise((resolve) => {
      this.pendingQuestionData.set(request.id, request.questions);
      this.pendingQuestions.set(request.id, (answers) => {
        this.pendingQuestions.delete(request.id);
        this.pendingQuestionData.delete(request.id);
        resolve({ answers });
      });
      this.pendingQuestionEvents.push({
        type: 'agent_question',
        requestId: request.id,
        questions: request.questions,
      });
    });
  };

  /** Callback that blocks the agent stream until the user approves/denies a tool. */
  private handleApprovalRequest = (request: { id: string; toolName: string; input: unknown; description: string }): Promise<ApprovalDecision> => {
    return new Promise((resolve) => {
      this.pendingApprovalData.set(request.id, {
        toolName: request.toolName,
        input: request.input,
        description: request.description,
      });
      this.pendingApprovals.set(request.id, (decision) => {
        this.pendingApprovals.delete(request.id);
        this.pendingApprovalData.delete(request.id);
        resolve(decision);
      });
      this.pendingApprovalEvents.push({
        type: 'approval_request',
        requestId: request.id,
        toolName: request.toolName,
        input: request.input,
        description: request.description,
      });
    });
  };

  /** Pre-create a session for fast startup. */
  private warmUp(): void {
    try {
      const model = readLastUsedModelSync() ?? 'sonnet';
      const abortCtrl = new AbortController();
      this.warmSession = new SdkSession(abortCtrl);
      this.warmSessionModel = model;
      log.info(`Pre-created warm session for fast startup (model: ${model})`);
    } catch (err) {
      log.error({ error: err instanceof Error ? err.message : String(err) }, 'Failed to pre-create warm session');
    }
  }

  /** Resolve or create the session for this query. Reuses warm session only when model + permission match. */
  private resolveSession(model: string, options?: RunOptions): SdkSession {
    const effectivePermission = options?.planMode ? 'plan' : (options?.permissionMode ?? 'default');

    if (this.warmSession && this.warmSessionModel === model && this.warmSessionPermissionMode === effectivePermission) {
      const session = this.warmSession;
      this.warmSession = null;
      this.warmSessionModel = null;
      this.warmSessionPermissionMode = null;
      log.info({ model }, 'Reusing warm session');
      return session;
    }

    if (this.warmSession) {
      this.warmSession.close();
      this.warmSession = null;
      this.warmSessionModel = null;
      this.warmSessionPermissionMode = null;
    }

    return new SdkSession(this.abortController ?? new AbortController());
  }

  async *run(prompt: string, options?: RunOptions): StreamResult<AgentStreamEvent> {
    if (this.runInProgress) {
      throw new AgentError('Run already in progress', 'UNKNOWN');
    }

    this.runInProgress = true;
    this.abortController = new AbortController();
    this.lastPlanPath = null;
    this.inPlanMode = false;
    const bus = getEventBus();
    let tokenIndex = 0;
    const model = options?.model ?? 'sonnet';

    try {
      writeLastUsedModel(model);
      this.session = this.resolveSession(model, options);

      // Build canUseTool with question + approval handling
      const canUseTool = buildCanUseTool({
        onQuestion: this.handleAgentQuestion,
        onApproval: this.handleApprovalRequest,
      });

      try {
        let lastMessageId = '';
        for await (const event of this.session.send(prompt, {
          model,
          permissionMode: options?.planMode ? 'plan' : options?.permissionMode,
          maxThinkingTokens: options?.maxThinkingTokens,
          allowDangerouslySkipPermissions: options?.permissionMode === 'bypassPermissions' || undefined,
          env: buildSdkEnv(),
          includeRawEvents: true,
        }, canUseTool)) {
          yield* this.handleEvent(event, bus, tokenIndex, lastMessageId);
          if (event.type === 'text_delta') tokenIndex++;
          if (event.type === 'message_start') lastMessageId = event.messageId;
        }
      } finally {
        if (!this.abortController?.signal.aborted && this.session) {
          this.warmSession = this.session;
          this.warmSessionModel = model;
          this.warmSessionPermissionMode = options?.planMode ? 'plan' : (options?.permissionMode ?? 'default');
        } else if (this.session) {
          this.session.close();
        }
        this.session = null;
      }
    } catch (err) {
      yield* this.handleRunError(err, bus, tokenIndex);
    } finally {
      this.runInProgress = false;
      this.abortController = null;
    }
  }

  private *handleEvent(
    event: AgentEvent,
    bus: EventBus,
    tokenIndex: number,
    lastMessageId: string,
  ): Generator<AgentStreamEvent> {
    // Flush any events buffered by the canUseTool callback (questions + approvals)
    while (this.pendingQuestionEvents.length > 0) {
      yield this.pendingQuestionEvents.shift()!;
    }
    while (this.pendingApprovalEvents.length > 0) {
      yield this.pendingApprovalEvents.shift()!;
    }

    const now = Date.now();

    switch (event.type) {
      case 'text_delta':
        yield { type: 'token', token: event.text };
        break;
      case 'thinking_delta':
        bus.emit({ type: 'ThinkingDelta', thinking: event.text, index: event.index ?? 0, timestamp: now });
        yield { type: 'thinking_delta', text: event.text };
        break;
      case 'raw':
        bus.emit({ type: 'RawSdkMessage', sdkMessageType: event.eventType, payload: event.data, timestamp: now });
        break;
      default:
        this.emitBusEvent(event, bus, now, lastMessageId);
        yield* this.yieldStreamEvents(event);
        break;
    }
  }

  /** Yield stream events for tool activity, content blocks, and system status. */
  private *yieldStreamEvents(event: AgentEvent): Generator<AgentStreamEvent> {
    if (event.type === 'assistant_message') {
      yield { type: 'turn_complete' };
    } else if (event.type === 'tool_start') {
      yield* this.handleToolStartEvent(event);
    } else if (event.type === 'tool_result') {
      yield { type: 'tool_result', toolUseId: event.toolUseId, toolName: event.toolName, result: event.result, isError: event.isError };
    } else if (event.type === 'content_block_start') {
      yield { type: 'content_block_start', index: event.index, blockType: event.blockType, id: event.id, name: event.name };
    } else if (event.type === 'content_block_stop') {
      yield { type: 'content_block_stop', index: event.index };
    } else if (event.type === 'status') {
      yield { type: 'status', message: event.message };
    }
  }

  /** Handle tool_start: plan mode tracking + yield tool_start event. */
  private *handleToolStartEvent(event: AgentEvent & { type: 'tool_start' }): Generator<AgentStreamEvent> {
    if (event.toolName === 'EnterPlanMode') this.inPlanMode = true;
    if (this.inPlanMode && event.toolName === 'Write') {
      const filePath = String((event.input as Record<string, unknown>).file_path ?? '');
      if (filePath.endsWith('.md')) this.lastPlanPath = filePath;
    }
    if (event.toolName === 'ExitPlanMode' && this.lastPlanPath) {
      this.inPlanMode = false;
      yield { type: 'plan_ready', path: this.lastPlanPath };
      this.lastPlanPath = null;
    }
    yield { type: 'tool_start', name: event.toolName, input: formatToolInput(event.toolName, event.input), toolUseId: event.toolUseId, inputRaw: event.input };
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
      case 'tool_result':
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
        bus.emit({ type: 'ContentBlockStart', index: event.index, contentBlock: { type: event.blockType as 'text' | 'tool_use' | 'thinking', id: event.id, name: event.name }, timestamp: now });
        break;
      case 'content_block_stop':
        bus.emit({ type: 'ContentBlockStop', index: event.index, timestamp: now });
        break;
      case 'assistant_message':
        log.info({ contentBlocks: event.content.length }, 'Assistant message received');
        bus.emit({
          type: 'AssistantMessage', messageId: event.messageId, uuid: event.uuid ?? '', sessionId: event.sessionId,
          model: event.model, stopReason: event.stopReason, usage: toBusUsage(event.usage),
          content: event.content, error: event.error, timestamp: now,
        });
        break;
    }
  }

  private emitToolEvent(
    event: Extract<AgentEvent, { type: 'tool_start' | 'tool_progress' | 'tool_summary' | 'tool_result' }>,
    bus: EventBus,
    now: number,
  ) {
    switch (event.type) {
      case 'tool_start':
        log.info({ toolName: event.toolName }, 'Processing tool_use block');
        bus.emit({ type: 'ToolStart', toolId: event.toolUseId, toolName: event.toolName, args: event.input, timestamp: now });
        break;
      case 'tool_progress':
        bus.emit({ type: 'ToolProgress', toolUseId: event.toolUseId, toolName: event.toolName, elapsedTimeSeconds: event.elapsedSeconds, timestamp: now });
        break;
      case 'tool_summary':
        bus.emit({ type: 'ToolUseSummary', summary: event.summary, precedingToolUseIds: event.precedingToolUseIds ?? [], timestamp: now });
        break;
      case 'tool_result':
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
        log.info('System init message received');
        bus.emit({
          type: 'SystemInit', claudeCodeVersion: event.claudeCodeVersion ?? '', cwd: event.cwd ?? '',
          model: event.model ?? '', tools: (event.tools ?? []) as string[],
          mcpServers: (event.mcpServers ?? []) as Array<{ name: string; status: string }>,
          permissionMode: event.permissionMode ?? '',
          slashCommands: (event.slashCommands ?? []) as string[],
          skills: (event.skills ?? []) as string[], sessionId: event.sessionId, timestamp: now,
        });
        break;
      case 'status':
        bus.emit({ type: 'SystemStatus', status: event.message === 'compacting' ? 'compacting' : null, permissionMode: event.permissionMode, timestamp: now });
        break;
      case 'session_complete':
        log.info({ subtype: event.subtype }, 'Result message received');
        this.emitSessionComplete(event, bus, now);
        break;
      case 'auth_status':
        bus.emit({ type: 'AuthStatus', isAuthenticating: event.isAuthenticating, output: event.output, error: event.error, timestamp: now });
        break;
      case 'error':
        bus.emit({ type: 'BridgeError', source: 'sdk', error: event.message, code: event.code, timestamp: now });
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
        const outcome = (['success', 'error', 'cancelled'] as const).includes(event.outcome as 'success') ? event.outcome as HookResponseEvent['outcome'] : 'error';
        bus.emit({ type: 'HookResponse', hookId: event.hookId, hookName: event.hookName, hookEvent: event.hookEvent, outcome, output: event.output, exitCode: event.exitCode, timestamp: now });
        break;
      }
      case 'task_notification': {
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
      type: 'QueryResult', subtype: validSubtype(event.subtype), durationMs: event.durationMs,
      durationApiMs: event.durationApiMs ?? 0, numTurns: event.numTurns, totalCostUsd: event.costUsd ?? 0,
      result: event.result, structuredOutput: event.structuredOutput,
      usage: {
        inputTokens: event.usage.inputTokens, outputTokens: event.usage.outputTokens,
        cacheReadInputTokens: event.usage.cacheReadTokens ?? 0, cacheCreationInputTokens: event.usage.cacheCreationTokens ?? 0,
      },
      modelUsage: event.modelUsage
        ? Object.fromEntries(
            Object.entries(event.modelUsage).map(([model, mu]) => [model, {
              inputTokens: mu.inputTokens, outputTokens: mu.outputTokens,
              cacheReadInputTokens: mu.cacheReadTokens ?? 0, cacheCreationInputTokens: mu.cacheCreationTokens ?? 0,
              webSearchRequests: mu.webSearchRequests ?? 0, costUSD: mu.costUsd ?? 0,
              contextWindow: mu.contextWindow ?? 0, maxOutputTokens: mu.maxOutputTokens ?? 0,
            }])
          )
        : {},
      errors: event.errors, timestamp: now,
    });
  }

  private *handleRunError(err: unknown, _bus: EventBus, _tokenIndex: number): Generator<AgentStreamEvent> {
    if (this.abortController?.signal.aborted) {
      log.info('Query cancelled by user');
      yield { type: 'token', token: ' [cancelled]' };
      return;
    }

    const errorCode: AgentErrorCode = isAuthError(err) ? 'AUTH_ERROR' : 'STREAM_FAILED';

    if (errorCode === 'AUTH_ERROR') {
      log.error({
        error: err instanceof Error ? err.message : String(err),
        HOME: process.env.HOME || homedir(),
        hasApiKey: !!process.env.ANTHROPIC_API_KEY,
        hasAuthToken: !!process.env.ANTHROPIC_AUTH_TOKEN,
      }, 'Authentication error');
    } else {
      log.error({ error: err instanceof Error ? err.message : String(err) }, 'Query error');
    }

    throw new AgentError(err instanceof Error ? err.message : String(err), errorCode, err);
  }

  async getSupportedModels(): Promise<AgentModelInfo[]> {
    return this.modelCache.getSupportedModels();
  }

  submitAnswer(requestId: string, answers: Record<string, string[]>): void {
    const resolve = this.pendingQuestions.get(requestId);
    if (resolve) {
      resolve(answers);
    } else {
      log.warn({ requestId }, 'submitAnswer: no pending question');
    }
  }

  getPendingQuestion(): { requestId: string; questions: AgentQuestion[] } | null {
    for (const [requestId, questions] of this.pendingQuestionData) {
      return { requestId, questions };
    }
    return null;
  }

  submitApproval(requestId: string, decision: ApprovalDecision): void {
    const resolve = this.pendingApprovals.get(requestId);
    if (resolve) {
      resolve(decision);
    } else {
      log.warn({ requestId }, 'submitApproval: no pending approval');
    }
  }

  getPendingApproval(): { requestId: string; toolName: string; input: unknown; description: string } | null {
    for (const [requestId, data] of this.pendingApprovalData) {
      return { requestId, ...data };
    }
    return null;
  }

  cancel(): void {
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
    // Drain pending questions
    for (const resolve of this.pendingQuestions.values()) {
      resolve({});
    }
    this.pendingQuestions.clear();
    this.pendingQuestionData.clear();
    this.pendingQuestionEvents.length = 0;
    // Drain pending approvals
    for (const resolve of this.pendingApprovals.values()) {
      resolve('cancel');
    }
    this.pendingApprovals.clear();
    this.pendingApprovalData.clear();
    this.pendingApprovalEvents.length = 0;

    if (this.session) {
      this.session.abort();
    }
  }

  isRunning(): boolean {
    return this.runInProgress;
  }

  dispose(): void {
    this.cancel();
    if (this.warmSession) {
      this.warmSession.close();
      this.warmSession = null;
      this.warmSessionModel = null;
      this.warmSessionPermissionMode = null;
    }
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
