import { afterEach, describe, expect, it, vi } from "vitest";
import type { AgentStreamEvent, Result } from "./types";
import type { SDKAdapterError, SDKQueryHandle } from "./sdk-adapter";

vi.mock("./sdk-adapter", () => ({
  runSDKQuery: vi.fn(),
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

const mockRunSDKQuery = vi.mocked(runSDKQuery);

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
        }),
      }),
    );
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
