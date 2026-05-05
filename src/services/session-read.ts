import type {
  Session,
  SessionSearchResult,
  SessionSummary,
  Message,
  HydrationStatus,
} from "./types";
import { SeqAllocator } from "./session-journal";
import { loadSession } from "./session-upgrade";
import { createLogger } from "tracey";
import type { RehydrationManager } from "./session-rehydration";

const log = createLogger("Session");

export interface SessionReadDeps {
  sessions: Map<string, Session>;
  hydrationStatus: Map<string, HydrationStatus>;
  seqAllocators: Map<string, SeqAllocator>;
  sessionsDir: string;
  rehydrator: RehydrationManager;
  ensureInitialized: () => Promise<void>;
  scheduleConsolidation: (sessionId: string) => void;
}

export async function getSession(
  deps: SessionReadDeps,
  sessionId: string,
): Promise<Session | null> {
  await deps.ensureInitialized();
  const status = deps.hydrationStatus.get(sessionId);
  log.info({ sessionId, status }, `get(${sessionId}) status=${status}`);

  if (status === "ready") {
    const s = deps.sessions.get(sessionId) ?? null;
    log.info(
      { sessionId, msgs: s?.messages.length ?? "null" },
      `get(${sessionId}) ready -> msgs=${s?.messages.length ?? "null"}`,
    );
    return s;
  }

  const flight = deps.rehydrator.getFlight(sessionId);
  if (flight) {
    log.info({ sessionId }, `get(${sessionId}) awaiting rehydration flight`);
    await flight;
    const s = deps.sessions.get(sessionId) ?? null;
    log.info(
      { sessionId, msgs: s?.messages.length ?? "null" },
      `get(${sessionId}) flight done -> msgs=${s?.messages.length ?? "null"}`,
    );
    return s;
  }

  if (status === "failed") {
    const cached = deps.sessions.get(sessionId);
    if (cached && cached.messages.length > 0) {
      log.info(
        { sessionId, msgs: cached.messages.length },
        `get(${sessionId}) using cached from failed rehydration -> msgs=${cached.messages.length}`,
      );
      return cached;
    }
  }

  log.info(
    { sessionId, status: status ?? "unknown" },
    `get(${sessionId}) ${status ?? "unknown"}, no flight -> direct load`,
  );
  const result = await loadSession(deps.sessionsDir, sessionId);
  if (!result) {
    log.info({ sessionId }, `get(${sessionId}) load returned null`);
    return null;
  }
  const { session, maxSeq } = result;
  log.info(
    { sessionId, msgs: session.messages.length, upgraded: result.upgraded },
    `get(${sessionId}) loaded -> msgs=${session.messages.length}`,
  );
  deps.sessions.set(sessionId, session);
  deps.seqAllocators.set(sessionId, new SeqAllocator(maxSeq + 1));
  deps.hydrationStatus.set(sessionId, "ready");
  deps.scheduleConsolidation(sessionId);
  return session;
}

export async function listSessions(
  deps: SessionReadDeps,
  options?: {
    limit?: number;
    offset?: number;
    orgId?: string;
    projectId?: string;
  },
): Promise<SessionSummary[]> {
  await deps.ensureInitialized();
  let results = Array.from(deps.sessions.values());
  if (options?.orgId)
    results = results.filter(
      (s) =>
        s.metadata.orgId === options.orgId ||
        (s.metadata.source === "claude-code" && !s.metadata.orgId),
    );
  if (options?.projectId)
    results = results.filter((s) => s.metadata.projectId === options.projectId);
  const sorted = results.sort((a, b) => b.updatedAt - a.updatedAt);
  const offset = options?.offset ?? 0;
  const limit = options?.limit ?? sorted.length;
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

export async function searchSessions(
  deps: SessionReadDeps,
  query: string,
): Promise<SessionSearchResult[]> {
  await deps.ensureInitialized();
  const results: SessionSearchResult[] = [];
  const lowerQuery = query.toLowerCase();

  for (const session of deps.sessions.values()) {
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

export async function getSessionMessages(
  deps: SessionReadDeps,
  sessionId: string,
  options?: { limit?: number; offset?: number },
): Promise<Message[]> {
  log.info({ sessionId }, `getMessages(${sessionId}) called`);
  const session = await getSession(deps, sessionId);
  if (!session) throw new Error(`Session not found: ${sessionId}`);
  const offset = options?.offset ?? 0;
  const limit = options?.limit ?? session.messages.length;
  const result = session.messages.slice(offset, offset + limit);
  log.info(
    { sessionId, count: result.length },
    `getMessages(${sessionId}) -> returning ${result.length} messages`,
  );
  return result;
}
