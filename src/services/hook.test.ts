import { describe, it, expect, beforeEach, afterEach } from "vitest";
import type { HookContext } from "./types";
import { getHookService, resetHookService } from "./hook";

const baseCtx: HookContext = { toolName: "search", args: { query: "test" } };

describe("HookService", () => {
  beforeEach(() => resetHookService());
  afterEach(() => resetHookService());

  describe("registerPreHook", () => {
    it("registers and lists a pre-hook", () => {
      const svc = getHookService();
      svc.registerPreHook("auth", () => ({ proceed: true }));
      const hooks = svc.listHooks();
      expect(hooks).toContainEqual({ name: "auth", type: "pre", priority: 0 });
    });

    it("throws on duplicate name", () => {
      const svc = getHookService();
      svc.registerPreHook("auth", () => ({ proceed: true }));
      expect(() => svc.registerPreHook("auth", () => ({ proceed: true }))).toThrow(
        "Pre-hook already registered: auth",
      );
    });

    it("sorts by priority descending", () => {
      const svc = getHookService();
      svc.registerPreHook("low", () => ({ proceed: true }), 1);
      svc.registerPreHook("high", () => ({ proceed: true }), 10);
      svc.registerPreHook("mid", () => ({ proceed: true }), 5);
      const hooks = svc.listHooks().filter((h) => h.type === "pre");
      expect(hooks.map((h) => h.name)).toEqual(["high", "mid", "low"]);
    });
  });

  describe("registerPostHook", () => {
    it("registers and lists a post-hook", () => {
      const svc = getHookService();
      svc.registerPostHook("log", () => ({}));
      const hooks = svc.listHooks();
      expect(hooks).toContainEqual({ name: "log", type: "post", priority: 0 });
    });

    it("throws on duplicate name", () => {
      const svc = getHookService();
      svc.registerPostHook("log", () => ({}));
      expect(() => svc.registerPostHook("log", () => ({}))).toThrow(
        "Post-hook already registered: log",
      );
    });
  });

  describe("unregister", () => {
    it("removes both pre and post hooks by name", () => {
      const svc = getHookService();
      svc.registerPreHook("auth", () => ({ proceed: true }));
      svc.registerPostHook("auth", () => ({}));
      svc.unregister("auth");
      expect(svc.listHooks()).toEqual([]);
    });

    it("is a no-op for unknown names", () => {
      const svc = getHookService();
      svc.unregister("missing"); // should not throw
    });
  });

  describe("runPreHooks", () => {
    it("returns proceed:true with no hooks", async () => {
      const svc = getHookService();
      const result = await svc.runPreHooks(baseCtx);
      expect(result.proceed).toBe(true);
    });

    it("threads modified args through hooks", async () => {
      const svc = getHookService();
      const order: string[] = [];

      svc.registerPreHook(
        "first",
        (ctx) => {
          order.push("first");
          return { proceed: true, modifiedArgs: { ...ctx.args, added: "by-first" } };
        },
        10,
      );

      svc.registerPreHook(
        "second",
        (ctx) => {
          order.push("second");
          expect(ctx.args).toHaveProperty("added", "by-first");
          return { proceed: true, modifiedArgs: { ...ctx.args, second: true } };
        },
        5,
      );

      const result = await svc.runPreHooks(baseCtx);
      expect(result.proceed).toBe(true);
      expect(result.modifiedArgs).toMatchObject({ query: "test", added: "by-first", second: true });
      expect(order).toEqual(["first", "second"]);
    });

    it("short-circuits on proceed:false", async () => {
      const svc = getHookService();
      const order: string[] = [];

      svc.registerPreHook(
        "blocker",
        () => {
          order.push("blocker");
          return { proceed: false, blockReason: "denied" };
        },
        10,
      );

      svc.registerPreHook(
        "skipped",
        () => {
          order.push("skipped");
          return { proceed: true };
        },
        5,
      );

      const result = await svc.runPreHooks(baseCtx);
      expect(result.proceed).toBe(false);
      expect(order).toEqual(["blocker"]);
    });

    it("short-circuits on shortCircuitResult", async () => {
      const svc = getHookService();

      svc.registerPreHook("cache", () => ({
        proceed: true,
        shortCircuitResult: { cached: true },
      }));

      const result = await svc.runPreHooks(baseCtx);
      expect(result.proceed).toBe(false);
      expect(result.shortCircuitResult).toEqual({ cached: true });
    });

    it("handles async hooks", async () => {
      const svc = getHookService();

      svc.registerPreHook("async", async () => {
        await new Promise((r) => setTimeout(r, 1));
        return { proceed: true, modifiedArgs: { async: true } };
      });

      const result = await svc.runPreHooks(baseCtx);
      expect(result.proceed).toBe(true);
      expect(result.modifiedArgs).toMatchObject({ async: true });
    });

    it("propagates hook errors to caller", async () => {
      const svc = getHookService();
      svc.registerPreHook("broken", () => {
        throw new Error("hook failed");
      });

      await expect(svc.runPreHooks(baseCtx)).rejects.toThrow("hook failed");
    });
  });

  describe("runPostHooks", () => {
    it("returns unmodified result with no hooks", async () => {
      const svc = getHookService();
      const result = await svc.runPostHooks(baseCtx, "original");
      expect(result.modifiedResult).toBe("original");
      expect(result.sideEffects).toBeUndefined();
    });

    it("threads modified results through hooks", async () => {
      const svc = getHookService();

      svc.registerPostHook(
        "first",
        (_ctx, result) => ({
          modifiedResult: `${result}+first`,
        }),
        10,
      );

      svc.registerPostHook(
        "second",
        (_ctx, result) => ({
          modifiedResult: `${result}+second`,
        }),
        5,
      );

      const result = await svc.runPostHooks(baseCtx, "original");
      expect(result.modifiedResult).toBe("original+first+second");
    });

    it("collects side effects from all hooks", async () => {
      const svc = getHookService();

      svc.registerPostHook("a", () => ({
        sideEffects: [
          {
            event: {
              type: "SessionChange",
              sessionId: "s1",
              action: "updated" as const,
              timestamp: 1,
            },
          },
        ],
      }));

      svc.registerPostHook("b", () => ({
        sideEffects: [
          {
            event: {
              type: "SessionChange",
              sessionId: "s2",
              action: "updated" as const,
              timestamp: 2,
            },
          },
        ],
      }));

      const result = await svc.runPostHooks(baseCtx, null);
      expect(result.sideEffects).toHaveLength(2);
    });

    it("omits sideEffects when none collected", async () => {
      const svc = getHookService();
      svc.registerPostHook("noop", () => ({}));
      const result = await svc.runPostHooks(baseCtx, null);
      expect(result.sideEffects).toBeUndefined();
    });
  });

  describe("singleton", () => {
    it("getHookService returns same instance", () => {
      expect(getHookService()).toBe(getHookService());
    });

    it("resetHookService clears and recreates", () => {
      const svc = getHookService();
      svc.registerPreHook("test", () => ({ proceed: true }));
      resetHookService();
      expect(getHookService().listHooks()).toEqual([]);
    });
  });
});
