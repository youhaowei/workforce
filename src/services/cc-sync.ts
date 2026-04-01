/**
 * CC Session Sync — Import, sync, and watch Claude Code sessions.
 *
 * Extracted from session.ts to keep it under line limits.
 * Uses a deps interface for access to session internals.
 */

import { stat } from "fs/promises";
import type { Session, JournalMeta, JournalRecord } from "./types";
import { readCCSession } from "./cc-reader";
import {
  SeqAllocator,
  JSONL_VERSION,
  writeRecords as journalWriteRecords,
} from "./session-journal";
import { loadSession } from "./session-upgrade";
import { getEventBus } from "@/shared/event-bus";
import { createLogger } from "tracey";

const log = createLogger("Session");

export interface CCSyncDeps {
  readonly sessions: Map<string, Session>;
  readonly seqAllocators: Map<string, SeqAllocator>;
  readonly sessionsDir: string;
  generateId(): string;
  registerSession(session: Session, status: "ready"): void;
  writeRecords(sessionId: string, records: JournalRecord[]): Promise<void>;
  scheduleConsolidation(sessionId: string): void;
  ensureInitialized(): Promise<void>;
}

const importFlights = new Map<string, Promise<Session>>();

export function importCCSession(
  deps: CCSyncDeps,
  ccFilePath: string,
  orgId?: string,
): Promise<Session> {
  const existing = importFlights.get(ccFilePath);
  if (existing) return existing;
  const promise = doImportCCSession(deps, ccFilePath, orgId).finally(() =>
    importFlights.delete(ccFilePath),
  );
  importFlights.set(ccFilePath, promise);
  return promise;
}

async function doImportCCSession(
  deps: CCSyncDeps,
  ccFilePath: string,
  orgId?: string,
): Promise<Session> {
  await deps.ensureInitialized();
  const result = await readCCSession(ccFilePath);
  if (!result) throw new Error(`Failed to read CC session from ${ccFilePath}`);

  // Check for duplicate import
  const existing = [...deps.sessions.values()].find(
    (s) => s.metadata.ccSessionId === result.header.id,
  );
  if (existing) {
    log.info({ ccSessionId: result.header.id }, "CC session already imported");
    return existing;
  }

  const now = Date.now();
  const session: Session = {
    id: deps.generateId(),
    title: result.header.title,
    createdAt: result.header.createdAt,
    updatedAt: now,
    messages: [],
    metadata: {
      source: "claude-code",
      ccSessionId: result.header.id,
      ccSourcePath: ccFilePath,
      ccLastSyncedAt: now,
      ccLastSyncedLines: result.stats.totalCCRecords + result.stats.malformedLines,
      ...(orgId ? { orgId } : {}),
      ...result.ccMeta,
    },
  };

  deps.registerSession(session, "ready");

  const header: JournalRecord = {
    t: "header",
    v: JSONL_VERSION,
    seq: 0,
    ts: now,
    id: session.id,
    title: session.title,
    createdAt: session.createdAt,
    metadata: session.metadata,
  };
  await journalWriteRecords(deps.sessionsDir, session.id, [header, ...result.records]);

  // loadSession handles replay + version upgrades (incl. plan artifact extraction)
  const loaded = await loadSession(deps.sessionsDir, session.id);
  if (loaded) {
    deps.sessions.set(session.id, loaded.session);
    deps.seqAllocators.set(session.id, new SeqAllocator(loaded.maxSeq + 1));

    // Auto-title from first user message if no title exists
    if (!loaded.session.title) {
      const firstUserMsg = loaded.session.messages.find((m: { role: string }) => m.role === "user");
      if (firstUserMsg?.content) {
        const autoTitle = firstUserMsg.content.slice(0, 100).split("\n")[0];
        if (autoTitle && autoTitle !== "No prompt") {
          loaded.session.title = autoTitle;
          await deps.writeRecords(session.id, [
            {
              t: "meta",
              seq: 0,
              ts: now,
              patch: { title: autoTitle },
            } satisfies JournalMeta,
          ]);
        }
      }
    }
  }

  log.info(
    { sessionId: session.id, ccSessionId: result.header.id, records: result.stats.mappedRecords },
    "Imported CC session",
  );
  getEventBus().emit({
    type: "SessionChange",
    sessionId: session.id,
    action: "created",
    timestamp: now,
  });
  return loaded?.session ?? session;
}

export async function checkCCSync(
  deps: CCSyncDeps,
  sessionId: string,
): Promise<{ inSync: boolean }> {
  await deps.ensureInitialized();
  const session = deps.sessions.get(sessionId);
  if (!session) return { inSync: true };
  const ccPath = session.metadata.ccSourcePath as string | undefined;
  if (!ccPath) return { inSync: true };
  try {
    const lastSynced = session.metadata.ccLastSyncedAt as number | undefined;
    return { inSync: !!lastSynced && (await stat(ccPath)).mtimeMs <= lastSynced };
  } catch {
    return { inSync: true };
  }
}

export async function checkCCSyncBatch(
  deps: CCSyncDeps,
  sessionIds: string[],
): Promise<Record<string, boolean>> {
  await deps.ensureInitialized();
  const entries = await Promise.all(
    sessionIds.map(async (id) => [id, (await checkCCSync(deps, id)).inSync] as const),
  );
  return Object.fromEntries(entries);
}

const syncFlights = new Map<string, Promise<Session>>();

export function syncCCSession(deps: CCSyncDeps, sessionId: string): Promise<Session> {
  const existing = syncFlights.get(sessionId);
  if (existing) return existing;
  const promise = doSyncCCSession(deps, sessionId).finally(() => syncFlights.delete(sessionId));
  syncFlights.set(sessionId, promise);
  return promise;
}

async function doSyncCCSession(deps: CCSyncDeps, sessionId: string): Promise<Session> {
  await deps.ensureInitialized();
  const session = deps.sessions.get(sessionId);
  if (!session) throw new Error(`Session not found: ${sessionId}`);
  const ccPath = session.metadata.ccSourcePath as string | undefined;
  if (!ccPath) throw new Error(`Session ${sessionId} has no linked CC source`);

  // Incremental: only parse CC records beyond the last-synced count
  const lastSyncedLines = (session.metadata.ccLastSyncedLines as number) ?? 0;
  const result = await readCCSession(ccPath, lastSyncedLines);

  if (result && result.records.length > 0) {
    const now = Date.now();
    await deps.writeRecords(sessionId, result.records);
    const newLineCount =
      lastSyncedLines + result.stats.totalCCRecords + result.stats.malformedLines;
    session.metadata.ccLastSyncedAt = now;
    session.metadata.ccLastSyncedLines = newLineCount;
    await deps.writeRecords(sessionId, [
      {
        t: "meta",
        seq: 0,
        ts: now,
        patch: { ccLastSyncedAt: now, ccLastSyncedLines: newLineCount },
      } satisfies JournalMeta,
    ]);
    const loaded = await loadSession(deps.sessionsDir, sessionId);
    if (loaded) {
      deps.sessions.set(sessionId, loaded.session);
      deps.seqAllocators.set(sessionId, new SeqAllocator(loaded.maxSeq + 1));
    }
    deps.scheduleConsolidation(sessionId);
    log.info(
      { sessionId, newRecords: result.stats.mappedRecords, totalLines: newLineCount },
      "Synced CC session (incremental)",
    );
  } else {
    // No new records — just update timestamp
    const now = Date.now();
    session.metadata.ccLastSyncedAt = now;
    await deps.writeRecords(sessionId, [
      { t: "meta", seq: 0, ts: now, patch: { ccLastSyncedAt: now } } satisfies JournalMeta,
    ]);
  }

  return deps.sessions.get(sessionId) ?? session;
}
