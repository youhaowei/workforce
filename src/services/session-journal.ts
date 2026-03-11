/**
 * Session Journal — JSONL I/O, replay, and consolidation.
 *
 * Extracted from session.ts to keep file sizes manageable and reduce
 * cyclomatic complexity in the replay function.
 */

import { readFile, writeFile, appendFile, mkdir, rename } from 'fs/promises';
import { join } from 'path';
import type {
  Session,
  Message,
  ContentBlock,
  ToolActivity,
  JournalRecord,
  JournalHeader,
  JournalMessage,
  JournalMessageFinal,
} from './types';
import { createLogger } from 'tracey';

const log = createLogger('Session');

export const JSONL_VERSION = 2;

// =============================================================================
// JSONL I/O
// =============================================================================

/** Append a single record to a session's JSONL file. */
export async function appendRecord(sessionsDir: string, sessionId: string, record: JournalRecord): Promise<void> {
  await mkdir(sessionsDir, { recursive: true });
  const filePath = join(sessionsDir, `${sessionId}.jsonl`);
  await appendFile(filePath, JSON.stringify(record) + '\n', 'utf-8');
}

/** Append multiple records to a session's JSONL file in a single I/O operation. */
export async function appendRecords(sessionsDir: string, sessionId: string, records: JournalRecord[]): Promise<void> {
  if (records.length === 0) return;
  await mkdir(sessionsDir, { recursive: true });
  const filePath = join(sessionsDir, `${sessionId}.jsonl`);
  const content = records.map((r) => JSON.stringify(r)).join('\n') + '\n';
  await appendFile(filePath, content, 'utf-8');
}

/** Write a complete JSONL file from an array of records (used by create, fork, consolidation). */
export async function writeRecords(sessionsDir: string, sessionId: string, records: JournalRecord[]): Promise<void> {
  await mkdir(sessionsDir, { recursive: true });
  const filePath = join(sessionsDir, `${sessionId}.jsonl`);
  const content = records.map((r) => JSON.stringify(r)).join('\n') + '\n';
  await writeFile(filePath, content, 'utf-8');
}

// =============================================================================
// Stream State (used during replay)
// =============================================================================

interface StreamState {
  deltas: Array<{ delta: string; seq: number }>;
  timestamp: number;
  contentBlocks?: ContentBlock[];
  toolActivities?: ToolActivity[];
}

/** Reconstruct partial content from ordered deltas. */
function assembleDeltas(stream: StreamState): string {
  const sorted = stream.deltas.sort((a, b) => a.seq - b.seq);
  return sorted.map((d) => d.delta).join('');
}

// =============================================================================
// Record Processors (one per record type)
// =============================================================================

interface ReplayContext {
  session: Session;
  activeStreams: Map<string, StreamState>;
  finalizedIds: Set<string>;
}

function processMetaRecord(ctx: ReplayContext, record: JournalRecord & { t: 'meta' }): void {
  ctx.session.updatedAt = record.updatedAt;
  // Extract top-level session fields before merging into metadata
  if ('title' in record.patch && typeof record.patch.title === 'string') {
    ctx.session.title = record.patch.title;
  }
  if ('parentId' in record.patch && typeof record.patch.parentId === 'string') {
    ctx.session.parentId = record.patch.parentId;
  }
  // Merge remaining fields into metadata (title/parentId go to both for compat)
  Object.assign(ctx.session.metadata, record.patch);
}

function processMessageRecord(ctx: ReplayContext, record: JournalRecord & { t: 'message' }): void {
  ctx.session.messages.push({
    id: record.id,
    role: record.role,
    content: record.content,
    timestamp: record.timestamp,
    agentConfig: record.agentConfig,
    toolCalls: record.toolCalls,
    toolResults: record.toolResults,
    toolActivities: record.toolActivities,
    contentBlocks: record.contentBlocks,
  });
  if (record.timestamp > ctx.session.updatedAt) ctx.session.updatedAt = record.timestamp;
}

function processMessageStart(ctx: ReplayContext, record: JournalRecord & { t: 'message_start' }): void {
  ctx.activeStreams.set(record.id, { deltas: [], timestamp: record.timestamp });
  if (record.timestamp > ctx.session.updatedAt) ctx.session.updatedAt = record.timestamp;
}

function processMessageDelta(ctx: ReplayContext, record: JournalRecord & { t: 'message_delta' }): void {
  const stream = ctx.activeStreams.get(record.id);
  if (stream) {
    stream.deltas.push({ delta: record.delta, seq: record.seq });
  }
}

function processMessageFinal(ctx: ReplayContext, record: JournalRecord & { t: 'message_final' }): void {
  ctx.finalizedIds.add(record.id);
  ctx.activeStreams.delete(record.id);
  ctx.session.messages.push({
    id: record.id,
    role: record.role,
    content: record.content,
    timestamp: record.timestamp,
    toolCalls: record.toolCalls,
    toolResults: record.toolResults,
    toolActivities: record.toolActivities,
    contentBlocks: record.contentBlocks,
  });
  if (record.timestamp > ctx.session.updatedAt) ctx.session.updatedAt = record.timestamp;
}

function processMessageBlocks(ctx: ReplayContext, record: JournalRecord & { t: 'message_blocks' }): void {
  const stream = ctx.activeStreams.get(record.id);
  if (stream) {
    stream.contentBlocks = record.contentBlocks;
    stream.toolActivities = record.toolActivities;
  }
}

function processMessageAbort(ctx: ReplayContext, record: JournalRecord & { t: 'message_abort' }): void {
  const abortedStream = ctx.activeStreams.get(record.id);
  if (abortedStream) {
    const partialContent = assembleDeltas(abortedStream);
    if (partialContent.length > 0) {
      ctx.session.messages.push({
        id: record.id,
        role: 'assistant',
        content: partialContent,
        timestamp: abortedStream.timestamp,
      });
    }
  }
  ctx.activeStreams.delete(record.id);
  if (record.timestamp > ctx.session.updatedAt) ctx.session.updatedAt = record.timestamp;
}

function applyRecord(ctx: ReplayContext, record: JournalRecord): void {
  switch (record.t) {
    case 'meta': return processMetaRecord(ctx, record);
    case 'message': return processMessageRecord(ctx, record);
    case 'message_start': return processMessageStart(ctx, record);
    case 'message_delta': return processMessageDelta(ctx, record);
    case 'message_blocks': return processMessageBlocks(ctx, record);
    case 'message_final': return processMessageFinal(ctx, record);
    case 'message_abort': return processMessageAbort(ctx, record);
  }
}

/** Recover incomplete streams that have deltas but no final/abort. */
function recoverOrphanedStreams(ctx: ReplayContext): void {
  for (const [msgId, stream] of ctx.activeStreams) {
    if (ctx.finalizedIds.has(msgId)) continue;
    const content = assembleDeltas(stream);
    if (content.length > 0 || stream.contentBlocks?.length) {
      ctx.session.messages.push({
        id: msgId,
        role: 'assistant',
        content,
        timestamp: stream.timestamp,
        ...(stream.contentBlocks?.length ? { contentBlocks: stream.contentBlocks } : {}),
        ...(stream.toolActivities?.length ? { toolActivities: stream.toolActivities } : {}),
      });
    }
  }
}

/**
 * Backfill AskUserQuestion blocks that have no result but are followed by a user message.
 * This happens when cold-replay answers were submitted before the updateBlockResult fix.
 * Mutates in place — the corrected result will be persisted on the next consolidation.
 */
function backfillQuestionResults(messages: Message[]): void {
  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    if (msg.role !== 'assistant' || !msg.contentBlocks) continue;
    for (const block of msg.contentBlocks) {
      if (block.type !== 'tool_use' || block.name !== 'AskUserQuestion') continue;
      if (block.result != null) continue;
      // Find the next user message as the answer
      const nextUser = messages.slice(i + 1).find((m) => m.role === 'user');
      if (nextUser) {
        block.result = { _fromFollowUp: true, answer: nextUser.content };
      }
    }
  }
}

// =============================================================================
// Replay
// =============================================================================

/** Move a corrupt JSONL to a backup path. */
async function corruptBackup(sessionsDir: string, sessionId: string): Promise<void> {
  try {
    const src = join(sessionsDir, `${sessionId}.jsonl`);
    const dest = join(sessionsDir, `${sessionId}.corrupt.${Date.now()}`);
    await rename(src, dest);
  } catch {
    // best-effort
  }
}

/** Parse and validate the header line. Returns null on failure. */
async function parseHeader(
  sessionsDir: string,
  sessionId: string,
  headerLine: string,
): Promise<JournalHeader | null> {
  try {
    const header = JSON.parse(headerLine) as JournalHeader;
    if (header.t !== 'header') {
      log.warn({ sessionId }, `Invalid header in ${sessionId}, marking corrupt`);
      await corruptBackup(sessionsDir, sessionId);
      return null;
    }
    return header;
  } catch {
    log.warn({ sessionId }, `Corrupt header in ${sessionId}, marking corrupt`);
    await corruptBackup(sessionsDir, sessionId);
    return null;
  }
}

/**
 * Replay a JSONL file into a Session object.
 *
 * Applies records in order. Uses handler dispatch to keep complexity low.
 */
export async function replaySession(sessionsDir: string, sessionId: string): Promise<Session | null> {
  const filePath = join(sessionsDir, `${sessionId}.jsonl`);

  let raw: string;
  try {
    raw = await readFile(filePath, 'utf-8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw err;
  }

  const lines = raw.split('\n').filter((l) => l.trim().length > 0);
  if (lines.length === 0) return null;

  const header = await parseHeader(sessionsDir, sessionId, lines[0]);
  if (!header) return null;

  const ctx: ReplayContext = {
    session: {
      id: header.id,
      title: header.title,
      createdAt: header.createdAt,
      updatedAt: header.updatedAt,
      parentId: header.parentId,
      messages: [],
      metadata: { ...header.metadata },
    },
    activeStreams: new Map(),
    finalizedIds: new Set(),
  };

  for (let i = 1; i < lines.length; i++) {
    try {
      const record = JSON.parse(lines[i]) as JournalRecord;
      applyRecord(ctx, record);
    } catch {
      log.warn({ sessionId, line: i + 1 }, `Skipping malformed line ${i + 1} in ${sessionId}`);
    }
  }

  recoverOrphanedStreams(ctx);
  backfillQuestionResults(ctx.session.messages);
  return ctx.session;
}

/**
 * Build a lightweight Session from the JSONL header alone (no messages).
 *
 * Used at startup to populate the session list without loading full message
 * histories. Because consolidation rewrites the header with the latest title,
 * metadata, and updatedAt after every finalized assistant message, the header
 * is almost always current. The only staleness window is between a `meta`
 * record write and the next consolidation cycle — at most one user turn — which
 * is acceptable for a sidebar listing. On-demand `get()` (full replay) always
 * returns the exact state.
 */
export async function replaySessionMetadata(sessionsDir: string, sessionId: string): Promise<Session | null> {
  const filePath = join(sessionsDir, `${sessionId}.jsonl`);

  let raw: string;
  try {
    raw = await readFile(filePath, 'utf-8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw err;
  }

  // Only parse the first line (header). Everything else is deferred to full replay.
  const newlineIdx = raw.indexOf('\n');
  const headerLine = newlineIdx === -1 ? raw.trim() : raw.slice(0, newlineIdx).trim();
  if (headerLine.length === 0) return null;

  const header = await parseHeader(sessionsDir, sessionId, headerLine);
  if (!header) return null;

  return {
    id: header.id,
    title: header.title,
    createdAt: header.createdAt,
    updatedAt: header.updatedAt,
    parentId: header.parentId,
    messages: [],
    metadata: { ...header.metadata },
  };
}

// =============================================================================
// Consolidation
// =============================================================================

/**
 * Consolidate a session's JSONL by:
 * - Keeping one header with latest metadata state.
 * - Keeping `message` and `message_final` records.
 * - Dropping superseded deltas for finalized messages.
 * - Atomic rewrite via .tmp + rename.
 */
export async function consolidateSession(sessionsDir: string, session: Session): Promise<void> {
  const records: JournalRecord[] = [];

  records.push({
    t: 'header',
    v: JSONL_VERSION,
    id: session.id,
    title: session.title,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    parentId: session.parentId,
    metadata: session.metadata,
  });

  for (const msg of session.messages) {
    records.push(messageToRecord(msg, 'consolidated'));
  }

  const tmpPath = join(sessionsDir, `${session.id}.jsonl.tmp`);
  const finalPath = join(sessionsDir, `${session.id}.jsonl`);
  const content = records.map((r) => JSON.stringify(r)).join('\n') + '\n';
  await writeFile(tmpPath, content, 'utf-8');
  await rename(tmpPath, finalPath);
}

/** Convert a Message to the appropriate JournalRecord for serialization. */
function messageToRecord(m: Session['messages'][number], stopReason?: string): JournalMessage | JournalMessageFinal {
  if (m.role === 'assistant') {
    return {
      t: 'message_final', id: m.id, role: 'assistant', content: m.content,
      timestamp: m.timestamp, stopReason: stopReason ?? 'consolidated',
      toolCalls: m.toolCalls, toolResults: m.toolResults,
      toolActivities: m.toolActivities, contentBlocks: m.contentBlocks,
    } satisfies JournalMessageFinal;
  }
  return {
    t: 'message', id: m.id, role: m.role, content: m.content,
    timestamp: m.timestamp, agentConfig: m.agentConfig,
    toolCalls: m.toolCalls, toolResults: m.toolResults,
    toolActivities: m.toolActivities, contentBlocks: m.contentBlocks,
  } satisfies JournalMessage;
}

/** Write a forked session's JSONL from scratch (header + all messages). */
export async function writeForkSession(sessionsDir: string, forked: Session): Promise<void> {
  const records: JournalRecord[] = [
    { t: 'header', v: JSONL_VERSION, id: forked.id, title: forked.title,
      createdAt: forked.createdAt, updatedAt: forked.updatedAt,
      parentId: forked.parentId, metadata: forked.metadata },
    ...forked.messages.map((m) => messageToRecord(m, 'forked')),
  ];
  await writeRecords(sessionsDir, forked.id, records);
}

// =============================================================================
// Append Lock (per-session serialization)
// =============================================================================

/**
 * Simple per-session promise chain to serialize appends.
 * Each append awaits the previous one, preventing interleaved writes.
 */
export class AppendLock {
  private locks = new Map<string, Promise<void>>();

  async acquire<T>(sessionId: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.locks.get(sessionId) ?? Promise.resolve();
    let resolve: () => void;
    const next = new Promise<void>((r) => { resolve = r; });
    this.locks.set(sessionId, next);

    await prev;
    try {
      return await fn();
    } finally {
      resolve!();
    }
  }

  clear(): void {
    this.locks.clear();
  }
}
