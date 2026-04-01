import { describe, it, expect } from "vitest";
import { extractPlansFromRecords } from "./artifact-extractor";
import type { JournalToolCall, JournalRecord } from "./types";

function tc(name: string, input: Record<string, unknown> = {}, seq = 0): JournalToolCall {
  return {
    t: "tool_call",
    seq,
    ts: Date.now(),
    actionId: `tc-${seq}`,
    messageId: `msg-${seq}`,
    name,
    input,
  };
}

describe("extractPlansFromRecords", () => {
  it("extracts a plan from EnterPlanMode → Write(.md) → ExitPlanMode", () => {
    const records: JournalRecord[] = [
      tc("EnterPlanMode", {}, 1),
      tc("Read", { file_path: "/src/foo.ts" }, 2),
      tc("Write", { file_path: "/plans/my-plan.md", content: "# Migration Plan\n\nDo stuff" }, 3),
      tc("ExitPlanMode", {}, 4),
    ];

    const plans = extractPlansFromRecords(records);
    expect(plans).toHaveLength(1);
    expect(plans[0].filePath).toBe("/plans/my-plan.md");
    expect(plans[0].title).toBe("Migration Plan");
    expect(plans[0].content).toBe("# Migration Plan\n\nDo stuff");
  });

  it("takes the last Write to the same path (handles rewrites)", () => {
    const records: JournalRecord[] = [
      tc("EnterPlanMode", {}, 1),
      tc("Write", { file_path: "/plans/plan.md", content: "# Draft 1\n\nOld content" }, 2),
      tc("Write", { file_path: "/plans/plan.md", content: "# Final Plan\n\nNew content" }, 3),
      tc("ExitPlanMode", {}, 4),
    ];

    const plans = extractPlansFromRecords(records);
    expect(plans).toHaveLength(1);
    expect(plans[0].title).toBe("Final Plan");
    expect(plans[0].content).toContain("New content");
  });

  it("ignores Write calls outside plan mode", () => {
    const records: JournalRecord[] = [
      tc("Write", { file_path: "/src/code.ts", content: "export const x = 1;" }, 1),
      tc("Write", { file_path: "/plans/orphan.md", content: "# Orphan" }, 2),
    ];

    const plans = extractPlansFromRecords(records);
    expect(plans).toHaveLength(0);
  });

  it("ignores non-.md Write calls in plan mode", () => {
    const records: JournalRecord[] = [
      tc("EnterPlanMode", {}, 1),
      tc("Write", { file_path: "/src/helper.ts", content: "code" }, 2),
      tc("ExitPlanMode", {}, 3),
    ];

    const plans = extractPlansFromRecords(records);
    expect(plans).toHaveLength(0);
  });

  it("handles EnterPlanMode → ExitPlanMode with no Write (exploration only)", () => {
    const records: JournalRecord[] = [
      tc("EnterPlanMode", {}, 1),
      tc("Read", { file_path: "/src/foo.ts" }, 2),
      tc("Grep", { pattern: "TODO" }, 3),
      tc("ExitPlanMode", {}, 4),
    ];

    const plans = extractPlansFromRecords(records);
    expect(plans).toHaveLength(0);
  });

  it("extracts multiple plans from multiple plan mode sessions", () => {
    const records: JournalRecord[] = [
      tc("EnterPlanMode", {}, 1),
      tc("Write", { file_path: "/plans/plan-a.md", content: "# Plan A" }, 2),
      tc("ExitPlanMode", {}, 3),
      // some non-plan work
      tc("Write", { file_path: "/src/code.ts", content: "code" }, 4),
      // second plan mode
      tc("EnterPlanMode", {}, 5),
      tc("Write", { file_path: "/plans/plan-b.md", content: "# Plan B" }, 6),
      tc("ExitPlanMode", {}, 7),
    ];

    const plans = extractPlansFromRecords(records);
    expect(plans).toHaveLength(2);
    expect(plans[0].title).toBe("Plan A");
    expect(plans[1].title).toBe("Plan B");
  });

  it("falls back to filename for title when no H1 heading", () => {
    const records: JournalRecord[] = [
      tc("EnterPlanMode", {}, 1),
      tc(
        "Write",
        { file_path: "/plans/refactor-auth.md", content: "No heading here\n\nJust text" },
        2,
      ),
      tc("ExitPlanMode", {}, 3),
    ];

    const plans = extractPlansFromRecords(records);
    expect(plans).toHaveLength(1);
    expect(plans[0].title).toBe("refactor-auth");
  });

  it("drops pending writes when plan mode is interrupted (no ExitPlanMode)", () => {
    const records = [
      tc("EnterPlanMode", {}, 1),
      tc("Write", { file_path: "/plans/interrupted.md", content: "# Interrupted" }, 2),
      // no ExitPlanMode
    ];
    expect(extractPlansFromRecords(records)).toHaveLength(0);
  });

  it("skips non-tool_call records", () => {
    const records: JournalRecord[] = [
      {
        t: "message",
        seq: 0,
        ts: Date.now(),
        id: "msg-1",
        role: "user",
        content: "plan something",
      },
      tc("EnterPlanMode", {}, 1),
      {
        t: "message_final",
        seq: 2,
        ts: Date.now(),
        id: "msg-2",
        role: "assistant",
        content: "writing plan",
        stopReason: "tool_use",
      },
      tc("Write", { file_path: "/plans/plan.md", content: "# The Plan" }, 3),
      tc("ExitPlanMode", {}, 4),
    ];

    const plans = extractPlansFromRecords(records);
    expect(plans).toHaveLength(1);
    expect(plans[0].title).toBe("The Plan");
  });
});
