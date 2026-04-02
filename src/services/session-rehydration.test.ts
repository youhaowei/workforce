import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Session, HydrationStatus } from './types';
import type { RehydrationDeps } from './session-rehydration';
import { RehydrationManager } from './session-rehydration';
import { AppendLock, SeqAllocator } from './session-journal';
import { getEventBus } from '@/shared/event-bus';

vi.mock('./session-journal', async (importOriginal) => {
  const orig = await importOriginal<typeof import('./session-journal')>();
  return {
    ...orig,
    replaySession: vi.fn(),
    consolidateSession: vi.fn(),
  };
});

import { replaySession, consolidateSession } from './session-journal';

const mockReplay = vi.mocked(replaySession);
const mockConsolidate = vi.mocked(consolidateSession);

function makeSession(id: string): Session {
  return { id, createdAt: 1000, updatedAt: 1000, messages: [], metadata: {} };
}

function makeReplayResult(session: Session) {
  return { session, maxSeq: 0 };
}

function makeDeps(coldIds: string[] = []): RehydrationDeps {
  const sessions = new Map<string, Session>();
  const hydrationStatus = new Map<string, HydrationStatus>();
  for (const id of coldIds) {
    hydrationStatus.set(id, 'cold');
  }
  return {
    sessions,
    hydrationStatus,
    deletedSessionIds: new Set(),
    appendLock: new AppendLock(),
    seqAllocators: new Map<string, SeqAllocator>(),
    sessionsDir: '/tmp/test-sessions',
    isDisposed: () => false,
  };
}

describe('RehydrationManager', () => {
  let bus: ReturnType<typeof getEventBus>;

  beforeEach(() => {
    vi.clearAllMocks();
    bus = getEventBus();
    mockConsolidate.mockResolvedValue(undefined);
  });

  afterEach(() => {
    bus.dispose();
  });

  describe('rehydrate (single session)', () => {
    it('replays and consolidates a cold session', async () => {
      const deps = makeDeps(['s1']);
      const session = makeSession('s1');
      mockReplay.mockResolvedValueOnce(makeReplayResult(session));

      const mgr = new RehydrationManager(deps);
      await mgr.rehydrate('s1');

      expect(deps.sessions.get('s1')).toBe(session);
      expect(deps.hydrationStatus.get('s1')).toBe('ready');
      expect(mockReplay).toHaveBeenCalledWith('/tmp/test-sessions', 's1');
      expect(mockConsolidate).toHaveBeenCalled();
    });

    it('emits lifecycle events', async () => {
      const deps = makeDeps(['s1']);
      mockReplay.mockResolvedValueOnce(makeReplayResult(makeSession('s1')));

      const events: string[] = [];
      bus.on('SessionRehydrateStarted', () => events.push('started'));
      bus.on('SessionConsolidationStarted', () => events.push('consolidating'));
      bus.on('SessionRehydrateDone', () => events.push('done'));

      const mgr = new RehydrationManager(deps);
      await mgr.rehydrate('s1');

      expect(events).toEqual(['started', 'consolidating', 'done']);
    });

    it('sets status to failed when replay returns null', async () => {
      const deps = makeDeps(['s1']);
      mockReplay.mockResolvedValueOnce(null);

      const events: string[] = [];
      bus.on('SessionRehydrateFailed', () => events.push('failed'));

      const mgr = new RehydrationManager(deps);
      await mgr.rehydrate('s1');

      expect(deps.hydrationStatus.get('s1')).toBe('failed');
      expect(events).toEqual(['failed']);
    });

    it('singleflight: concurrent calls share the same promise', async () => {
      const deps = makeDeps(['s1']);
      let resolveReplay!: (v: ReturnType<typeof makeReplayResult>) => void;
      mockReplay.mockImplementationOnce(() => new Promise((r) => { resolveReplay = r; }));

      const mgr = new RehydrationManager(deps);
      const p1 = mgr.rehydrate('s1');
      const p2 = mgr.rehydrate('s1');

      // Both should get the same flight
      expect(mgr.getFlight('s1')).toBeDefined();

      resolveReplay(makeReplayResult(makeSession('s1')));
      await Promise.all([p1, p2]);

      // Only one replay call
      expect(mockReplay).toHaveBeenCalledOnce();
    });

    it('clears flight after completion', async () => {
      const deps = makeDeps(['s1']);
      mockReplay.mockResolvedValueOnce(makeReplayResult(makeSession('s1')));

      const mgr = new RehydrationManager(deps);
      await mgr.rehydrate('s1');

      expect(mgr.getFlight('s1')).toBeUndefined();
    });
  });

  describe('enqueue (batch drain)', () => {
    it('drains all cold sessions', async () => {
      const deps = makeDeps(['s1', 's2']);
      mockReplay.mockImplementation(async (_dir, id) => makeReplayResult(makeSession(id as string)));

      const mgr = new RehydrationManager(deps);
      mgr.enqueue();

      // Wait for drain to complete
      await Promise.all([mgr.getFlight('s1'), mgr.getFlight('s2')].filter(Boolean));

      expect(deps.hydrationStatus.get('s1')).toBe('ready');
      expect(deps.hydrationStatus.get('s2')).toBe('ready');
    });

    it('respects concurrency limit', async () => {
      // Create 5 sessions but concurrency is 3
      const ids = ['s1', 's2', 's3', 's4', 's5'];
      const deps = makeDeps(ids);

      let peakConcurrency = 0;
      let currentConcurrency = 0;
      // Deterministic gates — each replay blocks until its gate is opened
      const gates = new Map<string, () => void>();

      mockReplay.mockImplementation(async (_dir, id) => {
        currentConcurrency++;
        peakConcurrency = Math.max(peakConcurrency, currentConcurrency);
        // Block until gate is opened
        await new Promise<void>((r) => { gates.set(id as string, r); });
        currentConcurrency--;
        return makeReplayResult(makeSession(id as string));
      });

      const mgr = new RehydrationManager(deps);
      mgr.enqueue();

      // Wait for the first batch to start (concurrency = 3)
      await vi.waitFor(() => expect(gates.size).toBe(3));
      expect(peakConcurrency).toBe(3);
      expect(currentConcurrency).toBe(3);

      // Release first 3 — should trigger next 2
      for (const [, resolve] of gates) resolve();
      gates.clear();

      await vi.waitFor(() => expect(gates.size).toBe(2));
      // Peak should still be 3 (never exceeded)
      expect(peakConcurrency).toBe(3);

      // Release remaining
      for (const [, resolve] of gates) resolve();

      // Wait for all flights to finish
      for (const id of ids) {
        const flight = mgr.getFlight(id);
        if (flight) await flight;
      }

      expect(peakConcurrency).toBeLessThanOrEqual(3);
      for (const id of ids) {
        expect(deps.hydrationStatus.get(id)).toBe('ready');
      }
    });

    it('skips non-cold sessions', async () => {
      const deps = makeDeps(['s1']);
      // Mark s1 as already rehydrating before enqueue
      deps.hydrationStatus.set('s1', 'rehydrating');

      const mgr = new RehydrationManager(deps);
      mgr.enqueue();

      // No replay should be called
      expect(mockReplay).not.toHaveBeenCalled();
    });
  });

  describe('deleted session handling', () => {
    it('skips replay if session is deleted', async () => {
      const deps = makeDeps(['s1']);
      deps.deletedSessionIds.add('s1');

      const mgr = new RehydrationManager(deps);
      await mgr.rehydrate('s1');

      expect(mockReplay).not.toHaveBeenCalled();
    });
  });

  describe('disposed service handling', () => {
    it('stops drain when service is disposed', async () => {
      let disposed = false;
      const deps = makeDeps(['s1', 's2']);
      deps.isDisposed = () => disposed;

      mockReplay.mockImplementation(async (_dir, id) => {
        disposed = true; // Dispose after first replay
        return makeReplayResult(makeSession(id as string));
      });

      const mgr = new RehydrationManager(deps);
      mgr.enqueue();

      await new Promise((r) => setTimeout(r, 50));

      // Only one session should have been replayed
      expect(mockReplay).toHaveBeenCalledOnce();
    });
  });

  describe('clear', () => {
    it('resets all internal state', () => {
      const deps = makeDeps(['s1']);
      const mgr = new RehydrationManager(deps);
      mgr.clear();

      expect(mgr.getFlight('s1')).toBeUndefined();
    });
  });
});
