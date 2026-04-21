import { describe, it, expect, vi, afterEach } from "vitest";
import type { AgentStreamEvent, Result } from "./types";
import type { SDKAdapterError, SDKQueryHandle } from "./sdk-adapter";

// Mock sdk-adapter before importing agent-instance
vi.mock("./sdk-adapter", () => ({
  runSDKQuery: vi.fn(),
  SDKAdapterError: class SDKAdapterError extends Error {
    readonly _tag = "SDKAdapterError" as const;
    readonly cause?: unknown;
    constructor(message: string, cause?: unknown) {
      super(message);
      this.name = "SDKAdapterError";
      this.cause = cause;
    }
  },
}));

// Sentinel return so event-level assertions can independently verify that
// postProcess actually swapped in the formatted value (rather than passing
// through the raw input by coincidence).
const FORMATTED_SENTINEL = "<<FORMATTED>>";
vi.mock("./agent", () => ({
  formatToolInput: vi.fn((_name: string, _input: unknown) => "<<FORMATTED>>"),
}));

import { buildSdkEnv, isAuthError, AgentError, AgentInstance } from "./agent-instance";
import { runSDKQuery, SDKAdapterError as SDKAdapterErrorClass } from "./sdk-adapter";
import { formatToolInput } from "./agent";

const mockRunSDKQuery = vi.mocked(runSDKQuery);
const mockFormatToolInput = vi.mocked(formatToolInput);

/** Build a mock SDKQueryHandle that yields the given events. */
function mockHandle(
  events: AgentStreamEvent[] | (() => AsyncGenerator<AgentStreamEvent>),
): Result<SDKQueryHandle, SDKAdapterError> {
  const gen =
    typeof events === "function"
      ? events()
      : (async function* () {
          for (const e of events) yield e;
        })();
  const abortFn = vi.fn();
  return {
    ok: true,
    value: {
      events: gen,
      abort: abortFn,
      query: {} as SDKQueryHandle["query"],
    },
  };
}

describe("agent-instance", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("buildSdkEnv", () => {
    it("returns process.env with HOME set", () => {
      const env = buildSdkEnv();
      expect(env.HOME).toBeDefined();
      expect(typeof env.HOME).toBe("string");
    });

    it("preserves existing HOME", () => {
      const originalHome = process.env.HOME;
      const env = buildSdkEnv();
      expect(env.HOME).toBe(originalHome);
    });

    it("strips CLAUDECODE markers so the SDK subprocess doesn't detect a nested session", () => {
      const originals = {
        CLAUDECODE: process.env.CLAUDECODE,
        CLAUDE_CODE_SSE_PORT: process.env.CLAUDE_CODE_SSE_PORT,
      };
      process.env.CLAUDECODE = "1";
      process.env.CLAUDE_CODE_SSE_PORT = "12345";
      try {
        const env = buildSdkEnv();
        expect(env.CLAUDECODE).toBeUndefined();
        expect(env.CLAUDE_CODE_SSE_PORT).toBeUndefined();
      } finally {
        if (originals.CLAUDECODE === undefined) delete process.env.CLAUDECODE;
        else process.env.CLAUDECODE = originals.CLAUDECODE;
        if (originals.CLAUDE_CODE_SSE_PORT === undefined) delete process.env.CLAUDE_CODE_SSE_PORT;
        else process.env.CLAUDE_CODE_SSE_PORT = originals.CLAUDE_CODE_SSE_PORT;
      }
    });

    it("sets HOME from homedir() when missing", () => {
      const originalHome = process.env.HOME;
      delete process.env.HOME;
      try {
        const env = buildSdkEnv();
        expect(env.HOME).toBeDefined();
        expect(env.HOME!.length).toBeGreaterThan(0);
      } finally {
        process.env.HOME = originalHome;
      }
    });
  });

  describe("isAuthError", () => {
    it.each([
      "authentication failed",
      "Unauthorized access",
      "HTTP 401 error",
      "invalid api key provided",
      "api key expired",
      "not authenticated",
      "credential error",
    ])('returns true for "%s"', (msg) => {
      expect(isAuthError(new Error(msg))).toBe(true);
    });

    it("returns false for non-auth errors", () => {
      expect(isAuthError(new Error("network timeout"))).toBe(false);
      expect(isAuthError(new Error("rate limited"))).toBe(false);
    });

    it("returns false for non-Error values", () => {
      expect(isAuthError("string error")).toBe(false);
      expect(isAuthError(null)).toBe(false);
      expect(isAuthError(42)).toBe(false);
    });
  });

  describe("AgentError", () => {
    it("has correct name, code, and cause", () => {
      const cause = new Error("root cause");
      const err = new AgentError("failed", "AUTH_ERROR", cause);
      expect(err.name).toBe("AgentError");
      expect(err.message).toBe("failed");
      expect(err.code).toBe("AUTH_ERROR");
      expect(err.cause).toBe(cause);
    });

    it("is an instance of Error", () => {
      const err = new AgentError("test", "UNKNOWN");
      expect(err).toBeInstanceOf(Error);
    });
  });

  describe("AgentInstance", () => {
    it("throws if run is called while already running", async () => {
      let resolveHang!: () => void;
      mockRunSDKQuery.mockReturnValueOnce(
        mockHandle(async function* () {
          yield { type: "token", token: "hi" };
          await new Promise<void>((r) => {
            resolveHang = r;
          });
        }),
      );

      const instance = new AgentInstance("sess-1", { cwd: "/tmp" });

      const gen = instance.run("first prompt");
      await gen.next();

      const gen2 = instance.run("second prompt");
      await expect(gen2.next()).rejects.toThrow("Query already in progress");

      instance.cancel();
      resolveHang?.();
      try {
        await gen.return(undefined);
      } catch {
        /* cleanup */
      }
    });

    it("passes through token events from adapter", async () => {
      mockRunSDKQuery.mockReturnValueOnce(
        mockHandle([
          { type: "token", token: "hello " },
          { type: "token", token: "world" },
        ]),
      );

      const instance = new AgentInstance("sess-1", { cwd: "/tmp" });
      const events: unknown[] = [];
      for await (const event of instance.run("test")) {
        events.push(event);
      }

      expect(events).toEqual([
        { type: "token", token: "hello " },
        { type: "token", token: "world" },
      ]);
    });

    it("formats tool_start input via formatToolInput (called with name + inputRaw)", async () => {
      mockFormatToolInput.mockClear();
      mockRunSDKQuery.mockReturnValueOnce(
        mockHandle([
          {
            type: "tool_start",
            name: "Bash",
            toolUseId: "tu-1",
            input: '{"command":"ls -la"}',
            inputRaw: { command: "ls -la" },
          },
          {
            type: "tool_result",
            toolUseId: "tu-1",
            toolName: "Bash",
            result: "found",
            isError: false,
          },
        ]),
      );

      const instance = new AgentInstance("sess-1", { cwd: "/tmp" });
      const events: unknown[] = [];
      for await (const event of instance.run("test")) {
        events.push(event);
      }

      // Assert the call args — the real formatToolInput branches on `name`
      // (Bash formats differently). A mock that only checks the returned
      // string can't catch `formatToolInput(toolUseId, inputRaw)` regressions.
      expect(mockFormatToolInput).toHaveBeenCalledTimes(1);
      expect(mockFormatToolInput).toHaveBeenCalledWith("Bash", { command: "ls -la" });

      expect(events).toHaveLength(2);
      expect(events[0]).toMatchObject({
        type: "tool_start",
        name: "Bash",
        toolUseId: "tu-1",
        // Sentinel proves postProcess re-wrote `input` via formatToolInput.
        // If postProcess regresses to passthrough, this assertion fails
        // independently of the call-count check above.
        input: FORMATTED_SENTINEL,
        inputRaw: { command: "ls -la" },
      });
      expect(events[1]).toMatchObject({ type: "tool_result", toolUseId: "tu-1", result: "found" });
    });

    it("forwards cwd/model/allowedTools/abortController/env/includePartialMessages to runSDKQuery", async () => {
      mockRunSDKQuery.mockReturnValueOnce(mockHandle([]));

      const instance = new AgentInstance("sess-1", {
        cwd: "/work/dir",
        allowedTools: ["Bash", "Read"],
      });
      for await (const _ of instance.run("do thing")) {
        /* consume */
      }

      expect(mockRunSDKQuery).toHaveBeenCalledTimes(1);
      const [prompt, opts] = mockRunSDKQuery.mock.calls[0]!;
      expect(prompt).toBe("do thing");
      expect(opts.sdkOptions).toMatchObject({
        cwd: "/work/dir",
        model: "sonnet",
        allowedTools: ["Bash", "Read"],
        includePartialMessages: true,
      });
      // abortController must be wired (scope: "Pass AbortController.signal directly")
      expect(opts.sdkOptions.abortController).toBeInstanceOf(AbortController);
      // env must reach the SDK so CLAUDECODE-stripped env is honored
      expect(opts.sdkOptions.env).toEqual(expect.objectContaining({ HOME: expect.any(String) }));
      // pathToClaudeCodeExecutable key must be present so packaged Electron
      // WorkAgents resolve the same claude binary as main-chat (matches agent.ts).
      // Value may be undefined if `which claude` fails — we assert the key is set.
      expect(opts.sdkOptions).toHaveProperty("pathToClaudeCodeExecutable");
      // Contract: agent-instance must NOT leak WorkAgent events onto the global bus
      expect(opts.eventBus).toBeUndefined();
      // Contract: "No onAgentQuestion — agent instances don't handle questions"
      expect(opts.onApprovalRequest).toBeUndefined();
    });

    it("omits allowedTools when empty", async () => {
      mockRunSDKQuery.mockReturnValueOnce(mockHandle([]));

      const instance = new AgentInstance("sess-1", { cwd: "/work/dir", allowedTools: [] });
      for await (const _ of instance.run("p")) {
        /* consume */
      }

      const [, opts] = mockRunSDKQuery.mock.calls[0]!;
      expect(opts.sdkOptions).not.toHaveProperty("allowedTools");
    });

    it("prepends systemPrompt to the prompt", async () => {
      mockRunSDKQuery.mockReturnValueOnce(mockHandle([]));

      const instance = new AgentInstance("sess-1", {
        cwd: "/tmp",
        systemPrompt: "You are helpful.",
      });
      for await (const _ of instance.run("do thing")) {
        /* consume */
      }

      const [prompt] = mockRunSDKQuery.mock.calls[0]!;
      expect(prompt).toBe("You are helpful.\n\ndo thing");
    });

    it("yields cancelled token when abort throws mid-stream", async () => {
      const instanceRef: { current?: AgentInstance } = {};
      mockRunSDKQuery.mockReturnValueOnce(
        mockHandle(async function* () {
          yield { type: "token", token: "start" };
          instanceRef.current!.cancel();
          throw new Error("The operation was aborted");
        }),
      );

      const instance = new AgentInstance("sess-1", { cwd: "/tmp" });
      instanceRef.current = instance;

      const events: unknown[] = [];
      for await (const event of instance.run("test")) {
        events.push(event);
      }

      expect(events).toEqual([
        { type: "token", token: "start" },
        { type: "token", token: " [cancelled]" },
      ]);
    });

    it("yields cancelled token when SDK close() ends stream cleanly (no throw)", async () => {
      // Reality: SDK's Query.close() triggers inputStream.done() — the for-await
      // exits normally, NOT via throw. Earlier mocks that threw an "aborted"
      // error hid a real regression where the [cancelled] token was never
      // emitted because it only lived in the catch block.
      const instanceRef: { current?: AgentInstance } = {};
      mockRunSDKQuery.mockReturnValueOnce(
        mockHandle(async function* () {
          yield { type: "token", token: "start" };
          instanceRef.current!.cancel();
          // Generator returns without throwing, mirroring real SDK close() behavior
        }),
      );

      const instance = new AgentInstance("sess-1", { cwd: "/tmp" });
      instanceRef.current = instance;

      const events: unknown[] = [];
      for await (const event of instance.run("test")) {
        events.push(event);
      }

      expect(events).toEqual([
        { type: "token", token: "start" },
        { type: "token", token: " [cancelled]" },
      ]);
    });

    it.each([
      { type: "status" as const, message: "session started" },
      { type: "thinking_delta" as const, text: "hmm" },
      { type: "content_block_start" as const, index: 0, blockType: "text" as const },
      { type: "content_block_stop" as const, index: 0 },
      { type: "turn_complete" as const },
    ])("passes $type events through postProcess unchanged", async (event) => {
      mockRunSDKQuery.mockReturnValueOnce(mockHandle([event]));
      const instance = new AgentInstance("sess-1", { cwd: "/tmp" });
      const events: unknown[] = [];
      for await (const e of instance.run("test")) events.push(e);
      expect(events).toEqual([event]);
    });

    it("cancel after completion is a no-op", async () => {
      mockRunSDKQuery.mockReturnValueOnce(mockHandle([{ type: "token", token: "done" }]));
      const instance = new AgentInstance("sess-1", { cwd: "/tmp" });
      for await (const _ of instance.run("test")) {
        /* consume */
      }
      expect(instance.isRunning()).toBe(false);
      // currentHandle is null post-completion — cancel() must not throw
      expect(() => instance.cancel()).not.toThrow();
    });

    it("isCancelled tracks abort signal", async () => {
      const instance = new AgentInstance("sess-1", { cwd: "/tmp" });
      expect(instance.isCancelled()).toBe(false);
      instance.cancel();
      expect(instance.isCancelled()).toBe(true);
    });

    it("honors cancel() that fires before run() starts (no stale-abort race)", async () => {
      // Regression: pre-fix, run() replaced the AbortController unconditionally,
      // so a cancel() between construction and first .next() was silently lost
      // and the SDK query ran with a fresh un-aborted signal. After fix: cancel
      // pre-run yields [cancelled] and returns without calling runSDKQuery.
      const instance = new AgentInstance("sess-1", { cwd: "/tmp" });
      instance.cancel();

      const events: unknown[] = [];
      for await (const event of instance.run("test")) {
        events.push(event);
      }

      expect(events).toEqual([{ type: "token", token: " [cancelled]" }]);
      expect(mockRunSDKQuery).not.toHaveBeenCalled();
    });

    it("cancel() calls handle.abort()", async () => {
      const handle = mockHandle(async function* () {
        yield { type: "token", token: "x" };
        await new Promise<void>(() => {
          /* hang */
        });
      });
      mockRunSDKQuery.mockReturnValueOnce(handle);

      const instance = new AgentInstance("sess-1", { cwd: "/tmp" });
      const gen = instance.run("test");
      await gen.next();

      instance.cancel();
      if (!handle.ok) throw new Error("mockHandle should return ok");
      expect(handle.value.abort).toHaveBeenCalledTimes(1);

      try {
        await gen.return(undefined);
      } catch {
        /* cleanup */
      }
    });

    it("throws AgentError with AUTH_ERROR code for auth errors", async () => {
      mockRunSDKQuery.mockReturnValueOnce(
        mockHandle(async function* () {
          throw new Error("authentication failed");
        }),
      );

      const instance = new AgentInstance("sess-1", { cwd: "/tmp" });

      try {
        for await (const _ of instance.run("test")) {
          /* consume */
        }
        expect.unreachable("should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(AgentError);
        expect((err as AgentError).code).toBe("AUTH_ERROR");
      }
    });

    it("throws AgentError with STREAM_FAILED for non-auth errors", async () => {
      mockRunSDKQuery.mockReturnValueOnce(
        mockHandle(async function* () {
          throw new Error("network timeout");
        }),
      );

      const instance = new AgentInstance("sess-1", { cwd: "/tmp" });

      try {
        for await (const _ of instance.run("test")) {
          /* consume */
        }
        expect.unreachable("should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(AgentError);
        expect((err as AgentError).code).toBe("STREAM_FAILED");
      }
    });

    it("throws AgentError when runSDKQuery returns error Result", async () => {
      mockRunSDKQuery.mockReturnValueOnce({
        ok: false,
        error: new SDKAdapterErrorClass("init failed"),
      });

      const instance = new AgentInstance("sess-1", { cwd: "/tmp" });

      try {
        for await (const _ of instance.run("test")) {
          /* consume */
        }
        expect.unreachable("should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(AgentError);
        expect((err as AgentError).code).toBe("STREAM_FAILED");
      }
    });

    it("classifies auth-flavored adapter init failures as AUTH_ERROR", async () => {
      mockRunSDKQuery.mockReturnValueOnce({
        ok: false,
        error: new SDKAdapterErrorClass("not authenticated"),
      });

      const instance = new AgentInstance("sess-1", { cwd: "/tmp" });

      try {
        for await (const _ of instance.run("test")) {
          /* consume */
        }
        expect.unreachable("should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(AgentError);
        expect((err as AgentError).code).toBe("AUTH_ERROR");
      }
    });

    it("resets runInProgress after completion", async () => {
      mockRunSDKQuery.mockReturnValueOnce(mockHandle([{ type: "token", token: "done" }]));

      const instance = new AgentInstance("sess-1", { cwd: "/tmp" });
      for await (const _ of instance.run("test")) {
        /* consume */
      }

      expect(instance.isRunning()).toBe(false);
    });

    describe("cancel / dispose", () => {
      it("cancel before run is a no-op", () => {
        const instance = new AgentInstance("sess-1", { cwd: "/tmp" });
        expect(() => instance.cancel()).not.toThrow();
      });

      it("dispose calls cancel", () => {
        const instance = new AgentInstance("sess-1", { cwd: "/tmp" });
        const cancelSpy = vi.spyOn(instance, "cancel");
        instance.dispose();
        expect(cancelSpy).toHaveBeenCalledOnce();
      });
    });
  });
});
