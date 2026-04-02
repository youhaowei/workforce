import { describe, expect, it } from "vitest";
import type { ContentBlock } from "@/services/types";
import { recordSubmittedQuestionAnswer } from "./agent-runner";

describe("recordSubmittedQuestionAnswer", () => {
  it("stores answers on the matching AskUserQuestion block", () => {
    const blocks: ContentBlock[] = [
      { type: "text", text: "Preface", status: "complete" },
      {
        type: "tool_use",
        id: "req_123",
        name: "AskUserQuestion",
        input: "",
        inputRaw: { questions: [{ id: "scope", question: "Scope?" }] },
        status: "running",
      },
    ];

    const changed = recordSubmittedQuestionAnswer(blocks, "req_123", { scope: ["Models only"] });

    expect(changed).toBe(true);
    expect(blocks[1]).toMatchObject({
      type: "tool_use",
      id: "req_123",
      status: "complete",
      result: { scope: ["Models only"] },
    });
  });

  it("falls back to the latest unanswered AskUserQuestion when request ids differ", () => {
    const blocks: ContentBlock[] = [
      {
        type: "tool_use",
        id: "old_question",
        name: "AskUserQuestion",
        input: "",
        status: "complete",
        result: { first: ["Already answered"] },
      },
      {
        type: "tool_use",
        id: "live_question",
        name: "AskUserQuestion",
        input: "",
        status: "running",
      },
    ];

    const changed = recordSubmittedQuestionAnswer(blocks, "request_from_sdk", {
      second: ["Delete everything"],
    });

    expect(changed).toBe(true);
    expect(blocks[0]).toMatchObject({
      type: "tool_use",
      id: "old_question",
      result: { first: ["Already answered"] },
    });
    expect(blocks[1]).toMatchObject({
      type: "tool_use",
      id: "live_question",
      status: "complete",
      result: { second: ["Delete everything"] },
    });
  });
});
