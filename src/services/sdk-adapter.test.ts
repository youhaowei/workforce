import { describe, it, expect } from "vitest";
import { mapSdkToStreamEvents, bridgeApproval } from "./sdk-adapter";
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
