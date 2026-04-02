import { render, screen, act } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useMessagesStore } from "@/ui/stores/useMessagesStore";
import MessageItem from "./MessageItem";

const contentBlockRendererSpy = vi.fn();

vi.mock("./ContentBlockRenderer", () => ({
  default: ({ blocks }: { blocks: Array<{ type: string; text?: string }> }) => {
    contentBlockRendererSpy(blocks);
    return (
      <div data-testid="content-block-renderer">
        {blocks.map((block) => block.text ?? block.type).join(" ")}
      </div>
    );
  },
}));

vi.mock("./QuestionCard", () => ({
  default: () => <div data-testid="question-card" />,
}));

vi.mock("./ToolOutput", () => ({
  default: () => <div data-testid="tool-output" />,
}));

describe("MessageItem streaming subscriptions", () => {
  beforeEach(() => {
    contentBlockRendererSpy.mockClear();
    useMessagesStore.setState({
      streamingContent: "",
      streamingBlocks: [],
      streamingMessageId: null,
      isStreaming: false,
    });
  });

  it("does not rerender finalized assistant rows on streaming updates for another message", () => {
    render(
      <MessageItem
        message={{
          id: "finalized-message",
          role: "assistant",
          content: "Done",
          timestamp: 1,
          isStreaming: false,
          contentBlocks: [{ type: "text", text: "Done", status: "complete" }],
        }}
      />,
    );

    expect(screen.getByTestId("content-block-renderer")).toHaveTextContent("Done");
    expect(contentBlockRendererSpy).toHaveBeenCalledTimes(1);

    act(() => {
      useMessagesStore.setState({
        streamingMessageId: "different-message",
        streamingContent: "still streaming",
        streamingBlocks: [{ type: "text", text: "still streaming", status: "running" }],
        isStreaming: true,
      });
    });

    expect(contentBlockRendererSpy).toHaveBeenCalledTimes(1);
  });
});
