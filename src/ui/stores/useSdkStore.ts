/**
 * SDK Store (Zustand) — Replaces SolidJS sdkStore.ts
 *
 * Captures SDK metadata: token usage, costs, system info,
 * active tools, hook executions, thinking content.
 *
 * EventBus subscription is handled by the useEventBusInit hook.
 */

import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';

// =============================================================================
// Types (re-exported for consumers)
// =============================================================================

export interface UsageStats {
  inputTokens: number;
  outputTokens: number;
  cacheReadInputTokens: number;
  cacheCreationInputTokens: number;
  totalCostUsd: number;
}

export interface QueryStats {
  durationMs: number;
  durationApiMs: number;
  numTurns: number;
  usage: UsageStats;
  modelUsage: Record<string, {
    inputTokens: number;
    outputTokens: number;
    cacheReadInputTokens: number;
    cacheCreationInputTokens: number;
    webSearchRequests: number;
    costUSD: number;
    contextWindow: number;
    maxOutputTokens: number;
  }>;
}

export interface SystemInfo {
  claudeCodeVersion: string;
  model: string;
  tools: string[];
  mcpServers: Array<{ name: string; status: string }>;
  permissionMode: string;
  skills: string[];
  sessionId: string;
}

export interface ActiveTool {
  toolUseId: string;
  toolName: string;
  startTime: number;
  elapsedSeconds: number;
}

export interface HookExecution {
  hookId: string;
  hookName: string;
  hookEvent: string;
  status: 'running' | 'success' | 'error' | 'cancelled';
  startTime: number;
  endTime?: number;
  exitCode?: number;
}

interface SdkStore {
  systemInfo: SystemInfo | null;
  currentQueryStats: QueryStats | null;
  cumulativeUsage: UsageStats;
  activeTools: ActiveTool[];
  hookExecutions: HookExecution[];
  lastMessageUsage: { inputTokens: number; outputTokens: number } | null;
  thinkingContent: string;
  isInitialized: boolean;

  // Event handlers (called by useEventBusInit)
  handleSystemInit: (event: SystemInfo & { timestamp?: number }) => void;
  handleMessageStart: (usage: { inputTokens: number; outputTokens: number }) => void;
  handleAssistantMessage: (usage: { inputTokens: number; outputTokens: number }) => void;
  handleQueryResult: (event: {
    durationMs: number;
    durationApiMs: number;
    numTurns: number;
    usage: { inputTokens: number; outputTokens: number; cacheReadInputTokens: number; cacheCreationInputTokens: number };
    totalCostUsd: number;
    modelUsage: QueryStats['modelUsage'];
  }) => void;
  handleToolProgress: (event: { toolUseId: string; toolName: string; timestamp: number; elapsedTimeSeconds: number }) => void;
  handleThinkingDelta: (thinking: string) => void;
  handleHookStarted: (event: { hookId: string; hookName: string; hookEvent: string; timestamp: number }) => void;
  handleHookResponse: (event: { hookId: string; outcome: HookExecution['status']; timestamp: number; exitCode?: number }) => void;

  // Actions
  clearActiveTool: (toolUseId: string) => void;
  clearAllActiveTools: () => void;
  clearHookExecutions: () => void;
  resetCumulativeUsage: () => void;
}

// =============================================================================
// Store
// =============================================================================

export const useSdkStore = create<SdkStore>()(
  immer((set) => ({
    systemInfo: null,
    currentQueryStats: null,
    cumulativeUsage: {
      inputTokens: 0,
      outputTokens: 0,
      cacheReadInputTokens: 0,
      cacheCreationInputTokens: 0,
      totalCostUsd: 0,
    },
    activeTools: [],
    hookExecutions: [],
    lastMessageUsage: null,
    thinkingContent: '',
    isInitialized: false,

    // ─── Event Handlers ───────────────────────────────────────────────

    handleSystemInit: (event) => {
      set((s) => {
        s.systemInfo = {
          claudeCodeVersion: event.claudeCodeVersion,
          model: event.model,
          tools: event.tools,
          mcpServers: event.mcpServers,
          permissionMode: event.permissionMode,
          skills: event.skills,
          sessionId: event.sessionId,
        };
        s.isInitialized = true;
      });
    },

    handleMessageStart: (usage) => {
      set((s) => {
        s.lastMessageUsage = { inputTokens: usage.inputTokens, outputTokens: usage.outputTokens };
        s.thinkingContent = '';
      });
    },

    handleAssistantMessage: (usage) => {
      set((s) => {
        s.lastMessageUsage = { inputTokens: usage.inputTokens, outputTokens: usage.outputTokens };
      });
    },

    handleQueryResult: (event) => {
      set((s) => {
        s.currentQueryStats = {
          durationMs: event.durationMs,
          durationApiMs: event.durationApiMs,
          numTurns: event.numTurns,
          usage: { ...event.usage, totalCostUsd: event.totalCostUsd },
          modelUsage: event.modelUsage,
        };
        s.cumulativeUsage.inputTokens += event.usage.inputTokens;
        s.cumulativeUsage.outputTokens += event.usage.outputTokens;
        s.cumulativeUsage.cacheReadInputTokens += event.usage.cacheReadInputTokens;
        s.cumulativeUsage.cacheCreationInputTokens += event.usage.cacheCreationInputTokens;
        s.cumulativeUsage.totalCostUsd += event.totalCostUsd;
      });
    },

    handleToolProgress: (event) => {
      set((s) => {
        const existing = s.activeTools.find((t) => t.toolUseId === event.toolUseId);
        if (existing) {
          existing.elapsedSeconds = event.elapsedTimeSeconds;
        } else {
          s.activeTools.push({
            toolUseId: event.toolUseId,
            toolName: event.toolName,
            startTime: event.timestamp,
            elapsedSeconds: event.elapsedTimeSeconds,
          });
        }
      });
    },

    handleThinkingDelta: (thinking) => {
      set((s) => {
        s.thinkingContent += thinking;
      });
    },

    handleHookStarted: (event) => {
      set((s) => {
        s.hookExecutions.push({
          hookId: event.hookId,
          hookName: event.hookName,
          hookEvent: event.hookEvent,
          status: 'running',
          startTime: event.timestamp,
        });
      });
    },

    handleHookResponse: (event) => {
      set((s) => {
        const hook = s.hookExecutions.find((h) => h.hookId === event.hookId);
        if (hook) {
          hook.status = event.outcome;
          hook.endTime = event.timestamp;
          hook.exitCode = event.exitCode;
        }
      });
    },

    // ─── Actions ──────────────────────────────────────────────────────

    clearActiveTool: (toolUseId) => {
      set((s) => {
        s.activeTools = s.activeTools.filter((t) => t.toolUseId !== toolUseId);
      });
    },

    clearAllActiveTools: () => {
      set((s) => {
        s.activeTools = [];
      });
    },

    clearHookExecutions: () => {
      set((s) => {
        s.hookExecutions = [];
      });
    },

    resetCumulativeUsage: () => {
      set((s) => {
        s.cumulativeUsage = {
          inputTokens: 0,
          outputTokens: 0,
          cacheReadInputTokens: 0,
          cacheCreationInputTokens: 0,
          totalCostUsd: 0,
        };
      });
    },
  })),
);
