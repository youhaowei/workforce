/**
 * Session Streaming — JSONL stream record methods.
 *
 * Free functions for recording stream start/delta/final/abort events.
 */

import type {
  Session,
  ToolActivity,
  ContentBlock,
  JournalMessageFinal,
  JournalRecord,
} from "./types";
import { appendRecord } from "./session-journal";
import { AppendLock } from "./session-journal";

export interface StreamingDeps {
  readonly sessions: Map<string, Session>;
  readonly sessionsDir: string;
  readonly appendLock: AppendLock;
  ensureInitialized(): Promise<void>;
  writeRecords(sessionId: string, records: JournalRecord[]): Promise<void>;
  scheduleConsolidation(sessionId: string): void;
}

export async function recordStreamStart(
  deps: StreamingDeps,
  sessionId: string,
  messageId: string,
): Promise<void> {
  await deps.ensureInitialized();
  if (!deps.sessions.has(sessionId)) throw new Error(`Session not found: ${sessionId}`);
  await deps.writeRecords(sessionId, [
    { t: "message_start", seq: 0, ts: Date.now(), id: messageId, role: "assistant" },
  ]);
}

export async function recordStreamDelta(
  deps: StreamingDeps,
  sessionId: string,
  messageId: string,
  delta: string,
  seq: number,
): Promise<void> {
  await deps.writeRecords(sessionId, [
    { t: "message_delta", seq, ts: Date.now(), id: messageId, delta },
  ]);
}

export async function recordStreamDeltaBatch(
  deps: StreamingDeps,
  sessionId: string,
  messageId: string,
  deltas: Array<{ delta: string; seq: number }>,
): Promise<void> {
  if (deltas.length === 0) return;
  await deps.writeRecords(
    sessionId,
    deltas.map((d) => ({
      t: "message_delta" as const,
      seq: d.seq,
      ts: Date.now(),
      id: messageId,
      delta: d.delta,
    })),
  );
}

export async function recordStreamEnd(
  deps: StreamingDeps,
  sessionId: string,
  messageId: string,
  fullContent: string,
  stopReason: string,
  toolActivities?: ToolActivity[],
  contentBlocks?: ContentBlock[],
): Promise<void> {
  const session = deps.sessions.get(sessionId);
  if (!session) throw new Error(`Session not found: ${sessionId}`);

  const now = Date.now();
  const record: JournalMessageFinal = {
    t: "message_final",
    seq: 0,
    ts: now,
    id: messageId,
    role: "assistant",
    content: fullContent,
    stopReason,
    ...(toolActivities?.length ? { toolActivities } : {}),
    ...(contentBlocks?.length ? { contentBlocks } : {}),
  };

  await deps.appendLock.acquire(sessionId, async () => {
    session.messages.push({
      id: messageId,
      role: "assistant",
      content: fullContent,
      timestamp: now,
      ...(toolActivities?.length ? { toolActivities } : {}),
      ...(contentBlocks?.length ? { contentBlocks } : {}),
    });
    session.updatedAt = now;
    await appendRecord(deps.sessionsDir, sessionId, record);
  });
  deps.scheduleConsolidation(sessionId);
}

export async function recordStreamBlocks(
  deps: StreamingDeps,
  sessionId: string,
  messageId: string,
  contentBlocks: ContentBlock[],
  toolActivities?: ToolActivity[],
): Promise<void> {
  await deps.writeRecords(sessionId, [
    {
      t: "message_blocks",
      seq: 0,
      ts: Date.now(),
      id: messageId,
      contentBlocks,
      ...(toolActivities?.length ? { toolActivities } : {}),
    },
  ]);
}

export async function recordStreamAbort(
  deps: StreamingDeps,
  sessionId: string,
  messageId: string,
  reason: string,
): Promise<void> {
  await deps.writeRecords(sessionId, [
    { t: "message_abort", seq: 0, ts: Date.now(), id: messageId, reason },
  ]);
}
