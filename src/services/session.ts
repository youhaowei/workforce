/**
 * SessionService — JSONL append-only persistence with streaming delta tracking.
 *
 * Each session is stored as a `.jsonl` file with typed records:
 *   header → meta → message | message_start/delta/final/abort
 *
 * JSONL I/O, replay logic, compaction, and append locking are in session-journal.ts.
 */

import { readdir, mkdir, unlink } from 'fs/promises';
import { join } from 'path';
import type {
  SessionService,
  Session,
  SessionSearchResult,
  Message,
  WorkAgentConfig,
  LifecycleState,
  SessionLifecycle,
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
  writeRecords,
  replaySession,
  replaySessionMetadata,
  compactSession,
  AppendLock,
  JSONL_VERSION,
} from './session-journal';

// =============================================================================
// Configuration
// =============================================================================

const SESSIONS_DIR = join(getDataDir(), 'sessions');

function generateId(): string {
  return `sess_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

// =============================================================================
// Service Implementation
// =============================================================================

class SessionServiceImpl implements SessionService {
  private sessions = new Map<string, Session>();
  private fullyLoaded = new Set<string>();
  private currentSession: Session | null = null;
  private sessionsDir: string;
  private dataDir: string;
  private initialized = false;
  private appendLock = new AppendLock();

  constructor(sessionsDir?: string) {
    this.sessionsDir = sessionsDir ?? SESSIONS_DIR;
    this.dataDir = sessionsDir ? join(sessionsDir, '..') : getDataDir();
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
          this.sessions.set(sessionId, session);
          // Note: session.messages is empty — full load deferred to get()
        }
      }
    } catch (err) {
      const error = err as NodeJS.ErrnoException;
      if (error.code !== 'ENOENT') {
        console.error('Failed to initialize sessions:', error);
      }
    }

    this.initialized = true;
  }

  async create(title?: string): Promise<Session> {
    await this.ensureInitialized();
    const now = Date.now();
    const session: Session = {
      id: generateId(),
      title,
      createdAt: now,
      updatedAt: now,
      messages: [],
      metadata: {},
    };

    this.sessions.set(session.id, session);
    this.fullyLoaded.add(session.id);
    await writeRecords(this.sessionsDir, session.id, [{
      t: 'header', v: JSONL_VERSION, id: session.id, title: session.title,
      createdAt: now, updatedAt: now, metadata: {},
    }]);

    getEventBus().emit({ type: 'SessionChange', sessionId: session.id, action: 'created', timestamp: now });
    return session;
  }

  async get(sessionId: string): Promise<Session | null> {
    await this.ensureInitialized();

    // If already fully loaded, return from cache
    if (this.fullyLoaded.has(sessionId)) {
      return this.sessions.get(sessionId) ?? null;
    }

    // Full replay to get messages (replaces metadata-only entry if present)
    const session = await replaySession(this.sessionsDir, sessionId);
    if (session) {
      this.sessions.set(sessionId, session);
      this.fullyLoaded.add(sessionId);
    }
    return session;
  }

  async save(session: Session): Promise<void> {
    await this.ensureInitialized();
    session.updatedAt = Date.now();
    this.sessions.set(session.id, session);

    await this.appendLock.acquire(session.id, () =>
      appendRecord(this.sessionsDir, session.id, {
        t: 'meta', updatedAt: session.updatedAt,
        patch: { title: session.title, ...session.metadata },
      } satisfies JournalMeta),
    );
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

    this.sessions.set(forked.id, forked);
    this.fullyLoaded.add(forked.id);
    const records: JournalRecord[] = [
      { t: 'header', v: JSONL_VERSION, id: forked.id, title: forked.title,
        createdAt: now, updatedAt: now, parentId: parent.id, metadata: forked.metadata },
      ...forked.messages.map((m): JournalMessage | JournalMessageFinal =>
        m.role === 'assistant'
          ? { t: 'message_final', id: m.id, role: 'assistant', content: m.content, timestamp: m.timestamp, stopReason: 'forked', toolCalls: m.toolCalls, toolResults: m.toolResults }
          : { t: 'message', id: m.id, role: m.role, content: m.content, timestamp: m.timestamp, toolCalls: m.toolCalls, toolResults: m.toolResults },
      ),
    ];
    await writeRecords(this.sessionsDir, forked.id, records);
    getEventBus().emit({ type: 'SessionChange', sessionId: forked.id, action: 'created', timestamp: now });
    return forked;
  }

  async list(options?: { limit?: number; offset?: number; orgId?: string }): Promise<Session[]> {
    await this.ensureInitialized();
    let results = Array.from(this.sessions.values());
    if (options?.orgId) results = results.filter((s) => s.metadata.orgId === options.orgId);
    const sorted = results.sort((a, b) => b.updatedAt - a.updatedAt);
    const offset = options?.offset ?? 0;
    const limit = options?.limit ?? sorted.length;
    return sorted.slice(offset, offset + limit);
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

    this.sessions.delete(sessionId);
    if (this.currentSession?.id === sessionId) this.currentSession = null;
    try { await unlink(join(this.sessionsDir, `${sessionId}.jsonl`)); } catch { /* ignore */ }
    getEventBus().emit({ type: 'SessionChange', sessionId, action: 'terminated', timestamp: Date.now() });
  }

  async addMessage(sessionId: string, message: Message): Promise<void> {
    const session = await this.get(sessionId);
    if (!session) throw new Error(`Session not found: ${sessionId}`);

    session.messages.push(message);
    session.updatedAt = Date.now();
    await this.appendLock.acquire(sessionId, () =>
      appendRecord(this.sessionsDir, sessionId, {
        t: 'message', id: message.id, role: message.role, content: message.content,
        timestamp: message.timestamp, toolCalls: message.toolCalls, toolResults: message.toolResults,
      } satisfies JournalMessage),
    );
  }

  getCurrent(): Session | null { return this.currentSession; }
  setCurrent(session: Session | null): void { this.currentSession = session; }

  // ─── Streaming Persistence ──────────────────────────────────────────

  async startAssistantStream(sessionId: string, messageId: string, meta?: Record<string, unknown>): Promise<void> {
    await this.ensureInitialized();
    if (!this.sessions.has(sessionId)) throw new Error(`Session not found: ${sessionId}`);
    await this.appendLock.acquire(sessionId, () =>
      appendRecord(this.sessionsDir, sessionId, { t: 'message_start', id: messageId, role: 'assistant', timestamp: Date.now(), meta }),
    );
  }

  async appendAssistantDelta(sessionId: string, messageId: string, delta: string, seq: number): Promise<void> {
    await this.appendLock.acquire(sessionId, () =>
      appendRecord(this.sessionsDir, sessionId, { t: 'message_delta', id: messageId, delta, seq }),
    );
  }

  async appendAssistantDeltaBatch(sessionId: string, messageId: string, deltas: Array<{ delta: string; seq: number }>): Promise<void> {
    if (deltas.length === 0) return;
    const records = deltas.map((d) => ({ t: 'message_delta' as const, id: messageId, delta: d.delta, seq: d.seq }));
    await this.appendLock.acquire(sessionId, () =>
      appendRecords(this.sessionsDir, sessionId, records),
    );
  }

  async finalizeAssistantMessage(sessionId: string, messageId: string, fullContent: string, stopReason: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`Session not found: ${sessionId}`);

    const now = Date.now();
    session.messages.push({ id: messageId, role: 'assistant', content: fullContent, timestamp: now });
    session.updatedAt = now;

    await this.appendLock.acquire(sessionId, () =>
      appendRecord(this.sessionsDir, sessionId, {
        t: 'message_final', id: messageId, role: 'assistant', content: fullContent, timestamp: now, stopReason,
      } satisfies JournalMessageFinal),
    );
    this.scheduleCompaction(sessionId);
  }

  async abortAssistantStream(sessionId: string, messageId: string, reason: string): Promise<void> {
    await this.appendLock.acquire(sessionId, () =>
      appendRecord(this.sessionsDir, sessionId, { t: 'message_abort', id: messageId, reason, timestamp: Date.now() }),
    );
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

    const session: Session = { id: generateId(), title: config.goal, createdAt: now, updatedAt: now, messages: [], metadata };
    this.sessions.set(session.id, session);
    this.fullyLoaded.add(session.id);
    await writeRecords(this.sessionsDir, session.id, [{
      t: 'header', v: JSONL_VERSION, id: session.id, title: session.title, createdAt: now, updatedAt: now, metadata,
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

    await this.appendLock.acquire(sessionId, () =>
      appendRecord(this.sessionsDir, sessionId, { t: 'meta', updatedAt: now, patch: { lifecycle: updatedLifecycle } } satisfies JournalMeta),
    );
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

  // ─── Compaction ─────────────────────────────────────────────────────

  private scheduleCompaction(sessionId: string): void {
    setTimeout(async () => {
      try {
        const session = this.sessions.get(sessionId);
        if (session) {
          await compactSession(this.sessionsDir, session);
          debugLog('Session', `Compacted session ${sessionId}`);
        }
      } catch (err) {
        debugLog('Session', `Compaction failed for ${sessionId}`, err);
      }
    }, 100);
  }

  dispose(): void {
    this.sessions.clear();
    this.fullyLoaded.clear();
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
export { replaySession, replaySessionMetadata, appendRecord, appendRecords, writeRecords, compactSession, JSONL_VERSION, AppendLock } from './session-journal';
