import { createSession } from "unifai";
import type { AgentEvent, AgentQuestionResponse, UnifaiSession, Usage } from "unifai";
import { homedir } from "os";
import type {
  AgentService,
  AgentModelInfo,
  AgentQuestion,
  RunOptions,
  AgentStreamEvent,
  StreamResult,
} from "./types";
import type {
  QueryResultEvent,
  HookResponseEvent,
  TaskNotificationEvent,
} from "@/shared/event-types";
import type { EventBus } from "@/shared/event-bus";
import { getEventBus } from "@/shared/event-bus";
import { createLogger } from "tracey";
import { buildSdkEnv, isAuthError, AgentError } from "./agent-instance";
import type { AgentErrorCode } from "./agent-instance";
import { ModelCache, readLastUsedModelSync, writeLastUsedModel } from "./agent-models";
import { resolveClaudeCliPath } from "./agent-cli-path";

const log = createLogger("Agent");

// Re-export for backward compatibility
export { AgentInstance, AgentError, buildSdkEnv, isAuthError } from "./agent-instance";
export type { AgentInstanceOptions, AgentErrorCode } from "./agent-instance";

function truncateStr(s: string, max = 80) {
  return s.length > max ? s.slice(0, max) + "..." : s;
}

/** Maps tool name → the arg key that best summarizes the invocation. */
const TOOL_SUMMARY_KEY: Record<string, string> = {
  Read: "file_path",
  Edit: "file_path",
  Write: "file_path",
  Bash: "command",
  Glob: "pattern",
  Task: "description",
};

/** Format tool input args into a human-readable one-liner for the activity trace. */
export function formatToolInput(name: string, input: unknown): string {
  const args = (input ?? {}) as Record<string, unknown>;
  const key = TOOL_SUMMARY_KEY[name];
  if (key) return truncateStr(String(args[key] ?? ""));
  if (name === "Grep") {
    const suffix = args.path ? ` in ${args.path}` : "";
    return truncateStr(`${args.pattern ?? ""}${suffix}`);
  }
  return truncateStr(JSON.stringify(input ?? "").slice(0, 120));
}

const VALID_SUBTYPES: ReadonlySet<string> = new Set([
  "success",
  "error_during_execution",
  "error_max_turns",
  "error_max_budget_usd",
  "error_max_structured_output_retries",
]);

function validSubtype(s: string | undefined): QueryResultEvent["subtype"] {
  return s && VALID_SUBTYPES.has(s) ? (s as QueryResultEvent["subtype"]) : "success";
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
  private runInProgress = false;
  private session: UnifaiSession | null = null;
  private modelCache = new ModelCache();
  /** Whether the agent is currently in plan mode (between EnterPlanMode and ExitPlanMode). */
  private inPlanMode = false;
  /** Tracks the last Write to a .md file while in plan mode, used for plan detection. */
  private lastPlanPath: string | null = null;
  /** Pre-created session kept alive between queries for fast startup. */
  private warmSession: UnifaiSession | null = null;
  /** Model of the warm session (used to check reusability). */
  private warmSessionModel: string | null = null;

  /** Pending agent questions — keyed by requestId, resolved when UI submits answers. */
  private pendingQuestions = new Map<string, (answers: Record<string, string[]>) => void>();

  /** Questions data for pending requests — used to restore question on reconnect. */
  private pendingQuestionData = new Map<string, AgentQuestion[]>();

  /** Buffer for events emitted by the onAgentQuestion callback (flushed in the query loop). */
  private pendingQuestionEvents: AgentStreamEvent[] = [];

  constructor() {
    this.warmUp();
  }

  /** Callback passed to unifai — blocks the agent stream until the user answers. */
  private handleAgentQuestion = (request: {
    id: string;
    questions: AgentQuestion[];
  }): Promise<AgentQuestionResponse> => {
    return new Promise((resolve) => {
      this.pendingQuestionData.set(request.id, request.questions);
      this.pendingQuestions.set(request.id, (answers) => {
        this.pendingQuestions.delete(request.id);
        this.pendingQuestionData.delete(request.id);
        resolve({ answers });
      });
      // Buffer the event so the query generator can yield it
      this.pendingQuestionEvents.push({
        type: "agent_question",
        requestId: request.id,
        questions: request.questions,
      });
    });
  };

  /**
   * Pre-create a V2 session and eagerly start its Claude subprocess so it's
   * fully ready before the first query arrives.
   */
  private warmUp(): void {
    try {
      const model = readLastUsedModelSync() ?? "sonnet";
      this.warmSession = createSession("claude", {
        model,
        env: buildSdkEnv(),
        pathToClaudeCodeExecutable: resolveClaudeCliPath(),
        includeRawEvents: true,
        interaction: { onAgentQuestion: this.handleAgentQuestion },
      });
      this.warmSessionModel = model;

      log.info(`Pre-created warm V2 session for fast startup (model: ${model})`);
    } catch (err) {
      log.error(
        { error: err instanceof Error ? err.message : String(err) },
        "Failed to pre-create warm session",
      );
    }
  }

  /** Resolve or create the session for this query. Reuses warm session when possible. */
  private resolveSession(model: string, options?: RunOptions): UnifaiSession {
    const needsV1 =
      options?.maxThinkingTokens !== undefined || options?.permissionMode === "bypassPermissions";

    if (this.warmSession && this.warmSessionModel === model && !needsV1) {
      const session = this.warmSession;
      this.warmSession = null;
      this.warmSessionModel = null;
      log.info({ model }, "Reusing warm session");
      return session;
    }

    if (this.warmSession) {
      this.warmSession.close();
      this.warmSession = null;
      this.warmSessionModel = null;
    }

    return createSession("claude", {
      model,
      env: buildSdkEnv(),
      pathToClaudeCodeExecutable: resolveClaudeCliPath(),
      includeRawEvents: true,
      interaction: { onAgentQuestion: this.handleAgentQuestion },
      ...(needsV1
        ? {
            sdkVersion: "v1" as const,
            cwd: process.cwd(),
            includePartialMessages: true,
            ...(options?.maxThinkingTokens !== undefined
              ? { maxThinkingTokens: options.maxThinkingTokens }
              : {}),
            ...(options?.permissionMode === "bypassPermissions"
              ? { allowDangerouslySkipPermissions: true }
              : {}),
          }
        : {
            sdkVersion: "v2" as const,
          }),
      ...(options?.permissionMode ? { permissionMode: options.permissionMode } : {}),
    });
  }

  async *run(prompt: string, options?: RunOptions): StreamResult<AgentStreamEvent> {
    if (this.runInProgress) {
      throw new AgentError("Run already in progress", "UNKNOWN");
    }

    this.runInProgress = true;
    this.abortController = new AbortController();
    this.lastPlanPath = null;
    this.inPlanMode = false;
    const bus = getEventBus();
    let tokenIndex = 0;
    const model = options?.model ?? "sonnet";

    try {
      writeLastUsedModel(model);
      this.session = this.resolveSession(model, options);

      try {
        let lastMessageId = "";
        for await (const event of this.session.send(prompt)) {
          yield* this.handleEvent(event, bus, tokenIndex, lastMessageId);
          if (event.type === "text_delta") tokenIndex++;
          if (event.type === "message_start") lastMessageId = event.messageId;
        }
      } finally {
        if (!this.abortController?.signal.aborted && this.session) {
          this.warmSession = this.session;
          this.warmSessionModel = model;
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
    // Flush any agent_question events buffered by the onAgentQuestion callback
    while (this.pendingQuestionEvents.length > 0) {
      yield this.pendingQuestionEvents.shift()!;
    }

    const now = Date.now();

    switch (event.type) {
      case "text_delta":
        yield { type: "token", token: event.text };
        break;
      case "thinking_delta":
        bus.emit({
          type: "ThinkingDelta",
          thinking: event.text,
          index: event.index ?? 0,
          timestamp: now,
        });
        yield { type: "thinking_delta", text: event.text };
        break;
      case "raw":
        bus.emit({
          type: "RawSdkMessage",
          sdkMessageType: event.eventType,
          payload: event.data,
          timestamp: now,
        });
        break;
      default:
        this.emitBusEvent(event, bus, now, lastMessageId);
        yield* this.yieldStreamEvents(event);
        break;
    }
  }

  /** Yield stream events for tool activity, content blocks, and system status. */
  private *yieldStreamEvents(event: AgentEvent): Generator<AgentStreamEvent> {
    if (event.type === "assistant_message") {
      yield { type: "turn_complete" };
    } else if (event.type === "tool_start") {
      yield* this.handleToolStartEvent(event);
    } else if (event.type === "tool_result") {
      yield {
        type: "tool_result",
        toolUseId: event.toolUseId,
        toolName: event.toolName,
        result: event.result,
        isError: event.isError,
      };
    } else if (event.type === "content_block_start") {
      yield {
        type: "content_block_start",
        index: event.index,
        blockType: event.blockType,
        id: event.id,
        name: event.name,
      };
    } else if (event.type === "content_block_stop") {
      yield { type: "content_block_stop", index: event.index };
    } else if (event.type === "status") {
      yield { type: "status", message: event.message };
    }
  }

  /** Handle tool_start: plan mode tracking + yield tool_start event. */
  private *handleToolStartEvent(
    event: AgentEvent & { type: "tool_start" },
  ): Generator<AgentStreamEvent> {
    if (event.toolName === "EnterPlanMode") this.inPlanMode = true;
    if (this.inPlanMode && event.toolName === "Write") {
      const filePath = String((event.input as Record<string, unknown>).file_path ?? "");
      if (filePath.endsWith(".md")) this.lastPlanPath = filePath;
    }
    if (event.toolName === "ExitPlanMode" && this.lastPlanPath) {
      this.inPlanMode = false;
      yield { type: "plan_ready", path: this.lastPlanPath };
      this.lastPlanPath = null;
    }
    yield {
      type: "tool_start",
      name: event.toolName,
      input: formatToolInput(event.toolName, event.input),
      toolUseId: event.toolUseId,
      inputRaw: event.input,
    };
  }

  // eslint-disable-next-line complexity -- Flat dispatch to domain handlers; each case is a trivial delegation.
  private emitBusEvent(event: AgentEvent, bus: EventBus, now: number, lastMessageId: string) {
    switch (event.type) {
      case "message_start":
      case "message_stop":
      case "content_block_start":
      case "content_block_stop":
      case "assistant_message":
        this.emitMessageEvent(event, bus, now, lastMessageId);
        break;
      case "tool_start":
      case "tool_progress":
      case "tool_summary":
      case "tool_result":
        this.emitToolEvent(event, bus, now);
        break;
      case "session_init":
      case "status":
      case "session_complete":
      case "auth_status":
      case "error":
        this.emitLifecycleEvent(event, bus, now);
        break;
      case "hook_started":
      case "hook_progress":
      case "hook_response":
      case "task_notification":
        this.emitHookOrTaskEvent(event, bus, now);
        break;
      // text_complete, turn_complete — intentionally unhandled
    }
  }

  private emitMessageEvent(
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

  private emitToolEvent(
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
        // tool_result is yielded as a stream event in handleEvent; no separate bus event needed
        break;
    }
  }

  private emitLifecycleEvent(
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
        this.emitSessionComplete(event, bus, now);
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

  private emitHookOrTaskEvent(
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
        // Cast to narrow member satisfies TS includes() signature; all three values are checked at runtime
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
        // Cast to narrow member satisfies TS includes() signature; all three values are checked at runtime
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

  private emitSessionComplete(
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

  private *handleRunError(
    err: unknown,
    _bus: EventBus,
    _tokenIndex: number,
  ): Generator<AgentStreamEvent> {
    if (this.abortController?.signal.aborted) {
      log.info("Query cancelled by user");
      yield { type: "token", token: " [cancelled]" };
      return;
    }

    const errorCode: AgentErrorCode = isAuthError(err) ? "AUTH_ERROR" : "STREAM_FAILED";

    if (errorCode === "AUTH_ERROR") {
      log.error(
        {
          error: err instanceof Error ? err.message : String(err),
          HOME: process.env.HOME || homedir(),
          hasApiKey: !!process.env.ANTHROPIC_API_KEY,
          hasAuthToken: !!process.env.ANTHROPIC_AUTH_TOKEN,
        },
        "Authentication error",
      );
    } else {
      log.error({ error: err instanceof Error ? err.message : String(err) }, "Query error");
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
      log.warn({ requestId }, "submitAnswer: no pending question");
    }
  }

  getPendingQuestion(): { requestId: string; questions: AgentQuestion[] } | null {
    for (const [requestId, questions] of this.pendingQuestionData) {
      return { requestId, questions };
    }
    return null;
  }

  cancel(): void {
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
    // Drain pending questions so the onAgentQuestion promise unblocks
    for (const resolve of this.pendingQuestions.values()) {
      resolve({});
    }
    this.pendingQuestions.clear();
    this.pendingQuestionData.clear();
    this.pendingQuestionEvents.length = 0;
    // Abort the session's in-flight send() directly — needed because reused
    // warm sessions may not have an embedded AbortController.
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
