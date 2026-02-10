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

/** Workspace lifecycle events */
export interface WorkspaceChangeEvent {
  type: 'WorkspaceChange';
  workspaceId: string;
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
  workspaceId: string;
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
  workspaceId: string;
  timestamp: number;
}

/** Audit entry recorded */
export interface AuditEntryEvent {
  type: 'AuditEntry';
  entryId: string;
  sessionId: string;
  workspaceId: string;
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
  | WorkspaceChangeEvent
  | LifecycleTransitionEvent
  | ReviewItemChangeEvent
  | WorktreeChangeEvent
  | AgentSpawnedEvent
  | AuditEntryEvent;

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
  WorkspaceChange: 'WorkspaceChange',
  LifecycleTransition: 'LifecycleTransition',
  ReviewItemChange: 'ReviewItemChange',
  WorktreeChange: 'WorktreeChange',
  AgentSpawned: 'AgentSpawned',
  AuditEntry: 'AuditEntry',
  Wildcard: '*',
} as const;

export type EventTypeName = BusEvent['type'];
export type WildcardType = typeof EventType.Wildcard;
export type SubscribableEventType = EventTypeName | WildcardType;
export type EventPayload<T extends EventTypeName> = Extract<BusEvent, { type: T }>;

export type SyncListener<T extends BusEvent = BusEvent> = (event: T) => void;
export type AsyncListener<T extends BusEvent = BusEvent> = (event: T) => Promise<void>;
export type Listener<T extends BusEvent = BusEvent> = SyncListener<T> | AsyncListener<T>;

export interface ListenerOptions {
  once?: boolean;
  priority?: number;
}

interface ListenerEntry<T extends BusEvent = BusEvent> {
  ref: WeakRef<ListenerWrapper<T>>;
  direct?: ListenerWrapper<T>;
  options: Required<ListenerOptions>;
}

interface ListenerWrapper<T extends BusEvent = BusEvent> {
  fn: Listener<T>;
}

export interface BackpressureController {
  pause(): void;
  resume(): void;
  isPaused(): boolean;
  queueSize(): number;
  clear(): void;
}

export type Unsubscribe = () => void;

export class EventBus {
  private listeners = new Map<SubscribableEventType, ListenerEntry[]>();
  private paused = false;
  private eventQueue: BusEvent[] = [];
  private cleanupInterval: ReturnType<typeof setInterval> | null = null;
  private readonly CLEANUP_INTERVAL_MS = 30000;

  constructor() {
    this.cleanupInterval = setInterval(() => this.cleanup(), this.CLEANUP_INTERVAL_MS);
  }

  on<T extends EventTypeName>(
    eventType: T,
    listener: Listener<EventPayload<T>>,
    options?: ListenerOptions
  ): Unsubscribe;
  on(
    eventType: WildcardType,
    listener: Listener<BusEvent>,
    options?: ListenerOptions
  ): Unsubscribe;
  on(
    eventType: SubscribableEventType,
    listener: Listener<BusEvent>,
    options: ListenerOptions = {}
  ): Unsubscribe {
    return this.addListener(eventType, listener, options);
  }

  once<T extends EventTypeName>(
    eventType: T,
    listener: Listener<EventPayload<T>>
  ): Unsubscribe;
  once(eventType: WildcardType, listener: Listener<BusEvent>): Unsubscribe;
  once(eventType: SubscribableEventType, listener: Listener<BusEvent>): Unsubscribe {
    return this.addListener(eventType, listener, { once: true });
  }

  private addListener(
    eventType: SubscribableEventType,
    listener: Listener,
    options: ListenerOptions = {}
  ): Unsubscribe {
    const resolvedOptions: Required<ListenerOptions> = {
      once: options.once ?? false,
      priority: options.priority ?? 0,
    };

    const wrapper: ListenerWrapper = { fn: listener };
    
    const entry: ListenerEntry = {
      ref: new WeakRef(wrapper),
      direct: wrapper,
      options: resolvedOptions,
    };

    if (!this.listeners.has(eventType)) {
      this.listeners.set(eventType, []);
    }

    const entries = this.listeners.get(eventType)!;
    entries.push(entry);
    entries.sort((a, b) => b.options.priority - a.options.priority);

    return () => {
      this.removeListener(eventType, listener);
    };
  }

  off<T extends EventTypeName>(eventType: T, listener: Listener<EventPayload<T>>): void;
  off(eventType: WildcardType, listener: Listener<BusEvent>): void;
  off(eventType: SubscribableEventType, listener: Listener<BusEvent>): void {
    this.removeListener(eventType, listener);
  }

  private removeListener(eventType: SubscribableEventType, listener: Listener): void {
    const entries = this.listeners.get(eventType);
    if (!entries) return;

    const index = entries.findIndex((entry) => {
      const wrapper = entry.direct ?? entry.ref.deref();
      return wrapper?.fn === listener;
    });

    if (index !== -1) {
      entries.splice(index, 1);
    }

    if (entries.length === 0) {
      this.listeners.delete(eventType);
    }
  }

  emit<T extends BusEvent>(event: T): void {
    if (this.paused) {
      this.eventQueue.push(event);
      return;
    }
    this.dispatch(event);
  }

  async emitAsync<T extends BusEvent>(event: T): Promise<void> {
    if (this.paused) {
      this.eventQueue.push(event);
      return;
    }
    await this.dispatchAsync(event);
  }

  getBackpressureController(): BackpressureController {
    return {
      pause: () => {
        this.paused = true;
      },
      resume: () => {
        this.paused = false;
        this.flushQueue();
      },
      isPaused: () => this.paused,
      queueSize: () => this.eventQueue.length,
      clear: () => {
        this.eventQueue = [];
      },
    };
  }

  listenerCount(eventType: SubscribableEventType): number {
    return this.listeners.get(eventType)?.length ?? 0;
  }

  totalListenerCount(): number {
    let count = 0;
    for (const entries of this.listeners.values()) {
      count += entries.length;
    }
    return count;
  }

  removeAllListeners(eventType?: SubscribableEventType): void {
    if (eventType) {
      this.listeners.delete(eventType);
    } else {
      this.listeners.clear();
    }
  }

  dispose(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
    this.listeners.clear();
    this.eventQueue = [];
  }

  private dispatch(event: BusEvent): void {
    const toRemove: Array<{ type: SubscribableEventType; listener: Listener }> = [];

    this.dispatchToType(event.type, event, toRemove);
    this.dispatchToType(EventType.Wildcard, event, toRemove);

    for (const { type, listener } of toRemove) {
      this.removeListener(type, listener);
    }
  }

  private async dispatchAsync(event: BusEvent): Promise<void> {
    const toRemove: Array<{ type: SubscribableEventType; listener: Listener }> = [];
    const promises: Promise<void>[] = [];

    this.dispatchToTypeAsync(event.type, event, toRemove, promises);
    this.dispatchToTypeAsync(EventType.Wildcard, event, toRemove, promises);

    await Promise.all(promises);

    for (const { type, listener } of toRemove) {
      this.removeListener(type, listener);
    }
  }

  private dispatchToType(
    eventType: SubscribableEventType,
    event: BusEvent,
    toRemove: Array<{ type: SubscribableEventType; listener: Listener }>
  ): void {
    const entries = this.listeners.get(eventType);
    if (!entries) return;

    for (const entry of entries) {
      const wrapper = entry.direct ?? entry.ref.deref();
      if (!wrapper) continue;

      try {
        const result = wrapper.fn(event);
        if (result instanceof Promise) {
          result.catch((err) => {
            console.error(`[EventBus] Async listener error for ${event.type}:`, err);
          });
        }
      } catch (err) {
        console.error(`[EventBus] Listener error for ${event.type}:`, err);
      }

      if (entry.options.once) {
        toRemove.push({ type: eventType, listener: wrapper.fn });
      }
    }
  }

  private dispatchToTypeAsync(
    eventType: SubscribableEventType,
    event: BusEvent,
    toRemove: Array<{ type: SubscribableEventType; listener: Listener }>,
    promises: Promise<void>[]
  ): void {
    const entries = this.listeners.get(eventType);
    if (!entries) return;

    for (const entry of entries) {
      const wrapper = entry.direct ?? entry.ref.deref();
      if (!wrapper) continue;

      try {
        const result = wrapper.fn(event);
        if (result instanceof Promise) {
          promises.push(
            result.catch((err) => {
              console.error(`[EventBus] Async listener error for ${event.type}:`, err);
            })
          );
        }
      } catch (err) {
        console.error(`[EventBus] Listener error for ${event.type}:`, err);
      }

      if (entry.options.once) {
        toRemove.push({ type: eventType, listener: wrapper.fn });
      }
    }
  }

  private flushQueue(): void {
    const events = this.eventQueue;
    this.eventQueue = [];

    for (const event of events) {
      this.dispatch(event);
    }
  }

  private cleanup(): void {
    for (const [eventType, entries] of this.listeners) {
      const alive = entries.filter((entry) => {
        const wrapper = entry.direct ?? entry.ref.deref();
        return wrapper !== undefined;
      });

      if (alive.length === 0) {
        this.listeners.delete(eventType);
      } else if (alive.length !== entries.length) {
        this.listeners.set(eventType, alive);
      }
    }
  }
}

let globalBus: EventBus | null = null;

export function getEventBus(): EventBus {
  if (!globalBus) {
    globalBus = new EventBus();
  }
  return globalBus;
}

export function createEventBus(): EventBus {
  return new EventBus();
}
