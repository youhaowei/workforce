import { createSession } from "unifai";
import type { AgentEvent, AgentQuestionResponse, UnifaiSession } from "unifai";
import { homedir } from "os";
import type {
  AgentService,
  AgentModelInfo,
  AgentQuestion,
  RunOptions,
  AgentStreamEvent,
  StreamResult,
} from "./types";
import type { EventBus } from "@/shared/event-bus";
import { getEventBus } from "@/shared/event-bus";
import { createLogger } from "tracey";
import { buildSdkEnv, isAuthError, AgentError } from "./agent-instance";
import type { AgentErrorCode } from "./agent-instance";
import { ModelCache, readLastUsedModelSync, writeLastUsedModel } from "./agent-models";
import { resolveClaudeCliPath } from "./agent-cli-path";
import { emitAgentBusEvent } from "./agent-bus-events";

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
        emitAgentBusEvent(event, bus, now, lastMessageId);
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

  // oxlint-disable-next-line complexity -- Flat dispatch to domain handlers; each case is a trivial delegation.
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
