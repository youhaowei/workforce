import { createLogger } from "tracey";
import type { Session } from "./types";
import { AppendLock, consolidateSession } from "./session-journal";

const log = createLogger("session-consolidation");

export interface SessionConsolidationDeps {
  sessionsDir: string;
  sessions: Map<string, Session>;
  deletedSessionIds: Set<string>;
  appendLock: AppendLock;
  timers: Map<string, ReturnType<typeof setTimeout>>;
  debounceMs: number;
}

export function scheduleSessionConsolidation(
  deps: SessionConsolidationDeps,
  sessionId: string,
): void {
  const existing = deps.timers.get(sessionId);
  if (existing) clearTimeout(existing);

  const timer = setTimeout(async () => {
    deps.timers.delete(sessionId);
    try {
      if (deps.deletedSessionIds.has(sessionId)) return;
      const session = deps.sessions.get(sessionId);
      if (!session) return;
      await deps.appendLock.acquire(sessionId, async () => {
        if (deps.deletedSessionIds.has(sessionId)) return;
        await consolidateSession(deps.sessionsDir, session);
      });
      log.info({ sessionId }, `Consolidated session ${sessionId}`);
    } catch (err) {
      log.error(
        { sessionId, error: err instanceof Error ? err.message : String(err) },
        `Consolidation failed for ${sessionId}`,
      );
    }
  }, deps.debounceMs);
  deps.timers.set(sessionId, timer);
}
