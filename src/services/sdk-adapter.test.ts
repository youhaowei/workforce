import { describe, it, expect } from "vitest";
import {
  mapSdkToStreamEvents,
  bridgeApproval,
  flushPendingTools,
  backfillText,
  processMessage,
} from "./sdk-adapter";
import type { AgentStreamEvent } from "./types";

// Helper: collect all events from a generator
function collect(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  msg: any,
  toolRegistry = new Map<string, string>(),
): AgentStreamEvent[] {
  return [...mapSdkToStreamEvents(msg, toolRegistry)];
}

// ---------------------------------------------------------------------------
// system messages
// ---------------------------------------------------------------------------

describe("mapSdkToStreamEvents — system messages", () => {
  it("maps system/init to status event", () => {
    const events = collect({
      type: "system",
      subtype: "init",
      session_id: "sess-1",
      model: "haiku",
      tools: ["Bash"],
      cwd: "/tmp",
    });
    expect(events).toEqual([{ type: "status", message: "Session initialized" }]);
  });

  it("maps system/status to status event", () => {
    const events = collect({ type: "system", subtype: "status", status: "compacting" });
    expect(events).toEqual([{ type: "status", message: "compacting" }]);
  });
});

// ---------------------------------------------------------------------------
// stream_event → content block / token / thinking
// ---------------------------------------------------------------------------

describe("mapSdkToStreamEvents — stream events", () => {
  it("maps content_block_start for text", () => {
    const events = collect({
      type: "stream_event",
      event: {
        type: "content_block_start",
        index: 0,
        content_block: { type: "text" },
      },
    });
    expect(events).toEqual([
      { type: "content_block_start", index: 0, blockType: "text", id: undefined, name: undefined },
    ]);
  });

  it("maps content_block_start for tool_use and registers in tool registry", () => {
    const registry = new Map<string, string>();
    const events = collect(
      {
        type: "stream_event",
        event: {
          type: "content_block_start",
          index: 1,
          content_block: { type: "tool_use", id: "tu_1", name: "Bash" },
        },
      },
      registry,
    );
    expect(events[0]).toMatchObject({
      type: "content_block_start",
      blockType: "tool_use",
      id: "tu_1",
      name: "Bash",
    });
    expect(registry.get("tu_1")).toBe("Bash");
  });

  it("maps content_block_stop", () => {
    const events = collect({
      type: "stream_event",
      event: { type: "content_block_stop", index: 2 },
    });
    expect(events).toEqual([{ type: "content_block_stop", index: 2 }]);
  });

  it("maps text_delta to token event", () => {
    const events = collect({
      type: "stream_event",
      event: {
        type: "content_block_delta",
        delta: { type: "text_delta", text: "hello" },
      },
    });
    expect(events).toEqual([{ type: "token", token: "hello" }]);
  });

  it("maps thinking_delta", () => {
    const events = collect({
      type: "stream_event",
      event: {
        type: "content_block_delta",
        delta: { type: "thinking_delta", thinking: "hmm" },
      },
    });
    expect(events).toEqual([{ type: "thinking_delta", text: "hmm" }]);
  });

  it("maps message_stop to turn_complete", () => {
    const events = collect({
      type: "stream_event",
      event: { type: "message_stop" },
    });
    expect(events).toEqual([{ type: "turn_complete" }]);
  });

  it("ignores stream_event with no event payload", () => {
    expect(collect({ type: "stream_event" })).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// assistant message → tool_start
// ---------------------------------------------------------------------------

describe("mapSdkToStreamEvents — assistant messages", () => {
  it("maps tool_use blocks to tool_start events", () => {
    const registry = new Map<string, string>();
    const events = collect(
      {
        type: "assistant",
        message: {
          content: [
            { type: "tool_use", id: "tu_abc", name: "Bash", input: { command: "git status" } },
          ],
        },
      },
      registry,
    );
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: "tool_start",
      name: "Bash",
      toolUseId: "tu_abc",
      inputRaw: { command: "git status" },
    });
    expect(registry.get("tu_abc")).toBe("Bash");
  });

  it("ignores text-only assistant messages", () => {
    const events = collect({
      type: "assistant",
      message: {
        content: [{ type: "text", text: "Done." }],
      },
    });
    expect(events).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// user message → tool_result
// ---------------------------------------------------------------------------

describe("mapSdkToStreamEvents — user messages (tool results)", () => {
  it("extracts tool_result from user message and resolves tool name from registry", () => {
    const registry = new Map([["tu_abc", "Bash"]]);
    const events = collect(
      {
        type: "user",
        message: {
          content: [
            { type: "tool_result", tool_use_id: "tu_abc", content: "output", is_error: false },
          ],
        },
      },
      registry,
    );
    expect(events).toEqual([
      {
        type: "tool_result",
        toolUseId: "tu_abc",
        toolName: "Bash",
        result: "output",
        isError: false,
      },
    ]);
    // Registry entry should be removed after resolution
    expect(registry.has("tu_abc")).toBe(false);
  });

  it("handles tool_result with unknown tool_use_id", () => {
    const events = collect({
      type: "user",
      message: {
        content: [
          { type: "tool_result", tool_use_id: "tu_unknown", content: null, is_error: true },
        ],
      },
    });
    expect(events[0]).toMatchObject({
      type: "tool_result",
      toolUseId: "tu_unknown",
      toolName: "",
      isError: true,
    });
  });
});

// ---------------------------------------------------------------------------
// bridgeApproval
// ---------------------------------------------------------------------------

describe("bridgeApproval", () => {
  it("maps approve decision to allow behavior", async () => {
    const canUseTool = bridgeApproval(async () => "approve");
    const result = await canUseTool(
      "Bash",
      { command: "ls" },
      {
        signal: new AbortController().signal,
        toolUseID: "tu_1",
      },
    );
    expect(result).toMatchObject({ behavior: "allow" });
  });

  it("maps deny decision to deny behavior", async () => {
    const canUseTool = bridgeApproval(async () => "deny");
    const result = await canUseTool(
      "Bash",
      { command: "rm -rf /" },
      {
        signal: new AbortController().signal,
        toolUseID: "tu_2",
      },
    );
    expect(result).toMatchObject({ behavior: "deny" });
  });

  it("passes tool name and input to the approval handler", async () => {
    let captured: { description: string; detail: unknown } | null = null;
    const canUseTool = bridgeApproval(async (req) => {
      captured = req;
      return "approve";
    });
    await canUseTool(
      "Read",
      { file: "test.ts" },
      {
        signal: new AbortController().signal,
        toolUseID: "tu_3",
      },
    );
    expect(captured).toMatchObject({
      description: "Tool: Read",
      detail: { file: "test.ts" },
      toolUseID: "tu_3",
    });
    expect(captured!).toHaveProperty("signal");
  });
});

// ---------------------------------------------------------------------------
// result messages — no stream events expected
// ---------------------------------------------------------------------------

describe("mapSdkToStreamEvents — result messages", () => {
  it("produces no events for result messages", () => {
    const events = collect({
      type: "result",
      subtype: "success",
      result: "done",
      duration_ms: 1000,
    });
    expect(events).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// flushPendingTools
// ---------------------------------------------------------------------------

describe("flushPendingTools", () => {
  it("yields tool_result for each pending tool and clears the registry", () => {
    const registry = new Map([
      ["tu_1", "Bash"],
      ["tu_2", "Read"],
    ]);
    const events = [...flushPendingTools(registry, false)];
    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({
      type: "tool_result",
      toolUseId: "tu_1",
      toolName: "Bash",
      isError: false,
      result: undefined,
    });
    expect(events[1]).toMatchObject({
      type: "tool_result",
      toolUseId: "tu_2",
      toolName: "Read",
      isError: false,
      result: undefined,
    });
    expect(registry.size).toBe(0);
  });

  it("sets isError=true and result message for orphaned tools at stream end", () => {
    const registry = new Map([["tu_x", "Edit"]]);
    const events = [...flushPendingTools(registry, true)];
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: "tool_result",
      toolUseId: "tu_x",
      toolName: "Edit",
      isError: true,
      result: "Tool execution ended without result",
    });
  });

  it("yields nothing when registry is empty", () => {
    const events = [...flushPendingTools(new Map(), true)];
    expect(events).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// backfillText
// ---------------------------------------------------------------------------

describe("backfillText", () => {
  it("synthesizes content_block_start/token/stop from assistant text blocks", () => {
    const events = [
      ...backfillText({
        message: {
          content: [
            { type: "text", text: "Hello" },
            { type: "tool_use", id: "tu_1", name: "Bash", input: {} },
            { type: "text", text: "World" },
          ],
        },
      }),
    ];
    // Should only backfill text blocks (indices 0 and 2 in content array)
    expect(events).toEqual([
      { type: "content_block_start", index: 0, blockType: "text" },
      { type: "token", token: "Hello" },
      { type: "content_block_stop", index: 0 },
      { type: "content_block_start", index: 2, blockType: "text" },
      { type: "token", token: "World" },
      { type: "content_block_stop", index: 2 },
    ]);
  });

  it("skips blocks with empty text", () => {
    const events = [
      ...backfillText({
        message: { content: [{ type: "text", text: "" }] },
      }),
    ];
    expect(events).toEqual([]);
  });

  it("yields nothing when message has no content", () => {
    expect([...backfillText({ message: {} })]).toEqual([]);
    expect([...backfillText({})]).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// processMessage — multi-turn orchestration
// ---------------------------------------------------------------------------

describe("processMessage", () => {
  function process(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    msgs: any[],
    toolRegistry = new Map<string, string>(),
    state = { streamedTextThisTurn: false },
  ): AgentStreamEvent[] {
    const events: AgentStreamEvent[] = [];
    for (const msg of msgs) {
      events.push(...processMessage(msg, toolRegistry, state));
    }
    return events;
  }

  it("flushes pending tools at turn boundary (message_start)", () => {
    const registry = new Map([["tu_1", "Bash"]]);
    const events = process(
      [
        // New turn starts — should flush tu_1 before emitting message_start events
        {
          type: "stream_event",
          event: { type: "message_start", message: { id: "msg_2", model: "haiku" } },
        },
      ],
      registry,
    );
    // First event should be the flushed tool_result
    const toolResults = events.filter((e) => e.type === "tool_result");
    expect(toolResults).toHaveLength(1);
    expect(toolResults[0]).toMatchObject({ toolUseId: "tu_1", toolName: "Bash", isError: false });
    expect(registry.size).toBe(0);
  });

  it("simulates full multi-turn: assistant → tool_start → user tool_result → new turn", () => {
    const registry = new Map<string, string>();
    const state = { streamedTextThisTurn: false };

    // Turn 1: stream text, then assistant message with tool_use
    const turn1 = [
      { type: "stream_event", event: { type: "message_start", message: { id: "msg_1" } } },
      {
        type: "stream_event",
        event: {
          type: "content_block_delta",
          delta: { type: "text_delta", text: "Let me check." },
        },
      },
      {
        type: "assistant",
        message: {
          content: [
            { type: "tool_use", id: "tu_1", name: "Bash", input: { command: "git status" } },
          ],
        },
      },
    ];
    const events1 = process(turn1, registry, state);

    // tool_start should be emitted, tool registered
    const toolStarts = events1.filter((e) => e.type === "tool_start");
    expect(toolStarts).toHaveLength(1);
    expect(toolStarts[0]).toMatchObject({ name: "Bash", toolUseId: "tu_1" });
    expect(registry.get("tu_1")).toBe("Bash");

    // User message with tool_result resolves it
    const turn1result = [
      {
        type: "user",
        message: {
          content: [
            {
              type: "tool_result",
              tool_use_id: "tu_1",
              content: "On branch main",
              is_error: false,
            },
          ],
        },
      },
    ];
    const eventsResult = process(turn1result, registry, state);
    const toolResults = eventsResult.filter((e) => e.type === "tool_result");
    expect(toolResults).toHaveLength(1);
    expect(toolResults[0]).toMatchObject({ toolUseId: "tu_1", toolName: "Bash", isError: false });
    expect(registry.size).toBe(0);

    // Turn 2: new message_start — no pending tools to flush
    const turn2 = [
      { type: "stream_event", event: { type: "message_start", message: { id: "msg_2" } } },
      {
        type: "stream_event",
        event: { type: "content_block_delta", delta: { type: "text_delta", text: "Done." } },
      },
    ];
    const events2 = process(turn2, registry, state);
    // No tool_result should be synthesized
    expect(events2.filter((e) => e.type === "tool_result")).toHaveLength(0);
  });

  it("backfills text when no stream text_deltas were emitted", () => {
    const registry = new Map<string, string>();
    const state = { streamedTextThisTurn: false };

    // message_start without any text_delta, then assistant with text
    const msgs = [
      { type: "stream_event", event: { type: "message_start", message: { id: "msg_1" } } },
      // No text_delta events — thinking mode suppressed them
      { type: "assistant", message: { content: [{ type: "text", text: "Backfilled text" }] } },
    ];
    const events = process(msgs, registry, state);

    // Should see synthesized content_block_start → token → content_block_stop
    const tokens = events.filter((e) => e.type === "token");
    expect(tokens).toHaveLength(1);
    expect(tokens[0]).toMatchObject({ token: "Backfilled text" });

    const blockStarts = events.filter((e) => e.type === "content_block_start");
    expect(blockStarts.length).toBeGreaterThanOrEqual(1);
  });

  it("does NOT backfill when stream text_deltas were present", () => {
    const registry = new Map<string, string>();
    const state = { streamedTextThisTurn: false };

    const msgs = [
      { type: "stream_event", event: { type: "message_start", message: { id: "msg_1" } } },
      {
        type: "stream_event",
        event: { type: "content_block_delta", delta: { type: "text_delta", text: "Streamed" } },
      },
      { type: "assistant", message: { content: [{ type: "text", text: "Streamed" }] } },
    ];
    const events = process(msgs, registry, state);

    // Only one token from the stream_event, none from backfill
    const tokens = events.filter((e) => e.type === "token");
    expect(tokens).toHaveLength(1);
    expect(tokens[0]).toMatchObject({ token: "Streamed" });
  });

  it("resets text tracking on each new turn", () => {
    const registry = new Map<string, string>();
    const state = { streamedTextThisTurn: false };

    // Turn 1: has text_delta
    process(
      [
        { type: "stream_event", event: { type: "message_start", message: { id: "msg_1" } } },
        {
          type: "stream_event",
          event: { type: "content_block_delta", delta: { type: "text_delta", text: "hi" } },
        },
      ],
      registry,
      state,
    );
    expect(state.streamedTextThisTurn).toBe(true);

    // Turn 2: message_start resets
    process(
      [{ type: "stream_event", event: { type: "message_start", message: { id: "msg_2" } } }],
      registry,
      state,
    );
    expect(state.streamedTextThisTurn).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// bridgeApproval — error handling
// ---------------------------------------------------------------------------

describe("bridgeApproval — error handling", () => {
  it("returns deny when approval callback throws", async () => {
    const canUseTool = bridgeApproval(async () => {
      throw new Error("callback exploded");
    });
    const result = await canUseTool(
      "Bash",
      { command: "ls" },
      {
        signal: new AbortController().signal,
        toolUseID: "tu_err",
      },
    );
    expect(result).toMatchObject({ behavior: "deny" });
  });
});
