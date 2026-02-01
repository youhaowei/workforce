/**
 * Service Layer Type Definitions
 *
 * All service interfaces for the Fuxi desktop agentic orchestrator.
 * Services follow the lazy singleton pattern with explicit dispose().
 */

import type { BusEvent } from '@shared/event-bus';

// =============================================================================
// Common Types
// =============================================================================

/** Base interface for all disposable services */
export interface Disposable {
  dispose(): void;
}

/** Result type for operations that can fail */
export type Result<T, E = Error> =
  | { ok: true; value: T }
  | { ok: false; error: E };

/** Async generator for streaming results */
export type StreamResult<T> = AsyncGenerator<T, void, unknown>;

// =============================================================================
// Agent Service Types
// =============================================================================

export interface QueryOptions {
  /** Model to use (defaults to claude-sonnet) */
  model?: string;
  /** Maximum tokens in response */
  maxTokens?: number;
  /** System prompt override */
  systemPrompt?: string;
  /** Tools available for this query */
  tools?: ToolDefinition[];
  /** AbortSignal for cancellation */
  signal?: AbortSignal;
  /** Session ID for context continuity */
  sessionId?: string;
}

export interface TokenDelta {
  token: string;
  index: number;
}

export interface ToolCall {
  id: string;
  name: string;
  args: Record<string, unknown>;
}

export interface ToolResult {
  toolCallId: string;
  result: unknown;
  error?: string;
}

export interface AgentResponse {
  /** Unique response ID */
  id: string;
  /** Full accumulated text */
  text: string;
  /** Tool calls made during response */
  toolCalls: ToolCall[];
  /** Usage statistics */
  usage?: {
    inputTokens: number;
    outputTokens: number;
  };
  /** Stop reason */
  stopReason: 'end_turn' | 'tool_use' | 'max_tokens' | 'cancelled';
}

export interface AgentService extends Disposable {
  /**
   * Query the agent with streaming response.
   * Emits TokenDelta events via EventBus.
   */
  query(prompt: string, options?: QueryOptions): StreamResult<TokenDelta>;

  /**
   * Cancel the current query.
   */
  cancel(): void;

  /**
   * Check if a query is currently in progress.
   */
  isQuerying(): boolean;
}

// =============================================================================
// Session Service Types
// =============================================================================

export interface Message {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: number;
  toolCalls?: ToolCall[];
  toolResults?: ToolResult[];
}

export interface Session {
  id: string;
  title?: string;
  createdAt: number;
  updatedAt: number;
  parentId?: string;
  messages: Message[];
  metadata: Record<string, unknown>;
}

export interface SessionSearchResult {
  session: Session;
  matchedText: string;
  score: number;
}

export interface SessionService extends Disposable {
  /**
   * Create a new session.
   */
  create(title?: string): Promise<Session>;

  /**
   * Get a session by ID.
   */
  get(sessionId: string): Promise<Session | null>;

  /**
   * Save/update a session (incremental append).
   */
  save(session: Session): Promise<void>;

  /**
   * Resume an existing session.
   */
  resume(sessionId: string): Promise<Session>;

  /**
   * Fork a session (create child with shared history).
   */
  fork(sessionId: string): Promise<Session>;

  /**
   * List all sessions with optional pagination.
   */
  list(options?: { limit?: number; offset?: number }): Promise<Session[]>;

  /**
   * Search sessions by content.
   */
  search(query: string): Promise<SessionSearchResult[]>;

  /**
   * Delete a session.
   */
  delete(sessionId: string): Promise<void>;

  /**
   * Get the current active session.
   */
  getCurrent(): Session | null;

  /**
   * Set the current active session.
   */
  setCurrent(session: Session | null): void;
}

// =============================================================================
// Tool Service Types
// =============================================================================

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface ToolExecutionContext {
  sessionId?: string;
  workingDirectory: string;
  signal?: AbortSignal;
}

export interface ToolExecutionResult<T = unknown> {
  success: boolean;
  result?: T;
  error?: string;
  duration: number;
}

export interface ToolService extends Disposable {
  /**
   * Register a tool implementation.
   * @param name - Tool name
   * @param handler - Tool execution handler
   * @param definition - Optional tool definition (description, inputSchema)
   */
  register(name: string, handler: ToolHandler, definition?: Partial<ToolDefinition>): void;

  /**
   * Unregister a tool.
   */
  unregister(name: string): void;

  /**
   * Execute a tool by name.
   */
  execute<T = unknown>(
    name: string,
    args: Record<string, unknown>,
    context: ToolExecutionContext
  ): Promise<ToolExecutionResult<T>>;

  /**
   * Get all registered tool definitions.
   */
  getDefinitions(): ToolDefinition[];

  /**
   * Check if a tool is registered.
   */
  has(name: string): boolean;
}

export type ToolHandler = (
  args: Record<string, unknown>,
  context: ToolExecutionContext
) => Promise<unknown> | unknown;

// =============================================================================
// Orchestrator Service Types
// =============================================================================

export interface AgentProfile {
  id: string;
  name: string;
  description: string;
  systemPrompt: string;
  tools?: string[];
  temperature?: number;
  maxTokens?: number;
}

export interface RoutingDecision {
  profileId: string;
  confidence: number;
  reason: string;
}

export interface OrchestratorService extends Disposable {
  /**
   * Get the current active profile.
   */
  getCurrentProfile(): AgentProfile;

  /**
   * Switch to a different profile.
   */
  switchProfile(profileId: string): Promise<void>;

  /**
   * Route a prompt to the best profile.
   */
  route(prompt: string): Promise<RoutingDecision>;

  /**
   * List all available profiles.
   */
  listProfiles(): AgentProfile[];

  /**
   * Register a custom profile.
   */
  registerProfile(profile: AgentProfile): void;

  /**
   * Unregister a profile.
   */
  unregisterProfile(profileId: string): void;
}

// =============================================================================
// Skill Service Types
// =============================================================================

export interface Skill {
  name: string;
  description: string;
  content: string;
  tags?: string[];
  loadedAt?: number;
}

export interface SkillService extends Disposable {
  /**
   * Load a skill by name.
   */
  load(name: string): Promise<Skill>;

  /**
   * Unload a skill.
   */
  unload(name: string): void;

  /**
   * Get all loaded skills.
   */
  getLoaded(): Skill[];

  /**
   * Check if a skill is loaded.
   */
  isLoaded(name: string): boolean;

  /**
   * List all available skills.
   */
  listAvailable(): Promise<string[]>;

  /**
   * Get the combined prompt injection for loaded skills.
   */
  getInjection(): string;
}

// =============================================================================
// Hook Service Types
// =============================================================================

export interface HookContext {
  toolName: string;
  args: Record<string, unknown>;
  sessionId?: string;
}

export interface PreHookResult {
  /** Whether to proceed with tool execution */
  proceed: boolean;
  /** Modified args (if any) */
  modifiedArgs?: Record<string, unknown>;
  /** Reason for blocking (if proceed=false) */
  blockReason?: string;
  /** Short-circuit result (skip tool, return this) */
  shortCircuitResult?: unknown;
}

export interface PostHookResult {
  /** Modified result (if any) */
  modifiedResult?: unknown;
  /** Side effects to trigger */
  sideEffects?: Array<{
    event: BusEvent;
  }>;
}

export type PreHook = (context: HookContext) => PreHookResult | Promise<PreHookResult>;
export type PostHook = (
  context: HookContext,
  result: unknown
) => PostHookResult | Promise<PostHookResult>;

export interface HookService extends Disposable {
  /**
   * Register a pre-tool hook.
   */
  registerPreHook(name: string, hook: PreHook, priority?: number): void;

  /**
   * Register a post-tool hook.
   */
  registerPostHook(name: string, hook: PostHook, priority?: number): void;

  /**
   * Unregister a hook by name.
   */
  unregister(name: string): void;

  /**
   * Run all pre-hooks for a tool.
   */
  runPreHooks(context: HookContext): Promise<PreHookResult>;

  /**
   * Run all post-hooks for a tool.
   */
  runPostHooks(context: HookContext, result: unknown): Promise<PostHookResult>;

  /**
   * List registered hooks.
   */
  listHooks(): Array<{ name: string; type: 'pre' | 'post'; priority: number }>;
}

// =============================================================================
// Background Service Types
// =============================================================================

export type TaskPriority = 'high' | 'normal' | 'low';
export type TaskStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';

export interface BackgroundTask {
  id: string;
  name: string;
  status: TaskStatus;
  priority: TaskPriority;
  progress?: number;
  result?: unknown;
  error?: string;
  createdAt: number;
  startedAt?: number;
  completedAt?: number;
}

export interface BackgroundTaskOptions {
  priority?: TaskPriority;
  name?: string;
}

export interface BackgroundService extends Disposable {
  /**
   * Submit a task to run in background.
   */
  submit<T>(
    fn: () => Promise<T>,
    options?: BackgroundTaskOptions
  ): string;

  /**
   * Get task status and result.
   */
  getTask(taskId: string): BackgroundTask | null;

  /**
   * Cancel a running task.
   */
  cancel(taskId: string): boolean;

  /**
   * List all tasks with optional filter.
   */
  list(filter?: { status?: TaskStatus }): BackgroundTask[];

  /**
   * Wait for a task to complete.
   */
  waitFor<T>(taskId: string): Promise<T>;

  /**
   * Get the number of running tasks.
   */
  runningCount(): number;
}

// =============================================================================
// Todo Service Types
// =============================================================================

export type TodoStatus = 'pending' | 'in_progress' | 'completed' | 'cancelled';

export interface Todo {
  id: string;
  title: string;
  description?: string;
  status: TodoStatus;
  priority?: number;
  createdAt: number;
  updatedAt: number;
  completedAt?: number;
  metadata?: Record<string, unknown>;
}

export interface TodoFilter {
  status?: TodoStatus | TodoStatus[];
  search?: string;
}

export interface TodoService extends Disposable {
  /**
   * Create a new todo.
   */
  create(title: string, description?: string): Todo;

  /**
   * Get a todo by ID.
   */
  get(todoId: string): Todo | null;

  /**
   * Update a todo.
   */
  update(todoId: string, updates: Partial<Omit<Todo, 'id' | 'createdAt'>>): Todo | null;

  /**
   * Delete a todo.
   */
  delete(todoId: string): boolean;

  /**
   * List todos with optional filter.
   */
  list(filter?: TodoFilter): Todo[];

  /**
   * Mark a todo as complete.
   */
  complete(todoId: string): Todo | null;

  /**
   * Start working on a todo.
   */
  start(todoId: string): Todo | null;

  /**
   * Cancel a todo.
   */
  cancel(todoId: string): Todo | null;

  /**
   * Get all pending todos.
   */
  getPending(): Todo[];

  /**
   * Flush changes to disk.
   */
  flush(): Promise<void>;
}
