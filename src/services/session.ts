/**
 * SessionService - JSONL append-only session persistence and management
 *
 * Provides:
 * - Session CRUD operations with JSONL replay
 * - Crash-resilient assistant streaming persistence (start/delta/final/abort)
 * - Corruption recovery for invalid headers (.corrupt.<ts> rename)
 * - Background JSONL compaction after assistant finalization
 */
/* eslint-disable complexity, max-lines */

import {
  access,
  appendFile,
  mkdir,
  readFile,
  readdir,
  rename,
  unlink,
  writeFile,
} from 'fs/promises';
import { join } from 'path';
import type {
  LifecycleState,
  Message,
  Session,
  SessionLifecycle,
  SessionSearchResult,
  SessionService,
  WorkAgentConfig,
} from './types';
import { VALID_TRANSITIONS } from './types';
import { getEventBus } from '@/shared/event-bus';
import { getDataDir } from './data-dir';

// =============================================================================
// Configuration
// =============================================================================

const SESSIONS_DIR = join(getDataDir(), 'sessions');
const SESSION_JSONL_EXTENSION = '.jsonl';
const SESSION_JSONL_VERSION = 2;

// Backward-compatible export name used by tests/importers.
const SESSION_VERSION = SESSION_JSONL_VERSION;

// =============================================================================
// JSONL Record Types
// =============================================================================

interface SessionHeaderRecord {
  type: 'header';
  version: number;
  sessionId: string;
  createdAt: number;
  updatedAt: number;
  title?: string;
  parentId?: string;
  metadata?: Record<string, unknown>;
}

interface SessionMetaRecord {
  type: 'meta';
  updatedAt: number;
  title?: string | null;
  parentId?: string | null;
  metadata?: Record<string, unknown>;
}

interface SessionMessageRecord {
  type: 'message';
  updatedAt: number;
  message: Message;
}

interface SessionMessageStartRecord {
  type: 'message_start';
  messageId: string;
  startedAt: number;
  meta?: Record<string, unknown>;
}

interface SessionMessageDeltaRecord {
  type: 'message_delta';
  messageId: string;
  delta: string;
  seq: number;
  timestamp: number;
}

interface SessionMessageFinalRecord {
  type: 'message_final';
  messageId: string;
  fullContent: string;
  stopReason: string;
  timestamp: number;
}

interface SessionMessageAbortRecord {
  type: 'message_abort';
  messageId: string;
  reason: string;
  timestamp: number;
}

type SessionJsonlRecord =
  | SessionMetaRecord
  | SessionMessageRecord
  | SessionMessageStartRecord
  | SessionMessageDeltaRecord
  | SessionMessageFinalRecord
  | SessionMessageAbortRecord;

interface ParsedSessionJsonl {
  header: SessionHeaderRecord;
  records: SessionJsonlRecord[];
}

interface ReplayMessageState {
  message: Message;
  order: number;
}

interface ReplayStreamState {
  order: number;
  start?: SessionMessageStartRecord;
  deltas: SessionMessageDeltaRecord[];
  final?: SessionMessageFinalRecord;
  abort?: SessionMessageAbortRecord;
}

// =============================================================================
// Helpers
// =============================================================================

function generateId(): string {
  return `sess_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function sessionFilePath(sessionsDir: string, sessionId: string): string {
  return join(sessionsDir, `${sessionId}${SESSION_JSONL_EXTENSION}`);
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function isMessageRole(value: unknown): value is Message['role'] {
  return value === 'user' || value === 'assistant' || value === 'system';
}

function cloneValue<T>(value: T): T {
  if (typeof structuredClone === 'function') {
    return structuredClone(value);
  }
  return JSON.parse(JSON.stringify(value)) as T;
}

function cloneSession(session: Session): Session {
  return {
    ...session,
    messages: session.messages.map((message) => ({
      ...message,
      toolCalls: message.toolCalls ? cloneValue(message.toolCalls) : undefined,
      toolResults: message.toolResults ? cloneValue(message.toolResults) : undefined,
    })),
    metadata: cloneValue(session.metadata),
  };
}

function buildHeaderRecord(session: Session): SessionHeaderRecord {
  return {
    type: 'header',
    version: SESSION_JSONL_VERSION,
    sessionId: session.id,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    title: session.title,
    parentId: session.parentId,
    metadata: cloneValue(session.metadata),
  };
}

function buildMetaRecord(session: Session): SessionMetaRecord {
  return {
    type: 'meta',
    updatedAt: session.updatedAt,
    title: session.title ?? null,
    parentId: session.parentId ?? null,
    metadata: cloneValue(session.metadata),
  };
}

function serializeRecord(record: SessionHeaderRecord | SessionJsonlRecord): string {
  return JSON.stringify(record);
}

function parseMessage(value: unknown): Message | null {
  if (!isObjectRecord(value)) return null;
  const { id, role, content, timestamp, toolCalls, toolResults } = value;
  if (typeof id !== 'string') return null;
  if (!isMessageRole(role)) return null;
  if (typeof content !== 'string') return null;
  if (typeof timestamp !== 'number') return null;

  return {
    id,
    role,
    content,
    timestamp,
    toolCalls: Array.isArray(toolCalls) ? cloneValue(toolCalls) : undefined,
    toolResults: Array.isArray(toolResults) ? cloneValue(toolResults) : undefined,
  };
}

function parseHeader(raw: unknown): SessionHeaderRecord | null {
  if (!isObjectRecord(raw)) return null;

  const { type, version, sessionId, createdAt, updatedAt, title, parentId, metadata } = raw;

  if (type !== 'header') return null;
  if (typeof version !== 'number') return null;
  if (typeof sessionId !== 'string') return null;
  if (typeof createdAt !== 'number') return null;
  if (typeof updatedAt !== 'number') return null;
  if (title !== undefined && typeof title !== 'string') return null;
  if (parentId !== undefined && typeof parentId !== 'string') return null;
  if (metadata !== undefined && !isObjectRecord(metadata)) return null;

  return {
    type: 'header',
    version,
    sessionId,
    createdAt,
    updatedAt,
    title,
    parentId,
    metadata: isObjectRecord(metadata) ? cloneValue(metadata) : undefined,
  };
}

function parseDataRecord(raw: unknown): SessionJsonlRecord | null {
  if (!isObjectRecord(raw)) return null;

  switch (raw.type) {
    case 'meta': {
      if (typeof raw.updatedAt !== 'number') return null;
      if (raw.title !== undefined && raw.title !== null && typeof raw.title !== 'string') return null;
      if (raw.parentId !== undefined && raw.parentId !== null && typeof raw.parentId !== 'string') return null;
      if (raw.metadata !== undefined && !isObjectRecord(raw.metadata)) return null;

      return {
        type: 'meta',
        updatedAt: raw.updatedAt,
        title: (raw.title as string | null | undefined),
        parentId: (raw.parentId as string | null | undefined),
        metadata: isObjectRecord(raw.metadata) ? cloneValue(raw.metadata) : undefined,
      };
    }

    case 'message': {
      if (typeof raw.updatedAt !== 'number') return null;
      const message = parseMessage(raw.message);
      if (!message) return null;
      return {
        type: 'message',
        updatedAt: raw.updatedAt,
        message,
      };
    }

    case 'message_start': {
      if (typeof raw.messageId !== 'string') return null;
      if (typeof raw.startedAt !== 'number') return null;
      if (raw.meta !== undefined && !isObjectRecord(raw.meta)) return null;

      return {
        type: 'message_start',
        messageId: raw.messageId,
        startedAt: raw.startedAt,
        meta: isObjectRecord(raw.meta) ? cloneValue(raw.meta) : undefined,
      };
    }

    case 'message_delta': {
      if (typeof raw.messageId !== 'string') return null;
      if (typeof raw.delta !== 'string') return null;
      if (typeof raw.seq !== 'number') return null;
      if (typeof raw.timestamp !== 'number') return null;

      return {
        type: 'message_delta',
        messageId: raw.messageId,
        delta: raw.delta,
        seq: raw.seq,
        timestamp: raw.timestamp,
      };
    }

    case 'message_final': {
      if (typeof raw.messageId !== 'string') return null;
      if (typeof raw.fullContent !== 'string') return null;
      if (typeof raw.stopReason !== 'string') return null;
      if (typeof raw.timestamp !== 'number') return null;

      return {
        type: 'message_final',
        messageId: raw.messageId,
        fullContent: raw.fullContent,
        stopReason: raw.stopReason,
        timestamp: raw.timestamp,
      };
    }

    case 'message_abort': {
      if (typeof raw.messageId !== 'string') return null;
      if (typeof raw.reason !== 'string') return null;
      if (typeof raw.timestamp !== 'number') return null;

      return {
        type: 'message_abort',
        messageId: raw.messageId,
        reason: raw.reason,
        timestamp: raw.timestamp,
      };
    }

    default:
      return null;
  }
}

async function markCorruptFile(filePath: string): Promise<void> {
  try {
    await rename(filePath, `${filePath}.corrupt.${Date.now()}`);
  } catch {
    // Best-effort corruption handling.
  }
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Parse JSONL session file.
 * - Invalid/missing header is unrecoverable and the file is renamed to .corrupt.<ts>
 * - Malformed data lines are skipped.
 */
async function parseSessionFile(filePath: string): Promise<ParsedSessionJsonl | null> {
  try {
    const raw = await readFile(filePath, 'utf-8');
    const lines = raw.split('\n');
    const headerLine = lines[0]?.trim();

    if (!headerLine) {
      await markCorruptFile(filePath);
      return null;
    }

    let headerRaw: unknown;
    try {
      headerRaw = JSON.parse(headerLine);
    } catch {
      await markCorruptFile(filePath);
      return null;
    }

    const header = parseHeader(headerRaw);
    if (!header) {
      await markCorruptFile(filePath);
      return null;
    }

    const records: SessionJsonlRecord[] = [];

    for (let index = 1; index < lines.length; index += 1) {
      const line = lines[index]?.trim();
      if (!line) continue;

      try {
        const parsed = JSON.parse(line) as unknown;
        const record = parseDataRecord(parsed);
        if (record) {
          records.push(record);
        }
      } catch {
        // Skip malformed line; replay continues.
      }
    }

    return { header, records };
  } catch (err) {
    const error = err as NodeJS.ErrnoException;
    if (error.code === 'ENOENT') {
      return null;
    }
    throw error;
  }
}

function replaySession(parsed: ParsedSessionJsonl): Session {
  const { header, records } = parsed;

  const session: Session = {
    id: header.sessionId,
    title: header.title,
    createdAt: header.createdAt,
    updatedAt: header.updatedAt,
    parentId: header.parentId,
    messages: [],
    metadata: cloneValue(header.metadata ?? {}),
  };

  const messages = new Map<string, ReplayMessageState>();
  const streams = new Map<string, ReplayStreamState>();
  let orderCounter = 0;

  for (const record of records) {
    switch (record.type) {
      case 'meta': {
        session.updatedAt = Math.max(session.updatedAt, record.updatedAt);
        if ('title' in record) {
          session.title = record.title ?? undefined;
        }
        if ('parentId' in record) {
          session.parentId = record.parentId ?? undefined;
        }
        if (record.metadata) {
          session.metadata = cloneValue(record.metadata);
        }
        break;
      }

      case 'message': {
        session.updatedAt = Math.max(session.updatedAt, record.updatedAt, record.message.timestamp);
        messages.set(record.message.id, {
          message: cloneValue(record.message),
          order: orderCounter++,
        });
        break;
      }

      case 'message_start': {
        const stream = streams.get(record.messageId) ?? {
          order: orderCounter++,
          deltas: [],
        };
        stream.start = record;
        streams.set(record.messageId, stream);
        session.updatedAt = Math.max(session.updatedAt, record.startedAt);
        break;
      }

      case 'message_delta': {
        const stream = streams.get(record.messageId) ?? {
          order: orderCounter++,
          deltas: [],
        };
        stream.deltas.push(record);
        streams.set(record.messageId, stream);
        session.updatedAt = Math.max(session.updatedAt, record.timestamp);
        break;
      }

      case 'message_final': {
        const stream = streams.get(record.messageId) ?? {
          order: orderCounter++,
          deltas: [],
        };
        stream.final = record;
        streams.set(record.messageId, stream);
        session.updatedAt = Math.max(session.updatedAt, record.timestamp);
        messages.set(record.messageId, {
          message: {
            id: record.messageId,
            role: 'assistant',
            content: record.fullContent,
            timestamp: record.timestamp,
          },
          order: orderCounter++,
        });
        break;
      }

      case 'message_abort': {
        const stream = streams.get(record.messageId) ?? {
          order: orderCounter++,
          deltas: [],
        };
        stream.abort = record;
        streams.set(record.messageId, stream);
        session.updatedAt = Math.max(session.updatedAt, record.timestamp);
        break;
      }
    }
  }

  // Replay partial streams when no final exists.
  for (const [messageId, stream] of streams) {
    if (stream.final) continue;
    if (stream.deltas.length === 0) continue;

    const content = [...stream.deltas]
      .sort((a, b) => a.seq - b.seq)
      .map((delta) => delta.delta)
      .join('');

    const timestamp = stream.start?.startedAt ?? stream.deltas[0].timestamp;

    messages.set(messageId, {
      message: {
        id: messageId,
        role: 'assistant',
        content,
        timestamp,
      },
      order: stream.order,
    });
  }

  session.messages = [...messages.values()]
    .sort((a, b) => a.order - b.order)
    .map((entry) => entry.message);

  return session;
}

function serializeJsonl(header: SessionHeaderRecord, records: SessionJsonlRecord[]): string {
  const lines = [serializeRecord(header), ...records.map((record) => serializeRecord(record))];
  return `${lines.join('\n')}\n`;
}

/**
 * Load a session from disk with JSONL replay and corruption recovery.
 */
async function loadSessionFromDir(
  sessionsDir: string,
  sessionId: string
): Promise<Session | null> {
  const filePath = sessionFilePath(sessionsDir, sessionId);
  const parsed = await parseSessionFile(filePath);
  if (!parsed) return null;
  return replaySession(parsed);
}

/**
 * Rewrite a session file from an in-memory session snapshot (used by tests and utilities).
 */
async function saveSessionToDir(sessionsDir: string, session: Session): Promise<void> {
  await mkdir(sessionsDir, { recursive: true });
  const filePath = sessionFilePath(sessionsDir, session.id);

  const header = buildHeaderRecord(session);
  const records: SessionJsonlRecord[] = session.messages.map((message) => ({
    type: 'message',
    updatedAt: session.updatedAt,
    message: cloneValue(message),
  }));

  await writeFile(filePath, serializeJsonl(header, records), 'utf-8');
}

function messageFingerprint(message: Message): string {
  return JSON.stringify(message);
}

function getRecordTimestamp(record: SessionJsonlRecord): number {
  switch (record.type) {
    case 'meta':
      return record.updatedAt;
    case 'message':
      return record.message.timestamp;
    case 'message_start':
      return record.startedAt;
    case 'message_delta':
      return record.timestamp;
    case 'message_final':
      return record.timestamp;
    case 'message_abort':
      return record.timestamp;
  }
}

function compactSessionRecords(session: Session, records: SessionJsonlRecord[]): SessionJsonlRecord[] {
  const latestMessages = new Map<string, SessionMessageRecord>();
  const finalized = new Map<string, SessionMessageFinalRecord>();

  const streams = new Map<string, ReplayStreamState>();

  for (const record of records) {
    switch (record.type) {
      case 'message': {
        latestMessages.set(record.message.id, record);
        break;
      }

      case 'message_start': {
        const existing = streams.get(record.messageId);
        streams.set(record.messageId, {
          order: existing?.order ?? Number.MAX_SAFE_INTEGER,
          start: record,
          deltas: [],
          abort: undefined,
          final: existing?.final,
        });
        break;
      }

      case 'message_delta': {
        const stream = streams.get(record.messageId) ?? {
          order: Number.MAX_SAFE_INTEGER,
          deltas: [],
        };
        stream.deltas.push(record);
        streams.set(record.messageId, stream);
        break;
      }

      case 'message_abort': {
        const stream = streams.get(record.messageId) ?? {
          order: Number.MAX_SAFE_INTEGER,
          deltas: [],
        };
        stream.abort = record;
        streams.set(record.messageId, stream);
        break;
      }

      case 'message_final': {
        finalized.set(record.messageId, record);
        const stream = streams.get(record.messageId) ?? {
          order: Number.MAX_SAFE_INTEGER,
          deltas: [],
        };
        stream.final = record;
        streams.set(record.messageId, stream);
        break;
      }

      case 'meta':
        break;
    }
  }

  const compacted: SessionJsonlRecord[] = [];

  // Keep one canonical meta snapshot.
  compacted.push(buildMetaRecord(session));

  // Keep latest non-stream messages (and assistant messages that do not have message_final).
  for (const record of latestMessages.values()) {
    if (record.message.role === 'assistant' && finalized.has(record.message.id)) {
      continue;
    }
    compacted.push(record);
  }

  // Keep authoritative finals only for finalized assistant messages.
  for (const finalRecord of finalized.values()) {
    compacted.push(finalRecord);
  }

  // Preserve active/incomplete streams (start/deltas/abort) for non-finalized message IDs.
  for (const [messageId, stream] of streams) {
    if (finalized.has(messageId)) continue;

    if (stream.start) {
      compacted.push(stream.start);
    }

    const sortedDeltas = [...stream.deltas].sort((a, b) => a.seq - b.seq);
    for (const delta of sortedDeltas) {
      compacted.push(delta);
    }

    if (stream.abort) {
      compacted.push(stream.abort);
    }
  }

  return compacted.sort((a, b) => getRecordTimestamp(a) - getRecordTimestamp(b));
}

// =============================================================================
// Service Implementation
// =============================================================================

class SessionServiceImpl implements SessionService {
  private sessions = new Map<string, Session>();
  private currentSession: Session | null = null;
  private sessionsDir: string;
  private initialized = false;
  private appendLocks = new Map<string, Promise<void>>();
  private persistedSnapshots = new Map<string, Session>();
  private compactionScheduled = new Set<string>();
  private compactionTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private disposed = false;

  constructor(sessionsDir?: string) {
    this.sessionsDir = sessionsDir ?? SESSIONS_DIR;
  }

  /**
   * Serialize append/rewrite operations per session.
   */
  private withSessionLock<T>(sessionId: string, task: () => Promise<T>): Promise<T> {
    const previous = this.appendLocks.get(sessionId) ?? Promise.resolve();

    const next = previous
      .catch(() => {
        // Keep lock chain alive even if a previous operation failed.
      })
      .then(task);

    const lockPromise = next
      .then(() => undefined)
      .catch(() => undefined)
      .finally(() => {
        if (this.appendLocks.get(sessionId) === lockPromise) {
          this.appendLocks.delete(sessionId);
        }
      });

    this.appendLocks.set(sessionId, lockPromise);
    return next;
  }

  private async appendRecords(sessionId: string, records: SessionJsonlRecord[]): Promise<void> {
    if (records.length === 0) return;

    const filePath = sessionFilePath(this.sessionsDir, sessionId);
    const payload = `${records.map((record) => serializeRecord(record)).join('\n')}\n`;
    await appendFile(filePath, payload, 'utf-8');
  }

  private async ensureSessionFile(session: Session): Promise<void> {
    await mkdir(this.sessionsDir, { recursive: true });
    const filePath = sessionFilePath(this.sessionsDir, session.id);
    if (await fileExists(filePath)) return;

    await writeFile(filePath, `${serializeRecord(buildHeaderRecord(session))}\n`, 'utf-8');
  }

  private updateSessionSnapshot(session: Session): void {
    this.sessions.set(session.id, session);
    this.persistedSnapshots.set(session.id, cloneSession(session));
  }

  private scheduleCompaction(sessionId: string): void {
    if (this.disposed) return;
    if (this.compactionScheduled.has(sessionId)) return;
    this.compactionScheduled.add(sessionId);

    const timer = setTimeout(() => {
      this.compactionTimers.delete(sessionId);
      if (this.disposed) {
        this.compactionScheduled.delete(sessionId);
        return;
      }
      void this.withSessionLock(sessionId, async () => {
        try {
          await this.compactSessionFile(sessionId);
        } finally {
          this.compactionScheduled.delete(sessionId);
        }
      });
    }, 0);

    this.compactionTimers.set(sessionId, timer);
  }

  private async compactSessionFile(sessionId: string): Promise<void> {
    const filePath = sessionFilePath(this.sessionsDir, sessionId);
    const parsed = await parseSessionFile(filePath);
    if (!parsed) {
      this.sessions.delete(sessionId);
      this.persistedSnapshots.delete(sessionId);
      return;
    }

    const replayed = replaySession(parsed);
    const compactedHeader = buildHeaderRecord(replayed);
    const compactedRecords = compactSessionRecords(replayed, parsed.records);

    const tmpPath = `${filePath}.tmp.${process.pid}.${Date.now()}`;
    await writeFile(tmpPath, serializeJsonl(compactedHeader, compactedRecords), 'utf-8');
    await rename(tmpPath, filePath);

    this.sessions.set(sessionId, replayed);
    this.persistedSnapshots.set(sessionId, cloneSession(replayed));
  }

  /**
   * Initialize by loading session index from disk.
   */
  private async ensureInitialized(): Promise<void> {
    if (this.disposed) {
      this.disposed = false;
    }
    if (this.initialized) return;

    try {
      await mkdir(this.sessionsDir, { recursive: true });

      const entries = await readdir(this.sessionsDir, { withFileTypes: true });
      const sessionFiles = entries.filter(
        (entry) => entry.isFile() && entry.name.endsWith(SESSION_JSONL_EXTENSION)
      );

      for (const file of sessionFiles) {
        const sessionId = file.name.slice(0, -SESSION_JSONL_EXTENSION.length);
        const session = await loadSessionFromDir(this.sessionsDir, sessionId);
        if (session) {
          this.sessions.set(sessionId, session);
          this.persistedSnapshots.set(sessionId, cloneSession(session));
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

    await this.withSessionLock(session.id, async () => {
      await this.ensureSessionFile(session);
    });

    this.updateSessionSnapshot(session);

    getEventBus().emit({
      type: 'SessionChange',
      sessionId: session.id,
      action: 'created',
      timestamp: now,
    });

    return session;
  }

  async get(sessionId: string, options?: { includeMessages?: boolean }): Promise<Session | null> {
    await this.ensureInitialized();

    if (!this.sessions.has(sessionId)) {
      const loaded = await loadSessionFromDir(this.sessionsDir, sessionId);
      if (loaded) {
        this.sessions.set(sessionId, loaded);
        this.persistedSnapshots.set(sessionId, cloneSession(loaded));
      }
    }

    const session = this.sessions.get(sessionId) ?? null;
    if (!session) return null;

    if (options?.includeMessages === false) {
      return {
        ...session,
        messages: [],
      };
    }

    return session;
  }

  async getMessages(sessionId: string, options?: { limit?: number; offset?: number }): Promise<Message[]> {
    const session = await this.get(sessionId);
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`);
    }

    const offset = options?.offset ?? 0;
    const limit = options?.limit ?? session.messages.length;
    return session.messages.slice(offset, offset + limit);
  }

  async save(session: Session): Promise<void> {
    await this.ensureInitialized();

    const previousSnapshot = this.persistedSnapshots.get(session.id);
    const now = Date.now();
    session.updatedAt = now;

    const previousMessageHashes = new Map<string, string>();
    for (const message of previousSnapshot?.messages ?? []) {
      previousMessageHashes.set(message.id, messageFingerprint(message));
    }

    const changedMessages = session.messages.filter(
      (message) => previousMessageHashes.get(message.id) !== messageFingerprint(message)
    );

    await this.withSessionLock(session.id, async () => {
      await this.ensureSessionFile(session);

      const records: SessionJsonlRecord[] = [buildMetaRecord(session)];
      for (const message of changedMessages) {
        records.push({
          type: 'message',
          updatedAt: session.updatedAt,
          message: cloneValue(message),
        });
      }

      await this.appendRecords(session.id, records);
    });

    this.updateSessionSnapshot(session);
  }

  async addMessage(sessionId: string, message: Message): Promise<void> {
    await this.ensureInitialized();

    const session = await this.get(sessionId);
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`);
    }

    session.messages.push(cloneValue(message));
    session.updatedAt = Date.now();

    await this.withSessionLock(sessionId, async () => {
      await this.ensureSessionFile(session);
      await this.appendRecords(sessionId, [
        {
          type: 'message',
          updatedAt: session.updatedAt,
          message: cloneValue(message),
        },
      ]);
    });

    this.updateSessionSnapshot(session);
  }

  async startAssistantStream(
    sessionId: string,
    messageId: string,
    meta?: Record<string, unknown>
  ): Promise<void> {
    await this.ensureInitialized();

    const session = await this.get(sessionId);
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`);
    }

    const now = Date.now();
    session.updatedAt = now;

    if (!session.messages.some((message) => message.id === messageId)) {
      session.messages.push({
        id: messageId,
        role: 'assistant',
        content: '',
        timestamp: now,
      });
    }

    await this.withSessionLock(sessionId, async () => {
      await this.ensureSessionFile(session);
      await this.appendRecords(sessionId, [
        {
          type: 'message_start',
          messageId,
          startedAt: now,
          meta: meta ? cloneValue(meta) : undefined,
        },
      ]);
    });

    this.updateSessionSnapshot(session);
  }

  async appendAssistantDelta(
    sessionId: string,
    messageId: string,
    delta: string,
    seq: number
  ): Promise<void> {
    await this.ensureInitialized();

    const session = await this.get(sessionId);
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`);
    }

    const now = Date.now();
    session.updatedAt = now;

    let message = session.messages.find((entry) => entry.id === messageId);
    if (!message) {
      message = {
        id: messageId,
        role: 'assistant',
        content: '',
        timestamp: now,
      };
      session.messages.push(message);
    }
    message.content += delta;

    await this.withSessionLock(sessionId, async () => {
      await this.ensureSessionFile(session);
      await this.appendRecords(sessionId, [
        {
          type: 'message_delta',
          messageId,
          delta,
          seq,
          timestamp: now,
        },
      ]);
    });

    this.updateSessionSnapshot(session);
  }

  async finalizeAssistantMessage(
    sessionId: string,
    messageId: string,
    fullContent: string,
    stopReason: string
  ): Promise<void> {
    await this.ensureInitialized();

    const session = await this.get(sessionId);
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`);
    }

    const now = Date.now();
    session.updatedAt = now;

    let message = session.messages.find((entry) => entry.id === messageId);
    if (!message) {
      message = {
        id: messageId,
        role: 'assistant',
        content: '',
        timestamp: now,
      };
      session.messages.push(message);
    }
    message.content = fullContent;
    message.timestamp = now;

    await this.withSessionLock(sessionId, async () => {
      await this.ensureSessionFile(session);
      await this.appendRecords(sessionId, [
        {
          type: 'message_final',
          messageId,
          fullContent,
          stopReason,
          timestamp: now,
        },
      ]);
    });

    this.updateSessionSnapshot(session);
    this.scheduleCompaction(sessionId);
  }

  async abortAssistantStream(sessionId: string, messageId: string, reason: string): Promise<void> {
    await this.ensureInitialized();

    const session = await this.get(sessionId);
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`);
    }

    const now = Date.now();
    session.updatedAt = now;

    await this.withSessionLock(sessionId, async () => {
      await this.ensureSessionFile(session);
      await this.appendRecords(sessionId, [
        {
          type: 'message_abort',
          messageId,
          reason,
          timestamp: now,
        },
      ]);
    });

    this.updateSessionSnapshot(session);
  }

  async resume(sessionId: string): Promise<Session> {
    const session = await this.get(sessionId);
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`);
    }

    this.currentSession = session;

    getEventBus().emit({
      type: 'SessionChange',
      sessionId: session.id,
      action: 'resumed',
      timestamp: Date.now(),
    });

    return session;
  }

  async fork(sessionId: string): Promise<Session> {
    const parent = await this.get(sessionId);
    if (!parent) {
      throw new Error(`Session not found: ${sessionId}`);
    }

    const now = Date.now();
    const forked: Session = {
      id: generateId(),
      title: parent.title ? `${parent.title} (fork)` : undefined,
      createdAt: now,
      updatedAt: now,
      parentId: parent.id,
      messages: parent.messages.map((message) => cloneValue(message)),
      metadata: cloneValue(parent.metadata),
    };

    await this.withSessionLock(forked.id, async () => {
      await this.ensureSessionFile(forked);
      await this.appendRecords(
        forked.id,
        forked.messages.map((message) => ({
          type: 'message',
          updatedAt: now,
          message,
        }))
      );
    });

    this.updateSessionSnapshot(forked);

    getEventBus().emit({
      type: 'SessionChange',
      sessionId: forked.id,
      action: 'created',
      timestamp: now,
    });

    return forked;
  }

  async list(options?: { limit?: number; offset?: number; orgId?: string }): Promise<Session[]> {
    await this.ensureInitialized();

    let results = Array.from(this.sessions.values());

    if (options?.orgId) {
      results = results.filter((session) => session.metadata.orgId === options.orgId);
    }

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
        results.push({
          session,
          matchedText: session.title,
          score: 2.0,
        });
        continue;
      }

      for (const message of session.messages) {
        const lowerContent = message.content.toLowerCase();
        const index = lowerContent.indexOf(lowerQuery);
        if (index === -1) continue;

        const start = Math.max(0, index - 30);
        const end = Math.min(lowerContent.length, index + query.length + 30);

        results.push({
          session,
          matchedText: message.content.slice(start, end),
          score: 1.0,
        });
        break;
      }
    }

    return results.sort((a, b) => b.score - a.score);
  }

  async delete(sessionId: string): Promise<void> {
    await this.ensureInitialized();

    if (!this.sessions.has(sessionId)) return;

    this.sessions.delete(sessionId);
    this.persistedSnapshots.delete(sessionId);
    this.compactionScheduled.delete(sessionId);

    if (this.currentSession?.id === sessionId) {
      this.currentSession = null;
    }

    try {
      await unlink(sessionFilePath(this.sessionsDir, sessionId));
    } catch {
      // Ignore file deletion errors.
    }

    getEventBus().emit({
      type: 'SessionChange',
      sessionId,
      action: 'terminated',
      timestamp: Date.now(),
    });
  }

  getCurrent(): Session | null {
    return this.currentSession;
  }

  setCurrent(session: Session | null): void {
    this.currentSession = session;
  }

  async createWorkAgent(config: WorkAgentConfig): Promise<Session> {
    await this.ensureInitialized();

    const now = Date.now();
    const lifecycle: SessionLifecycle = {
      state: 'created',
      stateHistory: [],
    };

    const session: Session = {
      id: generateId(),
      title: config.goal,
      createdAt: now,
      updatedAt: now,
      messages: [],
      metadata: {
        type: 'workagent' as const,
        lifecycle,
        templateId: config.templateId,
        goal: config.goal,
        workflowId: config.workflowId,
        workflowStepIndex: config.workflowStepIndex,
        worktreePath: config.worktreePath,
        orgId: config.orgId,
        repoRoot: config.repoRoot,
      },
    };

    await this.withSessionLock(session.id, async () => {
      await this.ensureSessionFile(session);
    });

    this.updateSessionSnapshot(session);

    getEventBus().emit({
      type: 'SessionChange',
      sessionId: session.id,
      action: 'created',
      timestamp: now,
    });

    return session;
  }

  async transitionState(
    sessionId: string,
    newState: LifecycleState,
    reason: string,
    actor: 'system' | 'user' | 'agent' = 'system'
  ): Promise<Session> {
    const session = await this.get(sessionId);
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`);
    }

    const lifecycle = session.metadata.lifecycle as SessionLifecycle | undefined;
    const currentState: LifecycleState = lifecycle?.state ?? 'created';

    const allowed = VALID_TRANSITIONS[currentState];
    if (!allowed.includes(newState)) {
      throw new Error(
        `Invalid state transition: ${currentState} → ${newState}. ` +
        `Allowed transitions: ${allowed.join(', ') || 'none'}`
      );
    }

    const now = Date.now();
    const updatedLifecycle: SessionLifecycle = {
      state: newState,
      stateHistory: [
        ...(lifecycle?.stateHistory ?? []),
        { from: currentState, to: newState, reason, timestamp: now, actor },
      ],
      pauseReason: newState === 'paused' ? reason : undefined,
      failureReason: newState === 'failed' ? reason : undefined,
      completionSummary: newState === 'completed' ? reason : lifecycle?.completionSummary,
    };

    session.metadata = {
      ...session.metadata,
      lifecycle: updatedLifecycle,
    };

    await this.save(session);

    getEventBus().emit({
      type: 'LifecycleTransition',
      sessionId,
      from: currentState,
      to: newState,
      reason,
      actor,
      timestamp: now,
    });

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
      .filter((session) => session.parentId === parentSessionId)
      .sort((a, b) => b.createdAt - a.createdAt);
  }

  dispose(): void {
    this.disposed = true;
    for (const timer of this.compactionTimers.values()) {
      clearTimeout(timer);
    }
    this.compactionTimers.clear();
    this.sessions.clear();
    this.persistedSnapshots.clear();
    this.appendLocks.clear();
    this.compactionScheduled.clear();
    this.currentSession = null;
    this.initialized = false;
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
  if (_instance) {
    _instance.dispose();
    _instance = null;
  }
}

/**
 * Create a session service with a custom sessions directory.
 * Useful for testing.
 */
export function createSessionService(sessionsDir: string): SessionService {
  return new SessionServiceImpl(sessionsDir);
}

// Export for testing and migration utilities
export {
  loadSessionFromDir,
  saveSessionToDir,
  parseSessionFile,
  replaySession,
  SESSION_VERSION,
  SESSION_JSONL_VERSION,
  SESSION_JSONL_EXTENSION,
};
