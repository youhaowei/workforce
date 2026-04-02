import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { ContentBlock } from "@/services/types";
import { useAgentQuestionStore } from "@/ui/stores/useAgentQuestionStore";
import { useMessagesStore } from "@/ui/stores/useMessagesStore";
import QuestionCard from "./QuestionCard";

vi.mock("@/bridge/trpc", () => ({
  trpc: {
    agent: {
      submitAnswer: { mutate: vi.fn() },
      cancel: { mutate: vi.fn() },
    },
    session: {
      updateBlockResult: { mutate: vi.fn() },
    },
  },
}));

class MockIntersectionObserver {
  observe() {}
  disconnect() {}
}

describe("QuestionCard", () => {
  beforeEach(() => {
    vi.stubGlobal("IntersectionObserver", MockIntersectionObserver);
    useAgentQuestionStore.setState({
      pending: null,
      cardVisible: false,
      submittedAnswers: null,
      sendMessage: null,
    });
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
  });

  it("keeps previously answered question blocks in answered state when another question is pending", () => {
    const block: ContentBlock & { type: "tool_use" } = {
      type: "tool_use",
      id: "old_question",
      name: "AskUserQuestion",
      input: "",
      status: "complete",
      inputRaw: {
        questions: [
          {
            id: "scope",
            header: "Scope",
            question: "What should this cover?",
            freeform: false,
            options: [{ label: "Docs", description: "Update docs" }],
          },
        ],
      },
      result: { scope: ["Docs"] },
    };

    useAgentQuestionStore.setState({
      pending: {
        requestId: "live_question",
        sessionId: "sess_1",
        questions: [
          {
            id: "priority",
            header: "Priority",
            question: "How urgent is this?",
            freeform: false,
            options: [{ label: "High", description: "Ship it quickly" }],
            secret: false,
          },
        ],
      },
      cardVisible: false,
      submittedAnswers: null,
      sendMessage: null,
    });

    render(<QuestionCard block={block} />);

    expect(screen.getByText("Question Answered")).toBeInTheDocument();
    expect(screen.getByText("What should this cover?")).toBeInTheDocument();
    expect(screen.getByText("Docs")).toBeInTheDocument();
    expect(screen.queryByText("Agent Question")).not.toBeInTheDocument();
    expect(screen.queryByText("How urgent is this?")).not.toBeInTheDocument();
  });
});
