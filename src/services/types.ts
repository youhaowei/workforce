/**
 * Service Layer Type Definitions
 *
 * All service interfaces for the Workforce desktop agentic orchestrator.
 * Services follow the lazy singleton pattern with explicit dispose().
 */

import type { BusEvent } from '@/shared/event-bus';

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
// Session Lifecycle Types (declared before SessionService which references them)
// =============================================================================

export type SessionType = 'chat' | 'workagent';

export type LifecycleState =
  | 'created'
  | 'active'
  | 'paused'
  | 'completed'
  | 'failed'
  | 'cancelled';

export interface StateTransition {
  from: LifecycleState;
  to: LifecycleState;
  reason: string;
  timestamp: number;
  actor: 'system' | 'user' | 'agent';
}

export interface SessionLifecycle {
  state: LifecycleState;
  stateHistory: StateTransition[];
  pauseReason?: string;
  failureReason?: string;
  completionSummary?: string;
}

export interface WorkAgentConfig {
  templateId: string;
  goal: string;
  workflowId?: string;
  workflowStepIndex?: number;
  worktreePath?: string;
  orgId: string;
  /** Absolute path to the org project root (for worktree isolation) */
  repoRoot?: string;
}

/** Valid lifecycle state transitions */
export const VALID_TRANSITIONS: Record<LifecycleState, LifecycleState[]> = {
  created: ['active'],
  active: ['paused', 'completed', 'failed', 'cancelled'],
  paused: ['active', 'cancelled'],
  completed: [],
  failed: [],
  cancelled: [],
};

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

// =============================================================================
// JSONL Record Types (Session Persistence)
// =============================================================================

/** Session identity + base metadata — always the first line in a .jsonl file. */
export interface JournalHeader {
  t: 'header';
  v: number;
  id: string;
  title?: string;
  createdAt: number;
  updatedAt: number;
  parentId?: string;
  metadata: Record<string, unknown>;
}

/** A complete non-streaming message (user or system). */
export interface JournalMessage {
  t: 'message';
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: number;
  toolCalls?: ToolCall[];
  toolResults?: ToolResult[];
}

/** Marks the start of an assistant streaming response. */
export interface JournalMessageStart {
  t: 'message_start';
  id: string;
  role: 'assistant';
  timestamp: number;
  meta?: Record<string, unknown>;
}

/** A single token/chunk delta for an in-progress stream. */
export interface JournalMessageDelta {
  t: 'message_delta';
  id: string;
  delta: string;
  seq: number;
}

/** Authoritative final content for a completed assistant message. */
export interface JournalMessageFinal {
  t: 'message_final';
  id: string;
  role: 'assistant';
  content: string;
  timestamp: number;
  stopReason: string;
  toolCalls?: ToolCall[];
  toolResults?: ToolResult[];
}

/** Stream aborted/interrupted marker. */
export interface JournalMessageAbort {
  t: 'message_abort';
  id: string;
  reason: string;
  timestamp: number;
}

/** Metadata patch (title change, lifecycle transition, etc.). */
export interface JournalMeta {
  t: 'meta';
  updatedAt: number;
  patch: Record<string, unknown>;
}

export type JournalRecord =
  | JournalHeader
  | JournalMessage
  | JournalMessageStart
  | JournalMessageDelta
  | JournalMessageFinal
  | JournalMessageAbort
  | JournalMeta;

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
   * List sessions with optional pagination and org scoping.
   * When orgId is provided, only sessions with matching metadata.orgId are returned.
   */
  list(options?: { limit?: number; offset?: number; orgId?: string }): Promise<Session[]>;

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

  /**
   * Create a WorkAgent session with lifecycle tracking.
   */
  createWorkAgent(config: WorkAgentConfig): Promise<Session>;

  /**
   * Transition a session's lifecycle state.
   * Validates the transition and records history.
   */
  transitionState(
    sessionId: string,
    newState: LifecycleState,
    reason: string,
    actor?: 'system' | 'user' | 'agent'
  ): Promise<Session>;

  /**
   * List sessions filtered by lifecycle state.
   */
  listByState(state: LifecycleState, orgId?: string): Promise<Session[]>;

  /**
   * Get all child sessions of a parent.
   */
  getChildren(parentSessionId: string): Promise<Session[]>;

  /**
   * Add a single message to a session (user/system messages).
   * Appends a `message` record to the JSONL file.
   */
  addMessage(sessionId: string, message: Message): Promise<void>;

  // ---------------------------------------------------------------------------
  // Streaming Persistence (JSONL delta tracking)
  // ---------------------------------------------------------------------------

  /**
   * Mark the start of an assistant streaming response.
   * Appends a `message_start` record to the JSONL file.
   */
  startAssistantStream(sessionId: string, messageId: string, meta?: Record<string, unknown>): Promise<void>;

  /**
   * Append a streaming token delta.
   * Appends a `message_delta` record with a sequence number.
   */
  appendAssistantDelta(sessionId: string, messageId: string, delta: string, seq: number): Promise<void>;

  /**
   * Append multiple deltas in a single I/O operation (batch variant of appendAssistantDelta).
   * Reduces write amplification when flushing buffered client-side deltas.
   */
  appendAssistantDeltaBatch(sessionId: string, messageId: string, deltas: Array<{ delta: string; seq: number }>): Promise<void>;

  /**
   * Finalize an assistant message with the full authoritative content.
   * Appends a `message_final` record. This is the source of truth on replay.
   */
  finalizeAssistantMessage(
    sessionId: string,
    messageId: string,
    fullContent: string,
    stopReason: string,
  ): Promise<void>;

  /**
   * Abort an in-progress assistant stream.
   * Appends a `message_abort` record with the reason.
   */
  abortAssistantStream(sessionId: string, messageId: string, reason: string): Promise<void>;

  /**
   * Read messages for a session with optional pagination.
   */
  getMessages(sessionId: string, options?: { limit?: number; offset?: number }): Promise<Message[]>;
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

export type BackgroundTaskPriority = 'high' | 'normal' | 'low';
export type BackgroundTaskStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';

export interface BackgroundTask {
  id: string;
  name: string;
  status: BackgroundTaskStatus;
  priority: BackgroundTaskPriority;
  progress?: number;
  result?: unknown;
  error?: string;
  createdAt: number;
  startedAt?: number;
  completedAt?: number;
}

export interface BackgroundTaskOptions {
  priority?: BackgroundTaskPriority;
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
  list(filter?: { status?: BackgroundTaskStatus }): BackgroundTask[];

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
// Task Service Types
// =============================================================================

export type TaskStatus = 'pending' | 'in_progress' | 'completed' | 'cancelled';

export interface Task {
  id: string;
  title: string;
  description?: string;
  status: TaskStatus;
  priority?: number;
  createdAt: number;
  updatedAt: number;
  completedAt?: number;
  metadata?: Record<string, unknown>;
}

export interface TaskFilter {
  status?: TaskStatus | TaskStatus[];
  search?: string;
}

export interface TaskService extends Disposable {
  /** Create a new task. */
  create(title: string, description?: string): Promise<Task>;

  /** Get a task by ID. */
  get(taskId: string): Promise<Task | null>;

  /** Update a task. */
  update(taskId: string, updates: Partial<Omit<Task, 'id' | 'createdAt'>>): Promise<Task | null>;

  /** Delete a task. */
  delete(taskId: string): Promise<boolean>;

  /** List tasks with optional filter. */
  list(filter?: TaskFilter): Promise<Task[]>;

  /** Mark a task as complete. */
  complete(taskId: string): Promise<Task | null>;

  /** Start working on a task. */
  start(taskId: string): Promise<Task | null>;

  /** Cancel a task. */
  cancel(taskId: string): Promise<Task | null>;

  /** Get all pending tasks. */
  getPending(): Promise<Task[]>;

  /** Flush changes to disk. */
  flush(): Promise<void>;
}

// =============================================================================
// Org Types
// =============================================================================

export interface Org {
  id: string;
  name: string;
  description?: string;
  /** Absolute path to the project root directory */
  rootPath: string;
  createdAt: number;
  updatedAt: number;
  settings: OrgSettings;
}

export interface OrgSettings {
  /** Tool names allowed in this org */
  allowedTools: string[];
  /** Default agent template for new sessions */
  defaultTemplateId?: string;
  /** Cost warning threshold in USD */
  costWarningThreshold?: number;
  /** Cost hard cap in USD (optional) */
  costHardCap?: number;
}

export interface OrgService extends Disposable {
  create(name: string, rootPath: string): Promise<Org>;
  get(id: string): Promise<Org | null>;
  update(id: string, updates: Partial<Omit<Org, 'id' | 'createdAt'>>): Promise<Org>;
  list(): Promise<Org[]>;
  delete(id: string): Promise<void>;
  getCurrent(): Org | null;
  setCurrent(org: Org | null): void;
}

// =============================================================================
// Agent Template Types
// =============================================================================

export interface AgentTemplate {
  id: string;
  name: string;
  description: string;
  systemPrompt: string;
  /** Skill names from SkillService */
  skills: string[];
  /** Tool names from ToolService */
  tools: string[];
  /** Natural-language constraints */
  constraints: string[];
  reasoningIntensity: 'low' | 'medium' | 'high' | 'max';
  maxTokens?: number;
  temperature?: number;
  archived: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface TemplateValidation {
  valid: boolean;
  errors: Array<{ field: string; message: string }>;
  warnings: Array<{ field: string; message: string }>;
}

export interface TemplateService extends Disposable {
  create(
    orgId: string,
    template: Omit<AgentTemplate, 'id' | 'createdAt' | 'updatedAt' | 'archived'>
  ): Promise<AgentTemplate>;
  get(orgId: string, id: string): Promise<AgentTemplate | null>;
  update(orgId: string, id: string, updates: Partial<AgentTemplate>): Promise<AgentTemplate>;
  duplicate(orgId: string, id: string): Promise<AgentTemplate>;
  archive(orgId: string, id: string): Promise<void>;
  list(orgId: string, options?: { includeArchived?: boolean }): Promise<AgentTemplate[]>;
  validate(template: Partial<AgentTemplate>): TemplateValidation;
  /** Convert a legacy AgentProfile to an AgentTemplate */
  fromProfile(profile: AgentProfile): AgentTemplate;
}

// =============================================================================
// Workflow Template Types
// =============================================================================

export type StepType = 'agent' | 'review_gate' | 'parallel_group';

export interface WorkflowStep {
  id: string;
  name: string;
  type: StepType;
  /** Agent template to use (for 'agent' type) */
  templateId?: string;
  /** Step-level goal override */
  goal?: string;
  /** Step IDs that must complete first */
  dependsOn: string[];
  /** For parallel_group: child step IDs that run concurrently */
  parallelStepIds?: string[];
  /** For review_gate: what needs review */
  reviewPrompt?: string;
}

export interface WorkflowTemplate {
  id: string;
  name: string;
  description: string;
  steps: WorkflowStep[];
  createdAt: number;
  updatedAt: number;
  archived: boolean;
}

export interface WorkflowExecution {
  workflowId: string;
  stepStates: Record<
    string,
    {
      state: LifecycleState;
      sessionId?: string;
      reviewItemId?: string;
      startedAt?: number;
      completedAt?: number;
      error?: string;
    }
  >;
  startedAt: number;
  completedAt?: number;
}

export interface WorkflowService extends Disposable {
  create(
    orgId: string,
    template: Omit<WorkflowTemplate, 'id' | 'createdAt' | 'updatedAt' | 'archived'>
  ): Promise<WorkflowTemplate>;
  get(orgId: string, id: string): Promise<WorkflowTemplate | null>;
  update(orgId: string, id: string, updates: Partial<WorkflowTemplate>): Promise<WorkflowTemplate>;
  list(orgId: string, options?: { includeArchived?: boolean }): Promise<WorkflowTemplate[]>;
  archive(orgId: string, id: string): Promise<void>;
  validate(template: Partial<WorkflowTemplate>): { valid: boolean; errors: string[] };
  /** Get execution order respecting dependencies (array of parallel batches) */
  getExecutionOrder(orgId: string, workflowId: string): Promise<string[][]>;
}

// =============================================================================
// Review Queue Types
// =============================================================================

export type ReviewAction = 'approve' | 'reject' | 'edit' | 'clarify';

export interface ReviewItem {
  id: string;
  /** Source agent session */
  sessionId: string;
  orgId: string;
  workflowId?: string;
  workflowStepId?: string;
  type: 'approval' | 'clarification' | 'review';
  title: string;
  summary: string;
  recommendation?: string;
  /** Additional context: diffs, artifact references, etc. */
  context: Record<string, unknown>;
  status: 'pending' | 'resolved';
  resolution?: {
    action: ReviewAction;
    comment?: string;
    resolvedAt: number;
  };
  createdAt: number;
  updatedAt: number;
}

export interface ReviewService extends Disposable {
  create(item: Omit<ReviewItem, 'id' | 'status' | 'createdAt' | 'updatedAt'>): Promise<ReviewItem>;
  get(id: string, orgId: string): Promise<ReviewItem | null>;
  listPending(orgId: string): Promise<ReviewItem[]>;
  list(options?: { status?: 'pending' | 'resolved'; orgId?: string }): Promise<ReviewItem[]>;
  resolve(id: string, orgId: string, action: ReviewAction, comment?: string): Promise<ReviewItem>;
  pendingCount(orgId: string): Promise<number>;
}

// =============================================================================
// Audit Types
// =============================================================================

export type AuditEntryType =
  | 'state_change'
  | 'tool_use'
  | 'review_decision'
  | 'agent_spawn'
  | 'worktree_action';

export interface AuditEntry {
  id: string;
  sessionId: string;
  orgId: string;
  type: AuditEntryType;
  description: string;
  data: Record<string, unknown>;
  timestamp: number;
}

export interface AuditService extends Disposable {
  record(entry: Omit<AuditEntry, 'id' | 'timestamp'>): Promise<AuditEntry>;
  getForSession(sessionId: string, orgId: string): Promise<AuditEntry[]>;
  getForOrg(
    orgId: string,
    options?: { limit?: number; offset?: number; type?: AuditEntryType }
  ): Promise<AuditEntry[]>;
}

// =============================================================================
// Worktree Types
// =============================================================================

export interface WorktreeInfo {
  path: string;
  branch: string;
  sessionId: string;
  /** Original repository root that this worktree was created from */
  repoRoot: string;
  createdAt: number;
  status: 'active' | 'merged' | 'archived' | 'deleted';
}

export interface WorktreeService extends Disposable {
  create(sessionId: string, repoRoot: string, branchName?: string): Promise<WorktreeInfo>;
  list(repoRoot: string): Promise<WorktreeInfo[]>;
  merge(sessionId: string, strategy?: 'merge' | 'rebase'): Promise<{ success: boolean; conflicts?: string[] }>;
  archive(sessionId: string): Promise<void>;
  delete(sessionId: string): Promise<void>;
  getForSession(sessionId: string): WorktreeInfo | null;
  getDiff(sessionId: string): Promise<string>;
}

// =============================================================================
// Orchestration Types
// =============================================================================

export interface SpawnOptions {
  templateId: string;
  goal: string;
  parentSessionId?: string;
  orgId: string;
  isolateWorktree?: boolean;
  workflowId?: string;
  workflowStepIndex?: number;
}

export interface AggregateProgress {
  total: number;
  completed: number;
  failed: number;
  active: number;
  paused: number;
  /** 0-100 */
  progress: number;
}

export interface OrchestrationService extends Disposable {
  spawn(options: SpawnOptions): Promise<Session>;
  cancel(sessionId: string, reason?: string): Promise<void>;
  pause(sessionId: string, reason: string): Promise<void>;
  resume(sessionId: string): Promise<void>;
  /** Stop the agent instance runtime without any state transition. */
  stopInstance(sessionId: string): Promise<void>;
  getAggregateProgress(parentSessionId: string): Promise<AggregateProgress>;
  getActiveInstances(): Map<string, unknown>;
  executeWorkflow(workflowId: string, orgId: string): Promise<Session>;
}

