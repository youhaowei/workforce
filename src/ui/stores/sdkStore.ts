/**
 * SDK Store - Reactive state for verbose SDK data
 *
 * This store captures all the rich data from the Claude Agent SDK
 * that isn't directly tied to individual messages, such as:
 * - Token usage and costs
 * - Query results and statistics
 * - System initialization info
 * - Tool progress updates
 * - Hook events
 *
 * This data can be used to build rich UI displays showing:
 * - Cost tracking
 * - Token usage meters
 * - Response timing
 * - Tool execution progress
 * - Thinking tokens (extended thinking)
 */

import { createStore, produce } from 'solid-js/store';
import { createSignal, batch } from 'solid-js';
import { getEventBus } from '@shared/event-bus';
import type {
  SystemInitEvent,
  QueryResultEvent,
  MessageStartEvent,
  AssistantMessageEvent,
  ToolProgressEvent,
  ThinkingDeltaEvent,
  HookStartedEvent,
  HookResponseEvent,
} from '@shared/event-bus';

// =============================================================================
// Types
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

interface SdkStoreState {
  systemInfo: SystemInfo | null;
  currentQueryStats: QueryStats | null;
  cumulativeUsage: UsageStats;
  activeTools: ActiveTool[];
  hookExecutions: HookExecution[];
  lastMessageUsage: {
    inputTokens: number;
    outputTokens: number;
  } | null;
}

// =============================================================================
// Store Creation
// =============================================================================

const [state, setState] = createStore<SdkStoreState>({
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
});

// Track thinking tokens separately for streaming display
const [thinkingContent, setThinkingContent] = createSignal('');
const [isInitialized, setIsInitialized] = createSignal(false);

// =============================================================================
// Event Handlers
// =============================================================================

function handleSystemInit(event: SystemInitEvent) {
  setState('systemInfo', {
    claudeCodeVersion: event.claudeCodeVersion,
    model: event.model,
    tools: event.tools,
    mcpServers: event.mcpServers,
    permissionMode: event.permissionMode,
    skills: event.skills,
    sessionId: event.sessionId,
  });
  setIsInitialized(true);
}

function handleMessageStart(event: MessageStartEvent) {
  setState('lastMessageUsage', {
    inputTokens: event.usage.inputTokens,
    outputTokens: event.usage.outputTokens,
  });
  // Clear thinking content for new message
  setThinkingContent('');
}

function handleAssistantMessage(event: AssistantMessageEvent) {
  // Update last message usage with final counts
  setState('lastMessageUsage', {
    inputTokens: event.usage.inputTokens,
    outputTokens: event.usage.outputTokens,
  });
}

function handleQueryResult(event: QueryResultEvent) {
  batch(() => {
    // Set current query stats
    setState('currentQueryStats', {
      durationMs: event.durationMs,
      durationApiMs: event.durationApiMs,
      numTurns: event.numTurns,
      usage: {
        inputTokens: event.usage.inputTokens,
        outputTokens: event.usage.outputTokens,
        cacheReadInputTokens: event.usage.cacheReadInputTokens,
        cacheCreationInputTokens: event.usage.cacheCreationInputTokens,
        totalCostUsd: event.totalCostUsd,
      },
      modelUsage: event.modelUsage,
    });

    // Accumulate usage stats
    setState(
      produce((s) => {
        s.cumulativeUsage.inputTokens += event.usage.inputTokens;
        s.cumulativeUsage.outputTokens += event.usage.outputTokens;
        s.cumulativeUsage.cacheReadInputTokens += event.usage.cacheReadInputTokens;
        s.cumulativeUsage.cacheCreationInputTokens += event.usage.cacheCreationInputTokens;
        s.cumulativeUsage.totalCostUsd += event.totalCostUsd;
      })
    );
  });
}

function handleToolProgress(event: ToolProgressEvent) {
  setState(
    produce((s) => {
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
    })
  );
}

function handleThinkingDelta(event: ThinkingDeltaEvent) {
  setThinkingContent((prev) => prev + event.thinking);
}

function handleHookStarted(event: HookStartedEvent) {
  setState(
    produce((s) => {
      s.hookExecutions.push({
        hookId: event.hookId,
        hookName: event.hookName,
        hookEvent: event.hookEvent,
        status: 'running',
        startTime: event.timestamp,
      });
    })
  );
}

function handleHookResponse(event: HookResponseEvent) {
  setState(
    produce((s) => {
      const hook = s.hookExecutions.find((h) => h.hookId === event.hookId);
      if (hook) {
        hook.status = event.outcome;
        hook.endTime = event.timestamp;
        hook.exitCode = event.exitCode;
      }
    })
  );
}

// =============================================================================
// Store Initialization
// =============================================================================

let unsubscribers: Array<() => void> = [];

export function initSdkStore() {
  const bus = getEventBus();

  // Subscribe to all relevant events
  unsubscribers = [
    bus.on('SystemInit', (e) => handleSystemInit(e as SystemInitEvent)),
    bus.on('MessageStart', (e) => handleMessageStart(e as MessageStartEvent)),
    bus.on('AssistantMessage', (e) => handleAssistantMessage(e as AssistantMessageEvent)),
    bus.on('QueryResult', (e) => handleQueryResult(e as QueryResultEvent)),
    bus.on('ToolProgress', (e) => handleToolProgress(e as ToolProgressEvent)),
    bus.on('ThinkingDelta', (e) => handleThinkingDelta(e as ThinkingDeltaEvent)),
    bus.on('HookStarted', (e) => handleHookStarted(e as HookStartedEvent)),
    bus.on('HookResponse', (e) => handleHookResponse(e as HookResponseEvent)),
  ];
}

export function cleanupSdkStore() {
  unsubscribers.forEach((unsub) => unsub());
  unsubscribers = [];
}

// =============================================================================
// Actions
// =============================================================================

export function clearActiveTool(toolUseId: string) {
  setState(
    produce((s) => {
      s.activeTools = s.activeTools.filter((t) => t.toolUseId !== toolUseId);
    })
  );
}

export function clearAllActiveTools() {
  setState('activeTools', []);
}

export function clearHookExecutions() {
  setState('hookExecutions', []);
}

export function resetCumulativeUsage() {
  setState('cumulativeUsage', {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadInputTokens: 0,
    cacheCreationInputTokens: 0,
    totalCostUsd: 0,
  });
}

// =============================================================================
// Selectors
// =============================================================================

export function getSystemInfo() {
  return state.systemInfo;
}

export function getCurrentQueryStats() {
  return state.currentQueryStats;
}

export function getCumulativeUsage() {
  return state.cumulativeUsage;
}

export function getActiveTools() {
  return state.activeTools;
}

export function getHookExecutions() {
  return state.hookExecutions;
}

export function getLastMessageUsage() {
  return state.lastMessageUsage;
}

export function getThinkingContent() {
  return thinkingContent;
}

export function getIsSdkInitialized() {
  return isInitialized;
}

// Export store for direct access if needed
export { state as sdkState };
