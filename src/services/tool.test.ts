import { describe, it, expect, beforeEach, afterEach } from "vitest";
import type { ToolExecutionContext } from "./types";
import { getToolService, resetToolService } from "./tool";
import { getEventBus } from "@/shared/event-bus";

const ctx: ToolExecutionContext = { sessionId: "sess-1", workingDirectory: "/tmp" };

describe("ToolService", () => {
  beforeEach(() => {
    resetToolService();
  });

  afterEach(() => {
    resetToolService();
    getEventBus().dispose();
  });

  describe("register / unregister", () => {
    it("registers a tool and reports has()", () => {
      const svc = getToolService();
      svc.register("echo", async (args) => args);
      expect(svc.has("echo")).toBe(true);
    });

    it("throws on duplicate registration", () => {
      const svc = getToolService();
      svc.register("echo", async (args) => args);
      expect(() => svc.register("echo", async (args) => args)).toThrow(
        "Tool already registered: echo",
      );
    });

    it("unregister removes the tool", () => {
      const svc = getToolService();
      svc.register("echo", async (args) => args);
      svc.unregister("echo");
      expect(svc.has("echo")).toBe(false);
    });

    it("uses default description when none provided", () => {
      const svc = getToolService();
      svc.register("echo", async (args) => args);
      const defs = svc.getDefinitions();
      expect(defs[0].description).toBe("Tool: echo");
    });

    it("uses custom description and inputSchema", () => {
      const svc = getToolService();
      svc.register("echo", async (args) => args, {
        description: "Echoes input",
        inputSchema: { type: "object", properties: { text: { type: "string" } } },
      });
      const defs = svc.getDefinitions();
      expect(defs[0].description).toBe("Echoes input");
      expect(defs[0].inputSchema).toHaveProperty("properties");
    });
  });

  describe("execute", () => {
    it("returns success result with handler output", async () => {
      const svc = getToolService();
      svc.register("echo", async (args) => ({ echoed: args.text }));

      const result = await svc.execute("echo", { text: "hello" }, ctx);
      expect(result.success).toBe(true);
      expect(result.result).toEqual({ echoed: "hello" });
      expect(result.duration).toEqual(expect.any(Number));
    });

    it("returns error result for unknown tool", async () => {
      const svc = getToolService();
      const result = await svc.execute("missing", {}, ctx);
      expect(result.success).toBe(false);
      expect(result.error).toBe("Unknown tool: missing");
      expect(result.duration).toBe(0);
    });

    it("catches handler errors and returns error result", async () => {
      const svc = getToolService();
      svc.register("fail", async () => {
        throw new Error("boom");
      });

      const result = await svc.execute("fail", {}, ctx);
      expect(result.success).toBe(false);
      expect(result.error).toBe("boom");
      expect(result.duration).toEqual(expect.any(Number));
    });

    it("catches non-Error throws", async () => {
      const svc = getToolService();
      svc.register("fail", async () => {
        throw "string error";
      });

      const result = await svc.execute("fail", {}, ctx);
      expect(result.success).toBe(false);
      expect(result.error).toBe("string error");
    });

    it("emits ToolStart and ToolEnd events on success", async () => {
      const svc = getToolService();
      const bus = getEventBus();
      const events: unknown[] = [];
      bus.on("ToolStart", (e) => events.push(e));
      bus.on("ToolEnd", (e) => events.push(e));

      svc.register("echo", async (args) => args);
      await svc.execute("echo", { text: "hi" }, ctx);

      expect(events).toHaveLength(2);
      expect(events[0]).toMatchObject({ type: "ToolStart", toolName: "echo" });
      expect(events[1]).toMatchObject({
        type: "ToolEnd",
        toolName: "echo",
        result: { text: "hi" },
      });
    });

    it("emits ToolEnd with null result on error", async () => {
      const svc = getToolService();
      const bus = getEventBus();
      const events: unknown[] = [];
      bus.on("ToolEnd", (e) => events.push(e));

      svc.register("fail", async () => {
        throw new Error("boom");
      });
      await svc.execute("fail", {}, ctx);

      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({ type: "ToolEnd", toolName: "fail", result: null });
    });
  });

  describe("getDefinitions", () => {
    it("returns all registered tool definitions", () => {
      const svc = getToolService();
      svc.register("a", async () => null);
      svc.register("b", async () => null);
      const defs = svc.getDefinitions();
      expect(defs).toHaveLength(2);
      expect(defs.map((d) => d.name).sort()).toEqual(["a", "b"]);
    });

    it("returns empty array when no tools registered", () => {
      const svc = getToolService();
      expect(svc.getDefinitions()).toEqual([]);
    });
  });

  describe("singleton", () => {
    it("getToolService returns same instance", () => {
      expect(getToolService()).toBe(getToolService());
    });

    it("resetToolService clears and recreates", () => {
      const s1 = getToolService();
      s1.register("echo", async () => null);
      resetToolService();
      const s2 = getToolService();
      expect(s2.has("echo")).toBe(false);
    });
  });

  describe("dispose", () => {
    it("clears all tools", () => {
      const svc = getToolService();
      svc.register("a", async () => null);
      svc.register("b", async () => null);
      svc.dispose();
      expect(svc.has("a")).toBe(false);
      expect(svc.getDefinitions()).toEqual([]);
    });
  });
});
