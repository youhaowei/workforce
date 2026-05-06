/**
 * SessionService — JSONL append-only persistence with streaming delta tracking.
 *
 * Each session is stored as a `.jsonl` file with typed records:
 *   header → meta → message | message_start/delta/final/abort
 *
 * Extracted modules:
 *   session-journal.ts     — JSONL I/O, replay, consolidation, append locking
 *   session-rehydration.ts — Background full-replay at startup (bounded concurrency)
 *   session-read.ts        — Replay-backed reads, listing, search, message retrieval
 *   session-history.ts     — Forking and truncating session history
 *   session-lifecycle.ts   — WorkAgent creation and state transitions
 *   session-streaming.ts   — Stream record methods (start/delta/final/abort)
 */

import { unlink } from "fs/promises";
import { join } from "path";
import type {
  SessionService,
  Session,
  SessionSummary,
  SessionSavePatch,
  SessionSearchResult,
  Message,
  ToolActivity,
  ContentBlock,
  WorkAgentConfig,
  LifecycleState,
  HydrationStatus,
  JournalMessage,
  JournalMeta,
  JournalRecord,
} from "./types";
import { getEventBus } from "@/shared/event-bus";
import { getDataDir } from "./data-dir";
import {
  appendRecord,
  appendRecords,
  writeRecords as journalWriteRecords,
  AppendLock,
  SeqAllocator,
  JSONL_VERSION,
} from "./session-journal";
import { RehydrationManager } from "./session-rehydration";
import * as lifecycle from "./session-lifecycle";
import * as streaming from "./session-streaming";
import { CCSourceWatcher } from "./cc-watcher";
import * as ccSync from "./cc-sync";
import { initializeSessions } from "./session-bootstrap";
import { scheduleSessionConsolidation } from "./session-consolidation";
import * as sessionRead from "./session-read";
import * as history from "./session-history";

const SESSIONS_DIR = join(getDataDir(), "sessions");
/** Debounce delay (ms) for consolidation after writes. */
const CONSOLIDATION_DEBOUNCE_MS = 500;

function generateId(): string {
  return `sess_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

class SessionServiceImpl implements SessionService {
  private sessions = new Map<string, Session>();
  private hydrationStatus = new Map<string, HydrationStatus>();
  private currentSession: Session | null = null;
  private sessionsDir: string;
  private dataDir: string;
  private initialized = false;
  private initPromise: Promise<void> | null = null;
  private appendLock = new AppendLock();
  private seqAllocators = new Map<string, SeqAllocator>();
  private consolidationTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private _disposed = false;
  private deletedSessionIds = new Set<string>();
  private ccWatcher = new CCSourceWatcher();
  private rehydrator: RehydrationManager;

  // Bound references exposed to extracted modules via deps interfaces
  private lifecycleDeps: lifecycle.LifecycleDeps;
  private ccSyncDeps: ccSync.CCSyncDeps;
  private streamingDeps: streaming.StreamingDeps;
  private readDeps: sessionRead.SessionReadDeps;
  private historyDeps: history.SessionHistoryDeps;

  constructor(sessionsDir?: string) {
    this.sessionsDir = sessionsDir ?? SESSIONS_DIR;
    this.dataDir = sessionsDir ? join(sessionsDir, "..") : getDataDir();

    this.rehydrator = new RehydrationManager({
      sessions: this.sessions,
      hydrationStatus: this.hydrationStatus,
      deletedSessionIds: this.deletedSessionIds,
      appendLock: this.appendLock,
      seqAllocators: this.seqAllocators,
      sessionsDir: this.sessionsDir,
      isDisposed: () => this._disposed,
    });

    this.lifecycleDeps = {
      sessions: this.sessions,
      sessionsDir: this.sessionsDir,
      generateId,
      registerSession: (s, status) => this.registerSession(s, status),
      writeRecords: (id, records) => this.writeRecords(id, records),
      ensureInitialized: () => this.ensureInitialized(),
    };

    this.ccSyncDeps = {
      sessions: this.sessions,
      seqAllocators: this.seqAllocators,
      sessionsDir: this.sessionsDir,
      generateId,
      registerSession: (s, status) => this.registerSession(s, status),
      writeRecords: (id, records) => this.writeRecords(id, records),
      scheduleConsolidation: (id) => this.scheduleConsolidation(id),
      ensureInitialized: () => this.ensureInitialized(),
    };

    this.streamingDeps = {
      sessions: this.sessions,
      sessionsDir: this.sessionsDir,
      appendLock: this.appendLock,
      ensureInitialized: () => this.ensureInitialized(),
      writeRecords: (id, records) => this.writeRecords(id, records),
      scheduleConsolidation: (id) => this.scheduleConsolidation(id),
    };

    this.readDeps = {
      sessions: this.sessions,
      hydrationStatus: this.hydrationStatus,
      seqAllocators: this.seqAllocators,
      sessionsDir: this.sessionsDir,
      rehydrator: this.rehydrator,
      ensureInitialized: () => this.ensureInitialized(),
      scheduleConsolidation: (id) => this.scheduleConsolidation(id),
    };

    this.historyDeps = {
      sessionsDir: this.sessionsDir,
      appendLock: this.appendLock,
      consolidationTimers: this.consolidationTimers,
      deletedSessionIds: this.deletedSessionIds,
      registerSession: (session) => this.registerSession(session, "ready"),
      getSession: (id) => this.get(id),
      generateId,
    };
  }

  private registerSession(session: Session, status: HydrationStatus = "cold"): void {
    this.sessions.set(session.id, session);
    this.hydrationStatus.set(session.id, status);
  }

  async ensureInitialized(): Promise<void> {
    if (this.initialized) return;
    // Singleflight: concurrent callers share the same init promise
    this.initPromise ??= this.doInit();
    return this.initPromise;
  }

  private async doInit(): Promise<void> {
    await initializeSessions({
      dataDir: this.dataDir,
      sessionsDir: this.sessionsDir,
      registerSession: (session, status) => this.registerSession(session, status),
      rehydrator: this.rehydrator,
    });
    this.initialized = true;
  }

  // ─── CRUD ──────────────────────────────────────────────────────────

  async create(
    title?: string,
    parentId?: string,
    metadata?: Record<string, unknown>,
  ): Promise<Session> {
    await this.ensureInitialized();
    const now = Date.now();
    const initialMetadata = metadata ?? {};
    const session: Session = {
      id: generateId(),
      title,
      createdAt: now,
      updatedAt: now,
      parentId,
      messages: [],
      metadata: initialMetadata,
    };

    this.registerSession(session, "ready");
    await journalWriteRecords(this.sessionsDir, session.id, [
      {
        t: "header",
        v: JSONL_VERSION,
        seq: 0,
        ts: now,
        id: session.id,
        title: session.title,
        createdAt: now,
        parentId,
        metadata: initialMetadata,
      },
    ]);
    getEventBus().emit({
      type: "SessionChange",
      sessionId: session.id,
      action: "created",
      timestamp: now,
    });
    return session;
  }

  async get(sessionId: string): Promise<Session | null> {
    return sessionRead.getSession(this.readDeps, sessionId);
  }

  async updateSession(sessionId: string, patch: SessionSavePatch): Promise<void> {
    await this.ensureInitialized();
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`Session not found: ${sessionId}`);

    if (patch.title !== undefined) session.title = patch.title;
    if (patch.metadata !== undefined) {
      const { parentId: _drop, ...cleanMetadata } = patch.metadata as Record<string, unknown>;
      session.metadata = cleanMetadata;
    }
    session.updatedAt = Date.now();

    const patchRecord: Record<string, unknown> = { title: session.title, ...session.metadata };
    await this.writeRecords(
      sessionId,
      [
        {
          t: "meta",
          seq: 0,
          ts: session.updatedAt,
          patch: patchRecord,
        } satisfies JournalMeta,
      ],
      true,
    );
  }

  async resume(sessionId: string): Promise<Session> {
    const session = await this.get(sessionId);
    if (!session) throw new Error(`Session not found: ${sessionId}`);
    this.currentSession = session;
    this.watchCCSource(session);
    getEventBus().emit({
      type: "SessionChange",
      sessionId: session.id,
      action: "resumed",
      timestamp: Date.now(),
    });
    return session;
  }

  private watchCCSource(session: Session) {
    const ccPath = session.metadata.ccSourcePath as string | undefined;
    if (ccPath) this.ccWatcher.start(session.id, ccPath);
    else this.ccWatcher.stop();
  }

  async fork(sessionId: string, options?: { atMessageIndex?: number }): Promise<Session> {
    return history.forkSession(this.historyDeps, sessionId, options);
  }

  async truncate(sessionId: string, upToMessageIndex: number): Promise<Session> {
    return history.truncateSession(this.historyDeps, sessionId, upToMessageIndex);
  }

  async list(options?: {
    limit?: number;
    offset?: number;
    orgId?: string;
    projectId?: string;
  }): Promise<SessionSummary[]> {
    return sessionRead.listSessions(this.readDeps, options);
  }

  async search(query: string): Promise<SessionSearchResult[]> {
    return sessionRead.searchSessions(this.readDeps, query);
  }

  async delete(sessionId: string): Promise<void> {
    await this.ensureInitialized();
    const session = this.sessions.get(sessionId);
    if (!session) return;

    this.deletedSessionIds.add(sessionId);
    const timer = this.consolidationTimers.get(sessionId);
    if (timer) {
      clearTimeout(timer);
      this.consolidationTimers.delete(sessionId);
    }

    this.sessions.delete(sessionId);
    this.hydrationStatus.delete(sessionId);
    if (this.currentSession?.id === sessionId) this.currentSession = null;
    try {
      await unlink(join(this.sessionsDir, `${sessionId}.jsonl`));
    } catch {
      /* ignore */
    }
    getEventBus().emit({
      type: "SessionChange",
      sessionId,
      action: "terminated",
      timestamp: Date.now(),
    });
  }

  async recordMessage(sessionId: string, message: Message): Promise<void> {
    const session = await this.get(sessionId);
    if (!session) throw new Error(`Session not found: ${sessionId}`);

    const msgTs = Math.max(message.timestamp, Date.now());
    const record: JournalMessage = {
      t: "message",
      seq: 0,
      ts: msgTs,
      id: message.id,
      role: message.role,
      content: message.content,
      agentConfig: message.agentConfig,
      toolCalls: message.toolCalls,
      toolResults: message.toolResults,
    };

    await this.appendLock.acquire(sessionId, async () => {
      session.messages.push({ ...message, timestamp: msgTs });
      session.updatedAt = msgTs;
      await appendRecord(this.sessionsDir, sessionId, record);
    });
    this.scheduleConsolidation(sessionId);
  }

  /** Update the result field on a tool_use content block (e.g. cold-replay question answers). */
  async updateBlockResult(
    sessionId: string,
    messageId: string,
    blockId: string,
    result: unknown,
  ): Promise<void> {
    const session = await this.get(sessionId);
    if (!session) throw new Error(`Session not found: ${sessionId}`);

    const message = session.messages.find((m) => m.id === messageId);
    if (!message) throw new Error(`Message not found: ${messageId}`);

    const block = message.contentBlocks?.find((b) => b.type === "tool_use" && b.id === blockId);
    if (!block || block.type !== "tool_use") throw new Error(`Block not found: ${blockId}`);

    block.result = result;
    this.scheduleConsolidation(sessionId);
  }

  getCurrent(): Session | null {
    return this.currentSession;
  }
  setCurrent(session: Session | null): void {
    this.currentSession = session;
  }

  async getMessages(
    sessionId: string,
    options?: { limit?: number; offset?: number },
  ): Promise<Message[]> {
    return sessionRead.getSessionMessages(this.readDeps, sessionId, options);
  }

  recordStreamStart(sessionId: string, messageId: string) {
    return streaming.recordStreamStart(this.streamingDeps, sessionId, messageId);
  }
  recordStreamDelta(sessionId: string, messageId: string, delta: string, seq: number) {
    return streaming.recordStreamDelta(this.streamingDeps, sessionId, messageId, delta, seq);
  }
  recordStreamDeltaBatch(
    sessionId: string,
    messageId: string,
    deltas: Array<{ delta: string; seq: number }>,
  ) {
    return streaming.recordStreamDeltaBatch(this.streamingDeps, sessionId, messageId, deltas);
  }
  recordStreamEnd(
    sessionId: string,
    messageId: string,
    fullContent: string,
    stopReason: string,
    toolActivities?: ToolActivity[],
    contentBlocks?: ContentBlock[],
  ) {
    return streaming.recordStreamEnd(
      this.streamingDeps,
      sessionId,
      messageId,
      fullContent,
      stopReason,
      toolActivities,
      contentBlocks,
    );
  }
  recordStreamBlocks(
    sessionId: string,
    messageId: string,
    contentBlocks: ContentBlock[],
    toolActivities?: ToolActivity[],
  ) {
    return streaming.recordStreamBlocks(
      this.streamingDeps,
      sessionId,
      messageId,
      contentBlocks,
      toolActivities,
    );
  }
  recordStreamAbort(sessionId: string, messageId: string, reason: string) {
    return streaming.recordStreamAbort(this.streamingDeps, sessionId, messageId, reason);
  }
  createWorkAgent(config: WorkAgentConfig) {
    return lifecycle.createWorkAgent(this.lifecycleDeps, config);
  }
  transitionState(
    sessionId: string,
    newState: LifecycleState,
    reason: string,
    actor?: "system" | "user" | "agent",
  ) {
    return lifecycle.transitionState(this.lifecycleDeps, sessionId, newState, reason, actor);
  }
  listByState(state: LifecycleState, orgId?: string) {
    return lifecycle.listByState(this.lifecycleDeps, state, orgId);
  }
  getChildren(parentSessionId: string) {
    return lifecycle.getChildren(this.lifecycleDeps, parentSessionId);
  }
  getHydrationStatus(sessionId: string): HydrationStatus {
    return this.hydrationStatus.get(sessionId) ?? "cold";
  }
  importCCSession(ccFilePath: string, orgId?: string) {
    return ccSync.importCCSession(this.ccSyncDeps, ccFilePath, orgId);
  }
  checkCCSync(sessionId: string) {
    return ccSync.checkCCSync(this.ccSyncDeps, sessionId);
  }
  checkCCSyncBatch(sessionIds: string[]) {
    return ccSync.checkCCSyncBatch(this.ccSyncDeps, sessionIds);
  }
  syncCCSession(sessionId: string) {
    return ccSync.syncCCSession(this.ccSyncDeps, sessionId);
  }

  // ─── Write Path ────────────────────────────────────────────────────

  private async writeRecords(
    sessionId: string,
    records: JournalRecord[],
    consolidate = false,
  ): Promise<void> {
    if (records.length === 0) return;
    await this.appendLock.acquire(sessionId, () => {
      // Stamp seq from allocator (create on-demand for new sessions)
      const alloc = this.seqAllocators.get(sessionId) ?? new SeqAllocator(0);
      if (!this.seqAllocators.has(sessionId)) this.seqAllocators.set(sessionId, alloc);
      for (const rec of records) rec.seq = alloc.allocate();

      return records.length === 1
        ? appendRecord(this.sessionsDir, sessionId, records[0])
        : appendRecords(this.sessionsDir, sessionId, records);
    });
    if (consolidate) this.scheduleConsolidation(sessionId);
  }

  private scheduleConsolidation(sessionId: string): void {
    scheduleSessionConsolidation(
      {
        sessionsDir: this.sessionsDir,
        sessions: this.sessions,
        deletedSessionIds: this.deletedSessionIds,
        appendLock: this.appendLock,
        timers: this.consolidationTimers,
        debounceMs: CONSOLIDATION_DEBOUNCE_MS,
      },
      sessionId,
    );
  }

  dispose(): void {
    this._disposed = true;
    for (const timer of this.consolidationTimers.values()) clearTimeout(timer);
    this.consolidationTimers.clear();
    this.sessions.clear();
    this.hydrationStatus.clear();
    this.deletedSessionIds.clear();
    this.rehydrator.clear();
    this.ccWatcher.stop();
    this.currentSession = null;
    this.initialized = false;
    this.initPromise = null;
    this.appendLock.clear();
  }
}

export { SessionServiceImpl };
export { getSessionService, resetSessionService, createSessionService } from "./session-factory";
