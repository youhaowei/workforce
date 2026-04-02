import { describe, it, expect, vi, afterEach } from "vitest";
import { getEventBus } from "@/shared/event-bus";

// Mock unifai before importing
vi.mock("unifai", () => ({
  createSession: vi.fn(),
}));

vi.mock("./agent-cli-path", () => ({
  resolveClaudeCliPath: () => "/usr/local/bin/claude",
}));

vi.mock("./agent", () => ({
  formatToolInput: (_name: string, input: unknown) => JSON.stringify(input),
}));

import { buildSdkEnv, isAuthError, AgentError, AgentInstance } from "./agent-instance";
import { createSession } from "unifai";

const mockCreateSession = vi.mocked(createSession);

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
      const mockSession = {
        send: vi.fn(() =>
          (async function* () {
            yield { type: "text_delta", text: "hi" };
            // Hang so the run stays in progress
            await new Promise<void>((r) => {
              resolveHang = r;
            });
          })(),
        ),
        close: vi.fn(),
      };
      mockCreateSession.mockReturnValue(mockSession as any);

      const instance = new AgentInstance("sess-1", { cwd: "/tmp" });

      // Start first run and consume the first token
      const gen = instance.run("first prompt");
      await gen.next(); // yields 'hi'

      // Second run should throw
      const gen2 = instance.run("second prompt");
      await expect(gen2.next()).rejects.toThrow("Query already in progress");

      // Cleanup: cancel the first run
      instance.cancel();
      resolveHang?.();
      try {
        await gen.return(undefined);
      } catch {
        /* cleanup */
      }
    });

    it("yields token events from text_delta", async () => {
      const mockSession = {
        send: vi.fn(() =>
          (async function* () {
            yield { type: "text_delta", text: "hello " };
            yield { type: "text_delta", text: "world" };
          })(),
        ),
        close: vi.fn(),
      };
      mockCreateSession.mockReturnValue(mockSession as any);

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

    it("yields tool_start and tool_result events", async () => {
      const mockSession = {
        send: vi.fn(() =>
          (async function* () {
            yield {
              type: "tool_start",
              toolName: "search",
              input: { q: "test" },
              toolUseId: "tu-1",
            };
            yield {
              type: "tool_result",
              toolUseId: "tu-1",
              toolName: "search",
              result: "found",
              isError: false,
            };
          })(),
        ),
        close: vi.fn(),
      };
      mockCreateSession.mockReturnValue(mockSession as any);

      const instance = new AgentInstance("sess-1", { cwd: "/tmp" });
      const events: unknown[] = [];
      for await (const event of instance.run("test")) {
        events.push(event);
      }

      expect(events).toHaveLength(2);
      expect(events[0]).toMatchObject({ type: "tool_start", name: "search", toolUseId: "tu-1" });
      expect(events[1]).toMatchObject({ type: "tool_result", toolUseId: "tu-1", result: "found" });
    });

    it("emits RawSdkMessage for raw events", async () => {
      const bus = getEventBus();
      const rawEvents: unknown[] = [];
      bus.on("RawSdkMessage", (e) => rawEvents.push(e));

      const mockSession = {
        send: vi.fn(() =>
          (async function* () {
            yield { type: "raw", eventType: "content_block_start", data: { index: 0 } };
          })(),
        ),
        close: vi.fn(),
      };
      mockCreateSession.mockReturnValue(mockSession as any);

      const instance = new AgentInstance("sess-1", { cwd: "/tmp" });
      for await (const _ of instance.run("test")) {
        /* consume */
      }

      expect(rawEvents).toHaveLength(1);
      expect(rawEvents[0]).toMatchObject({
        type: "RawSdkMessage",
        sdkMessageType: "content_block_start",
      });
    });

    it("yields cancelled token when aborted mid-stream", async () => {
      const instanceRef: { current?: AgentInstance } = {};
      const mockSession = {
        send: vi.fn(() =>
          (async function* () {
            yield { type: "text_delta", text: "start" };
            // Cancel mid-stream, then throw like the SDK would
            instanceRef.current!.cancel();
            throw new Error("The operation was aborted");
          })(),
        ),
        close: vi.fn(),
      };
      mockCreateSession.mockReturnValue(mockSession as any);

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

    it("throws AgentError with AUTH_ERROR code for auth errors", async () => {
      const mockSession = {
        send: vi.fn(() =>
          (async function* () {
            throw new Error("authentication failed");
          })(),
        ),
        close: vi.fn(),
      };
      mockCreateSession.mockReturnValue(mockSession as any);

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
      const mockSession = {
        send: vi.fn(() =>
          (async function* () {
            throw new Error("network timeout");
          })(),
        ),
        close: vi.fn(),
      };
      mockCreateSession.mockReturnValue(mockSession as any);

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
      const mockSession = {
        send: vi.fn(() =>
          (async function* () {
            yield { type: "text_delta", text: "done" };
          })(),
        ),
        close: vi.fn(),
      };
      mockCreateSession.mockReturnValue(mockSession as any);

      const instance = new AgentInstance("sess-1", { cwd: "/tmp" });
      for await (const _ of instance.run("test")) {
        /* consume */
      }

      expect(instance.isRunning()).toBe(false);
    });

    it("calls session.close() in finally block", async () => {
      const closeFn = vi.fn();
      const mockSession = {
        send: vi.fn(() =>
          (async function* () {
            yield { type: "text_delta", text: "x" };
          })(),
        ),
        close: closeFn,
      };
      mockCreateSession.mockReturnValue(mockSession as any);

      const instance = new AgentInstance("sess-1", { cwd: "/tmp" });
      for await (const _ of instance.run("test")) {
        /* consume */
      }

      expect(closeFn).toHaveBeenCalledOnce();
    });

    it("prepends systemPrompt to the prompt", async () => {
      const mockSession = {
        send: vi.fn(() =>
          (async function* () {
            /* empty */
          })(),
        ),
        close: vi.fn(),
      };
      mockCreateSession.mockReturnValue(mockSession as any);

      const instance = new AgentInstance("sess-1", {
        cwd: "/tmp",
        systemPrompt: "You are helpful.",
      });
      for await (const _ of instance.run("do thing")) {
        /* consume */
      }

      expect(mockSession.send).toHaveBeenCalledWith("You are helpful.\n\ndo thing");
    });

    describe("cancel / dispose", () => {
      it("cancel sets abort signal", () => {
        const instance = new AgentInstance("sess-1", { cwd: "/tmp" });
        instance.cancel();
        // No way to check signal directly, but it shouldn't throw
      });

      it("dispose calls cancel", () => {
        const instance = new AgentInstance("sess-1", { cwd: "/tmp" });
        instance.dispose();
        // Should not throw
      });
    });
  });
});
