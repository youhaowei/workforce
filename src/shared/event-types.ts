export interface TokenDeltaEvent {
  type: 'TokenDelta';
  token: string;
  index: number;
  timestamp: number;
}

export interface ToolStartEvent {
  type: 'ToolStart';
  toolId: string;
  toolName: string;
  args: unknown;
  timestamp: number;
}

export interface ToolEndEvent {
  type: 'ToolEnd';
  toolId: string;
  toolName: string;
  result: unknown;
  duration: number;
  timestamp: number;
}

export interface TaskUpdateEvent {
  type: 'TaskUpdate';
  taskId: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
  progress?: number;
  message?: string;
  timestamp: number;
}

export interface SessionChangeEvent {
  type: 'SessionChange';
  sessionId: string;
  action: 'created' | 'resumed' | 'suspended' | 'terminated';
  timestamp: number;
}

export interface BridgeErrorEvent {
  type: 'BridgeError';
  source: string;
  error: string;
  code?: string;
  timestamp: number;
}

export interface AskUserEvent {
  type: 'AskUser';
  requestId: string;
  question: string;
  options?: string[];
  timestamp: number;
}

export interface AskUserResponseEvent {
  type: 'AskUserResponse';
  requestId: string;
  response: string;
  selectedOption?: number;
  timestamp: number;
}

// ─────────────────────────────────────────────────────────────
// SDK Message Events (verbose mode - passthrough from Agent SDK)
// ─────────────────────────────────────────────────────────────

/** Content block lifecycle events */
export interface ContentBlockStartEvent {
  type: 'ContentBlockStart';
  index: number;
  contentBlock: {
    type: 'text' | 'tool_use' | 'thinking';
    id?: string;
    name?: string;
    text?: string;
  };
  timestamp: number;
}

export interface ContentBlockStopEvent {
  type: 'ContentBlockStop';
  index: number;
  timestamp: number;
}

/** Thinking block delta (extended thinking) */
export interface ThinkingDeltaEvent {
  type: 'ThinkingDelta';
  thinking: string;
  index: number;
  timestamp: number;
}

/** Message lifecycle events */
export interface MessageStartEvent {
  type: 'MessageStart';
  messageId: string;
  model: string;
  stopReason: string | null;
  usage: {
    inputTokens: number;
    outputTokens: number;
    cacheReadInputTokens?: number;
    cacheCreationInputTokens?: number;
  };
  timestamp: number;
}

export interface MessageStopEvent {
  type: 'MessageStop';
  messageId: string;
  stopReason: string;
  timestamp: number;
}

/** Full assistant message (after streaming completes) */
export interface AssistantMessageEvent {
  type: 'AssistantMessage';
  messageId: string;
  uuid: string;
  sessionId: string;
  model: string;
  stopReason: string | null;
  usage: {
    inputTokens: number;
    outputTokens: number;
    cacheReadInputTokens?: number;
    cacheCreationInputTokens?: number;
  };
  content: Array<{
    type: 'text' | 'tool_use' | 'thinking';
    text?: string;
    id?: string;
    name?: string;
    input?: unknown;
    thinking?: string;
  }>;
  error?: string;
  timestamp: number;
}

/** Query result with final statistics */
export interface QueryResultEvent {
  type: 'QueryResult';
  subtype: 'success' | 'error_during_execution' | 'error_max_turns' | 'error_max_budget_usd' | 'error_max_structured_output_retries';
  durationMs: number;
  durationApiMs: number;
  numTurns: number;
  totalCostUsd: number;
  result?: string;
  structuredOutput?: unknown;
  usage: {
    inputTokens: number;
    outputTokens: number;
    cacheReadInputTokens: number;
    cacheCreationInputTokens: number;
  };
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
  errors?: string[];
  timestamp: number;
}

/** System initialization info */
export interface SystemInitEvent {
  type: 'SystemInit';
  claudeCodeVersion: string;
  cwd: string;
  model: string;
  tools: string[];
  mcpServers: Array<{ name: string; status: string }>;
  permissionMode: string;
  slashCommands: string[];
  skills: string[];
  sessionId: string;
  timestamp: number;
}

/** System status changes */
export interface SystemStatusEvent {
  type: 'SystemStatus';
  status: 'compacting' | null;
  permissionMode?: string;
  timestamp: number;
}

/** Tool progress updates */
export interface ToolProgressEvent {
  type: 'ToolProgress';
  toolUseId: string;
  toolName: string;
  elapsedTimeSeconds: number;
  timestamp: number;
}

/** Tool use summary */
export interface ToolUseSummaryEvent {
  type: 'ToolUseSummary';
  summary: string;
  precedingToolUseIds: string[];
  timestamp: number;
}

/** Hook lifecycle events */
export interface HookStartedEvent {
  type: 'HookStarted';
  hookId: string;
  hookName: string;
  hookEvent: string;
  timestamp: number;
}

export interface HookProgressEvent {
  type: 'HookProgress';
  hookId: string;
  hookName: string;
  hookEvent: string;
  stdout: string;
  stderr: string;
  output: string;
  timestamp: number;
}

export interface HookResponseEvent {
  type: 'HookResponse';
  hookId: string;
  hookName: string;
  hookEvent: string;
  outcome: 'success' | 'error' | 'cancelled';
  output: string;
  exitCode?: number;
  timestamp: number;
}

/** Task notifications (for background tasks) */
export interface TaskNotificationEvent {
  type: 'TaskNotification';
  taskId: string;
  status: 'completed' | 'failed' | 'stopped';
  outputFile: string;
  summary: string;
  timestamp: number;
}

/** Auth status changes */
export interface AuthStatusEvent {
  type: 'AuthStatus';
  isAuthenticating: boolean;
  output: string[];
  error?: string;
  timestamp: number;
}

/** Raw SDK message passthrough for advanced use cases */
export interface RawSdkMessageEvent {
  type: 'RawSdkMessage';
  sdkMessageType: string;
  payload: unknown;
  timestamp: number;
}

// ─────────────────────────────────────────────────────────────
// Workforce Orchestration Events
// ─────────────────────────────────────────────────────────────

/** Org lifecycle events */
export interface OrgChangeEvent {
  type: 'OrgChange';
  orgId: string;
  action: 'created' | 'updated' | 'deleted' | 'switched';
  timestamp: number;
}

/** Session lifecycle state transitions */
export interface LifecycleTransitionEvent {
  type: 'LifecycleTransition';
  sessionId: string;
  from: string;
  to: string;
  reason: string;
  actor: 'system' | 'user' | 'agent';
  timestamp: number;
}

/** Review queue item changes */
export interface ReviewItemChangeEvent {
  type: 'ReviewItemChange';
  reviewItemId: string;
  sessionId: string;
  orgId: string;
  action: 'created' | 'resolved';
  timestamp: number;
}

/** Git worktree lifecycle events */
export interface WorktreeChangeEvent {
  type: 'WorktreeChange';
  sessionId: string;
  worktreePath: string;
  action: 'created' | 'merged' | 'archived' | 'deleted';
  timestamp: number;
}

/** Agent spawned notification */
export interface AgentSpawnedEvent {
  type: 'AgentSpawned';
  sessionId: string;
  parentSessionId?: string;
  templateId: string;
  goal: string;
  orgId: string;
  timestamp: number;
}

/** Session rehydration started (background full replay begins) */
export interface SessionRehydrateStartedEvent {
  type: 'SessionRehydrateStarted';
  sessionId: string;
  timestamp: number;
}

/** Session rehydration completed (full replay + consolidation done) */
export interface SessionRehydrateDoneEvent {
  type: 'SessionRehydrateDone';
  sessionId: string;
  timestamp: number;
}

/** Session rehydration failed */
export interface SessionRehydrateFailedEvent {
  type: 'SessionRehydrateFailed';
  sessionId: string;
  error: string;
  timestamp: number;
}

/** Session consolidation phase started (after replay, before file rewrite) */
export interface SessionConsolidationStartedEvent {
  type: 'SessionConsolidationStarted';
  sessionId: string;
  timestamp: number;
}

/** Audit entry recorded */
export interface AuditEntryEvent {
  type: 'AuditEntry';
  entryId: string;
  sessionId: string;
  orgId: string;
  auditType: string;
  description: string;
  timestamp: number;
}

export type BusEvent =
  | TokenDeltaEvent
  | ToolStartEvent
  | ToolEndEvent
  | TaskUpdateEvent
  | SessionChangeEvent
  | BridgeErrorEvent
  | AskUserEvent
  | AskUserResponseEvent
  // SDK message events (verbose mode)
  | ContentBlockStartEvent
  | ContentBlockStopEvent
  | ThinkingDeltaEvent
  | MessageStartEvent
  | MessageStopEvent
  | AssistantMessageEvent
  | QueryResultEvent
  | SystemInitEvent
  | SystemStatusEvent
  | ToolProgressEvent
  | ToolUseSummaryEvent
  | HookStartedEvent
  | HookProgressEvent
  | HookResponseEvent
  | TaskNotificationEvent
  | AuthStatusEvent
  | RawSdkMessageEvent
  // Workforce orchestration events
  | OrgChangeEvent
  | LifecycleTransitionEvent
  | ReviewItemChangeEvent
  | WorktreeChangeEvent
  | AgentSpawnedEvent
  | AuditEntryEvent
  // Session rehydration events
  | SessionRehydrateStartedEvent
  | SessionRehydrateDoneEvent
  | SessionRehydrateFailedEvent
  | SessionConsolidationStartedEvent;

export const EventType = {
  TokenDelta: 'TokenDelta',
  ToolStart: 'ToolStart',
  ToolEnd: 'ToolEnd',
  TaskUpdate: 'TaskUpdate',
  SessionChange: 'SessionChange',
  BridgeError: 'BridgeError',
  AskUser: 'AskUser',
  AskUserResponse: 'AskUserResponse',
  // SDK message events (verbose mode)
  ContentBlockStart: 'ContentBlockStart',
  ContentBlockStop: 'ContentBlockStop',
  ThinkingDelta: 'ThinkingDelta',
  MessageStart: 'MessageStart',
  MessageStop: 'MessageStop',
  AssistantMessage: 'AssistantMessage',
  QueryResult: 'QueryResult',
  SystemInit: 'SystemInit',
  SystemStatus: 'SystemStatus',
  ToolProgress: 'ToolProgress',
  ToolUseSummary: 'ToolUseSummary',
  HookStarted: 'HookStarted',
  HookProgress: 'HookProgress',
  HookResponse: 'HookResponse',
  TaskNotification: 'TaskNotification',
  AuthStatus: 'AuthStatus',
  RawSdkMessage: 'RawSdkMessage',
  // Workforce orchestration events
  OrgChange: 'OrgChange',
  LifecycleTransition: 'LifecycleTransition',
  ReviewItemChange: 'ReviewItemChange',
  WorktreeChange: 'WorktreeChange',
  AgentSpawned: 'AgentSpawned',
  AuditEntry: 'AuditEntry',
  // Session rehydration events
  SessionRehydrateStarted: 'SessionRehydrateStarted',
  SessionRehydrateDone: 'SessionRehydrateDone',
  SessionRehydrateFailed: 'SessionRehydrateFailed',
  SessionConsolidationStarted: 'SessionConsolidationStarted',
  Wildcard: '*',
} as const;

export type EventTypeName = BusEvent['type'];
export type WildcardType = typeof EventType.Wildcard;
export type SubscribableEventType = EventTypeName | WildcardType;
export type EventPayload<T extends EventTypeName> = Extract<BusEvent, { type: T }>;
