import { describe, it, expect, beforeEach } from "vitest";
import { useMessagesStore } from "./useMessagesStore";

/**
 * Tests for useMessagesStore — streaming block actions.
 *
 * Verifies that completeNonTaskTools correctly skips Task/Explore tools
 * while completeRunningTools marks ALL tools complete.
 */

function resetStore() {
  useMessagesStore.setState({
    messages: [],
    activeSessionId: null,
    streamingContent: "",
    streamingBlocks: [],
    streamingMessageId: null,
    isStreaming: false,
    pendingToolActivities: [],
    currentTool: null,
    draftInput: null,
  });
}

describe("useMessagesStore", () => {
  beforeEach(resetStore);

  describe("completeNonTaskTools", () => {
    it("completes regular tools but keeps Task tool running", () => {
      const store = useMessagesStore.getState();

      // Start assistant message to enable streaming
      store.startAssistantMessage();

      // Add tool blocks: Read (regular), Task (should stay running), Grep (regular)
      store.startToolBlock("tu_1", "Read", "file.ts");
      store.startToolBlock("tu_2", "Task", "explore codebase");
      store.startToolBlock("tu_3", "Grep", "pattern");

      // All should be running
      let blocks = useMessagesStore.getState().streamingBlocks;
      expect(blocks.filter((b) => b.type === "tool_use" && b.status === "running")).toHaveLength(3);

      // Complete non-task tools
      useMessagesStore.getState().completeNonTaskTools();

      blocks = useMessagesStore.getState().streamingBlocks;
      const toolBlocks = blocks.filter(
        (b): b is Extract<typeof b, { type: "tool_use" }> => b.type === "tool_use",
      );

      // Read and Grep should be complete, Task should still be running
      expect(toolBlocks.find((b) => b.name === "Read")?.status).toBe("complete");
      expect(toolBlocks.find((b) => b.name === "Grep")?.status).toBe("complete");
      expect(toolBlocks.find((b) => b.name === "Task")?.status).toBe("running");
    });

    it("keeps Explore tool running", () => {
      const store = useMessagesStore.getState();
      store.startAssistantMessage();
      store.startToolBlock("tu_1", "Explore", "search patterns");
      store.startToolBlock("tu_2", "Edit", "file.ts");

      useMessagesStore.getState().completeNonTaskTools();

      const blocks = useMessagesStore.getState().streamingBlocks;
      const toolBlocks = blocks.filter(
        (b): b is Extract<typeof b, { type: "tool_use" }> => b.type === "tool_use",
      );

      expect(toolBlocks.find((b) => b.name === "Explore")?.status).toBe("running");
      expect(toolBlocks.find((b) => b.name === "Edit")?.status).toBe("complete");
    });

    it("does nothing when no running tools exist", () => {
      const store = useMessagesStore.getState();
      store.startAssistantMessage();
      store.startToolBlock("tu_1", "Read", "file.ts");
      store.setToolResult("tu_1", "content", false);

      useMessagesStore.getState().completeNonTaskTools();

      const blocks = useMessagesStore.getState().streamingBlocks;
      const toolBlocks = blocks.filter(
        (b): b is Extract<typeof b, { type: "tool_use" }> => b.type === "tool_use",
      );
      expect(toolBlocks[0].status).toBe("complete");
    });
  });

  describe("completeRunningTools", () => {
    it("completes ALL running tools including Task", () => {
      const store = useMessagesStore.getState();
      store.startAssistantMessage();
      store.startToolBlock("tu_1", "Task", "long running");
      store.startToolBlock("tu_2", "Explore", "search");
      store.startToolBlock("tu_3", "Read", "file.ts");

      useMessagesStore.getState().completeRunningTools();

      const blocks = useMessagesStore.getState().streamingBlocks;
      const toolBlocks = blocks.filter(
        (b): b is Extract<typeof b, { type: "tool_use" }> => b.type === "tool_use",
      );
      expect(toolBlocks.every((b) => b.status === "complete")).toBe(true);
    });
  });

  describe("thinking blocks", () => {
    it("appendToThinkingBlock creates block if none exists", () => {
      const store = useMessagesStore.getState();
      store.startAssistantMessage();

      store.appendToThinkingBlock("thinking...");

      const blocks = useMessagesStore.getState().streamingBlocks;
      expect(blocks).toHaveLength(1);
      expect(blocks[0]).toEqual({ type: "thinking", text: "thinking...", status: "running" });
    });

    it("appendToThinkingBlock appends to existing thinking block", () => {
      const store = useMessagesStore.getState();
      store.startAssistantMessage();
      store.startContentBlock(0, "thinking");

      store.appendToThinkingBlock("part 1");
      store.appendToThinkingBlock(" part 2");

      const blocks = useMessagesStore.getState().streamingBlocks;
      expect(blocks).toHaveLength(1);
      expect(blocks[0]).toEqual({ type: "thinking", text: "part 1 part 2", status: "running" });
    });

    it("thinking deltas after tool block create new thinking block", () => {
      const store = useMessagesStore.getState();
      store.startAssistantMessage();
      store.startContentBlock(0, "thinking");
      store.appendToThinkingBlock("first thought");
      store.startToolBlock("tu_1", "Read", "file.ts");

      // Now thinking delta arrives — last block is tool_use, not thinking
      store.appendToThinkingBlock("second thought");

      const blocks = useMessagesStore.getState().streamingBlocks;
      expect(blocks).toHaveLength(3);
      // First thinking block was completed when startToolBlock pushed a new block
      expect(blocks[0]).toEqual({ type: "thinking", text: "first thought", status: "complete" });
      expect(blocks[2]).toEqual({ type: "thinking", text: "second thought", status: "running" });
    });

    it("finishContentBlock marks running thinking block as complete", () => {
      const store = useMessagesStore.getState();
      store.startAssistantMessage();
      store.startContentBlock(0, "thinking");
      store.appendToThinkingBlock("done thinking");
      store.finishContentBlock(0);

      const blocks = useMessagesStore.getState().streamingBlocks;
      expect(blocks[0]).toEqual({ type: "thinking", text: "done thinking", status: "complete" });
    });

    it("finishContentBlock marks running text block as complete", () => {
      const store = useMessagesStore.getState();
      store.startAssistantMessage();
      store.startContentBlock(0, "text");
      store.appendToTextBlock("some text");
      store.finishContentBlock(0);

      const blocks = useMessagesStore.getState().streamingBlocks;
      expect(blocks[0]).toEqual({ type: "text", text: "some text", status: "complete" });
    });
  });
});
