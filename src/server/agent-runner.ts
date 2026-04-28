/**
 * AgentRunner — Decouples agent execution from SSE observation.
 *
 * The agent run is a detached async task that continues even when SSE clients
 * disconnect (e.g. during HMR). Clients observe the run via `observe()`, which
 * yields a snapshot of accumulated state followed by live events.
 */

import { AgentError, getAgentService } from "@/services/agent";
import { getSessionService } from "@/services/session";
import { createLogger } from "tracey";
import type { ContentBlock, ToolActivity, AgentStreamEvent, AgentQuestion } from "@/services/types";

const log = createLogger("AgentRunner");
const streamLog = createLogger("Stream");

// =============================================================================
// Block accumulation (shared with agent router for processEvent)
// =============================================================================

export interface BlockAccumulator {
  blocks: ContentBlock[];
  activities: ToolActivity[];
}

export function findToolBlock(acc: BlockAccumulator, toolUseId: string) {
  return acc.blocks.find(
    (b): b is ContentBlock & { type: "tool_use" } => b.type === "tool_use" && b.id === toolUseId,
  );
}

export function accumulateToolStart(
  acc: BlockAccumulator,
  event: AgentStreamEvent & { type: "tool_start" },
) {
  const existing = findToolBlock(acc, event.toolUseId);
  if (existing) {
    existing.input = event.input;
    existing.name = event.name;
    existing.inputRaw = event.inputRaw;
  } else {
    completePreviousBlock(acc);
    acc.blocks.push({
      type: "tool_use",
      id: event.toolUseId,
      name: event.name,
      input: event.input,
      inputRaw: event.inputRaw,
      status: "running",
    });
  }
  acc.activities.push({ name: event.name, input: event.input });
}

export function accumulateToolResult(
  acc: BlockAccumulator,
  event: AgentStreamEvent & { type: "tool_result" },
) {
  const block = findToolBlock(acc, event.toolUseId);
  if (!block) return;
  block.status = event.isError ? "error" : "complete";
  if (event.isError)
    block.error = typeof event.result === "string" ? event.result : JSON.stringify(event.result);
  else block.result = event.result;
}

export function completePreviousBlock(acc: BlockAccumulator) {
  const prev = acc.blocks[acc.blocks.length - 1];
  if (prev && (prev.type === "text" || prev.type === "thinking") && prev.status === "running") {
    prev.status = "complete";
  }
}

export function accumulateContentBlockStart(
  acc: BlockAccumulator,
  event: AgentStreamEvent & { type: "content_block_start" },
) {
  completePreviousBlock(acc);
  if (event.blockType === "text") {
    acc.blocks.push({ type: "text", text: "", status: "running" });
  } else if (event.blockType === "tool_use" && event.id && event.name) {
    acc.blocks.push({
      type: "tool_use",
      id: event.id,
      name: event.name,
      input: "",
      status: "running",
    });
  } else if (event.blockType === "thinking") {
    acc.blocks.push({ type: "thinking", text: "", status: "running" });
  }
}

export function accumulateTokenText(acc: BlockAccumulator, token: string) {
  const last = acc.blocks[acc.blocks.length - 1];
  if (last && last.type === "text") {
    (last as { type: "text"; text: string }).text += token;
  } else {
    acc.blocks.push({ type: "text", text: token, status: "running" });
  }
}

export function accumulateThinkingDelta(acc: BlockAccumulator, text: string) {
  const last = acc.blocks[acc.blocks.length - 1];
  if (last && last.type === "thinking") {
    (last as { type: "thinking"; text: string }).text += text;
  } else {
    acc.blocks.push({ type: "thinking", text, status: "running" });
  }
}

export function accumulateContentBlockStop(acc: BlockAccumulator) {
  for (let i = acc.blocks.length - 1; i >= 0; i--) {
    const block = acc.blocks[i];
    if ((block.type === "text" || block.type === "thinking") && block.status === "running") {
      block.status = "complete";
      break;
    }
  }
}

export function completeRunningBlocks(acc: BlockAccumulator) {
  for (const block of acc.blocks) {
    if (block.status === "running") {
      block.status = "complete";
    }
  }
}

export function recordSubmittedQuestionAnswer(
  blocks: ContentBlock[],
  requestId: string,
  answers: Record<string, string[]>,
): boolean {
  const questionBlocks = blocks.filter(
    (block): block is ContentBlock & { type: "tool_use" } =>
      block.type === "tool_use" && block.name === "AskUserQuestion",
  );
  if (questionBlocks.length === 0) return false;

  const target =
    [...questionBlocks].reverse().find((block) => block.id === requestId) ??
    [...questionBlocks].reverse().find((block) => block.result == null);
  if (!target) return false;

  target.result = answers;
  if (target.status === "running") target.status = "complete";
  return true;
}

// =============================================================================
// SSE event types
// =============================================================================

export type SSEEvent =
  | { type: "token"; data: string }
  | { type: "turn_complete" }
  | { type: "tool_start"; name: string; input: string; toolUseId: string; inputRaw: unknown }
  | { type: "tool_result"; toolUseId: string; toolName: string; result: unknown; isError: boolean }
  | { type: "content_block_start"; index: number; blockType: string; id?: string; name?: string }
  | { type: "thinking_delta"; data: string }
  | { type: "content_block_stop"; index: number }
  | { type: "status"; data: string }
  | { type: "plan_ready"; path: string }
  | { type: "agent_question"; requestId: string; questions: AgentQuestion[] }
  | {
      type: "snapshot";
      blocks: ContentBlock[];
      fullText: string;
      activities: ToolActivity[];
      pendingQuestion?: { requestId: string; questions: AgentQuestion[] };
    }
  | { type: "done"; data: string }
  | { type: "error"; data: string | { message: string; code?: string } };

export function toSSEErrorData(err: unknown): string | { message: string; code?: string } {
  const message = err instanceof Error ? err.message : String(err);
  const code = err instanceof AgentError ? err.code : undefined;
  return code ? { message, code } : message;
}

export function* processEvent(
  event: AgentStreamEvent,
  acc: BlockAccumulator,
  snapshotBlocks: () => void,
): Generator<SSEEvent> {
  switch (event.type) {
    case "token":
      yield { type: "token", data: event.token };
      break;
    case "turn_complete":
      snapshotBlocks();
      yield { type: "turn_complete" };
      break;
    case "tool_start":
      accumulateToolStart(acc, event);
      streamLog.info({ name: event.name, toolUseId: event.toolUseId }, "tool start");
      yield {
        type: "tool_start",
        name: event.name,
        input: event.input,
        toolUseId: event.toolUseId,
        inputRaw: event.inputRaw,
      };
      break;
    case "tool_result":
      accumulateToolResult(acc, event);
      streamLog.info(
        { toolName: event.toolName, toolUseId: event.toolUseId, isError: event.isError },
        "tool result",
      );
      snapshotBlocks();
      yield {
        type: "tool_result",
        toolUseId: event.toolUseId,
        toolName: event.toolName,
        result: event.result,
        isError: event.isError,
      };
      break;
    case "thinking_delta":
      accumulateThinkingDelta(acc, event.text);
      yield { type: "thinking_delta", data: event.text };
      break;
    case "content_block_start":
      accumulateContentBlockStart(acc, event);
      yield {
        type: "content_block_start",
        index: event.index,
        blockType: event.blockType,
        id: event.id,
        name: event.name,
      };
      break;
    case "content_block_stop":
      accumulateContentBlockStop(acc);
      yield { type: "content_block_stop", index: event.index };
      break;
    case "status":
      yield { type: "status", data: event.message };
      break;
    case "plan_ready":
      yield { type: "plan_ready", path: event.path };
      break;
    case "agent_question":
      streamLog.info(
        { requestId: event.requestId, questionCount: event.questions.length },
        "agent question",
      );
      yield { type: "agent_question", requestId: event.requestId, questions: event.questions };
      break;
  }
}

// =============================================================================
// ActiveRun — state for a single in-flight agent run
// =============================================================================

interface ActiveRun {
  sessionId?: string;
  messageId?: string;
  done: boolean;
  /**
   * Stored as the same shape used on the wire so a late observer (post-disconnect
   * reconnect after the run terminated) replays the structured payload —
   * preserving `code` (e.g. `AUTH_ERROR`) so the UI can still render the reauth CTA.
   */
  error?: string | { message: string; code?: string };
  fullText: string;
  tokenCount: number;
  acc: BlockAccumulator;
  listeners: Set<(event: SSEEvent) => void>;
}

// =============================================================================
// AgentRunner singleton
// =============================================================================

const SNAPSHOT_INTERVAL = 100;

async function persistStreamEnd(
  sessionId: string,
  messageId: string,
  fullText: string,
  stopReason: string,
  acc: BlockAccumulator,
): Promise<void> {
  try {
    await getSessionService().recordStreamEnd(
      sessionId,
      messageId,
      fullText.trim(),
      stopReason,
      acc.activities.length > 0 ? acc.activities : undefined,
      acc.blocks.length > 0 ? acc.blocks : undefined,
    );
  } catch (err) {
    log.error(
      { sessionId, messageId, error: err instanceof Error ? err.message : String(err) },
      "persistStreamEnd failed",
    );
  }
}

class AgentRunnerImpl {
  private activeRun: ActiveRun | null = null;

  isActive(): boolean {
    return this.activeRun !== null && !this.activeRun.done;
  }

  getState(): { running: boolean; sessionId?: string; messageId?: string } {
    if (!this.activeRun || this.activeRun.done) return { running: false };
    return {
      running: true,
      sessionId: this.activeRun.sessionId,
      messageId: this.activeRun.messageId,
    };
  }

  /**
   * Start a new agent run as a detached async task.
   * The task continues even if all SSE observers disconnect.
   */
  startRun(input: {
    prompt: string;
    model?: string;
    maxThinkingTokens?: number;
    permissionMode?: "plan" | "default" | "acceptEdits" | "bypassPermissions";
    sessionId?: string;
    messageId?: string;
  }): void {
    if (this.activeRun && !this.activeRun.done) {
      throw new Error("A run is already in progress");
    }

    const run: ActiveRun = {
      sessionId: input.sessionId,
      messageId: input.messageId,
      done: false,
      fullText: "",
      tokenCount: 0,
      acc: { blocks: [], activities: [] },
      listeners: new Set(),
    };
    this.activeRun = run;

    // Fire-and-forget — the run continues independently of SSE connections
    this.executeRun(run, input).catch((err) => {
      log.error(
        { error: err instanceof Error ? err.message : String(err) },
        "executeRun unhandled error",
      );
    });
  }

  /**
   * Observe the current run. Yields a snapshot of accumulated state first,
   * then live events as they happen.
   */
  async *observe(): AsyncGenerator<SSEEvent> {
    const run = this.activeRun;
    streamLog.info({ hasActiveRun: !!run, done: run?.done ?? true }, "observer connected");
    if (!run || run.done) {
      // If the run just finished, yield any final event
      if (run?.error) {
        yield { type: "error", data: run.error };
      } else {
        yield { type: "done", data: "" };
      }
      return;
    }

    // Yield a snapshot of current accumulated state (including any pending question)
    const pendingQ = getAgentService().getPendingQuestion() ?? undefined;
    yield {
      type: "snapshot",
      blocks: structuredClone(run.acc.blocks),
      fullText: run.fullText,
      activities: [...run.acc.activities],
      pendingQuestion: pendingQ,
    };

    // Then yield live events via a listener
    const queue: SSEEvent[] = [];
    let resolve: (() => void) | null = null;

    const listener = (event: SSEEvent) => {
      queue.push(event);
      if (resolve) {
        resolve();
        resolve = null;
      }
    };

    run.listeners.add(listener);
    try {
      while (true) {
        // Drain queued events
        while (queue.length > 0) {
          const event = queue.shift()!;
          yield event;
          // Terminal events end observation
          if (event.type === "done" || event.type === "error") return;
        }
        // Wait for more events
        if (run.done && queue.length === 0) return;
        await new Promise<void>((r) => {
          resolve = r;
        });
      }
    } finally {
      run.listeners.delete(listener);
      streamLog.info(
        { sessionId: run.sessionId, remainingObservers: run.listeners.size },
        "observer disconnected",
      );
    }
  }

  cancel(): void {
    getAgentService().cancel();
  }

  recordQuestionAnswer(requestId: string, answers: Record<string, string[]>): void {
    const run = this.activeRun;
    if (!run || run.done) return;
    if (!recordSubmittedQuestionAnswer(run.acc.blocks, requestId, answers)) return;
    this.snapshotBlocks(run);
  }

  // ─── Private ────────────────────────────────────────────────────────

  private broadcast(run: ActiveRun, event: SSEEvent): void {
    for (const listener of run.listeners) {
      listener(event);
    }
  }

  private snapshotBlocks(run: ActiveRun): void {
    if (!run.sessionId || !run.messageId || run.acc.blocks.length === 0) return;
    getSessionService()
      .recordStreamBlocks(
        run.sessionId,
        run.messageId,
        [...run.acc.blocks],
        run.acc.activities.length > 0 ? [...run.acc.activities] : undefined,
      )
      .catch(() => {
        /* best-effort */
      });
  }

  private async executeRun(
    run: ActiveRun,
    input: {
      prompt: string;
      model?: string;
      maxThinkingTokens?: number;
      permissionMode?: string;
      sessionId?: string;
      messageId?: string;
    },
  ): Promise<void> {
    log.info(
      {
        prompt: input.prompt.slice(0, 100),
        model: input.model,
        sessionId: input.sessionId,
      },
      "run started",
    );

    const agent = getAgentService();
    let tokensSinceSnapshot = 0;

    // Write message_start so journal can recover interrupted streams
    if (input.sessionId && input.messageId) {
      await getSessionService().recordStreamStart(input.sessionId, input.messageId);
    }

    try {
      for await (const event of agent.run(input.prompt, {
        model: input.model,
        maxThinkingTokens: input.maxThinkingTokens,
        permissionMode: input.permissionMode as
          | "plan"
          | "default"
          | "acceptEdits"
          | "bypassPermissions"
          | undefined,
      })) {
        // Process event → accumulate blocks + generate SSE events
        for (const sseEvent of processEvent(event, run.acc, () => this.snapshotBlocks(run))) {
          this.broadcast(run, sseEvent);
        }

        if (event.type === "token") {
          run.tokenCount++;
          run.fullText += event.token;
          accumulateTokenText(run.acc, event.token);
          tokensSinceSnapshot++;
          if (tokensSinceSnapshot >= SNAPSHOT_INTERVAL) {
            this.snapshotBlocks(run);
            tokensSinceSnapshot = 0;
          }
        }
      }

      completeRunningBlocks(run.acc);
      if (input.sessionId && input.messageId) {
        await persistStreamEnd(input.sessionId, input.messageId, run.fullText, "end_turn", run.acc);
      }

      log.info({ totalTokens: run.tokenCount }, "run complete");
      this.broadcast(run, { type: "done", data: "" });
    } catch (err) {
      const errorPayload = toSSEErrorData(err);
      const logMessage = typeof errorPayload === "string" ? errorPayload : errorPayload.message;
      log.error({ error: logMessage }, "run error");
      run.error = errorPayload;

      if (
        input.sessionId &&
        input.messageId &&
        (run.fullText.length > 0 || run.acc.blocks.length > 0)
      ) {
        await persistStreamEnd(input.sessionId, input.messageId, run.fullText, "error", run.acc);
      }
      this.broadcast(run, { type: "error", data: errorPayload });
    } finally {
      run.done = true;
      // Clear the reference after a brief window so late reconnections can still
      // see the terminal state, but the accumulated data is eventually GC'd.
      setTimeout(() => {
        if (this.activeRun === run) this.activeRun = null;
      }, 30_000);
    }
  }
}

// Singleton
let _runner: AgentRunnerImpl | null = null;

export function getAgentRunner(): AgentRunnerImpl {
  return (_runner ??= new AgentRunnerImpl());
}

export function resetAgentRunner(): void {
  _runner = null;
}
