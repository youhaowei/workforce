/**
 * Tool Store - Reactive state for tool execution status
 *
 * Tracks active tool executions from the Agent SDK event stream.
 * UI components subscribe to this for rendering tool cards.
 */

import { createStore, produce } from 'solid-js/store';
import { getEventBus } from '@shared/event-bus';
import type { ToolStartEvent, ToolEndEvent } from '@shared/event-bus';

// =============================================================================
// Types
// =============================================================================

export type ToolUIStatus = 'pending' | 'running' | 'success' | 'failed' | 'cancelled';

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

interface ToolStoreState {
  tools: Record<string, ToolUIState>;
  activeToolIds: string[];
}

// =============================================================================
// Store Creation
// =============================================================================

const [state, setState] = createStore<ToolStoreState>({
  tools: {},
  activeToolIds: [],
});

// =============================================================================
// EventBus Integration
// =============================================================================

let initialized = false;

export function initToolStore(): void {
  if (initialized) return;
  initialized = true;

  const bus = getEventBus();

  bus.on('ToolStart', (event: ToolStartEvent) => {
    setState(
      produce((s) => {
        s.tools[event.toolId] = {
          id: event.toolId,
          name: event.toolName,
          args: event.args,
          status: 'running',
          startTime: event.timestamp,
        };
        if (!s.activeToolIds.includes(event.toolId)) {
          s.activeToolIds.push(event.toolId);
        }
      })
    );
  });

  bus.on('ToolEnd', (event: ToolEndEvent) => {
    setState(
      produce((s) => {
        const tool = s.tools[event.toolId];
        if (tool) {
          tool.status = 'success';
          tool.result = event.result;
          tool.duration = event.duration;
          tool.endTime = event.timestamp;
        }
        // Remove from active list after a delay (for UI animation)
        const idx = s.activeToolIds.indexOf(event.toolId);
        if (idx !== -1) {
          s.activeToolIds.splice(idx, 1);
        }
      })
    );
  });
}

// =============================================================================
// Actions
// =============================================================================

export function markToolFailed(toolId: string, error: string): void {
  setState(
    produce((s) => {
      const tool = s.tools[toolId];
      if (tool) {
        tool.status = 'failed';
        tool.error = error;
        tool.endTime = Date.now();
        tool.duration = tool.endTime - tool.startTime;
      }
      const idx = s.activeToolIds.indexOf(toolId);
      if (idx !== -1) {
        s.activeToolIds.splice(idx, 1);
      }
    })
  );
}

export function markToolCancelled(toolId: string): void {
  setState(
    produce((s) => {
      const tool = s.tools[toolId];
      if (tool) {
        tool.status = 'cancelled';
        tool.endTime = Date.now();
        tool.duration = tool.endTime - tool.startTime;
      }
      const idx = s.activeToolIds.indexOf(toolId);
      if (idx !== -1) {
        s.activeToolIds.splice(idx, 1);
      }
    })
  );
}

export function clearTools(): void {
  setState({
    tools: {},
    activeToolIds: [],
  });
}

// =============================================================================
// Selectors
// =============================================================================

export function getTool(toolId: string): ToolUIState | undefined {
  return state.tools[toolId];
}

export function getAllTools(): ToolUIState[] {
  return Object.values(state.tools);
}

export function getActiveTools(): ToolUIState[] {
  return state.activeToolIds.map((id) => state.tools[id]).filter(Boolean);
}

export function getActiveToolCount(): number {
  return state.activeToolIds.length;
}

export function isToolActive(toolId: string): boolean {
  return state.activeToolIds.includes(toolId);
}

// Export store for direct access
export { state as toolState };
