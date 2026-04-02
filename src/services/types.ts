/**
 * Service Layer Type Definitions
 *
 * All service interfaces for the Workforce desktop agentic orchestrator.
 * Services follow the lazy singleton pattern with explicit dispose().
 */

import type { BusEvent } from "@/shared/event-bus";

// =============================================================================
// Common Types
// =============================================================================

/** Base interface for all disposable services */
export interface Disposable {
  dispose(): void;
}

/** Result type for operations that can fail */
export type Result<T, E = Error> = { ok: true; value: T } | { ok: false; error: E };

/** Async generator for streaming results */
export type StreamResult<T> = AsyncGenerator<T, void, unknown>;

// =============================================================================
// Agent Configuration Types
// =============================================================================

export type ThinkingLevel = "off" | "auto" | "low" | "medium" | "high";

export type AgentTone = "friendly" | "professional" | "direct" | "technical";
export type VerboseLevel = "concise" | "balanced" | "thorough" | "exhaustive";

/** Org/template-level defaults for WorkAgent behavior. */
export interface AgentDefaults {
  model: string;
  thinkingLevel: ThinkingLevel;
  tone: AgentTone;
  verboseLevel: VerboseLevel;
}

export type AgentPermissionMode = "plan" | "default" | "acceptEdits" | "bypassPermissions";

export interface AgentConfig {
  model: string;
  thinkingLevel: ThinkingLevel;
  permissionMode: AgentPermissionMode;
}

export interface AgentModelInfo {
  id: string;
  displayName: string;
  description: string;
}

// =============================================================================
// Agent Service Types
// =============================================================================

export interface RunOptions {
  /** Model to use (defaults to claude-sonnet) */
  model?: string;
  /** Maximum tokens in response */
  maxTokens?: number;
  /** Maximum tokens for Claude thinking blocks (0 = disabled, undefined = SDK decides) */
  maxThinkingTokens?: number;
  /** Permission mode for tool execution */
  permissionMode?: AgentPermissionMode;
  /** System prompt override */
  systemPrompt?: string;
  /** Tools available for this run */
  tools?: ToolDefinition[];
  /** AbortSignal for cancellation */
  signal?: AbortSignal;
  /** Session ID for context continuity */
  sessionId?: string;
}

/** A single entry in the tool activity trace. */
export interface ToolActivity {
  name: string;
  input: string;
}

/** Structured content block for interleaved text/tool rendering. */
export type ContentBlock =
  | { type: "text"; text: string; status?: "running" | "complete" }
  | {
      type: "tool_use";
      id: string;
      name: string;
      input: string;
      inputRaw?: unknown;
      result?: unknown;
      error?: string;
      status: "running" | "complete" | "error";
    }
  | { type: "thinking"; text: string; status?: "running" | "complete" };

/** A structured question the agent asks the user. */
export interface AgentQuestion {
  id: string;
  header: string;
  question: string;
  freeform: boolean;
  secret: boolean;
  multiSelect?: boolean;
  options?: Array<{ label: string; description: string }>;
}

/** Events yielded by AgentService.run() through the stream. */
export type AgentStreamEvent =
  | { type: "token"; token: string }
  | { type: "thinking_delta"; text: string }
  | { type: "turn_complete" }
  | { type: "tool_start"; name: string; input: string; toolUseId: string; inputRaw: unknown }
  | { type: "tool_result"; toolUseId: string; toolName: string; result: unknown; isError: boolean }
  | { type: "content_block_start"; index: number; blockType: string; id?: string; name?: string }
  | { type: "content_block_stop"; index: number }
  | { type: "status"; message: string }
  | { type: "plan_ready"; path: string }
  | { type: "agent_question"; requestId: string; questions: AgentQuestion[] };

// =============================================================================
// Artifact Types
// =============================================================================

export type ArtifactMimeType =
  | "text/markdown"
  | "text/html"
  | "text/csv"
  | "application/json"
  | "image/svg+xml"
  | "text/plain";

export type ArtifactStatus =
  | "draft"
  | "pending_review"
  | "approved"
  | "rejected"
  | "executing"
  | "archived";

export interface ArtifactComment {
  id: string;
  artifactId: string;
  content: string;
  severity: "suggestion" | "issue" | "question" | "praise";
  anchor?: { line?: number; startCol?: number; endCol?: number; section?: string };
  author: Author;
  createdAt: number;
  resolved?: boolean;
}

export interface ArtifactReview {
  id: string;
  artifactId: string;
  action: ReviewAction;
  comments: ArtifactComment[];
  summary?: string;
  author: Author;
  createdAt: number;
}

export interface Artifact {
  id: string;
  /** Org that owns this artifact (required) */
  orgId: string;
  /** Optional project association */
  projectId?: string;
  title: string;
  mimeType: ArtifactMimeType;
  /** Absolute path on disk — agent reads/writes this file */
  filePath: string;
  /** Current content (cached, may be stale if file changed externally) */
  content?: string;
  status: ArtifactStatus;
  createdBy: Author;
  createdAt: number;
  updatedAt: number;
  /** Sessions that reference this artifact */
  sessionLinks: string[];
  /** Pending comments not yet submitted as a review */
  pendingComments: ArtifactComment[];
  /** Submitted reviews */
  reviews: ArtifactReview[];
  metadata: Record<string, unknown>;
}

export interface ArtifactFilter {
  orgId?: string;
  projectId?: string;
  mimeType?: ArtifactMimeType;
  status?: ArtifactStatus;
  sessionId?: string;
}

export type ArtifactPatch = Partial<Pick<Artifact, "title" | "status" | "content" | "metadata">>;

export interface ArtifactService extends Disposable {
  ensureInitialized(): Promise<void>;
  create(input: {
    orgId: string;
    projectId?: string;
    title: string;
    mimeType: ArtifactMimeType;
    filePath: string;
    content?: string;
    status?: ArtifactStatus;
    createdBy: Author;
    sessionId?: string;
    metadata?: Record<string, unknown>;
  }): Promise<Artifact>;
  get(artifactId: string): Promise<Artifact | null>;
  list(filter?: ArtifactFilter): Promise<Artifact[]>;
  update(artifactId: string, patch: ArtifactPatch): Promise<Artifact>;
  delete(artifactId: string): Promise<void>;
  linkToSession(artifactId: string, sessionId: string): Promise<void>;
  addComment(
    artifactId: string,
    comment: Omit<ArtifactComment, "id" | "createdAt">,
  ): Promise<ArtifactComment>;
  submitReview(
    artifactId: string,
    review: Omit<ArtifactReview, "id" | "createdAt">,
  ): Promise<ArtifactReview>;
}

// =============================================================================
// Tool Types
// =============================================================================

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
  stopReason: "end_turn" | "tool_use" | "max_tokens" | "cancelled";
}

export interface AgentService extends Disposable {
  /** Run the agent with streaming response. */
  run(prompt: string, options?: RunOptions): StreamResult<AgentStreamEvent>;

  /**
   * Cancel the current run.
   */
  cancel(): void;

  /** Submit answers to a pending agent question. */
  submitAnswer(requestId: string, answers: Record<string, string[]>): void;

  /** Get the currently pending question (if any). Used for snapshot on reconnect. */
  getPendingQuestion(): { requestId: string; questions: AgentQuestion[] } | null;

  /**
   * Check if a run is currently in progress.
   */
  isRunning(): boolean;

  /**
   * Get the list of models supported by the current Claude Code installation.
   * Cached with 5-minute TTL.
   */
  getSupportedModels(): Promise<AgentModelInfo[]>;
}

// =============================================================================
// Session Lifecycle Types (declared before SessionService which references them)
// =============================================================================

export type SessionType = "chat" | "workagent";

export type LifecycleState = "created" | "active" | "paused" | "completed" | "failed" | "cancelled";

export interface StateTransition {
  from: LifecycleState;
  to: LifecycleState;
  reason: string;
  timestamp: number;
  actor: "system" | "user" | "agent";
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
  /** Immutable parent session ID (set at creation, never mutated). */
  parentId?: string;
}

/** Valid lifecycle state transitions */
export const VALID_TRANSITIONS: Record<LifecycleState, LifecycleState[]> = {
  created: ["active"],
  active: ["paused", "completed", "failed", "cancelled"],
  paused: ["active", "cancelled"],
  completed: [],
  failed: [],
  cancelled: [],
};

// =============================================================================
// Session Service Types
// =============================================================================

export interface Message {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  timestamp: number;
  model?: string;
  usage?: TokenUsage;
  agentConfig?: AgentConfig;
  toolCalls?: ToolCall[];
  toolResults?: ToolResult[];
  toolActivities?: ToolActivity[];
  contentBlocks?: ContentBlock[];
}

export interface Session {
  id: string;
  title?: string;
  createdAt: number;
  updatedAt: number;
  parentId?: string;
  messages: Message[];
  metadata: Record<string, unknown>;
  /** Non-message records (tool calls, hooks, file changes, etc.). Optional — not sent over tRPC by default. */
  records?: AnyJournalRecord[];
}

/**
 * Lightweight session shape for list views.
 * Avoids sending full message arrays over the wire.
 */
export interface SessionSummary {
  id: string;
  title?: string;
  createdAt: number;
  updatedAt: number;
  parentId?: string;
  metadata: Record<string, unknown>;
  messageCount: number;
  lastMessagePreview?: string;
}

export interface SessionSearchResult {
  session: Session;
  matchedText: string;
  score: number;
}

export interface SessionSavePatch {
  title?: string;
  metadata?: Record<string, unknown>;
}

// =============================================================================
// JSONL Record Types (Session Persistence) — v0.3.0
// =============================================================================

/** Universal author identity for action records. */
export type Author =
  | { type: "user"; id: string }
  | { type: "agent"; sessionId: string; actionId: string }
  | { type: "system" };

/** Git repository context snapshot. */
export interface GitContext {
  branch: string;
  commitHash?: string;
  repoRoot?: string;
  isDirty?: boolean;
}

/** Token usage statistics for an API turn. */
export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadInputTokens?: number;
  cacheCreationInputTokens?: number;
}

/** File operation within a file_change record. */
export interface FileOperation {
  path: string;
  operation: "create" | "modify" | "delete" | "rename";
  oldPath?: string;
  diff?: string;
}

// ---------------------------------------------------------------------------
// Record Interfaces
// ---------------------------------------------------------------------------

/** Session identity + base metadata — always the first line in a .jsonl file. */
export interface JournalHeader {
  t: "header";
  v: string;
  seq: number;
  ts: number;
  id: string;
  sessionType?: SessionType;
  title?: string;
  createdAt: number;
  parentId?: string;
  orgId?: string;
  projectId?: string;
  gitContext?: GitContext;
  agentConfig?: AgentConfig;
  metadata: Record<string, unknown>;
}

/** A complete non-streaming message (user or system). */
export interface JournalMessage {
  t: "message";
  seq: number;
  ts: number;
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  author?: Author;
  agentConfig?: AgentConfig;
  toolCalls?: ToolCall[];
  toolResults?: ToolResult[];
  toolActivities?: ToolActivity[];
  contentBlocks?: ContentBlock[];
}

/** Marks the start of an assistant streaming response. */
export interface JournalMessageStart {
  t: "message_start";
  seq: number;
  ts: number;
  id: string;
  role: "assistant";
  model?: string;
  usage?: TokenUsage;
}

/** A single token/chunk delta for an in-progress stream. */
export interface JournalMessageDelta {
  t: "message_delta";
  seq: number;
  ts: number;
  id: string;
  delta: string;
}

/** Thinking block delta for an in-progress stream. */
export interface JournalThinkingDelta {
  t: "thinking_delta";
  seq: number;
  ts: number;
  id: string;
  delta: string;
}

/** Snapshot of content blocks during streaming (survives page refresh). */
export interface JournalMessageBlocks {
  t: "message_blocks";
  seq: number;
  ts: number;
  id: string;
  contentBlocks: ContentBlock[];
  toolActivities?: ToolActivity[];
}

/** Authoritative final content for a completed assistant message. */
export interface JournalMessageFinal {
  t: "message_final";
  seq: number;
  ts: number;
  id: string;
  role: "assistant";
  content: string;
  stopReason: string;
  model?: string;
  usage?: TokenUsage;
  toolCalls?: ToolCall[];
  toolResults?: ToolResult[];
  toolActivities?: ToolActivity[];
  contentBlocks?: ContentBlock[];
}

/** Stream aborted/interrupted marker. */
export interface JournalMessageAbort {
  t: "message_abort";
  seq: number;
  ts: number;
  id: string;
  reason: string;
}

/** Tool invocation by the agent. */
export interface JournalToolCall {
  t: "tool_call";
  seq: number;
  ts: number;
  actionId: string;
  messageId: string;
  name: string;
  input: Record<string, unknown>;
}

/** Tool execution result. */
export interface JournalToolResult {
  t: "tool_result";
  seq: number;
  ts: number;
  actionId: string;
  name: string;
  result: unknown;
  error?: string;
  isError: boolean;
  durationMs?: number;
}

/** Long-running tool progress update. */
export interface JournalToolProgress {
  t: "tool_progress";
  seq: number;
  ts: number;
  actionId: string;
  name: string;
  elapsedMs?: number;
  message?: string;
  output?: string;
}

/** Hook execution (collapsed — single record per hook invocation). */
export interface JournalHook {
  t: "hook";
  seq: number;
  ts: number;
  hookId: string;
  hookName: string;
  hookEvent: string;
  actionId?: string;
  outcome: "success" | "error" | "cancelled";
  output?: string;
  durationMs?: number;
}

/** Files modified by a tool call. */
export interface JournalFileChange {
  t: "file_change";
  seq: number;
  ts: number;
  actionId: string;
  files: FileOperation[];
}

/** Task created or updated within this session. */
export interface JournalTaskUpdate {
  t: "task_update";
  seq: number;
  ts: number;
  taskId: string;
  author: Author;
  patch: {
    title?: string;
    description?: string;
    status?: TaskStatus;
    priority?: number;
    metadata?: Record<string, unknown>;
  };
}

/** Session interaction with a workspace-level artifact. */
export interface JournalArtifactLink {
  t: "artifact_link";
  seq: number;
  ts: number;
  artifactId: string;
  action: "create" | "open" | "modify" | "close" | "link" | "unlink";
  author: Author;
  actionId?: string;
  snapshot?: { title: string; type: string; status?: ArtifactStatus };
}

/** Review comment on an artifact. */
export interface JournalReviewComment {
  t: "review_comment";
  seq: number;
  ts: number;
  artifactId: string;
  reviewId: string;
  content: string;
  anchor?: { line?: number; section?: string };
  author: Author;
}

/** Review batch submitted. */
export interface JournalReviewSubmit {
  t: "review_submit";
  seq: number;
  ts: number;
  artifactId: string;
  reviewId: string;
  action: ReviewAction;
  summary?: string;
  author: Author;
}

/** Subagent spawned from this session. */
export interface JournalSubagentSpawn {
  t: "subagent_spawn";
  seq: number;
  ts: number;
  childSessionId: string;
  templateId?: string;
  goal: string;
  actionId?: string;
}

/** Subagent completed/failed. */
export interface JournalSubagentResult {
  t: "subagent_result";
  seq: number;
  ts: number;
  childSessionId: string;
  outcome: "completed" | "failed" | "cancelled";
  summary?: string;
  durationMs?: number;
}

/** Explicit git state capture (before/after commits, branch changes). */
export interface JournalGitSnapshot {
  t: "git_snapshot";
  seq: number;
  ts: number;
  context: GitContext;
  trigger: "commit" | "checkout" | "merge" | "manual";
  actionId?: string;
  commitMessage?: string;
}

/** End-of-turn statistics. */
export interface JournalQueryResult {
  t: "query_result";
  seq: number;
  ts: number;
  messageId: string;
  durationMs: number;
  usage?: TokenUsage;
  model?: string;
}

/** Metadata patch (title change, lifecycle transition, etc.). */
export interface JournalMeta {
  t: "meta";
  seq: number;
  ts: number;
  patch: Record<string, unknown>;
}

/** Forward-compat escape hatch for unknown record types. */
export interface JournalUnknown {
  t: string;
  seq: number;
  ts: number;
  [key: string]: unknown;
}

/** Discriminated union of all known journal record types. */
export type JournalRecord =
  | JournalHeader
  | JournalMessage
  | JournalMessageStart
  | JournalMessageDelta
  | JournalThinkingDelta
  | JournalMessageBlocks
  | JournalMessageFinal
  | JournalMessageAbort
  | JournalToolCall
  | JournalToolResult
  | JournalToolProgress
  | JournalHook
  | JournalFileChange
  | JournalTaskUpdate
  | JournalArtifactLink
  | JournalReviewComment
  | JournalReviewSubmit
  | JournalSubagentSpawn
  | JournalSubagentResult
  | JournalGitSnapshot
  | JournalQueryResult
  | JournalMeta;

/** Union including unknown records — used in parsed/persisted contexts where
 *  forward-compat matters (e.g., Session.records, replay output). */
export type AnyJournalRecord = JournalRecord | JournalUnknown;

/** Runtime-only hydration status for a session (not persisted on Session type). */
export type HydrationStatus = "cold" | "rehydrating" | "consolidating" | "ready" | "failed";

export interface SessionService extends Disposable {
  /**
   * Create a new session.
   * @param title Optional session title.
   * @param parentId Immutable parent session ID (set once in the header record).
   * @param metadata Optional initial metadata (e.g. `{ orgId, projectId }`).
   */
  create(title?: string, parentId?: string, metadata?: Record<string, unknown>): Promise<Session>;

  /**
   * Get a session by ID.
   */
  get(sessionId: string): Promise<Session | null>;

  /**
   * Update a session's title or metadata via a patch (incremental append).
   * Lineage (`parentId`) is immutable and cannot be patched.
   */
  updateSession(sessionId: string, patch: SessionSavePatch): Promise<void>;

  /**
   * Resume an existing session.
   */
  resume(sessionId: string): Promise<Session>;

  /**
   * Fork a session at a specific message point (create child with history up to that point).
   * When `atMessageIndex` is provided, only messages [0..atMessageIndex] are copied.
   * Stores `forkAtMessageId` in child metadata for fork indicators.
   */
  fork(sessionId: string, options?: { atMessageIndex?: number }): Promise<Session>;

  /**
   * Truncate a session to keep only messages [0..upToMessageIndex].
   * Destructive: messages after the index are permanently removed.
   */
  truncate(sessionId: string, upToMessageIndex: number): Promise<Session>;

  /**
   * List lightweight session summaries with optional pagination and org scoping.
   * When orgId is provided, only sessions with matching metadata.orgId are returned.
   *
   * Intentionally excludes full `messages` history for responsiveness in list UIs.
   * Use `getMessages`, `get`, or `search` for deep/history-aware operations.
   */
  list(options?: {
    limit?: number;
    offset?: number;
    orgId?: string;
    projectId?: string;
  }): Promise<SessionSummary[]>;

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
    actor?: "system" | "user" | "agent",
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
   * Record a complete message (user/system).
   */
  recordMessage(sessionId: string, message: Message): Promise<void>;

  // ---------------------------------------------------------------------------
  // Streaming Records
  // ---------------------------------------------------------------------------

  /** Record the start of an assistant streaming response. */
  recordStreamStart(sessionId: string, messageId: string): Promise<void>;

  /** Record a streaming token delta. */
  recordStreamDelta(
    sessionId: string,
    messageId: string,
    delta: string,
    seq: number,
  ): Promise<void>;

  /** Record multiple deltas in a single I/O operation (batch flush). */
  recordStreamDeltaBatch(
    sessionId: string,
    messageId: string,
    deltas: Array<{ delta: string; seq: number }>,
  ): Promise<void>;

  /** Record the finalized assistant message. Source of truth on replay. */
  recordStreamEnd(
    sessionId: string,
    messageId: string,
    fullContent: string,
    stopReason: string,
    toolActivities?: ToolActivity[],
    contentBlocks?: ContentBlock[],
  ): Promise<void>;

  /** Snapshot in-progress content blocks (best-effort, for crash recovery). */
  recordStreamBlocks(
    sessionId: string,
    messageId: string,
    contentBlocks: ContentBlock[],
    toolActivities?: ToolActivity[],
  ): Promise<void>;

  /** Record an aborted assistant stream. */
  recordStreamAbort(sessionId: string, messageId: string, reason: string): Promise<void>;

  /** Update the result field on a content block (e.g. cold-replay question answers). */
  updateBlockResult(
    sessionId: string,
    messageId: string,
    blockId: string,
    result: unknown,
  ): Promise<void>;

  /**
   * Read messages for a session with optional pagination.
   */
  getMessages(sessionId: string, options?: { limit?: number; offset?: number }): Promise<Message[]>;

  /**
   * Get the runtime hydration status of a session.
   * Sessions start as 'cold' (header-only) after restart and progress to 'ready'
   * after background rehydration + consolidation. Sessions created during this
   * runtime start as 'ready' immediately.
   */
  getHydrationStatus(sessionId: string): HydrationStatus;

  // ---------------------------------------------------------------------------
  // CC Session Sync
  // ---------------------------------------------------------------------------

  /** Import a standalone CC session as a new WF session. */
  importCCSession(ccFilePath: string, orgId?: string): Promise<Session>;

  /** Check if a WF session's linked CC source has new records. */
  checkCCSync(sessionId: string): Promise<{ inSync: boolean; newRecordCount?: number }>;

  /** Batch check CC sync status for multiple sessions. Returns map of sessionId → inSync. */
  checkCCSyncBatch(sessionIds: string[]): Promise<Record<string, boolean>>;

  /** Re-sync a WF session from its linked CC source. */
  syncCCSession(sessionId: string): Promise<Session>;
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
    context: ToolExecutionContext,
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
  context: ToolExecutionContext,
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
  result: unknown,
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
  listHooks(): Array<{ name: string; type: "pre" | "post"; priority: number }>;
}

// =============================================================================
// Background Service Types
// =============================================================================

export type BackgroundTaskPriority = "high" | "normal" | "low";
export type BackgroundTaskStatus = "pending" | "running" | "completed" | "failed" | "cancelled";

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
  submit<T>(fn: () => Promise<T>, options?: BackgroundTaskOptions): string;

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

export type TaskStatus = "pending" | "in_progress" | "completed" | "cancelled";

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
  update(taskId: string, updates: Partial<Omit<Task, "id" | "createdAt">>): Promise<Task | null>;

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
  initialized?: boolean;
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
  /** Org-level agent behavior defaults (set during workspace initialization) */
  agentDefaults?: AgentDefaults;
}

export interface OrgService extends Disposable {
  create(name: string): Promise<Org>;
  get(id: string): Promise<Org | null>;
  update(id: string, updates: Partial<Omit<Org, "id" | "createdAt">>): Promise<Org>;
  list(): Promise<Org[]>;
  delete(id: string): Promise<void>;
  getCurrent(): Promise<Org | null>;
  setCurrent(org: Org | null): void;
}

// =============================================================================
// User Types
// =============================================================================

export interface User {
  id: string;
  displayName: string;
  avatarColor: string;
  createdAt: number;
  updatedAt: number;
}

export interface UserService extends Disposable {
  get(): Promise<User | null>;
  create(displayName: string): Promise<User>;
  update(updates: Partial<Pick<User, "displayName">>): Promise<User>;
  delete(): Promise<void>;
  exists(): Promise<boolean>;
}

// =============================================================================
// Project Types
// =============================================================================

export interface Project {
  id: string;
  orgId: string;
  name: string;
  rootPath: string;
  /** Hex color for the project avatar, auto-generated from name if not provided */
  color: string;
  /** Optional URL/path to image/SVG icon, overrides the letter avatar */
  icon?: string;
  createdAt: number;
  updatedAt: number;
}

export class ProjectNotFound {
  readonly _tag = "ProjectNotFound";
  constructor(readonly projectId: string) {}
}

export interface ProjectService extends Disposable {
  create(
    orgId: string,
    name: string,
    rootPath: string,
    opts?: { color?: string; icon?: string },
  ): Promise<Project>;
  get(id: string): Promise<Project | null>;
  update(
    id: string,
    updates: Partial<Omit<Project, "id" | "orgId" | "createdAt">>,
  ): Promise<Result<Project, ProjectNotFound>>;
  list(orgId?: string): Promise<Project[]>;
  delete(id: string): Promise<void>;
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
  reasoningIntensity: "low" | "medium" | "high" | "max";
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
    template: Omit<AgentTemplate, "id" | "createdAt" | "updatedAt" | "archived">,
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

export type StepType = "agent" | "review_gate" | "parallel_group";

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
    template: Omit<WorkflowTemplate, "id" | "createdAt" | "updatedAt" | "archived">,
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

export type ReviewAction = "approve" | "reject" | "edit" | "clarify";

export interface ReviewItem {
  id: string;
  /** Source agent session */
  sessionId: string;
  orgId: string;
  workflowId?: string;
  workflowStepId?: string;
  type: "approval" | "clarification" | "review";
  title: string;
  summary: string;
  recommendation?: string;
  /** Additional context: diffs, artifact references, etc. */
  context: Record<string, unknown>;
  status: "pending" | "resolved";
  resolution?: {
    action: ReviewAction;
    comment?: string;
    resolvedAt: number;
  };
  createdAt: number;
  updatedAt: number;
}

export interface ReviewService extends Disposable {
  create(item: Omit<ReviewItem, "id" | "status" | "createdAt" | "updatedAt">): Promise<ReviewItem>;
  get(id: string, orgId: string): Promise<ReviewItem | null>;
  listPending(orgId: string): Promise<ReviewItem[]>;
  list(options?: { status?: "pending" | "resolved"; orgId?: string }): Promise<ReviewItem[]>;
  resolve(id: string, orgId: string, action: ReviewAction, comment?: string): Promise<ReviewItem>;
  pendingCount(orgId: string): Promise<number>;
}

// =============================================================================
// Audit Types
// =============================================================================

export type AuditEntryType =
  | "state_change"
  | "tool_use"
  | "review_decision"
  | "agent_spawn"
  | "worktree_action";

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
  record(entry: Omit<AuditEntry, "id" | "timestamp">): Promise<AuditEntry>;
  getForSession(sessionId: string, orgId: string): Promise<AuditEntry[]>;
  getForOrg(
    orgId: string,
    options?: { limit?: number; offset?: number; type?: AuditEntryType },
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
  status: "active" | "merged" | "archived" | "deleted";
}

export interface WorktreeService extends Disposable {
  create(sessionId: string, repoRoot: string, branchName?: string): Promise<WorktreeInfo>;
  list(repoRoot: string): Promise<WorktreeInfo[]>;
  merge(
    sessionId: string,
    strategy?: "merge" | "rebase",
  ): Promise<{ success: boolean; conflicts?: string[] }>;
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
