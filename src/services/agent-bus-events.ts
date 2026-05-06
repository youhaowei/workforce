import type { AgentEvent, Usage } from "unifai";
import type { EventBus } from "@/shared/event-bus";
import type {
  HookResponseEvent,
  QueryResultEvent,
  TaskNotificationEvent,
} from "@/shared/event-types";
import { createLogger } from "tracey";

const log = createLogger("Agent");

const VALID_SUBTYPES: ReadonlySet<string> = new Set([
  "success",
  "error_during_execution",
  "error_max_turns",
  "error_max_budget_usd",
  "error_max_structured_output_retries",
]);

function validSubtype(s: string | undefined): QueryResultEvent["subtype"] {
  if (s === undefined) return "success";
  if (VALID_SUBTYPES.has(s)) return s as QueryResultEvent["subtype"];
  // Intentional: unknown subtypes → error (not silent success) to surface SDK changes
  log.warn({ subtype: s }, "Unknown session result subtype");
  return "error_during_execution";
}

function toBusUsage(u: Usage) {
  return {
    inputTokens: u.inputTokens,
    outputTokens: u.outputTokens,
    cacheReadInputTokens: u.cacheReadTokens,
    cacheCreationInputTokens: u.cacheCreationTokens,
  };
}

export function emitAgentBusEvent(
  event: AgentEvent,
  bus: EventBus,
  now: number,
  lastMessageId: string,
) {
  switch (event.type) {
    case "message_start":
    case "message_stop":
    case "content_block_start":
    case "content_block_stop":
    case "assistant_message":
      emitMessageEvent(event, bus, now, lastMessageId);
      break;
    case "tool_start":
    case "tool_progress":
    case "tool_summary":
    case "tool_result":
      emitToolEvent(event, bus, now);
      break;
    case "session_init":
    case "status":
    case "session_complete":
    case "auth_status":
    case "error":
      emitLifecycleEvent(event, bus, now);
      break;
    case "hook_started":
    case "hook_progress":
    case "hook_response":
    case "task_notification":
      emitHookOrTaskEvent(event, bus, now);
      break;
  }
}

function emitMessageEvent(
  event: Extract<
    AgentEvent,
    {
      type:
        | "message_start"
        | "message_stop"
        | "content_block_start"
        | "content_block_stop"
        | "assistant_message";
    }
  >,
  bus: EventBus,
  now: number,
  lastMessageId: string,
) {
  switch (event.type) {
    case "message_start":
      bus.emit({
        type: "MessageStart",
        messageId: event.messageId,
        model: event.model,
        stopReason: event.stopReason,
        usage: toBusUsage(event.usage),
        timestamp: now,
      });
      break;
    case "message_stop":
      bus.emit({
        type: "MessageStop",
        messageId: lastMessageId,
        stopReason: "end_turn",
        timestamp: now,
      });
      break;
    case "content_block_start":
      bus.emit({
        type: "ContentBlockStart",
        index: event.index,
        contentBlock: { type: event.blockType, id: event.id, name: event.name },
        timestamp: now,
      });
      break;
    case "content_block_stop":
      bus.emit({ type: "ContentBlockStop", index: event.index, timestamp: now });
      break;
    case "assistant_message":
      log.info({ contentBlocks: event.content.length }, "Assistant message received");
      bus.emit({
        type: "AssistantMessage",
        messageId: event.messageId,
        uuid: event.uuid ?? "",
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

function emitToolEvent(
  event: Extract<
    AgentEvent,
    { type: "tool_start" | "tool_progress" | "tool_summary" | "tool_result" }
  >,
  bus: EventBus,
  now: number,
) {
  switch (event.type) {
    case "tool_start":
      log.info({ toolName: event.toolName }, "Processing tool_use block");
      bus.emit({
        type: "ToolStart",
        toolId: event.toolUseId,
        toolName: event.toolName,
        args: event.input,
        timestamp: now,
      });
      break;
    case "tool_progress":
      bus.emit({
        type: "ToolProgress",
        toolUseId: event.toolUseId,
        toolName: event.toolName,
        elapsedTimeSeconds: event.elapsedSeconds,
        timestamp: now,
      });
      break;
    case "tool_summary":
      bus.emit({
        type: "ToolUseSummary",
        summary: event.summary,
        precedingToolUseIds: event.precedingToolUseIds ?? [],
        timestamp: now,
      });
      break;
    case "tool_result":
      break;
  }
}

function emitLifecycleEvent(
  event: Extract<
    AgentEvent,
    { type: "session_init" | "status" | "session_complete" | "auth_status" | "error" }
  >,
  bus: EventBus,
  now: number,
) {
  switch (event.type) {
    case "session_init":
      log.info("System init message received");
      bus.emit({
        type: "SystemInit",
        claudeCodeVersion: event.claudeCodeVersion ?? "",
        cwd: event.cwd ?? "",
        model: event.model ?? "",
        tools: event.tools ?? [],
        mcpServers: event.mcpServers ?? [],
        permissionMode: event.permissionMode ?? "",
        slashCommands: event.slashCommands ?? [],
        skills: event.skills ?? [],
        sessionId: event.sessionId,
        timestamp: now,
      });
      break;
    case "status":
      bus.emit({
        type: "SystemStatus",
        status: event.message === "compacting" ? "compacting" : null,
        permissionMode: event.permissionMode,
        timestamp: now,
      });
      break;
    case "session_complete":
      log.info({ subtype: event.subtype }, "Result message received");
      emitSessionComplete(event, bus, now);
      break;
    case "auth_status":
      bus.emit({
        type: "AuthStatus",
        isAuthenticating: event.isAuthenticating,
        output: event.output,
        error: event.error,
        timestamp: now,
      });
      break;
    case "error":
      bus.emit({
        type: "BridgeError",
        source: "unifai",
        error: event.message,
        code: event.code,
        timestamp: now,
      });
      break;
  }
}

function emitHookOrTaskEvent(
  event: Extract<
    AgentEvent,
    { type: "hook_started" | "hook_progress" | "hook_response" | "task_notification" }
  >,
  bus: EventBus,
  now: number,
) {
  switch (event.type) {
    case "hook_started":
      bus.emit({
        type: "HookStarted",
        hookId: event.hookId,
        hookName: event.hookName,
        hookEvent: event.hookEvent,
        timestamp: now,
      });
      break;
    case "hook_progress":
      bus.emit({
        type: "HookProgress",
        hookId: event.hookId,
        hookName: event.hookName,
        hookEvent: event.hookEvent,
        stdout: event.stdout,
        stderr: event.stderr,
        output: event.output,
        timestamp: now,
      });
      break;
    case "hook_response": {
      const outcome = (["success", "error", "cancelled"] as const).includes(
        event.outcome as "success",
      )
        ? (event.outcome as HookResponseEvent["outcome"])
        : "error";
      bus.emit({
        type: "HookResponse",
        hookId: event.hookId,
        hookName: event.hookName,
        hookEvent: event.hookEvent,
        outcome,
        output: event.output,
        exitCode: event.exitCode,
        timestamp: now,
      });
      break;
    }
    case "task_notification": {
      const status = (["completed", "failed", "stopped"] as const).includes(
        event.status as "completed",
      )
        ? (event.status as TaskNotificationEvent["status"])
        : "failed";
      bus.emit({
        type: "TaskNotification",
        taskId: event.taskId,
        status,
        outputFile: event.outputFile,
        summary: event.summary,
        timestamp: now,
      });
      break;
    }
  }
}

function emitSessionComplete(
  event: Extract<AgentEvent, { type: "session_complete" }>,
  bus: EventBus,
  now: number,
) {
  bus.emit({
    type: "QueryResult",
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
          ]),
        )
      : {},
    errors: event.errors,
    timestamp: now,
  });
}
