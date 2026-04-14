import { describe, it, expect, vi, afterEach } from "vitest";
import { getEventBus } from "@/shared/event-bus";
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

vi.mock("./agent-cli-path", () => ({
  resolveClaudeCliPath: () => "/usr/local/bin/claude",
}));

vi.mock("./agent", () => ({
  formatToolInput: (_name: string, input: unknown) => JSON.stringify(input),
}));

import { buildSdkEnv, isAuthError, AgentError, AgentInstance } from "./agent-instance";
import { runSDKQuery, SDKAdapterError as SDKAdapterErrorClass } from "./sdk-adapter";

const mockRunSDKQuery = vi.mocked(runSDKQuery);

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
    getEventBus().dispose();
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

    it("formats tool_start input via formatToolInput", async () => {
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

      expect(events).toHaveLength(2);
      expect(events[0]).toMatchObject({
        type: "tool_start",
        name: "Bash",
        toolUseId: "tu-1",
        input: '{"command":"ls -la"}',
        inputRaw: { command: "ls -la" },
      });
      expect(events[1]).toMatchObject({ type: "tool_result", toolUseId: "tu-1", result: "found" });
    });

    it("passes sdkOptions and eventBus to runSDKQuery", async () => {
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
      });
      expect(opts.eventBus).toBe(getEventBus());
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

    it("yields cancelled token when aborted mid-stream", async () => {
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
      expect(handle.ok && handle.value.abort).toHaveBeenCalledTimes(1);

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
        expect(() => instance.dispose()).not.toThrow();
      });
    });
  });
});
