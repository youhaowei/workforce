/**
 * HookService - Pre/post tool execution hooks
 *
 * Provides:
 * - Pre-hook execution before tools (can block/modify)
 * - Post-hook execution after tools (can modify result)
 * - Priority-based hook ordering
 */

import type {
  HookService,
  PreHook,
  PostHook,
  HookContext,
  PreHookResult,
  PostHookResult,
} from "./types";

interface HookEntry<T> {
  name: string;
  hook: T;
  priority: number;
}

class HookServiceImpl implements HookService {
  private preHooks: HookEntry<PreHook>[] = [];
  private postHooks: HookEntry<PostHook>[] = [];

  registerPreHook(name: string, hook: PreHook, priority = 0): void {
    if (this.preHooks.some((h) => h.name === name)) {
      throw new Error(`Pre-hook already registered: ${name}`);
    }

    this.preHooks.push({ name, hook, priority });
    this.preHooks.sort((a, b) => b.priority - a.priority);
  }

  registerPostHook(name: string, hook: PostHook, priority = 0): void {
    if (this.postHooks.some((h) => h.name === name)) {
      throw new Error(`Post-hook already registered: ${name}`);
    }

    this.postHooks.push({ name, hook, priority });
    this.postHooks.sort((a, b) => b.priority - a.priority);
  }

  unregister(name: string): void {
    this.preHooks = this.preHooks.filter((h) => h.name !== name);
    this.postHooks = this.postHooks.filter((h) => h.name !== name);
  }

  async runPreHooks(context: HookContext): Promise<PreHookResult> {
    let currentArgs = context.args;

    for (const entry of this.preHooks) {
      const result = await entry.hook({
        ...context,
        args: currentArgs,
      });

      if (!result.proceed) {
        return result;
      }

      if (result.modifiedArgs) {
        currentArgs = result.modifiedArgs;
      }

      if (result.shortCircuitResult !== undefined) {
        return {
          proceed: false,
          shortCircuitResult: result.shortCircuitResult,
        };
      }
    }

    return {
      proceed: true,
      modifiedArgs: currentArgs,
    };
  }

  async runPostHooks(context: HookContext, result: unknown): Promise<PostHookResult> {
    let currentResult = result;
    const allSideEffects: PostHookResult["sideEffects"] = [];

    for (const entry of this.postHooks) {
      const hookResult = await entry.hook(context, currentResult);

      if (hookResult.modifiedResult !== undefined) {
        currentResult = hookResult.modifiedResult;
      }

      if (hookResult.sideEffects) {
        allSideEffects.push(...hookResult.sideEffects);
      }
    }

    return {
      modifiedResult: currentResult,
      sideEffects: allSideEffects.length > 0 ? allSideEffects : undefined,
    };
  }

  listHooks(): Array<{ name: string; type: "pre" | "post"; priority: number }> {
    const hooks: Array<{ name: string; type: "pre" | "post"; priority: number }> = [];

    for (const h of this.preHooks) {
      hooks.push({ name: h.name, type: "pre", priority: h.priority });
    }

    for (const h of this.postHooks) {
      hooks.push({ name: h.name, type: "post", priority: h.priority });
    }

    return hooks;
  }

  dispose(): void {
    this.preHooks = [];
    this.postHooks = [];
  }
}

let _instance: HookService | null = null;

export function getHookService(): HookService {
  return (_instance ??= new HookServiceImpl());
}

export function resetHookService(): void {
  if (_instance) {
    _instance.dispose();
    _instance = null;
  }
}
