/**
 * SessionService — JSONL append-only persistence with streaming delta tracking.
 *
 * Each session is stored as a `.jsonl` file with typed records:
 *   header → meta → message | message_start/delta/final/abort
 *
 * JSONL I/O, replay logic, consolidation, and append locking are in session-journal.ts.
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
  WorkAgentConfig,
  LifecycleState,
  SessionLifecycle,
  HydrationStatus,
  JournalMessage,
  JournalMessageFinal,
  JournalMeta,
  JournalRecord,
} from './types';
import { VALID_TRANSITIONS } from './types';
import { getEventBus } from '@/shared/event-bus';
import { getDataDir } from './data-dir';
import { runMigrations } from './migration';
import { debugLog } from '@/shared/debug-log';
import {
  appendRecord,
  appendRecords,
  writeRecords as journalWriteRecords,
  replaySession,
  replaySessionMetadata,
  consolidateSession,
  AppendLock,
  JSONL_VERSION,
} from './session-journal';

// =============================================================================
// Configuration
// =============================================================================

const SESSIONS_DIR = join(getDataDir(), 'sessions');

/** Max concurrent background rehydration workers at startup. */
const REHYDRATION_CONCURRENCY = 3;
/** Max retry attempts for a failed rehydration (0 = no retry). */
const REHYDRATION_MAX_RETRIES = 1;
/** Delay (ms) before retrying a failed rehydration. */
const REHYDRATION_RETRY_DELAY_MS = 5_000;
/** Debounce delay (ms) for consolidation after writes. */
const CONSOLIDATION_DEBOUNCE_MS = 500;

function generateId(): string {
  return `sess_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

// =============================================================================
// Service Implementation
// =============================================================================

class SessionServiceImpl implements SessionService {
  private sessions = new Map<string, Session>();
  private hydrationStatus = new Map<string, HydrationStatus>();
  private hydrationFlights = new Map<string, Promise<void>>();
  private currentSession: Session | null = null;
  private sessionsDir: string;
  private dataDir: string;
  private initialized = false;
  private appendLock = new AppendLock();
  private consolidationTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private rehydrationConcurrency = { active: 0, max: REHYDRATION_CONCURRENCY };
  private rehydrationQueue: string[] = [];
  private _disposed = false;
  /** Sessions deleted while rehydration was in-flight. Prevents resurrection. */
  private deletedSessionIds = new Set<string>();

  constructor(sessionsDir?: string) {
    this.sessionsDir = sessionsDir ?? SESSIONS_DIR;
    this.dataDir = sessionsDir ? join(sessionsDir, '..') : getDataDir();
  }

  /** Record a session in the in-memory map with the given hydration status. */
  private registerSession(session: Session, status: HydrationStatus = 'cold'): void {
    this.sessions.set(session.id, session);
    this.hydrationStatus.set(session.id, status);
  }

  private async ensureInitialized(): Promise<void> {
    if (this.initialized) return;
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
        if (session) {
          this.registerSession(session, 'cold'); // metadata-only; full load deferred
        }
      }
    } catch (err) {
      const error = err as NodeJS.ErrnoException;
      if (error.code !== 'ENOENT') {
        console.error('Failed to initialize sessions:', error);
      }
    }

    this.initialized = true;

    // Enqueue background rehydration for all cold sessions
    this.enqueueRehydration();
  }

  /**
   * Fill the rehydration queue with all cold sessions and start draining.
   * Uses bounded concurrency to avoid overwhelming the disk at startup.
   */
  private enqueueRehydration(): void {
    for (const [id, status] of this.hydrationStatus) {
      if (status === 'cold') this.rehydrationQueue.push(id);
    }
    this.drainRehydrationQueue();
  }

  /** Cooperative semaphore drain: start workers up to the concurrency limit. */
  private drainRehydrationQueue(): void {
    while (
      !this._disposed &&
      this.rehydrationQueue.length > 0 &&
      this.rehydrationConcurrency.active < this.rehydrationConcurrency.max
    ) {
      const sessionId = this.rehydrationQueue.shift()!;
      // Skip if already rehydrated (e.g. by a get() call)
      if (this.hydrationStatus.get(sessionId) !== 'cold') continue;

      this.rehydrationConcurrency.active++;
      this.rehydrateAndConsolidate(sessionId).finally(() => {
        this.rehydrationConcurrency.active--;
        this.drainRehydrationQueue();
      });
    }
  }

  /**
   * Full replay + consolidation for a single session. Singleflight: concurrent
   * calls for the same session share the same in-flight promise.
   *
   * The flight promise stays alive through retries so concurrent `get()` calls
   * always coalesce rather than spawning independent replays.
   *
   * State machine: cold → rehydrating → consolidating → ready | failed
   */
  private rehydrateAndConsolidate(sessionId: string): Promise<void> {
    const existing = this.hydrationFlights.get(sessionId);
    if (existing) return existing;

    const work = (async () => {
      const bus = getEventBus();

      for (let attempt = 0; attempt <= REHYDRATION_MAX_RETRIES; attempt++) {
        // Short-circuit if service is shutting down or session was deleted
        if (this._disposed || this.deletedSessionIds.has(sessionId)) return;

        try {
          this.hydrationStatus.set(sessionId, 'rehydrating');
          bus.emit({ type: 'SessionRehydrateStarted', sessionId, timestamp: Date.now() });

          // Full replay — updates in-memory cache with correct metadata + messages
          const session = await replaySession(this.sessionsDir, sessionId);

          // Re-check after async gap: session may have been deleted during replay
          if (this.deletedSessionIds.has(sessionId)) return;

          if (!session) {
            this.hydrationStatus.set(sessionId, 'failed');
            bus.emit({ type: 'SessionRehydrateFailed', sessionId, error: 'Session file not found', timestamp: Date.now() });
            return;
          }
          this.sessions.set(sessionId, session);

          // Consolidation phase — rewrite JSONL so header is current for future restarts
          this.hydrationStatus.set(sessionId, 'consolidating');
          bus.emit({ type: 'SessionConsolidationStarted', sessionId, timestamp: Date.now() });

          await this.appendLock.acquire(sessionId, async () => {
            // Final check inside the lock: don't recreate a deleted file
            if (this.deletedSessionIds.has(sessionId)) return;
            await consolidateSession(this.sessionsDir, session);
          });

          // Don't mark ready if deleted during consolidation
          if (this.deletedSessionIds.has(sessionId)) {
            // Clean up the session that was reinserted before the delete check
            this.sessions.delete(sessionId);
            this.hydrationStatus.delete(sessionId);
            return;
          }

          this.hydrationStatus.set(sessionId, 'ready');
          bus.emit({ type: 'SessionRehydrateDone', sessionId, timestamp: Date.now() });
          debugLog('Session', `Rehydrated session ${sessionId}`);
          return; // Success — exit retry loop
        } catch (err) {
          debugLog('Session', `Rehydration failed for ${sessionId} (attempt ${attempt + 1})`, err);

          if (attempt < REHYDRATION_MAX_RETRIES) {
            // Reset to cold for retry, but keep the flight promise alive
            this.hydrationStatus.set(sessionId, 'cold');
            await new Promise((resolve) => setTimeout(resolve, REHYDRATION_RETRY_DELAY_MS));
            continue;
          }

          // All retries exhausted
          this.hydrationStatus.set(sessionId, 'failed');
          bus.emit({
            type: 'SessionRehydrateFailed', sessionId,
            error: err instanceof Error ? err.message : String(err),
            timestamp: Date.now(),
          });
        }
      }
    })();

    // Flight promise covers the entire retry loop — never deleted mid-retry
    this.hydrationFlights.set(sessionId, work.finally(() => {
      this.hydrationFlights.delete(sessionId);
    }));
    return work;
  }

  async create(title?: string, parentId?: string): Promise<Session> {
    await this.ensureInitialized();
    const now = Date.now();
    const session: Session = {
      id: generateId(),
      title,
      createdAt: now,
      updatedAt: now,
      parentId,
      messages: [],
      metadata: {},
    };

    this.registerSession(session, 'ready');
    await journalWriteRecords(this.sessionsDir, session.id, [{
      t: 'header', v: JSONL_VERSION, id: session.id, title: session.title,
      createdAt: now, updatedAt: now, parentId, metadata: {},
    }]);

    getEventBus().emit({ type: 'SessionChange', sessionId: session.id, action: 'created', timestamp: now });
    return session;
  }

  async get(sessionId: string): Promise<Session | null> {
    await this.ensureInitialized();

    const status = this.hydrationStatus.get(sessionId);

    // Already fully hydrated — return from cache
    if (status === 'ready') {
      return this.sessions.get(sessionId) ?? null;
    }

    // If background rehydration is already in-flight, await it
    const flight = this.hydrationFlights.get(sessionId);
    if (flight) {
      await flight;
      return this.sessions.get(sessionId) ?? null;
    }

    // No flight in progress — do a full replay ourselves
    const session = await replaySession(this.sessionsDir, sessionId);
    if (!session) return null;

    this.sessions.set(sessionId, session);
    this.hydrationStatus.set(sessionId, 'ready');

    // Fire-and-forget background consolidation (header rewrite)
    this.scheduleConsolidation(sessionId);

    return session;
  }

  async updateSession(sessionId: string, patch: SessionSavePatch): Promise<void> {
    await this.ensureInitialized();
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`Session not found: ${sessionId}`);

    // Apply only mutable fields — parentId is immutable and untouched.
    if (patch.title !== undefined) session.title = patch.title;
    if (patch.metadata !== undefined) {
      // Strip any legacy parentId from metadata (parentId lives on Session, not metadata)
      const { parentId: _drop, ...cleanMetadata } = patch.metadata as Record<string, unknown>;
      session.metadata = cleanMetadata;
    }
    session.updatedAt = Date.now();

    const patchRecord: Record<string, unknown> = { title: session.title, ...session.metadata };

    await this.writeRecords(sessionId, [{
      t: 'meta', updatedAt: session.updatedAt, patch: patchRecord,
    } satisfies JournalMeta], true);
  }

  async resume(sessionId: string): Promise<Session> {
    const session = await this.get(sessionId);
    if (!session) throw new Error(`Session not found: ${sessionId}`);
    this.currentSession = session;
    getEventBus().emit({ type: 'SessionChange', sessionId: session.id, action: 'resumed', timestamp: Date.now() });
    return session;
  }

  async fork(sessionId: string): Promise<Session> {
    const parent = await this.get(sessionId);
    if (!parent) throw new Error(`Session not found: ${sessionId}`);

    const now = Date.now();
    const forked: Session = {
      id: generateId(),
      title: parent.title ? `${parent.title} (fork)` : undefined,
      createdAt: now, updatedAt: now, parentId: parent.id,
      messages: [...parent.messages], metadata: { ...parent.metadata },
    };

    this.registerSession(forked, 'ready');
    const records: JournalRecord[] = [
      { t: 'header', v: JSONL_VERSION, id: forked.id, title: forked.title,
        createdAt: now, updatedAt: now, parentId: parent.id, metadata: forked.metadata },
      ...forked.messages.map((m): JournalMessage | JournalMessageFinal =>
        m.role === 'assistant'
          ? { t: 'message_final', id: m.id, role: 'assistant', content: m.content, timestamp: m.timestamp, stopReason: 'forked', toolCalls: m.toolCalls, toolResults: m.toolResults }
          : { t: 'message', id: m.id, role: m.role, content: m.content, timestamp: m.timestamp, agentConfig: m.agentConfig, toolCalls: m.toolCalls, toolResults: m.toolResults },
      ),
    ];
    await journalWriteRecords(this.sessionsDir, forked.id, records);
    getEventBus().emit({ type: 'SessionChange', sessionId: forked.id, action: 'created', timestamp: now });
    return forked;
  }

  async list(options?: { limit?: number; offset?: number; orgId?: string }): Promise<SessionSummary[]> {
    await this.ensureInitialized();
    let results = Array.from(this.sessions.values());
    if (options?.orgId) results = results.filter((s) => s.metadata.orgId === options.orgId);
    const sorted = results.sort((a, b) => b.updatedAt - a.updatedAt);
    const offset = options?.offset ?? 0;
    const limit = options?.limit ?? sorted.length;
    // Keep list payloads lightweight: no full message history in sidebar/home/board APIs.
    return sorted.slice(offset, offset + limit).map((session) => {
      const lastMessage = session.messages[session.messages.length - 1];
      return {
        id: session.id,
        title: session.title,
        createdAt: session.createdAt,
        updatedAt: session.updatedAt,
        parentId: session.parentId,
        metadata: session.metadata,
        messageCount: session.messages.length,
        lastMessagePreview: lastMessage?.content,
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

    // Mark as deleted BEFORE clearing state — prevents in-flight rehydration
    // from resurrecting the session or recreating the JSONL file.
    this.deletedSessionIds.add(sessionId);

    // Cancel any pending consolidation timer so it doesn't recreate the file
    const timer = this.consolidationTimers.get(sessionId);
    if (timer) {
      clearTimeout(timer);
      this.consolidationTimers.delete(sessionId);
    }

    this.sessions.delete(sessionId);
    this.hydrationStatus.delete(sessionId);
    this.hydrationFlights.delete(sessionId);
    if (this.currentSession?.id === sessionId) this.currentSession = null;
    try { await unlink(join(this.sessionsDir, `${sessionId}.jsonl`)); } catch { /* ignore */ }
    getEventBus().emit({ type: 'SessionChange', sessionId, action: 'terminated', timestamp: Date.now() });
  }

  async recordMessage(sessionId: string, message: Message): Promise<void> {
    const session = await this.get(sessionId);
    if (!session) throw new Error(`Session not found: ${sessionId}`);

    // Ensure the record timestamp is at least Date.now() so durable updatedAt
    // always advances, even if the caller passes an old message.timestamp.
    const ts = Math.max(message.timestamp, Date.now());
    const record: JournalMessage = {
      t: 'message', id: message.id, role: message.role, content: message.content,
      timestamp: ts, agentConfig: message.agentConfig, toolCalls: message.toolCalls, toolResults: message.toolResults,
    };

    // Mutate in-memory state inside the lock to prevent data-race with consolidation,
    // which reads session.messages under the same lock.
    await this.appendLock.acquire(sessionId, async () => {
      session.messages.push({ ...message, timestamp: ts });
      session.updatedAt = ts;
      await appendRecord(this.sessionsDir, sessionId, record);
    });
    this.scheduleConsolidation(sessionId);
  }

  getCurrent(): Session | null { return this.currentSession; }
  setCurrent(session: Session | null): void { this.currentSession = session; }

  // ─── Streaming Records ─────────────────────────────────────────────

  async recordStreamStart(sessionId: string, messageId: string, meta?: Record<string, unknown>): Promise<void> {
    await this.ensureInitialized();
    if (!this.sessions.has(sessionId)) throw new Error(`Session not found: ${sessionId}`);
    await this.writeRecords(sessionId, [{ t: 'message_start', id: messageId, role: 'assistant', timestamp: Date.now(), meta }]);
  }

  async recordStreamDelta(sessionId: string, messageId: string, delta: string, seq: number): Promise<void> {
    await this.writeRecords(sessionId, [{ t: 'message_delta', id: messageId, delta, seq }]);
  }

  async recordStreamDeltaBatch(sessionId: string, messageId: string, deltas: Array<{ delta: string; seq: number }>): Promise<void> {
    if (deltas.length === 0) return;
    await this.writeRecords(sessionId, deltas.map((d) => ({ t: 'message_delta' as const, id: messageId, delta: d.delta, seq: d.seq })));
  }

  async recordStreamEnd(sessionId: string, messageId: string, fullContent: string, stopReason: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`Session not found: ${sessionId}`);

    const now = Date.now();
    const record: JournalMessageFinal = {
      t: 'message_final', id: messageId, role: 'assistant', content: fullContent, timestamp: now, stopReason,
    };

    // Mutate in-memory state inside the lock to prevent data-race with consolidation
    await this.appendLock.acquire(sessionId, async () => {
      session.messages.push({ id: messageId, role: 'assistant', content: fullContent, timestamp: now });
      session.updatedAt = now;
      await appendRecord(this.sessionsDir, sessionId, record);
    });
    this.scheduleConsolidation(sessionId);
  }

  async recordStreamAbort(sessionId: string, messageId: string, reason: string): Promise<void> {
    await this.writeRecords(sessionId, [{ t: 'message_abort', id: messageId, reason, timestamp: Date.now() }]);
  }

  async getMessages(sessionId: string, options?: { limit?: number; offset?: number }): Promise<Message[]> {
    const session = await this.get(sessionId);
    if (!session) throw new Error(`Session not found: ${sessionId}`);
    const offset = options?.offset ?? 0;
    const limit = options?.limit ?? session.messages.length;
    return session.messages.slice(offset, offset + limit);
  }

  // ─── WorkAgent + Lifecycle ──────────────────────────────────────────

  async createWorkAgent(config: WorkAgentConfig): Promise<Session> {
    await this.ensureInitialized();
    const now = Date.now();
    const lifecycle: SessionLifecycle = { state: 'created', stateHistory: [] };
    const metadata = {
      type: 'workagent' as const, lifecycle,
      templateId: config.templateId, goal: config.goal,
      workflowId: config.workflowId, workflowStepIndex: config.workflowStepIndex,
      worktreePath: config.worktreePath, orgId: config.orgId, repoRoot: config.repoRoot,
    };

    const session: Session = { id: generateId(), title: config.goal, createdAt: now, updatedAt: now, parentId: config.parentId, messages: [], metadata };
    this.registerSession(session, 'ready');
    await journalWriteRecords(this.sessionsDir, session.id, [{
      t: 'header', v: JSONL_VERSION, id: session.id, title: session.title, createdAt: now, updatedAt: now, parentId: config.parentId, metadata,
    }]);
    getEventBus().emit({ type: 'SessionChange', sessionId: session.id, action: 'created', timestamp: now });
    return session;
  }

  async transitionState(sessionId: string, newState: LifecycleState, reason: string, actor: 'system' | 'user' | 'agent' = 'system'): Promise<Session> {
    const session = await this.get(sessionId);
    if (!session) throw new Error(`Session not found: ${sessionId}`);

    const lifecycle = session.metadata.lifecycle as SessionLifecycle | undefined;
    const currentState: LifecycleState = lifecycle?.state ?? 'created';
    const allowed = VALID_TRANSITIONS[currentState];
    if (!allowed.includes(newState)) {
      throw new Error(`Invalid state transition: ${currentState} → ${newState}. Allowed: ${allowed.join(', ') || 'none'}`);
    }

    const now = Date.now();
    const updatedLifecycle: SessionLifecycle = {
      state: newState,
      stateHistory: [...(lifecycle?.stateHistory ?? []), { from: currentState, to: newState, reason, timestamp: now, actor }],
      pauseReason: newState === 'paused' ? reason : undefined,
      failureReason: newState === 'failed' ? reason : undefined,
      completionSummary: newState === 'completed' ? reason : lifecycle?.completionSummary,
    };

    session.metadata = { ...session.metadata, lifecycle: updatedLifecycle };
    session.updatedAt = now;

    await this.writeRecords(sessionId, [{ t: 'meta', updatedAt: now, patch: { lifecycle: updatedLifecycle } } satisfies JournalMeta]);
    getEventBus().emit({ type: 'LifecycleTransition', sessionId, from: currentState, to: newState, reason, actor, timestamp: now });
    return session;
  }

  async listByState(state: LifecycleState, orgId?: string): Promise<Session[]> {
    await this.ensureInitialized();
    return Array.from(this.sessions.values()).filter((session) => {
      const lifecycle = session.metadata.lifecycle as SessionLifecycle | undefined;
      if (!lifecycle || lifecycle.state !== state) return false;
      if (orgId && session.metadata.orgId !== orgId) return false;
      return true;
    });
  }

  async getChildren(parentSessionId: string): Promise<Session[]> {
    await this.ensureInitialized();
    return Array.from(this.sessions.values())
      .filter((s) => s.parentId === parentSessionId)
      .sort((a, b) => b.createdAt - a.createdAt);
  }

  // ─── Hydration Status ──────────────────────────────────────────────

  getHydrationStatus(sessionId: string): HydrationStatus {
    return this.hydrationStatus.get(sessionId) ?? 'cold';
  }

  // ─── Write Path ────────────────────────────────────────────────────

  /** Lock → write → optionally consolidate. All record writes go through here. */
  private async writeRecords(sessionId: string, records: JournalRecord[], consolidate = false): Promise<void> {
    if (records.length === 0) return;
    await this.appendLock.acquire(sessionId, () =>
      records.length === 1
        ? appendRecord(this.sessionsDir, sessionId, records[0])
        : appendRecords(this.sessionsDir, sessionId, records),
    );
    if (consolidate) this.scheduleConsolidation(sessionId);
  }

  /**
   * Debounced per-session consolidation. Multiple calls within the delay window
   * coalesce into a single consolidation — so a user message → assistant stream →
   * finalize sequence produces one disk rewrite, not three.
   */
  private scheduleConsolidation(sessionId: string): void {
    const existing = this.consolidationTimers.get(sessionId);
    if (existing) clearTimeout(existing);

    const timer = setTimeout(async () => {
      this.consolidationTimers.delete(sessionId);
      try {
        // Skip if session was deleted while the timer was pending
        if (this.deletedSessionIds.has(sessionId)) return;
        const session = this.sessions.get(sessionId);
        if (session) {
          await this.appendLock.acquire(sessionId, async () => {
            // Re-check inside lock: delete() may have run while we waited
            if (this.deletedSessionIds.has(sessionId)) return;
            await consolidateSession(this.sessionsDir, session);
          });
          debugLog('Session', `Consolidated session ${sessionId}`);
        }
      } catch (err) {
        debugLog('Session', `Consolidation failed for ${sessionId}`, err);
      }
    }, CONSOLIDATION_DEBOUNCE_MS);

    this.consolidationTimers.set(sessionId, timer);
  }

  dispose(): void {
    this._disposed = true; // Signal in-flight rehydrations to stop
    for (const timer of this.consolidationTimers.values()) clearTimeout(timer);
    this.consolidationTimers.clear();
    this.sessions.clear();
    this.hydrationStatus.clear();
    this.hydrationFlights.clear();
    this.deletedSessionIds.clear();
    this.rehydrationQueue.length = 0;
    this.rehydrationConcurrency.active = 0;
    this.currentSession = null;
    this.initialized = false;
    this.appendLock.clear();
  }
}

// =============================================================================
// Singleton Management
// =============================================================================

let _instance: SessionServiceImpl | null = null;

export function getSessionService(): SessionService {
  return (_instance ??= new SessionServiceImpl());
}

export function resetSessionService(): void {
  if (_instance) { _instance.dispose(); _instance = null; }
}

export function createSessionService(sessionsDir: string): SessionService {
  return new SessionServiceImpl(sessionsDir);
}

// Re-export journal internals for testing
export { replaySession, replaySessionMetadata, appendRecord, appendRecords, writeRecords, consolidateSession, JSONL_VERSION, AppendLock } from './session-journal';
