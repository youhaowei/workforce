import { describe, it, expect, vi, beforeEach } from "vitest";
import { handleStreamEvent, type StreamEventActions } from "./shellHelpers";

/**
 * Tests for handleStreamEvent — verifies SSE event dispatch to store actions.
 *
 * Key scenarios:
 * - Tool lifecycle: tool_start → tool_result → complete
 * - Task/Explore tools stay running through turn_complete
 * - Regular tools complete on turn_complete
 * - Thinking deltas accumulate
 * - Done event completes all tools
 */

function createMockActions(): StreamEventActions {
  return {
    appendToStreamingMessage: vi.fn(),
    appendToTextBlock: vi.fn(),
    appendToThinkingBlock: vi.fn(),
    addToolActivity: vi.fn(),
    setCurrentTool: vi.fn(),
    startToolBlock: vi.fn(),
    setToolResult: vi.fn(),
    completeRunningTools: vi.fn(),
    completeNonTaskTools: vi.fn(),
    startContentBlock: vi.fn(),
    finishContentBlock: vi.fn(),
    finishStreamingMessage: vi.fn(),
    setError: vi.fn(),
    planReady: vi.fn(),
    agentQuestion: vi.fn(),
  };
}

function makeCancelRef() {
  return { current: null } as { current: (() => void) | null };
}

describe("handleStreamEvent", () => {
  let actions: StreamEventActions;
  let cancelRef: ReturnType<typeof makeCancelRef>;

  beforeEach(() => {
    actions = createMockActions();
    cancelRef = makeCancelRef();
  });

  // ─── Token events ───────────────────────────────────────────────

  it("token event appends to streaming message and text block", () => {
    const done = handleStreamEvent(
      { type: "token", data: "Hello" },
      "sess1",
      "msg1",
      actions,
      cancelRef,
    );

    expect(done).toBe(false);
    expect(actions.appendToStreamingMessage).toHaveBeenCalledWith("Hello");
    expect(actions.appendToTextBlock).toHaveBeenCalledWith("Hello");
    expect(actions.setCurrentTool).toHaveBeenCalledWith(null);
  });

  // ─── Thinking events ───────────────────────────────────────────

  it("thinking_delta appends to thinking block", () => {
    const done = handleStreamEvent(
      { type: "thinking_delta", data: "Let me think..." },
      "sess1",
      "msg1",
      actions,
      cancelRef,
    );

    expect(done).toBe(false);
    expect(actions.appendToThinkingBlock).toHaveBeenCalledWith("Let me think...");
  });

  it("multiple thinking_delta events accumulate", () => {
    handleStreamEvent(
      { type: "thinking_delta", data: "Part 1" },
      "sess1",
      "msg1",
      actions,
      cancelRef,
    );
    handleStreamEvent(
      { type: "thinking_delta", data: " Part 2" },
      "sess1",
      "msg1",
      actions,
      cancelRef,
    );

    expect(actions.appendToThinkingBlock).toHaveBeenCalledTimes(2);
    expect(actions.appendToThinkingBlock).toHaveBeenNthCalledWith(1, "Part 1");
    expect(actions.appendToThinkingBlock).toHaveBeenNthCalledWith(2, " Part 2");
  });

  // ─── Tool lifecycle ─────────────────────────────────────────────

  it("tool_start creates tool block and activity", () => {
    handleStreamEvent(
      { type: "tool_start", name: "Read", input: "file.ts", toolUseId: "tu_1" },
      "sess1",
      "msg1",
      actions,
      cancelRef,
    );

    expect(actions.addToolActivity).toHaveBeenCalledWith("Read", "file.ts");
    expect(actions.setCurrentTool).toHaveBeenCalledWith("Read");
    expect(actions.startToolBlock).toHaveBeenCalledWith("tu_1", "Read", "file.ts", undefined);
  });

  it("tool_result marks tool complete", () => {
    handleStreamEvent(
      { type: "tool_result", toolUseId: "tu_1", result: "content", isError: false },
      "sess1",
      "msg1",
      actions,
      cancelRef,
    );

    expect(actions.setToolResult).toHaveBeenCalledWith("tu_1", "content", false);
  });

  it("tool_result with isError marks tool as error", () => {
    handleStreamEvent(
      { type: "tool_result", toolUseId: "tu_1", result: "fail", isError: true },
      "sess1",
      "msg1",
      actions,
      cancelRef,
    );

    expect(actions.setToolResult).toHaveBeenCalledWith("tu_1", "fail", true);
  });

  // ─── turn_complete ───────────────────────────────────────────────

  it("turn_complete does not complete any tools (relies on tool_result + done)", () => {
    handleStreamEvent({ type: "turn_complete" }, "sess1", "msg1", actions, cancelRef);

    expect(actions.completeRunningTools).not.toHaveBeenCalled();
  });

  // ─── Content block lifecycle ────────────────────────────────────

  it("content_block_start forwards to startContentBlock", () => {
    handleStreamEvent(
      { type: "content_block_start", index: 0, blockType: "text" },
      "sess1",
      "msg1",
      actions,
      cancelRef,
    );

    expect(actions.startContentBlock).toHaveBeenCalledWith(0, "text", undefined, undefined);
  });

  it("content_block_stop forwards to finishContentBlock", () => {
    handleStreamEvent(
      { type: "content_block_stop", index: 0 },
      "sess1",
      "msg1",
      actions,
      cancelRef,
    );

    expect(actions.finishContentBlock).toHaveBeenCalledWith(0);
  });

  // ─── Done event ─────────────────────────────────────────────────

  it("done completes ALL running tools and finishes stream", () => {
    cancelRef.current = vi.fn();

    const done = handleStreamEvent({ type: "done", data: "" }, "sess1", "msg1", actions, cancelRef);

    expect(done).toBe(true);
    expect(actions.completeRunningTools).toHaveBeenCalledTimes(1);
    expect(actions.finishStreamingMessage).toHaveBeenCalledTimes(1);
    expect(cancelRef.current).toBeNull();
  });

  // ─── Error event ────────────────────────────────────────────────

  it("error completes running tools, finishes stream, and sets error", () => {
    const done = handleStreamEvent(
      { type: "error", data: "Something went wrong" },
      "sess1",
      "msg1",
      actions,
      cancelRef,
    );

    expect(done).toBe(true);
    expect(actions.completeRunningTools).toHaveBeenCalledTimes(1);
    expect(actions.finishStreamingMessage).toHaveBeenCalledTimes(1);
    expect(actions.setError).toHaveBeenCalledWith("Something went wrong");
  });

  it("preserves structured auth error codes from the backend", () => {
    const done = handleStreamEvent(
      { type: "error", data: { message: "not authenticated", code: "AUTH_ERROR" } },
      "sess1",
      "msg1",
      actions,
      cancelRef,
    );

    expect(done).toBe(true);
    expect(actions.setError).toHaveBeenCalledWith({
      message: "not authenticated",
      code: "AUTH_ERROR",
    });
    // Structured-error path must still terminate the stream like the string path.
    expect(actions.completeRunningTools).toHaveBeenCalledTimes(1);
    expect(actions.finishStreamingMessage).toHaveBeenCalledTimes(1);
  });

  it("recovers a usable label when the error payload object lacks `message`", () => {
    handleStreamEvent(
      { type: "error", data: { error: "rate limited", code: "RATE_LIMIT" } as unknown as string },
      "sess1",
      "msg1",
      actions,
      cancelRef,
    );

    // `{ error: "..." }` is a common server shape — never surface "[object Object]".
    expect(actions.setError).toHaveBeenCalledWith({
      message: "rate limited",
      code: "RATE_LIMIT",
    });
  });

  // ─── Full streaming scenario ────────────────────────────────────

  it("full scenario: thinking → tools → Task tool → turn_complete → tokens → done", () => {
    // 1. Thinking block starts
    handleStreamEvent(
      { type: "content_block_start", index: 0, blockType: "thinking" },
      "sess1",
      "msg1",
      actions,
      cancelRef,
    );
    handleStreamEvent(
      { type: "thinking_delta", data: "Analyzing..." },
      "sess1",
      "msg1",
      actions,
      cancelRef,
    );
    handleStreamEvent(
      { type: "content_block_stop", index: 0 },
      "sess1",
      "msg1",
      actions,
      cancelRef,
    );

    // 2. Regular tool (Read) starts and completes
    handleStreamEvent(
      { type: "tool_start", name: "Read", input: "f.ts", toolUseId: "tu_1" },
      "sess1",
      "msg1",
      actions,
      cancelRef,
    );
    handleStreamEvent(
      { type: "tool_result", toolUseId: "tu_1", result: "ok", isError: false },
      "sess1",
      "msg1",
      actions,
      cancelRef,
    );

    // 3. Task tool starts (long-running, no individual child results)
    handleStreamEvent(
      { type: "tool_start", name: "Task", input: "explore", toolUseId: "tu_2" },
      "sess1",
      "msg1",
      actions,
      cancelRef,
    );

    // 4. Turn complete — no tools completed (individual tool_result handles that)
    handleStreamEvent({ type: "turn_complete" }, "sess1", "msg1", actions, cancelRef);
    expect(actions.completeRunningTools).not.toHaveBeenCalled();

    // 5. More tokens come in
    handleStreamEvent({ type: "token", data: "Result: " }, "sess1", "msg1", actions, cancelRef);

    // 6. Task tool gets its result
    handleStreamEvent(
      { type: "tool_result", toolUseId: "tu_2", result: "done", isError: false },
      "sess1",
      "msg1",
      actions,
      cancelRef,
    );

    // 7. Stream ends — completes ALL remaining tools
    handleStreamEvent({ type: "done", data: "" }, "sess1", "msg1", actions, cancelRef);
    expect(actions.completeRunningTools).toHaveBeenCalledTimes(1);
    expect(actions.finishStreamingMessage).toHaveBeenCalledTimes(1);

    // Verify thinking was accumulated
    expect(actions.appendToThinkingBlock).toHaveBeenCalledWith("Analyzing...");
  });

  // ─── Plan ready ─────────────────────────────────────────────────

  it("plan_ready forwards path and session", () => {
    handleStreamEvent(
      { type: "plan_ready", path: "/tmp/plan.md" },
      "sess1",
      "msg1",
      actions,
      cancelRef,
    );

    expect(actions.planReady).toHaveBeenCalledWith("/tmp/plan.md", "sess1");
  });

  // ─── Agent question ────────────────────────────────────────────

  it("agent_question forwards requestId and questions", () => {
    const questions = [
      {
        id: "q_0",
        header: "Choice",
        question: "Pick one?",
        freeform: true,
        secret: false,
        options: [{ label: "A", description: "Option A" }],
      },
    ];
    const done = handleStreamEvent(
      { type: "agent_question", requestId: "req_1", questions },
      "sess1",
      "msg1",
      actions,
      cancelRef,
    );

    expect(done).toBe(false);
    expect(actions.completeNonTaskTools).toHaveBeenCalled();
    expect(actions.agentQuestion).toHaveBeenCalledWith("req_1", questions);
  });

  // ─── Unknown events ─────────────────────────────────────────────

  it("unknown event type returns false without side effects", () => {
    const done = handleStreamEvent(
      { type: "unknown_event", data: "whatever" },
      "sess1",
      "msg1",
      actions,
      cancelRef,
    );

    expect(done).toBe(false);
    expect(actions.appendToStreamingMessage).not.toHaveBeenCalled();
    expect(actions.finishStreamingMessage).not.toHaveBeenCalled();
  });
});
