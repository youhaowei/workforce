import { homedir } from "os";
import type { StreamResult, AgentStreamEvent } from "./types";
import { formatToolInput } from "./agent";
import { resolveClaudeCliPath } from "./agent-cli-path";
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
  readonly _tag = "AgentError" as const;
  readonly cause?: unknown;
  constructor(
    message: string,
    public readonly code: AgentErrorCode,
    cause?: unknown,
  ) {
    // Pass via options bag so Error's native `.cause` slot is set — matters for
    // util.inspect and structured-error tooling. TS lib (ES2021) predates
    // Error.cause, so we use a spread-arg cast; V8/Node accept it since 16.9.
    const superArgs: [string, { cause: unknown }?] =
      cause !== undefined ? [message, { cause }] : [message];
    super(...(superArgs as [string]));
    this.name = "AgentError";
    if (cause !== undefined) this.cause = cause;
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
  /**
   * Tool names that are auto-approved without prompting — maps to SDK's
   * `allowedTools` option. WorkAgent sessions are headless (no user to
   * approve prompts), so listing tools here lets them run without gating.
   *
   * Semantics: SDK `allowedTools` skips approval prompts for the listed tools;
   * it does NOT restrict the tool surface. Restriction requires SDK's `tools`
   * option, which isn't plumbed through this interface.
   */
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

    try {
      // If cancel() fired between construction and this run() (e.g. during
      // an orchestration await point before runAgent starts), the current
      // controller is already aborted. Honor it instead of silently replacing
      // it with a fresh one — otherwise the SDK query runs un-aborted and the
      // cancel signal is lost.
      if (this.abortController.signal.aborted) {
        yield { type: "token" as const, token: " [cancelled]" };
        return;
      }
      this.abortController = new AbortController();

      const result = runSDKQuery(this.composePrompt(prompt), {
        sdkOptions: this.buildSdkOptions(),
        // Intentionally no eventBus — WorkAgent events must not leak onto the
        // global bus (would overwrite main-chat SystemInit/QueryResult, clobber
        // the header and inflate cumulative cost). Matches git.ts smartCommit.
      });

      if (!result.ok) {
        throw new AgentError(
          result.error.message,
          isAuthError(result.error) ? "AUTH_ERROR" : "STREAM_FAILED",
          result.error,
        );
      }

      this.currentHandle = result.value;
      try {
        for await (const event of this.currentHandle.events) {
          yield* this.postProcess(event);
        }
        // SDK's Query.close() ends the iterator cleanly rather than throwing —
        // so a mid-stream cancel arrives here, not in the catch block.
        if (this.abortController.signal.aborted) {
          yield { type: "token" as const, token: " [cancelled]" };
        }
      } finally {
        this.currentHandle = null;
      }
    } catch (err) {
      // Re-throw real AgentError before the abort sentinel — otherwise a real
      // failure that happens to land in the same tick as cancel() gets eaten.
      if (err instanceof AgentError) {
        throw err;
      }
      if (this.abortController.signal.aborted) {
        yield { type: "token" as const, token: " [cancelled]" };
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

  private composePrompt(prompt: string): string {
    return this.options.systemPrompt ? `${this.options.systemPrompt}\n\n${prompt}` : prompt;
  }

  private buildSdkOptions() {
    return {
      model: "sonnet" as const,
      cwd: this.options.cwd,
      env: this.options.env ?? buildSdkEnv(),
      abortController: this.abortController,
      // Match agent.ts — pin to the system-installed claude binary so packaged
      // Electron WorkAgents resolve the same CLI as main-chat.
      pathToClaudeCodeExecutable: resolveClaudeCliPath(),
      // Required for live content_block_delta streaming — without it the SDK
      // only emits whole assistant messages and text arrives as one batched
      // backfill at turn end instead of streaming tokens.
      includePartialMessages: true,
      ...(this.options.allowedTools?.length ? { allowedTools: this.options.allowedTools } : {}),
    };
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

  /** True if cancel() was called since the last run() started. */
  isCancelled(): boolean {
    return this.abortController.signal.aborted;
  }

  dispose(): void {
    this.cancel();
  }
}
