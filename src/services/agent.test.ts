import { afterEach, describe, expect, it, vi } from "vitest";
import type { AgentStreamEvent, Result } from "./types";
import type { SDKAdapterError, SDKQueryHandle } from "./sdk-adapter";
import type { CodexQueryHandle } from "./codex-adapter";

vi.mock("./sdk-adapter", () => ({
  runSDKQuery: vi.fn(),
  buildApprovalQuestion: (toolName: string, input: Record<string, unknown>) => ({
    id: "approval",
    header: "Approve",
    question: `Allow ${toolName}: ${input.command ?? input.file_path ?? JSON.stringify(input)}?`,
    freeform: false,
    secret: false,
    multiSelect: false,
    options: [
      { label: "Approve", description: "Allow this tool use" },
      { label: "Deny", description: "Block this tool use" },
    ],
  }),
}));

vi.mock("./codex-adapter", () => ({
  runCodexQuery: vi.fn(),
}));

vi.mock("./agent-instance", () => {
  class AgentError extends Error {
    readonly _tag = "AgentError" as const;
    readonly cause?: unknown;
    constructor(
      message: string,
      public readonly code: string,
      cause?: unknown,
    ) {
      super(message);
      this.name = "AgentError";
      this.cause = cause;
    }
  }

  return {
    AgentInstance: class AgentInstance {},
    AgentError,
    buildSdkEnv: () => ({ HOME: "/home/test" }),
    isAuthError: (err: unknown) =>
      err instanceof Error && err.message.toLowerCase().includes("auth"),
  };
});

vi.mock("./agent-cli-path", () => ({
  resolveClaudeCliPath: () => "/bin/claude",
}));

const writeLastUsedModel = vi.fn();

vi.mock("./agent-models", () => ({
  ModelCache: class ModelCache {
    getSupportedModels = vi.fn(async () => []);
  },
  readLastUsedModelSync: () => "sonnet",
  writeLastUsedModel: (model: string) => writeLastUsedModel(model),
}));

import { getAgentService, resetAgentService } from "./agent";
import { runSDKQuery } from "./sdk-adapter";
import { runCodexQuery } from "./codex-adapter";

const mockRunSDKQuery = vi.mocked(runSDKQuery);
const mockRunCodexQuery = vi.mocked(runCodexQuery);

async function collect(events: AsyncGenerator<AgentStreamEvent>) {
  const collected: AgentStreamEvent[] = [];
  for await (const event of events) collected.push(event);
  return collected;
}

function mockHandle(
  events: AgentStreamEvent[],
  sessionId: string | null,
): Result<SDKQueryHandle, SDKAdapterError> {
  return {
    ok: true,
    value: {
      events: (async function* () {
        for (const event of events) yield event;
      })(),
      abort: vi.fn(),
      getSessionId: () => sessionId,
      query: {} as SDKQueryHandle["query"],
    },
  };
}

function mockCodexHandle(events: AgentStreamEvent[]): Result<CodexQueryHandle> {
  return {
    ok: true,
    value: {
      events: (async function* () {
        for (const event of events) yield event;
      })(),
      abort: vi.fn(),
    },
  };
}

describe("AgentService direct SDK port", () => {
  afterEach(() => {
    resetAgentService();
    vi.clearAllMocks();
  });

  it("runs through sdk-adapter and formats tool_start input", async () => {
    mockRunSDKQuery.mockReturnValueOnce(
      mockHandle(
        [
          {
            type: "tool_start",
            name: "Bash",
            input: JSON.stringify({ command: "git status" }),
            toolUseId: "tool-1",
            inputRaw: { command: "git status" },
          },
        ],
        "session-1",
      ),
    );

    const service = getAgentService();
    const events = await collect(service.run("hello", { model: "sonnet" }));

    expect(mockRunSDKQuery).toHaveBeenCalledWith(
      "hello",
      expect.objectContaining({
        sdkOptions: expect.objectContaining({
          model: "sonnet",
          cwd: process.cwd(),
          env: { HOME: "/home/test" },
          pathToClaudeCodeExecutable: "/bin/claude",
          includePartialMessages: true,
          settingSources: ["user", "project", "local"],
          systemPrompt: {
            type: "preset",
            preset: "claude_code",
          },
        }),
      }),
    );
    expect(mockRunSDKQuery.mock.calls[0]?.[1].onApprovalRequest).toBeDefined();
    expect(events).toEqual([
      {
        type: "tool_start",
        name: "Bash",
        input: "git status",
        toolUseId: "tool-1",
        inputRaw: { command: "git status" },
      },
    ]);
    expect(writeLastUsedModel).toHaveBeenCalledWith("sonnet");
  });

  it("resumes the previous session when run options still match", async () => {
    mockRunSDKQuery
      .mockReturnValueOnce(mockHandle([], "session-1"))
      .mockReturnValueOnce(mockHandle([], "session-2"));

    const service = getAgentService();
    await collect(service.run("first", { model: "sonnet" }));
    await collect(service.run("second", { model: "sonnet" }));

    expect(mockRunSDKQuery.mock.calls[1]?.[1].sdkOptions).toMatchObject({
      resume: "session-1",
    });
  });

  it("routes Codex provider runs through the app-server adapter", async () => {
    mockRunCodexQuery.mockReturnValueOnce(mockCodexHandle([{ type: "token", token: "ok" }]));

    const service = getAgentService();
    const events = await collect(
      service.run("hello", {
        provider: "codex",
        model: "gpt-5.4",
        permissionMode: "default",
      }),
    );

    expect(mockRunCodexQuery).toHaveBeenCalledWith(
      "hello",
      expect.objectContaining({
        model: "gpt-5.4",
        cwd: process.cwd(),
        permissionMode: "default",
      }),
    );
    expect(mockRunSDKQuery).not.toHaveBeenCalled();
    expect(events).toEqual([{ type: "token", token: "ok" }]);
    expect(writeLastUsedModel).toHaveBeenCalledWith("gpt-5.4");
  });

  it("exposes blocking agent questions until submitAnswer resolves them", async () => {
    mockRunSDKQuery.mockReturnValueOnce(mockHandle([], "session-1"));
    const service = getAgentService();

    const run = service.run("question");
    await run.next();
    const onAgentQuestion = mockRunSDKQuery.mock.calls[0]?.[1].onAgentQuestion;
    expect(onAgentQuestion).toBeDefined();

    const response = onAgentQuestion!({
      id: "question-1",
      questions: [
        {
          id: "q1",
          header: "Choice",
          question: "Pick one",
          freeform: true,
          secret: false,
        },
      ],
    });

    expect(service.getPendingQuestion()).toMatchObject({
      requestId: "question-1",
      questions: [{ id: "q1", question: "Pick one" }],
    });

    service.submitAnswer("question-1", { q1: ["answer"] });
    await expect(response).resolves.toEqual({ answers: { q1: ["answer"] } });
    expect(service.getPendingQuestion()).toBeNull();
  });

  it("surfaces SDK approval requests through the pending question flow", async () => {
    mockRunSDKQuery.mockReturnValueOnce(mockHandle([], "session-1"));
    const service = getAgentService();

    const run = service.run("approval");
    await run.next();
    const onApprovalRequest = mockRunSDKQuery.mock.calls[0]?.[1].onApprovalRequest;
    expect(onApprovalRequest).toBeDefined();

    const decision = onApprovalRequest!({
      description: "Tool: Bash",
      detail: { command: "git status" },
      toolUseID: "tool-approval-1",
    });

    expect(service.getPendingQuestion()).toMatchObject({
      requestId: "tool-approval-1",
      questions: [
        {
          id: "approval",
          question: "Allow Bash: git status?",
        },
      ],
    });

    service.submitAnswer("tool-approval-1", { approval: ["Approve"] });
    await expect(decision).resolves.toBe("approve");
    expect(service.getPendingQuestion()).toBeNull();
  });

  it("clears pending questions when a run fails with a non-abort error", async () => {
    let rejectStream: () => void = () => {};
    mockRunSDKQuery.mockReturnValueOnce({
      ok: true,
      value: {
        events: (async function* () {
          await new Promise<void>((resolve) => {
            rejectStream = resolve;
          });
          throw new Error("network dropped");
        })(),
        abort: vi.fn(),
        getSessionId: () => null,
        query: {} as SDKQueryHandle["query"],
      },
    });

    const service = getAgentService();
    const iterator = service.run("question then fail");
    const nextEvent = iterator.next();
    const onAgentQuestion = mockRunSDKQuery.mock.calls[0]?.[1].onAgentQuestion;
    expect(onAgentQuestion).toBeDefined();

    const response = onAgentQuestion!({
      id: "question-1",
      questions: [
        {
          id: "q1",
          header: "Choice",
          question: "Pick one",
          freeform: true,
          secret: false,
        },
      ],
    });

    expect(service.getPendingQuestion()).toMatchObject({ requestId: "question-1" });
    rejectStream();

    await expect(nextEvent).rejects.toThrow("network dropped");
    await expect(response).resolves.toEqual({ answers: {} });
    expect(service.getPendingQuestion()).toBeNull();
  });

  it("emits a cancelled token when Query.close drains the SDK stream cleanly", async () => {
    let releaseStream: () => void = () => {};
    const abort = vi.fn(() => releaseStream());
    mockRunSDKQuery.mockReturnValueOnce({
      ok: true,
      value: {
        events: (async function* () {
          await new Promise<void>((resolve) => {
            releaseStream = resolve;
          });
        })(),
        abort,
        getSessionId: () => "session-1",
        query: {} as SDKQueryHandle["query"],
      },
    });

    const service = getAgentService();
    const iterator = service.run("cancel me", { model: "sonnet" });
    const nextEvent = iterator.next();

    service.cancel();

    await expect(nextEvent).resolves.toEqual({
      value: { type: "token", token: " [cancelled]" },
      done: false,
    });
    expect(abort).toHaveBeenCalledOnce();
    await expect(iterator.next()).resolves.toMatchObject({ done: true });
  });

  it("drops warm resume state when cancelling a resumed run", async () => {
    let releaseStream: () => void = () => {};
    const abort = vi.fn(() => releaseStream());
    mockRunSDKQuery
      .mockReturnValueOnce(mockHandle([], "session-1"))
      .mockReturnValueOnce({
        ok: true,
        value: {
          events: (async function* () {
            await new Promise<void>((resolve) => {
              releaseStream = resolve;
            });
          })(),
          abort,
          getSessionId: () => "session-1",
          query: {} as SDKQueryHandle["query"],
        },
      })
      .mockReturnValueOnce(mockHandle([], "session-2"));

    const service = getAgentService();
    await collect(service.run("first", { model: "sonnet" }));

    const resumedRun = service.run("cancel resumed", { model: "sonnet" });
    const cancelledEvent = resumedRun.next();
    expect(mockRunSDKQuery.mock.calls[1]?.[1].sdkOptions).toMatchObject({
      resume: "session-1",
    });

    service.cancel();

    await expect(cancelledEvent).resolves.toMatchObject({
      value: { type: "token", token: " [cancelled]" },
    });
    await expect(resumedRun.next()).resolves.toMatchObject({ done: true });

    await collect(service.run("after cancel", { model: "sonnet" }));
    expect(mockRunSDKQuery.mock.calls[2]?.[1].sdkOptions).not.toHaveProperty("resume");
  });

  it("clears plan mode when ExitPlanMode arrives without a written plan", async () => {
    mockRunSDKQuery.mockReturnValueOnce(
      mockHandle(
        [
          {
            type: "tool_start",
            name: "EnterPlanMode",
            input: "",
            toolUseId: "tool-1",
            inputRaw: {},
          },
          {
            type: "tool_start",
            name: "ExitPlanMode",
            input: "",
            toolUseId: "tool-2",
            inputRaw: {},
          },
          {
            type: "tool_start",
            name: "Write",
            input: "",
            toolUseId: "tool-3",
            inputRaw: { file_path: "/tmp/not-a-plan.md" },
          },
          {
            type: "tool_start",
            name: "ExitPlanMode",
            input: "",
            toolUseId: "tool-4",
            inputRaw: {},
          },
        ],
        "session-1",
      ),
    );

    const service = getAgentService();
    const events = await collect(service.run("plan mode", { model: "sonnet" }));

    expect(events.some((event) => event.type === "plan_ready")).toBe(false);
  });
});
