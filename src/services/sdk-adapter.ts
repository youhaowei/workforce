/**
 * SDK Adapter — thin bridge between Claude Agent SDK's `query()` and
 * Workforce's `AgentStreamEvent` / `EventBus` types.
 *
 * Responsibilities:
 * - SDKMessage → AgentStreamEvent mapping
 * - SDKMessage → EventBus event mapping (optional)
 * - Tool name registry: tool_use_id → toolName
 * - Orphaned tool completion: synthetic error tool_result for dangling IDs
 * - Text delta backfill when stream_event messages are suppressed
 */

import {
  query as sdkQuery,
  type Options as SDKOptions,
  type Query,
  type CanUseTool,
  type PermissionResult,
} from "@anthropic-ai/claude-agent-sdk";
import type { AgentStreamEvent, Result } from "./types";
import type { EventBus } from "@/shared/event-bus";
import type { QueryResultEvent } from "@/shared/event-types";
import { createLogger } from "tracey";

const logger = createLogger("sdk-adapter");

// ---------------------------------------------------------------------------
// Error types
// ---------------------------------------------------------------------------

/** Tagged error for SDK adapter failures at the service boundary. */
export class SDKAdapterError extends Error {
  readonly _tag = "SDKAdapterError" as const;
  readonly cause?: unknown;

  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = "SDKAdapterError";
    this.cause = cause;
  }
}

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface SDKAdapterOptions {
  /** SDK options passed through to query(). */
  sdkOptions: Omit<SDKOptions, "canUseTool">;
  /** Optional EventBus for broadcasting raw SDK events. */
  eventBus?: EventBus;
  /**
   * Simplified approval callback — maps to SDK's canUseTool.
   * Return "approve" or "deny".
   */
  onApprovalRequest?: ApprovalCallback;
}

// ---------------------------------------------------------------------------
// Approval bridge
// ---------------------------------------------------------------------------

/** Callback signature for the simplified approval bridge. */
export type ApprovalCallback = (request: {
  description: string;
  detail: unknown;
  /** AbortSignal from the SDK — lets async handlers short-circuit on abort. */
  signal?: AbortSignal;
  toolUseID?: string;
}) => Promise<"approve" | "deny">;

/** Bridge a simple approve/deny callback to the SDK's CanUseTool signature. */
export function bridgeApproval(fn: ApprovalCallback): CanUseTool {
  return async (
    toolName: string,
    input: Record<string, unknown>,
    options?: { signal?: AbortSignal; toolUseID?: string },
  ): Promise<PermissionResult> => {
    try {
      const decision = await fn({
        description: `Tool: ${toolName}`,
        detail: input,
        signal: options?.signal,
        toolUseID: options?.toolUseID,
      });
      if (decision === "approve") {
        return { behavior: "allow", updatedInput: input };
      }
      return { behavior: "deny", message: "Denied by approval handler" };
    } catch (err) {
      logger.warn({ err, toolName }, "Approval callback threw — denying");
      return { behavior: "deny", message: "Approval callback error" };
    }
  };
}

// ---------------------------------------------------------------------------
// SDKMessage → AgentStreamEvent mapping
// ---------------------------------------------------------------------------

/**
 * Tool name registry — maps tool_use_id to toolName.
 * Populated from assistant messages (tool_use content blocks) and
 * stream_event content_block_start events.
 */
type ToolRegistry = Map<string, string>;

/* eslint-disable @typescript-eslint/no-explicit-any */

/** Map a single SDK message to zero or more AgentStreamEvents. */
export function* mapSdkToStreamEvents(
  msg: any,
  toolRegistry: ToolRegistry,
): Generator<AgentStreamEvent> {
  switch (msg.type) {
    case "system":
      yield* mapSystemMessage(msg);
      break;
    case "stream_event":
      yield* mapStreamEvent(msg, toolRegistry);
      break;
    case "assistant":
      yield* mapAssistantMessage(msg, toolRegistry);
      break;
    case "user":
      yield* mapUserMessage(msg, toolRegistry);
      break;
    case "result":
      // Result signals end of query — no stream event needed
      break;
  }
}

function* mapSystemMessage(msg: any): Generator<AgentStreamEvent> {
  if (msg.subtype === "init") {
    yield { type: "status", message: "Session initialized" };
  } else if (msg.subtype === "status") {
    yield { type: "status", message: msg.status ?? "status update" };
  }
}

function* mapContentBlockStart(
  event: any,
  toolRegistry: ToolRegistry,
): Generator<AgentStreamEvent> {
  const block = event.content_block;
  if (!block) return;
  yield {
    type: "content_block_start",
    index: Number(event.index ?? 0),
    blockType: block.type as string,
    id: "id" in block ? String(block.id) : undefined,
    name: "name" in block ? String(block.name) : undefined,
  };
  if (block.type === "tool_use" && block.id && block.name) {
    toolRegistry.set(String(block.id), String(block.name));
  }
}

function* mapContentBlockDelta(event: any): Generator<AgentStreamEvent> {
  const delta = event.delta;
  if (!delta) return;
  if (delta.type === "text_delta" && typeof delta.text === "string") {
    yield { type: "token", token: delta.text };
  } else if (delta.type === "thinking_delta") {
    const text = typeof delta.thinking === "string" ? delta.thinking : String(delta.text ?? "");
    if (text) yield { type: "thinking_delta", text };
  }
}

function* mapStreamEvent(msg: any, toolRegistry: ToolRegistry): Generator<AgentStreamEvent> {
  const event = msg.event;
  if (!event) return;

  switch (event.type) {
    case "content_block_start":
      yield* mapContentBlockStart(event, toolRegistry);
      break;
    case "content_block_stop":
      yield { type: "content_block_stop", index: Number(event.index ?? 0) };
      break;
    case "content_block_delta":
      yield* mapContentBlockDelta(event);
      break;
    case "message_stop":
      yield { type: "turn_complete" };
      break;
  }
}

function* mapAssistantMessage(msg: any, toolRegistry: ToolRegistry): Generator<AgentStreamEvent> {
  const m = msg.message;
  if (!m) return;
  const contentArr = m.content;
  if (!Array.isArray(contentArr)) return;

  for (const block of contentArr) {
    if (block.type === "tool_use") {
      const toolUseId = String(block.id ?? "");
      const toolName = String(block.name ?? "");
      if (toolUseId) toolRegistry.set(toolUseId, toolName);
      yield {
        type: "tool_start",
        name: toolName,
        toolUseId,
        input: JSON.stringify(block.input ?? {}),
        inputRaw: block.input,
      };
    }
  }
}

/** Extract tool_result from SDK "user" messages (tool execution results). */
function* mapUserMessage(msg: any, toolRegistry: ToolRegistry): Generator<AgentStreamEvent> {
  const content = msg.message?.content;
  if (!Array.isArray(content)) return;

  for (const block of content) {
    if (block.type === "tool_result" && block.tool_use_id) {
      const toolUseId = String(block.tool_use_id);
      const toolName = toolRegistry.get(toolUseId) ?? "";
      toolRegistry.delete(toolUseId);
      yield {
        type: "tool_result",
        toolUseId,
        toolName,
        result: block.content,
        isError: !!block.is_error,
      };
    }
  }
}

/* eslint-enable @typescript-eslint/no-explicit-any */

// ---------------------------------------------------------------------------
// SDKMessage → EventBus mapping (optional)
// ---------------------------------------------------------------------------

/* eslint-disable @typescript-eslint/no-explicit-any */

function emitSystemToBus(bus: EventBus, msg: any, now: number): void {
  if (msg.subtype === "init") {
    bus.emit({
      type: "SystemInit",
      claudeCodeVersion: String(msg.claude_code_version ?? ""),
      cwd: String(msg.cwd ?? ""),
      model: String(msg.model ?? ""),
      tools: Array.isArray(msg.tools) ? msg.tools : [],
      mcpServers: Array.isArray(msg.mcp_servers) ? msg.mcp_servers : [],
      permissionMode: String(msg.permissionMode ?? ""),
      slashCommands: Array.isArray(msg.slash_commands) ? msg.slash_commands : [],
      skills: Array.isArray(msg.skills) ? msg.skills : [],
      sessionId: String(msg.session_id ?? ""),
      timestamp: now,
    });
  } else if (msg.subtype === "status") {
    bus.emit({
      type: "SystemStatus",
      status: msg.status ?? null,
      permissionMode: msg.permissionMode,
      timestamp: now,
    });
  }
}

// eslint-disable-next-line complexity -- pure data mapping, branches are field coercions
function emitStreamEventToBus(bus: EventBus, event: any, now: number): void {
  switch (event.type) {
    case "content_block_start":
      if (event.content_block)
        bus.emit({
          type: "ContentBlockStart",
          index: Number(event.index ?? 0),
          contentBlock: event.content_block,
          timestamp: now,
        });
      break;
    case "content_block_stop":
      bus.emit({ type: "ContentBlockStop", index: Number(event.index ?? 0), timestamp: now });
      break;
    case "content_block_delta":
      if (event.delta?.type === "thinking_delta") {
        bus.emit({
          type: "ThinkingDelta",
          thinking:
            typeof event.delta.thinking === "string"
              ? event.delta.thinking
              : String(event.delta.text ?? ""),
          index: Number(event.index ?? 0),
          timestamp: now,
        });
      }
      break;
    case "message_start":
      if (event.message) {
        const m = event.message;
        bus.emit({
          type: "MessageStart",
          messageId: String(m.id ?? ""),
          model: String(m.model ?? ""),
          stopReason: m.stop_reason ?? null,
          usage: {
            inputTokens: Number(m.usage?.input_tokens ?? 0),
            outputTokens: Number(m.usage?.output_tokens ?? 0),
          },
          timestamp: now,
        });
      }
      break;
    case "message_stop":
      bus.emit({
        type: "MessageStop",
        messageId: "",
        stopReason: event.message?.stop_reason ?? "end_turn",
        timestamp: now,
      });
      break;
  }
}

/** Map SDK per-model usage to EventBus shape (both camelCase, same fields). */
function mapModelUsage(raw: unknown): QueryResultEvent["modelUsage"] {
  if (!raw || typeof raw !== "object") return {};
  const result: QueryResultEvent["modelUsage"] = {};
  for (const [model, mu] of Object.entries(raw as Record<string, Record<string, unknown>>)) {
    result[model] = {
      inputTokens: Number(mu.inputTokens ?? 0),
      outputTokens: Number(mu.outputTokens ?? 0),
      cacheReadInputTokens: Number(mu.cacheReadInputTokens ?? 0),
      cacheCreationInputTokens: Number(mu.cacheCreationInputTokens ?? 0),
      webSearchRequests: Number(mu.webSearchRequests ?? 0),
      costUSD: Number(mu.costUSD ?? 0),
      contextWindow: Number(mu.contextWindow ?? 0),
      maxOutputTokens: Number(mu.maxOutputTokens ?? 0),
    };
  }
  return result;
}

// eslint-disable-next-line complexity -- pure data mapping, branches are field coercions
function emitResultToBus(bus: EventBus, msg: any, now: number): void {
  bus.emit({
    type: "QueryResult",
    subtype: msg.subtype ?? "success",
    durationMs: Number(msg.duration_ms ?? 0),
    durationApiMs: Number(msg.duration_api_ms ?? 0),
    numTurns: Number(msg.num_turns ?? 0),
    totalCostUsd: Number(msg.total_cost_usd ?? 0),
    result: msg.result != null ? String(msg.result) : undefined,
    usage: {
      inputTokens: Number(msg.usage?.input_tokens ?? 0),
      outputTokens: Number(msg.usage?.output_tokens ?? 0),
      cacheReadInputTokens: Number(msg.usage?.cache_read_input_tokens ?? 0),
      cacheCreationInputTokens: Number(msg.usage?.cache_creation_input_tokens ?? 0),
    },
    modelUsage: mapModelUsage(msg.modelUsage),
    errors: Array.isArray(msg.errors) ? msg.errors : undefined,
    timestamp: now,
  });
}

function emitToBus(bus: EventBus, msg: any): void {
  const now = Date.now();
  switch (msg.type) {
    case "system":
      emitSystemToBus(bus, msg, now);
      break;
    case "stream_event":
      if (msg.event) emitStreamEventToBus(bus, msg.event, now);
      break;
    case "result":
      emitResultToBus(bus, msg, now);
      break;
    case "tool_progress":
      bus.emit({
        type: "ToolProgress",
        toolUseId: String(msg.tool_use_id ?? ""),
        toolName: String(msg.tool_name ?? ""),
        elapsedTimeSeconds: Number(msg.elapsed_time_seconds ?? 0),
        timestamp: now,
      });
      break;
    case "tool_use_summary":
      bus.emit({
        type: "ToolUseSummary",
        summary: String(msg.summary ?? ""),
        precedingToolUseIds: Array.isArray(msg.preceding_tool_use_ids)
          ? msg.preceding_tool_use_ids
          : [],
        timestamp: now,
      });
      break;
  }
}

/* eslint-enable @typescript-eslint/no-explicit-any */

// ---------------------------------------------------------------------------
// Main adapter: runs query and yields AgentStreamEvent
// ---------------------------------------------------------------------------

/** Yield synthetic tool_result for unresolved tools at turn boundary. Exported for testing. */
export function* flushPendingTools(
  toolRegistry: ToolRegistry,
  isError: boolean,
): Generator<AgentStreamEvent> {
  for (const [toolUseId, toolName] of toolRegistry) {
    if (isError) {
      logger.warn({ toolUseId, toolName }, "Orphaned tool — synthesizing error result");
    }
    yield {
      type: "tool_result",
      toolUseId,
      toolName,
      result: isError ? "Tool execution ended without result" : undefined,
      isError,
    };
  }
  toolRegistry.clear();
}

/** Backfill text_delta for assistant messages when stream_event was suppressed. Exported for testing. */
export function* backfillText(msg: any): Generator<AgentStreamEvent> {
  const content = msg.message?.content;
  if (!Array.isArray(content)) return;
  for (const [i, block] of content.entries()) {
    if (block.type === "text" && block.text) {
      yield { type: "content_block_start", index: i, blockType: "text" };
      yield { type: "token", token: block.text };
      yield { type: "content_block_stop", index: i };
    }
  }
}

/** Returns whether a stream_event is a text_delta. */
function isTextDelta(msg: any): boolean {
  return (
    msg.type === "stream_event" &&
    msg.event?.type === "content_block_delta" &&
    msg.event?.delta?.type === "text_delta"
  );
}

/** Returns whether a stream_event is a message_start. */
function isMessageStart(msg: any): boolean {
  return msg.type === "stream_event" && msg.event?.type === "message_start";
}

/** Process a single SDK message into AgentStreamEvents with turn/tool tracking. Exported for testing. */
export function* processMessage(
  msg: any,
  toolRegistry: ToolRegistry,
  state: { streamedTextThisTurn: boolean },
): Generator<AgentStreamEvent> {
  // Turn boundary: flush pending tools
  if (isMessageStart(msg) && toolRegistry.size > 0) yield* flushPendingTools(toolRegistry, false);

  // Track text streaming for backfill detection
  if (isMessageStart(msg)) state.streamedTextThisTurn = false;
  if (isTextDelta(msg)) state.streamedTextThisTurn = true;

  // Text backfill when stream_event text_deltas were suppressed
  if (msg.type === "assistant" && !state.streamedTextThisTurn) yield* backfillText(msg);

  yield* mapSdkToStreamEvents(msg, toolRegistry);
}

/** Handle returned by runSDKQuery for cancellation support. */
export interface SDKQueryHandle {
  /** Stream of AgentStreamEvents from the query. */
  events: AsyncGenerator<AgentStreamEvent>;
  /** Abort the running query. Safe to call multiple times. */
  abort: () => void;
  /** The underlying SDK Query handle (for advanced use like interrupt/setPermissionMode). */
  query: Query;
}

/**
 * Run an SDK query and return a handle with the event stream + abort control.
 *
 * Handles:
 * - Tool name registry (tool_use_id → name)
 * - Orphaned tool completion at stream end
 * - Text delta backfill when stream_event is suppressed
 * - Optional EventBus broadcasting
 */
export function runSDKQuery(
  prompt: string,
  opts: SDKAdapterOptions,
): Result<SDKQueryHandle, SDKAdapterError> {
  const canUseTool = opts.onApprovalRequest ? bridgeApproval(opts.onApprovalRequest) : undefined;

  const sdkOptions: SDKOptions = {
    ...opts.sdkOptions,
    ...(canUseTool && { canUseTool }),
  };

  let queryHandle: Query;
  try {
    queryHandle = sdkQuery({ prompt, options: sdkOptions });
  } catch (err) {
    const message = err instanceof Error ? err.message : "SDK query initialization failed";
    logger.error({ err }, "runSDKQuery: failed to create query");
    return { ok: false, error: new SDKAdapterError(message, err) };
  }

  async function* streamEvents(): AsyncGenerator<AgentStreamEvent> {
    const toolRegistry: ToolRegistry = new Map();
    const state = { streamedTextThisTurn: false };

    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      for await (const msg of queryHandle as AsyncIterable<any>) {
        if (opts.eventBus) {
          try {
            emitToBus(opts.eventBus, msg);
          } catch (err) {
            logger.warn({ err }, "EventBus emit failed");
          }
        }
        yield* processMessage(msg, toolRegistry, state);
      }
      yield* flushPendingTools(toolRegistry, true);
    } finally {
      queryHandle.close();
    }
  }

  return {
    ok: true,
    value: {
      events: streamEvents(),
      abort: () => queryHandle.close(),
      query: queryHandle,
    },
  };
}
