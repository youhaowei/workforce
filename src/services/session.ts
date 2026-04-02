/**
 * SessionService — JSONL append-only persistence with streaming delta tracking.
 *
 * Each session is stored as a `.jsonl` file with typed records:
 *   header → meta → message | message_start/delta/final/abort
 *
 * Extracted modules:
 *   session-journal.ts     — JSONL I/O, replay, consolidation, append locking
 *   session-rehydration.ts — Background full-replay at startup (bounded concurrency)
 *   session-lifecycle.ts   — WorkAgent creation and state transitions
 *   session-streaming.ts   — Stream record methods (start/delta/final/abort)
 */

import { readdir, mkdir, unlink } from 'fs/promises';
import { join } from 'path';
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
} from './types';
import { getEventBus } from '@/shared/event-bus';
import { getDataDir } from './data-dir';
import { runMigrations } from './migration';
import { createLogger } from 'tracey';
import { getLogService } from './log';
import {
  appendRecord,
  appendRecords,
  writeRecords as journalWriteRecords,
  writeForkSession,
  replaySessionMetadata,
  consolidateSession,
  AppendLock,
  SeqAllocator,
  JSONL_VERSION,
} from './session-journal';
import { RehydrationManager } from './session-rehydration';
import { loadSession } from './session-upgrade';
import * as lifecycle from './session-lifecycle';
import * as streaming from './session-streaming';
import { CCSourceWatcher } from './cc-watcher';
import * as ccSync from './cc-sync';

const SESSIONS_DIR = join(getDataDir(), 'sessions');
const log = createLogger('Session');
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

  constructor(sessionsDir?: string) {
    this.sessionsDir = sessionsDir ?? SESSIONS_DIR;
    this.dataDir = sessionsDir ? join(sessionsDir, '..') : getDataDir();

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
  }

  private registerSession(session: Session, status: HydrationStatus = 'cold'): void {
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
    await runMigrations(this.dataDir);

    try {
      await mkdir(this.sessionsDir, { recursive: true });
      const entries = await readdir(this.sessionsDir);
      const sessionFiles = entries.filter(
        (name) => name.endsWith('.jsonl') && !name.includes('.corrupt') && !name.includes('.tmp'),
      );

      for (const file of sessionFiles) {
        const sessionId = file.replace('.jsonl', '');
        const session = await replaySessionMetadata(this.sessionsDir, sessionId);
        if (session) this.registerSession(session, 'cold');
      }
    } catch (err) {
      const error = err as NodeJS.ErrnoException;
      if (error.code !== 'ENOENT') {
        getLogService().error('general', 'Failed to initialize sessions', { error: String(error) });
      }
    }

    this.initialized = true;
    this.rehydrator.enqueue();
  }

  // ─── CRUD ──────────────────────────────────────────────────────────

  async create(title?: string, parentId?: string, metadata?: Record<string, unknown>): Promise<Session> {
    await this.ensureInitialized();
    const now = Date.now();
    const initialMetadata = metadata ?? {};
    const session: Session = {
      id: generateId(), title, createdAt: now, updatedAt: now,
      parentId, messages: [], metadata: initialMetadata,
    };

    this.registerSession(session, 'ready');
    await journalWriteRecords(this.sessionsDir, session.id, [{
      t: 'header', v: JSONL_VERSION, seq: 0, ts: now, id: session.id, title: session.title,
      createdAt: now, parentId, metadata: initialMetadata,
    }]);
    getEventBus().emit({ type: 'SessionChange', sessionId: session.id, action: 'created', timestamp: now });
    return session;
  }

  async get(sessionId: string): Promise<Session | null> {
    await this.ensureInitialized();
    const status = this.hydrationStatus.get(sessionId);
    log.info({ sessionId, status }, `get(${sessionId}) status=${status}`);

    // Fast path: fully rehydrated
    if (status === 'ready') {
      const s = this.sessions.get(sessionId) ?? null;
      log.info({ sessionId, msgs: s?.messages.length ?? 'null' }, `get(${sessionId}) ready → msgs=${s?.messages.length ?? 'null'}`);
      return s;
    }

    // Await in-flight rehydration
    const flight = this.rehydrator.getFlight(sessionId);
    if (flight) {
      log.info({ sessionId }, `get(${sessionId}) awaiting rehydration flight`);
      await flight;
      const s = this.sessions.get(sessionId) ?? null;
      log.info({ sessionId, msgs: s?.messages.length ?? 'null' }, `get(${sessionId}) flight done → msgs=${s?.messages.length ?? 'null'}`);
      return s;
    }

    // Failed rehydration may have left the session in the map with messages
    // (loadSession succeeded but consolidation failed). Use it if available.
    if (status === 'failed') {
      const cached = this.sessions.get(sessionId);
      if (cached && cached.messages.length > 0) {
        log.info({ sessionId, msgs: cached.messages.length }, `get(${sessionId}) using cached from failed rehydration → msgs=${cached.messages.length}`);
        return cached;
      }
    }

    // Cold / failed-without-cache / unknown: do a direct replay (with upgrade)
    log.info({ sessionId, status: status ?? 'unknown' }, `get(${sessionId}) ${status ?? 'unknown'}, no flight → direct load`);
    const result = await loadSession(this.sessionsDir, sessionId);
    if (!result) { log.info({ sessionId }, `get(${sessionId}) load returned null`); return null; }
    const { session, maxSeq } = result;
    log.info({ sessionId, msgs: session.messages.length, upgraded: result.upgraded }, `get(${sessionId}) loaded → msgs=${session.messages.length}`);
    this.sessions.set(sessionId, session);
    this.seqAllocators.set(sessionId, new SeqAllocator(maxSeq + 1));
    this.hydrationStatus.set(sessionId, 'ready');
    this.scheduleConsolidation(sessionId);
    return session;
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
    await this.writeRecords(sessionId, [{
      t: 'meta', seq: 0, ts: session.updatedAt, patch: patchRecord,
    } satisfies JournalMeta], true);
  }

  async resume(sessionId: string): Promise<Session> {
    const session = await this.get(sessionId);
    if (!session) throw new Error(`Session not found: ${sessionId}`);
    this.currentSession = session;
    this.watchCCSource(session);
    getEventBus().emit({ type: 'SessionChange', sessionId: session.id, action: 'resumed', timestamp: Date.now() });
    return session;
  }

  private watchCCSource(session: Session) {
    const ccPath = session.metadata.ccSourcePath as string | undefined;
    if (ccPath) this.ccWatcher.start(session.id, ccPath);
    else this.ccWatcher.stop();
  }

  async fork(sessionId: string, options?: { atMessageIndex?: number }): Promise<Session> {
    const parent = await this.get(sessionId);
    if (!parent) throw new Error(`Session not found: ${sessionId}`);
    if (parent.messages.length === 0) throw new Error('Cannot fork an empty session');

    const cutoff = options?.atMessageIndex;
    if (cutoff !== undefined && (cutoff < -1 || cutoff >= parent.messages.length))
      throw new Error(`Invalid message index: ${cutoff}. Session has ${parent.messages.length} messages.`);

    // cutoff === -1 means "fork with zero messages" (edit-and-resend the first message)
    let messages: typeof parent.messages;
    if (cutoff === -1) messages = [];
    else if (cutoff !== undefined) messages = parent.messages.slice(0, cutoff + 1);
    else messages = parent.messages;
    const lastIdx = cutoff !== undefined && cutoff >= 0 ? cutoff : parent.messages.length - 1;
    const forkAtMessageId = parent.messages[lastIdx]?.id;
    const now = Date.now();
    const { lifecycle: _, type: _t, templateId: _ti, goal: _g,
            worktreePath: _w, workflowId: _wf, workflowStepIndex: _ws,
            repoRoot: _rr, forkAtMessageId: _old, ...inheritedMetadata } = parent.metadata;
    const forked: Session = {
      id: generateId(),
      title: parent.title ? `${parent.title} (fork)` : undefined,
      createdAt: now, updatedAt: now, parentId: parent.id,
      messages: messages.map((m) => ({ ...m })),
      metadata: { ...inheritedMetadata, forkAtMessageId },
    };

    this.registerSession(forked, 'ready');
    await writeForkSession(this.sessionsDir, forked);
    getEventBus().emit({ type: 'SessionChange', sessionId: forked.id, action: 'created', timestamp: now });
    return forked;
  }

  async truncate(sessionId: string, upToMessageIndex: number): Promise<Session> {
    const session = await this.get(sessionId);
    if (!session) throw new Error(`Session not found: ${sessionId}`);
    if (upToMessageIndex === -1 && session.messages.length === 0) return session;
    if (upToMessageIndex < -1 || upToMessageIndex >= session.messages.length)
      throw new Error(`Invalid message index: ${upToMessageIndex}. Session has ${session.messages.length} messages.`);

    const timer = this.consolidationTimers.get(sessionId);
    if (timer) { clearTimeout(timer); this.consolidationTimers.delete(sessionId); }

    await this.appendLock.acquire(sessionId, async () => {
      session.messages = upToMessageIndex === -1 ? [] : session.messages.slice(0, upToMessageIndex + 1);
      session.updatedAt = Date.now();
      if (!this.deletedSessionIds.has(sessionId)) await consolidateSession(this.sessionsDir, session);
    });
    getEventBus().emit({ type: 'SessionChange', sessionId, action: 'updated', timestamp: session.updatedAt });
    return session;
  }

  async list(options?: { limit?: number; offset?: number; orgId?: string; projectId?: string }): Promise<SessionSummary[]> {
    await this.ensureInitialized();
    let results = Array.from(this.sessions.values());
    if (options?.orgId) results = results.filter((s) =>
      s.metadata.orgId === options.orgId
      || (s.metadata.source === 'claude-code' && !s.metadata.orgId) // include CC sessions missing orgId
    );
    if (options?.projectId) results = results.filter((s) => s.metadata.projectId === options.projectId);
    const sorted = results.sort((a, b) => b.updatedAt - a.updatedAt);
    const offset = options?.offset ?? 0;
    const limit = options?.limit ?? sorted.length;
    return sorted.slice(offset, offset + limit).map((session) => {
      const lastMessage = session.messages[session.messages.length - 1];
      return {
        id: session.id, title: session.title, createdAt: session.createdAt,
        updatedAt: session.updatedAt, parentId: session.parentId, metadata: session.metadata,
        messageCount: session.messages.length, lastMessagePreview: lastMessage?.content,
      };
    });
  }

  async search(query: string): Promise<SessionSearchResult[]> {
    await this.ensureInitialized();
    const results: SessionSearchResult[] = [];
    const lowerQuery = query.toLowerCase();

    for (const session of this.sessions.values()) {
      if (session.title?.toLowerCase().includes(lowerQuery)) {
        results.push({ session, matchedText: session.title, score: 2.0 });
        continue;
      }
      for (const message of session.messages) {
        const content = message.content.toLowerCase();
        const index = content.indexOf(lowerQuery);
        if (index !== -1) {
          const start = Math.max(0, index - 30);
          const end = Math.min(content.length, index + query.length + 30);
          results.push({ session, matchedText: message.content.slice(start, end), score: 1.0 });
          break;
        }
      }
    }
    return results.sort((a, b) => b.score - a.score);
  }

  async delete(sessionId: string): Promise<void> {
    await this.ensureInitialized();
    const session = this.sessions.get(sessionId);
    if (!session) return;

    this.deletedSessionIds.add(sessionId);
    const timer = this.consolidationTimers.get(sessionId);
    if (timer) { clearTimeout(timer); this.consolidationTimers.delete(sessionId); }

    this.sessions.delete(sessionId);
    this.hydrationStatus.delete(sessionId);
    if (this.currentSession?.id === sessionId) this.currentSession = null;
    try { await unlink(join(this.sessionsDir, `${sessionId}.jsonl`)); } catch { /* ignore */ }
    getEventBus().emit({ type: 'SessionChange', sessionId, action: 'terminated', timestamp: Date.now() });
  }

  async recordMessage(sessionId: string, message: Message): Promise<void> {
    const session = await this.get(sessionId);
    if (!session) throw new Error(`Session not found: ${sessionId}`);

    const msgTs = Math.max(message.timestamp, Date.now());
    const record: JournalMessage = {
      t: 'message', seq: 0, ts: msgTs, id: message.id, role: message.role, content: message.content,
      agentConfig: message.agentConfig, toolCalls: message.toolCalls, toolResults: message.toolResults,
    };

    await this.appendLock.acquire(sessionId, async () => {
      session.messages.push({ ...message, timestamp: msgTs });
      session.updatedAt = msgTs;
      await appendRecord(this.sessionsDir, sessionId, record);
    });
    this.scheduleConsolidation(sessionId);
  }

  /** Update the result field on a tool_use content block (e.g. cold-replay question answers). */
  async updateBlockResult(sessionId: string, messageId: string, blockId: string, result: unknown): Promise<void> {
    const session = await this.get(sessionId);
    if (!session) throw new Error(`Session not found: ${sessionId}`);

    const message = session.messages.find((m) => m.id === messageId);
    if (!message) throw new Error(`Message not found: ${messageId}`);

    const block = message.contentBlocks?.find((b) => b.type === 'tool_use' && b.id === blockId);
    if (!block || block.type !== 'tool_use') throw new Error(`Block not found: ${blockId}`);

    block.result = result;
    this.scheduleConsolidation(sessionId);
  }

  getCurrent(): Session | null { return this.currentSession; }
  setCurrent(session: Session | null): void { this.currentSession = session; }

  async getMessages(sessionId: string, options?: { limit?: number; offset?: number }): Promise<Message[]> {
    log.info({ sessionId }, `getMessages(${sessionId}) called`);
    const session = await this.get(sessionId);
    if (!session) throw new Error(`Session not found: ${sessionId}`);
    const offset = options?.offset ?? 0;
    const limit = options?.limit ?? session.messages.length;
    const result = session.messages.slice(offset, offset + limit);
    log.info({ sessionId, count: result.length }, `getMessages(${sessionId}) → returning ${result.length} messages`);
    return result;
  }

  // ─── Delegated: Streaming ──────────────────────────────────────────

  recordStreamStart(sessionId: string, messageId: string) {
    return streaming.recordStreamStart(this.streamingDeps, sessionId, messageId);
  }
  recordStreamDelta(sessionId: string, messageId: string, delta: string, seq: number) {
    return streaming.recordStreamDelta(this.streamingDeps, sessionId, messageId, delta, seq);
  }
  recordStreamDeltaBatch(sessionId: string, messageId: string, deltas: Array<{ delta: string; seq: number }>) {
    return streaming.recordStreamDeltaBatch(this.streamingDeps, sessionId, messageId, deltas);
  }
  recordStreamEnd(sessionId: string, messageId: string, fullContent: string, stopReason: string, toolActivities?: ToolActivity[], contentBlocks?: ContentBlock[]) {
    return streaming.recordStreamEnd(this.streamingDeps, sessionId, messageId, fullContent, stopReason, toolActivities, contentBlocks);
  }
  recordStreamBlocks(sessionId: string, messageId: string, contentBlocks: ContentBlock[], toolActivities?: ToolActivity[]) {
    return streaming.recordStreamBlocks(this.streamingDeps, sessionId, messageId, contentBlocks, toolActivities);
  }
  recordStreamAbort(sessionId: string, messageId: string, reason: string) {
    return streaming.recordStreamAbort(this.streamingDeps, sessionId, messageId, reason);
  }

  // ─── Delegated: WorkAgent + Lifecycle ──────────────────────────────

  createWorkAgent(config: WorkAgentConfig) { return lifecycle.createWorkAgent(this.lifecycleDeps, config); }
  transitionState(sessionId: string, newState: LifecycleState, reason: string, actor?: 'system' | 'user' | 'agent') {
    return lifecycle.transitionState(this.lifecycleDeps, sessionId, newState, reason, actor);
  }
  listByState(state: LifecycleState, orgId?: string) { return lifecycle.listByState(this.lifecycleDeps, state, orgId); }
  getChildren(parentSessionId: string) { return lifecycle.getChildren(this.lifecycleDeps, parentSessionId); }

  getHydrationStatus(sessionId: string): HydrationStatus {
    return this.hydrationStatus.get(sessionId) ?? 'cold';
  }

  // ─── CC Session Sync (delegated to cc-sync.ts) ──────────────────

  importCCSession(ccFilePath: string, orgId?: string) { return ccSync.importCCSession(this.ccSyncDeps, ccFilePath, orgId); }
  checkCCSync(sessionId: string) { return ccSync.checkCCSync(this.ccSyncDeps, sessionId); }
  checkCCSyncBatch(sessionIds: string[]) { return ccSync.checkCCSyncBatch(this.ccSyncDeps, sessionIds); }
  syncCCSession(sessionId: string) { return ccSync.syncCCSession(this.ccSyncDeps, sessionId);
  }

  // ─── Write Path ────────────────────────────────────────────────────

  private async writeRecords(sessionId: string, records: JournalRecord[], consolidate = false): Promise<void> {
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
    const existing = this.consolidationTimers.get(sessionId);
    if (existing) clearTimeout(existing);

    const timer = setTimeout(async () => {
      this.consolidationTimers.delete(sessionId);
      try {
        if (this.deletedSessionIds.has(sessionId)) return;
        const session = this.sessions.get(sessionId);
        if (session) {
          await this.appendLock.acquire(sessionId, async () => {
            if (this.deletedSessionIds.has(sessionId)) return;
            await consolidateSession(this.sessionsDir, session);
          });
          log.info({ sessionId }, `Consolidated session ${sessionId}`);
        }
      } catch (err) {
        log.error({ sessionId, error: err instanceof Error ? err.message : String(err) }, `Consolidation failed for ${sessionId}`);
      }
    }, CONSOLIDATION_DEBOUNCE_MS);
    this.consolidationTimers.set(sessionId, timer);
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

// Singleton management (same pattern as all other services)
let _instance: SessionServiceImpl | null = null;
export function getSessionService(): SessionService { return (_instance ??= new SessionServiceImpl()); }
export function resetSessionService(): void { if (_instance) { _instance.dispose(); _instance = null; } }
export function createSessionService(sessionsDir: string): SessionService { return new SessionServiceImpl(sessionsDir); }
