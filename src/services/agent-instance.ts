import { homedir } from "os";
import type { StreamResult, AgentStreamEvent } from "./types";
import { getEventBus } from "@/shared/event-bus";
import { formatToolInput } from "./agent";
import { runSDKQuery, type SDKQueryHandle } from "./sdk-adapter";

/**
 * Build environment variables for the SDK subprocess.
 * Ensures HOME is set (GUI apps launched from Finder may not have it).
 *
 * NOTE: We intentionally do NOT inject auth tokens from credentials file.
 * The SDK subprocess handles auth internally (token refresh, etc.) just like
 * the Claude CLI does. Injecting expired tokens would break auth.
 */
export function buildSdkEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (typeof v === "string") env[k] = v;
  }
  if (!env.HOME) env.HOME = homedir();
  // Strip Claude Code session markers so the SDK subprocess doesn't refuse
  // to boot with "cannot be launched inside another Claude Code session".
  // Leaks in when Workforce (or its dev server) is launched from a Claude Code context.
  delete env.CLAUDECODE;
  delete env.CLAUDE_CODE_SSE_PORT;
  return env;
}

/**
 * Classify an error as auth-related based on message content.
 */
export function isAuthError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const msg = err.message.toLowerCase();
  return (
    msg.includes("authentication") ||
    msg.includes("unauthorized") ||
    msg.includes("401") ||
    msg.includes("invalid api key") ||
    msg.includes("api key") ||
    msg.includes("not authenticated") ||
    msg.includes("credential")
  );
}

export class AgentError extends Error {
  constructor(
    message: string,
    public readonly code: AgentErrorCode,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = "AgentError";
  }
}

export type AgentErrorCode =
  | "AUTH_ERROR"
  | "RATE_LIMIT"
  | "NETWORK_ERROR"
  | "STREAM_FAILED"
  | "CANCELLED"
  | "TOOL_ERROR"
  | "UNKNOWN";

export interface AgentInstanceOptions {
  cwd: string;
  systemPrompt?: string;
  env?: Record<string, string>;
  /** Org-level tool allowlist — passed to SDK if non-empty */
  allowedTools?: string[];
}

/**
 * An individual agent instance tied to a specific session.
 * Each instance has its own AbortController and working directory,
 * enabling concurrent agents with worktree isolation.
 */
export class AgentInstance {
  private abortController: AbortController;
  private runInProgress = false;
  private currentHandle: SDKQueryHandle | null = null;

  constructor(
    public readonly sessionId: string,
    private options: AgentInstanceOptions,
  ) {
    this.abortController = new AbortController();
  }

  async *run(prompt: string): StreamResult<AgentStreamEvent> {
    if (this.runInProgress) {
      throw new AgentError("Query already in progress for this instance", "UNKNOWN");
    }

    this.runInProgress = true;
    this.abortController = new AbortController();
    const bus = getEventBus();

    try {
      const fullPrompt = this.options.systemPrompt
        ? `${this.options.systemPrompt}\n\n${prompt}`
        : prompt;

      const result = runSDKQuery(fullPrompt, {
        sdkOptions: {
          model: "sonnet",
          cwd: this.options.cwd,
          env: this.options.env ?? buildSdkEnv(),
          abortController: this.abortController,
          ...(this.options.allowedTools?.length
            ? { allowedTools: this.options.allowedTools }
            : {}),
        },
        eventBus: bus,
      });

      if (!result.ok) {
        throw new AgentError(result.error.message, "STREAM_FAILED", result.error);
      }

      this.currentHandle = result.value;
      try {
        for await (const event of this.currentHandle.events) {
          yield* this.postProcess(event);
        }
      } finally {
        this.currentHandle = null;
      }
    } catch (err) {
      if (this.abortController.signal.aborted) {
        yield { type: "token" as const, token: " [cancelled]" };
      } else if (err instanceof AgentError) {
        throw err;
      } else {
        throw new AgentError(
          err instanceof Error ? err.message : String(err),
          isAuthError(err) ? "AUTH_ERROR" : "STREAM_FAILED",
          err,
        );
      }
    } finally {
      this.runInProgress = false;
    }
  }

  /** Apply per-consumer tweaks to adapter events — currently just tool_start input formatting. */
  private *postProcess(event: AgentStreamEvent): Generator<AgentStreamEvent> {
    if (event.type === "tool_start") {
      yield {
        ...event,
        input: formatToolInput(event.name, event.inputRaw),
      };
      return;
    }
    yield event;
  }

  cancel(): void {
    this.abortController.abort();
    this.currentHandle?.abort();
  }

  isRunning(): boolean {
    return this.runInProgress;
  }

  dispose(): void {
    this.cancel();
  }
}
