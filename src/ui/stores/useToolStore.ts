/**
 * Tool Store (Zustand) — Replaces SolidJS toolStore.ts
 *
 * Tracks active tool executions from the Agent SDK event stream.
 * EventBus subscription is handled by useEventBusInit.
 */

import { create } from "zustand";
import { immer } from "zustand/middleware/immer";

// =============================================================================
// Types (re-exported for consumers)
// =============================================================================

export type ToolUIStatus = "pending" | "running" | "success" | "failed" | "cancelled";

export interface ToolUIState {
  id: string;
  name: string;
  args: unknown;
  status: ToolUIStatus;
  result?: unknown;
  error?: string;
  duration?: number;
  startTime: number;
  endTime?: number;
}

interface ToolStore {
  tools: Record<string, ToolUIState>;
  activeToolIds: string[];

  // Event handlers (called by useEventBusInit)
  handleToolStart: (event: {
    toolId: string;
    toolName: string;
    args: unknown;
    timestamp: number;
  }) => void;
  handleToolEnd: (event: {
    toolId: string;
    result: unknown;
    duration: number;
    timestamp: number;
  }) => void;

  // Actions
  markToolFailed: (toolId: string, error: string) => void;
  markToolCancelled: (toolId: string) => void;
  clearTools: () => void;
}

// =============================================================================
// Store
// =============================================================================

export const useToolStore = create<ToolStore>()(
  immer((set) => ({
    tools: {},
    activeToolIds: [],

    handleToolStart: (event) => {
      set((s) => {
        s.tools[event.toolId] = {
          id: event.toolId,
          name: event.toolName,
          args: event.args,
          status: "running",
          startTime: event.timestamp,
        };
        if (!s.activeToolIds.includes(event.toolId)) {
          s.activeToolIds.push(event.toolId);
        }
      });
    },

    handleToolEnd: (event) => {
      set((s) => {
        const tool = s.tools[event.toolId];
        if (tool) {
          tool.status = "success";
          tool.result = event.result;
          tool.duration = event.duration;
          tool.endTime = event.timestamp;
        }
        const idx = s.activeToolIds.indexOf(event.toolId);
        if (idx !== -1) {
          s.activeToolIds.splice(idx, 1);
        }
      });
    },

    markToolFailed: (toolId, error) => {
      set((s) => {
        const tool = s.tools[toolId];
        if (tool) {
          tool.status = "failed";
          tool.error = error;
          tool.endTime = Date.now();
          tool.duration = tool.endTime - tool.startTime;
        }
        const idx = s.activeToolIds.indexOf(toolId);
        if (idx !== -1) {
          s.activeToolIds.splice(idx, 1);
        }
      });
    },

    markToolCancelled: (toolId) => {
      set((s) => {
        const tool = s.tools[toolId];
        if (tool) {
          tool.status = "cancelled";
          tool.endTime = Date.now();
          tool.duration = tool.endTime - tool.startTime;
        }
        const idx = s.activeToolIds.indexOf(toolId);
        if (idx !== -1) {
          s.activeToolIds.splice(idx, 1);
        }
      });
    },

    clearTools: () => {
      set((s) => {
        s.tools = {};
        s.activeToolIds = [];
      });
    },
  })),
);

// =============================================================================
// Derived selectors (use outside components or with useToolStore.getState())
// =============================================================================

export function getActiveTools(state: ToolStore): ToolUIState[] {
  return state.activeToolIds.map((id) => state.tools[id]).filter(Boolean);
}
