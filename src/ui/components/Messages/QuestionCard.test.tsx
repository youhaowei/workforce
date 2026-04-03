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

  // ─── AnsweredCard: live SDK string decoding (R11) ───────────────────────────

  describe("AnsweredCard live SDK answer string decoding", () => {
    function makeBlock(result: string): ContentBlock & { type: "tool_use" } {
      return {
        type: "tool_use",
        id: "q1",
        name: "AskUserQuestion",
        input: "",
        status: "complete",
        inputRaw: {
          questions: [
            {
              id: "q",
              header: "",
              question: "What is your choice?",
              freeform: false,
              options: [{ label: "Option A", description: "" }],
            },
          ],
        },
        result,
      };
    }

    it("extracts single answer from SDK format", () => {
      const block = makeBlock(
        'User has answered your questions: "What is your choice?"="Option A".',
      );
      render(<QuestionCard block={block} />);
      expect(screen.getByText("Option A")).toBeInTheDocument();
    });

    it("decodes escaped quotes in answer value", () => {
      const block = makeBlock(
        'User has answered your questions: "What is your choice?"="He said \\"yes\\"".',
      );
      render(<QuestionCard block={block} />);
      expect(screen.getByText('He said "yes"')).toBeInTheDocument();
    });

    it("joins multiple Q/A pairs with comma separator", () => {
      const block = makeBlock('User has answered your questions: "Q1"="A1". "Q2"="B2".');
      render(<QuestionCard block={block} />);
      expect(screen.getByText("A1, B2")).toBeInTheDocument();
    });

    it("falls back to raw string when no pairs found", () => {
      const block = makeBlock("Yes, please proceed.");
      render(<QuestionCard block={block} />);
      expect(screen.getByText("Yes, please proceed.")).toBeInTheDocument();
    });

    it("renders empty string answer when answer value is empty", () => {
      // Empty answer: "Q"="" — pairs match but value is empty string
      const block = makeBlock('User has answered your questions: "What is your choice?"="".');
      render(<QuestionCard block={block} />);
      // Answer span exists (empty content renders as "")
      expect(screen.getByText("Question Answered")).toBeInTheDocument();
    });
  });
});
