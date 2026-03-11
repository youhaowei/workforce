/**
 * Session Rehydration — Background full-replay + consolidation at startup.
 *
 * Bounded-concurrency workers replay cold sessions from JSONL,
 * then consolidate the file so the header is current for future restarts.
 */

import type { Session, HydrationStatus } from './types';
import { getEventBus } from '@/shared/event-bus';
import { createLogger } from 'tracey';
import { replaySession, consolidateSession, AppendLock } from './session-journal';

const log = createLogger('Session');

/** Max concurrent background rehydration workers at startup. */
const REHYDRATION_CONCURRENCY = 3;
/** Max retry attempts for a failed rehydration (0 = no retry). */
const REHYDRATION_MAX_RETRIES = 1;
/** Delay (ms) before retrying a failed rehydration. */
const REHYDRATION_RETRY_DELAY_MS = 5_000;

export interface RehydrationDeps {
  readonly sessions: Map<string, Session>;
  readonly hydrationStatus: Map<string, HydrationStatus>;
  readonly deletedSessionIds: Set<string>;
  readonly appendLock: AppendLock;
  readonly sessionsDir: string;
  isDisposed(): boolean;
}

/**
 * Manages background rehydration of cold sessions.
 *
 * State machine per session: cold → rehydrating → consolidating → ready | failed
 */
export class RehydrationManager {
  private hydrationFlights = new Map<string, Promise<void>>();
  private queue: string[] = [];
  private concurrency = { active: 0, max: REHYDRATION_CONCURRENCY };

  constructor(private deps: RehydrationDeps) {}

  /** Fill the queue with all cold sessions and start draining. */
  enqueue(): void {
    for (const [id, status] of this.deps.hydrationStatus) {
      if (status === 'cold') this.queue.push(id);
    }
    log.info({ count: this.queue.length }, `Rehydration: enqueued ${this.queue.length} cold sessions`);
    this.drain();
  }

  /** Await (or trigger) full rehydration for a specific session. Singleflight. */
  async rehydrate(sessionId: string): Promise<void> {
    return this.rehydrateAndConsolidate(sessionId);
  }

  /** Return the in-flight promise for a session, if any. */
  getFlight(sessionId: string): Promise<void> | undefined {
    return this.hydrationFlights.get(sessionId);
  }

  /** Clear all flights and drain state. Called by dispose(). */
  clear(): void {
    this.hydrationFlights.clear();
    this.queue.length = 0;
    this.concurrency.active = 0;
  }

  // ─── Internal ──────────────────────────────────────────────────────

  /** Cooperative semaphore drain: start workers up to the concurrency limit. */
  private drain(): void {
    while (
      !this.deps.isDisposed() &&
      this.queue.length > 0 &&
      this.concurrency.active < this.concurrency.max
    ) {
      const sessionId = this.queue.shift()!;
      if (this.deps.hydrationStatus.get(sessionId) !== 'cold') continue;

      this.concurrency.active++;
      this.rehydrateAndConsolidate(sessionId).finally(() => {
        this.concurrency.active--;
        this.drain();
      });
    }
  }

  /**
   * Full replay + consolidation for a single session.
   * Concurrent calls for the same session share the same in-flight promise.
   * The flight promise stays alive through retries so concurrent get() calls
   * always coalesce rather than spawning independent replays.
   */
  private rehydrateAndConsolidate(sessionId: string): Promise<void> {
    const existing = this.hydrationFlights.get(sessionId);
    if (existing) return existing;

    const { sessions, hydrationStatus, deletedSessionIds, appendLock, sessionsDir } = this.deps;
    const bus = getEventBus();

    const work = (async () => {
      for (let attempt = 0; attempt <= REHYDRATION_MAX_RETRIES; attempt++) {
        if (this.deps.isDisposed() || deletedSessionIds.has(sessionId)) return;

        try {
          hydrationStatus.set(sessionId, 'rehydrating');
          bus.emit({ type: 'SessionRehydrateStarted', sessionId, timestamp: Date.now() });

          const session = await replaySession(sessionsDir, sessionId);

          if (deletedSessionIds.has(sessionId)) return;
          if (!session) {
            hydrationStatus.set(sessionId, 'failed');
            bus.emit({ type: 'SessionRehydrateFailed', sessionId, error: 'Session file not found', timestamp: Date.now() });
            return;
          }
          sessions.set(sessionId, session);

          hydrationStatus.set(sessionId, 'consolidating');
          bus.emit({ type: 'SessionConsolidationStarted', sessionId, timestamp: Date.now() });

          await appendLock.acquire(sessionId, async () => {
            if (deletedSessionIds.has(sessionId)) return;
            await consolidateSession(sessionsDir, session);
          });

          if (deletedSessionIds.has(sessionId)) {
            sessions.delete(sessionId);
            hydrationStatus.delete(sessionId);
            return;
          }

          hydrationStatus.set(sessionId, 'ready');
          bus.emit({ type: 'SessionRehydrateDone', sessionId, timestamp: Date.now() });
          log.info({ sessionId }, `Rehydrated session ${sessionId}`);
          return;
        } catch (err) {
          log.error({ sessionId, attempt: attempt + 1, error: err instanceof Error ? err.message : String(err) }, `Rehydration failed for ${sessionId} (attempt ${attempt + 1})`);

          if (attempt < REHYDRATION_MAX_RETRIES) {
            hydrationStatus.set(sessionId, 'cold');
            await new Promise((resolve) => setTimeout(resolve, REHYDRATION_RETRY_DELAY_MS));
            continue;
          }

          hydrationStatus.set(sessionId, 'failed');
          bus.emit({
            type: 'SessionRehydrateFailed', sessionId,
            error: err instanceof Error ? err.message : String(err),
            timestamp: Date.now(),
          });
        }
      }
    })();

    this.hydrationFlights.set(sessionId, work.finally(() => {
      this.hydrationFlights.delete(sessionId);
    }));
    return work;
  }
}
