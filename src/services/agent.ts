import { homedir } from "os";
import type { Options as SDKOptions } from "@anthropic-ai/claude-agent-sdk";
import type {
  AgentModelInfo,
  AgentQuestion,
  AgentService,
  AgentStreamEvent,
  RunOptions,
  StreamResult,
} from "./types";
import { getEventBus } from "@/shared/event-bus";
import { createLogger } from "tracey";
import { buildSdkEnv, isAuthError, AgentError } from "./agent-instance";
import type { AgentErrorCode } from "./agent-instance";
import { ModelCache, readLastUsedModelSync, writeLastUsedModel } from "./agent-models";
import { resolveClaudeCliPath } from "./agent-cli-path";
import { runSDKQuery, type SDKQueryHandle } from "./sdk-adapter";

const log = createLogger("Agent");

// Re-export for backward compatibility.
export { AgentInstance, AgentError, buildSdkEnv, isAuthError } from "./agent-instance";
export type { AgentInstanceOptions, AgentErrorCode } from "./agent-instance";

function truncateStr(s: string, max = 80) {
  return s.length > max ? s.slice(0, max) + "..." : s;
}

/** Maps tool name to the arg key that best summarizes the invocation. */
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

function sessionReuseKey(model: string, options?: RunOptions): string {
  return JSON.stringify({
    model,
    permissionMode: options?.permissionMode ?? "default",
    maxThinkingTokens: options?.maxThinkingTokens ?? null,
    systemPrompt: options?.systemPrompt ?? null,
  });
}

class AgentServiceImpl implements AgentService {
  private abortController: AbortController | null = null;
  private runInProgress = false;
  private currentHandle: SDKQueryHandle | null = null;
  private modelCache = new ModelCache();
  /** Whether the agent is currently in plan mode (between EnterPlanMode and ExitPlanMode). */
  private inPlanMode = false;
  /** Tracks the last Write to a .md file while in plan mode, used for plan detection. */
  private lastPlanPath: string | null = null;
  /** Last successful Claude session id reused via SDK resume on the next compatible query. */
  private warmSessionId: string | null = null;
  /** Configuration key for warm session reuse. */
  private warmSessionKey: string | null = null;

  /** Pending agent questions keyed by requestId, resolved when UI submits answers. */
  private pendingQuestions = new Map<string, (answers: Record<string, string[]>) => void>();

  /** Questions data for pending requests, used to restore question on reconnect. */
  private pendingQuestionData = new Map<string, AgentQuestion[]>();

  constructor() {
    const model = readLastUsedModelSync() ?? "sonnet";
    log.info({ model }, "AgentService ready for direct Claude SDK queries");
  }

  private handleAgentQuestion = (request: {
    id: string;
    questions: AgentQuestion[];
  }): Promise<{ answers: Record<string, string[]> }> => {
    return new Promise((resolve) => {
      this.pendingQuestionData.set(request.id, request.questions);
      this.pendingQuestions.set(request.id, (answers) => {
        this.pendingQuestions.delete(request.id);
        this.pendingQuestionData.delete(request.id);
        resolve({ answers });
      });
    });
  };

  private buildSdkOptions(model: string, options?: RunOptions): Omit<SDKOptions, "canUseTool"> {
    const reuseKey = sessionReuseKey(model, options);
    const resume =
      this.warmSessionId && this.warmSessionKey === reuseKey ? this.warmSessionId : undefined;

    if (this.warmSessionId && !resume) {
      log.info({ model }, "Discarding warm Claude session because run options changed");
      this.warmSessionId = null;
      this.warmSessionKey = null;
    }

    return {
      model,
      cwd: process.cwd(),
      env: buildSdkEnv(),
      abortController: this.abortController ?? undefined,
      pathToClaudeCodeExecutable: resolveClaudeCliPath(),
      includePartialMessages: true,
      ...(resume ? { resume } : {}),
      ...(options?.permissionMode ? { permissionMode: options.permissionMode } : {}),
      ...(options?.permissionMode === "bypassPermissions"
        ? { allowDangerouslySkipPermissions: true }
        : {}),
      ...(options?.maxThinkingTokens !== undefined
        ? { maxThinkingTokens: options.maxThinkingTokens }
        : {}),
      ...(options?.systemPrompt
        ? {
            systemPrompt: {
              type: "preset" as const,
              preset: "claude_code" as const,
              append: options.systemPrompt,
            },
          }
        : {}),
    };
  }

  async *run(prompt: string, options?: RunOptions): StreamResult<AgentStreamEvent> {
    if (this.runInProgress) {
      throw new AgentError("Run already in progress", "UNKNOWN");
    }

    this.runInProgress = true;
    const runController = new AbortController();
    this.abortController = runController;
    this.lastPlanPath = null;
    this.inPlanMode = false;

    const bus = getEventBus();
    const model = options?.model ?? "sonnet";
    const reuseKey = sessionReuseKey(model, options);

    try {
      writeLastUsedModel(model);

      const result = runSDKQuery(prompt, {
        sdkOptions: this.buildSdkOptions(model, options),
        eventBus: bus,
        emitRawEvents: true,
        onAgentQuestion: this.handleAgentQuestion,
      });

      if (!result.ok) {
        throw new AgentError(
          result.error.message,
          isAuthError(result.error) ? "AUTH_ERROR" : "STREAM_FAILED",
          result.error,
        );
      }

      const handle = result.value;
      this.currentHandle = handle;
      try {
        for await (const event of handle.events) {
          yield* this.postProcessEvent(event);
        }
        if (runController.signal.aborted) {
          log.info("Query cancelled by user");
          yield { type: "token", token: " [cancelled]" };
        } else {
          const sessionId = handle.getSessionId();
          this.warmSessionId = sessionId;
          this.warmSessionKey = sessionId ? reuseKey : null;
          if (sessionId) log.info({ sessionId, model }, "Stored Claude session for warm reuse");
        }
      } finally {
        if (this.currentHandle === handle) this.currentHandle = null;
      }
    } catch (err) {
      yield* this.handleRunError(err, runController.signal.aborted);
    } finally {
      this.runInProgress = false;
      if (this.abortController === runController) this.abortController = null;
    }
  }

  private *postProcessEvent(event: AgentStreamEvent): Generator<AgentStreamEvent> {
    if (event.type !== "tool_start") {
      yield event;
      return;
    }

    if (event.name === "EnterPlanMode") this.inPlanMode = true;
    if (this.inPlanMode && event.name === "Write") {
      const filePath = String((event.inputRaw as Record<string, unknown>)?.file_path ?? "");
      if (filePath.endsWith(".md")) this.lastPlanPath = filePath;
    }
    if (event.name === "ExitPlanMode") {
      this.inPlanMode = false;
      if (this.lastPlanPath) {
        yield { type: "plan_ready", path: this.lastPlanPath };
      }
      this.lastPlanPath = null;
    }

    yield {
      ...event,
      input: formatToolInput(event.name, event.inputRaw),
    };
  }

  private *handleRunError(err: unknown, wasAborted: boolean): Generator<AgentStreamEvent> {
    if (wasAborted) {
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
    this.abortController?.abort();
    this.abortController = null;
    this.currentHandle?.abort();

    for (const resolve of this.pendingQuestions.values()) {
      resolve({});
    }
    this.pendingQuestions.clear();
    this.pendingQuestionData.clear();
  }

  isRunning(): boolean {
    return this.runInProgress;
  }

  dispose(): void {
    this.cancel();
    this.warmSessionId = null;
    this.warmSessionKey = null;
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
