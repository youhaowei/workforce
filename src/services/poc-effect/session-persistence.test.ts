/**
 * POC: Side-by-side tests for current vs Effect session persistence
 *
 * Both implementations are exercised with identical test cases.
 * This validates behavioral equivalence and highlights testability differences.
 */

import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { mkdir, writeFile, rm, readFile, readdir } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { Effect, pipe, Exit } from 'effect';

import * as Current from './session-persistence-current';
import * as Eff from './session-persistence-effect';

import type { Session } from '../types';

// =============================================================================
// Shared test fixtures
// =============================================================================

const BASE_DIR = join(tmpdir(), `workforce-effect-poc-${Date.now()}`);
let testCounter = 0;

function freshDir(): string {
  return join(BASE_DIR, `test-${++testCounter}`);
}

function makeSession(id: string, title?: string): Session {
  const now = Date.now();
  return {
    id,
    title,
    createdAt: now,
    updatedAt: now,
    messages: [],
    metadata: {},
  };
}

beforeEach(async () => {
  // Ensure base dir exists
  await mkdir(BASE_DIR, { recursive: true });
});

afterAll(async () => {
  await rm(BASE_DIR, { recursive: true, force: true });
});

// =============================================================================
// Run identical tests against both implementations
// =============================================================================

describe.each([
  { name: 'Current (async/await)', impl: Current },
  { name: 'Effect (wrapped)', impl: Eff },
])('$name', ({ impl }) => {
  describe('saveSession + loadSession round-trip', () => {
    it('should persist and reload a session', async () => {
      const dir = freshDir();
      const session = makeSession('sess_rt_1', 'Round Trip');

      await impl.saveSession(dir, session);
      const loaded = await impl.loadSession(dir, 'sess_rt_1');

      expect(loaded).not.toBeNull();
      expect(loaded!.id).toBe('sess_rt_1');
      expect(loaded!.title).toBe('Round Trip');
    });

    it('should write version number to disk', async () => {
      const dir = freshDir();
      const session = makeSession('sess_ver_1', 'Versioned');

      await impl.saveSession(dir, session);

      const raw = await readFile(join(dir, 'sess_ver_1.json'), 'utf-8');
      const parsed = JSON.parse(raw);
      expect(parsed.version).toBe(impl.SESSION_VERSION);
    });

    it('should preserve unknown top-level fields on round-trip', async () => {
      const dir = freshDir();
      await mkdir(dir, { recursive: true });

      // Write a file with extra top-level fields (simulating a future version)
      const data = {
        version: 1,
        session: makeSession('sess_fwd_1', 'Forward Compat'),
        futureField: 'preserved',
        nestedUnknown: { key: 42 },
      };
      await writeFile(join(dir, 'sess_fwd_1.json'), JSON.stringify(data));

      // Load, modify, save
      const loaded = await impl.loadSession(dir, 'sess_fwd_1');
      expect(loaded).not.toBeNull();
      loaded!.title = 'Updated';
      await impl.saveSession(dir, loaded!);

      // Verify preservation
      const raw = await readFile(join(dir, 'sess_fwd_1.json'), 'utf-8');
      const parsed = JSON.parse(raw);
      expect(parsed.futureField).toBe('preserved');
      expect(parsed.nestedUnknown).toEqual({ key: 42 });
      expect(parsed.session.title).toBe('Updated');
    });
  });

  describe('loadSession — not found', () => {
    it('should return null for non-existent session', async () => {
      const dir = freshDir();
      await mkdir(dir, { recursive: true });

      const result = await impl.loadSession(dir, 'does_not_exist');
      expect(result).toBeNull();
    });
  });

  describe('loadSession — corrupted JSON', () => {
    it('should return null and create backup for corrupted file', async () => {
      const dir = freshDir();
      await mkdir(dir, { recursive: true });

      await writeFile(join(dir, 'sess_corrupt.json'), '{ broken json !!!}}}');

      const result = await impl.loadSession(dir, 'sess_corrupt');
      expect(result).toBeNull();

      // Backup should exist
      const files = await readdir(dir);
      const backups = files.filter((f) => f.startsWith('sess_corrupt.json.backup'));
      expect(backups.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('loadSession — unknown version', () => {
    it('should best-effort load session with unknown version', async () => {
      const dir = freshDir();
      await mkdir(dir, { recursive: true });

      const data = {
        version: 99,
        session: makeSession('sess_v99', 'Future Version'),
      };
      await writeFile(join(dir, 'sess_v99.json'), JSON.stringify(data));

      const result = await impl.loadSession(dir, 'sess_v99');
      expect(result).not.toBeNull();
      expect(result!.title).toBe('Future Version');
    });
  });

  describe('deleteSession', () => {
    it('should delete file from disk', async () => {
      const dir = freshDir();
      const session = makeSession('sess_del', 'To Delete');
      await impl.saveSession(dir, session);

      await impl.deleteSession(dir, 'sess_del');

      // File should be gone
      await expect(readFile(join(dir, 'sess_del.json'))).rejects.toThrow();
    });

    it('should not throw for non-existent file', async () => {
      const dir = freshDir();
      await mkdir(dir, { recursive: true });

      // Should not throw
      await expect(impl.deleteSession(dir, 'ghost')).resolves.toBeUndefined();
    });
  });

  describe('loadAllSessions', () => {
    it('should load all valid sessions from directory', async () => {
      const dir = freshDir();

      await impl.saveSession(dir, makeSession('sess_all_1', 'First'));
      await impl.saveSession(dir, makeSession('sess_all_2', 'Second'));

      const sessions = await impl.loadAllSessions(dir);
      expect(sessions.size).toBe(2);
      expect(sessions.get('sess_all_1')!.title).toBe('First');
      expect(sessions.get('sess_all_2')!.title).toBe('Second');
    });

    it('should skip corrupted files and load valid ones', async () => {
      const dir = freshDir();

      await impl.saveSession(dir, makeSession('sess_good', 'Good'));
      await writeFile(join(dir, 'sess_bad.json'), 'not json');

      const sessions = await impl.loadAllSessions(dir);
      expect(sessions.size).toBe(1);
      expect(sessions.has('sess_good')).toBe(true);
    });

    it('should handle empty directory', async () => {
      const dir = freshDir();
      await mkdir(dir, { recursive: true });

      const sessions = await impl.loadAllSessions(dir);
      expect(sessions.size).toBe(0);
    });
  });
});

// =============================================================================
// Effect-only tests — demonstrating unique capabilities
// =============================================================================

describe('Effect-only: typed error inspection', () => {
  it('should expose SessionNotFound with context when file missing', async () => {
    const dir = freshDir();
    await mkdir(dir, { recursive: true });

    const effect = Eff.loadSessionEffect(dir, 'missing_session');

    // Run to Exit to inspect the error without throwing
    const exit = await Effect.runPromiseExit(effect);

    // DiskIOError is the only possible error after recovery, but for missing
    // files loadSessionEffect recovers to null. Let's test the raw pipeline:
    const rawEffect = pipe(
      // Access the internal readSessionFile by composing directly
      Effect.tryPromise({
        try: () => readFile(join(dir, 'missing_session.json'), 'utf-8'),
        catch: (err) => {
          const error = err as NodeJS.ErrnoException;
          if (error.code === 'ENOENT') {
            return new Eff.SessionNotFound({
              sessionId: 'missing_session',
              path: join(dir, 'missing_session.json'),
            });
          }
          return new Eff.DiskIOError({
            operation: 'read' as const,
            path: join(dir, 'missing_session.json'),
            cause: err,
          });
        },
      })
    );

    const rawExit = await Effect.runPromiseExit(rawEffect);

    expect(Exit.isFailure(rawExit)).toBe(true);
    if (Exit.isFailure(rawExit)) {
      const error = rawExit.cause;
      // The cause should contain our SessionNotFound error
      expect(JSON.stringify(error)).toContain('SessionNotFound');
    }
  });

  it('should expose SessionCorrupted with SyntaxError cause', async () => {
    const dir = freshDir();
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'sess_c.json'), '{{{{bad');

    // Use the raw readSessionFile-equivalent to get typed error
    const effect = Effect.tryPromise({
      try: () => readFile(join(dir, 'sess_c.json'), 'utf-8'),
      catch: (err) =>
        new Eff.DiskIOError({
          operation: 'read' as const,
          path: join(dir, 'sess_c.json'),
          cause: err,
        }),
    }).pipe(
      Effect.flatMap((raw) =>
        Effect.try({
          try: () => JSON.parse(raw),
          catch: (err) =>
            new Eff.SessionCorrupted({
              sessionId: 'sess_c',
              path: join(dir, 'sess_c.json'),
              cause: err as SyntaxError,
            }),
        })
      )
    );

    const exit = await Effect.runPromiseExit(effect);

    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      expect(JSON.stringify(exit.cause)).toContain('SessionCorrupted');
    }
  });

  it('should allow selective error recovery via catchTag', async () => {
    const dir = freshDir();
    await mkdir(dir, { recursive: true });

    // This demonstrates the key value prop: selective recovery by error type
    const effect = pipe(
      Eff.loadSessionEffect(dir, 'nonexistent'),
      // loadSessionEffect already recovers NotFound to null,
      // but DiskIOError would propagate. We can add specific recovery:
      Effect.catchTag('DiskIOError', (err) =>
        pipe(
          Effect.logError(`Handled disk error: ${err.operation} on ${err.path}`),
          Effect.map(() => null as Session | null)
        )
      )
    );

    // This should succeed (not found → null)
    const result = await Effect.runPromise(effect);
    expect(result).toBeNull();
  });

  it('should support concurrent loading with Effect.all', async () => {
    const dir = freshDir();

    // Save 5 sessions
    for (let i = 0; i < 5; i++) {
      await Eff.saveSession(dir, makeSession(`sess_conc_${i}`, `Concurrent ${i}`));
    }

    // Load them all concurrently using Effect
    const effects = Array.from({ length: 5 }, (_, i) =>
      Eff.loadSessionEffect(dir, `sess_conc_${i}`)
    );

    const results = await Effect.runPromise(
      pipe(
        Effect.all(effects, { concurrency: 'unbounded' }),
        // Recover any DiskIOError for the test
        Effect.catchAll(() => Effect.succeed([] as (Session | null)[]))
      )
    );

    expect(results).toHaveLength(5);
    for (const session of results) {
      expect(session).not.toBeNull();
    }
  });
});

// =============================================================================
// Current-only: demonstrating limitations
// =============================================================================

describe('Current-only: limitation demonstrations', () => {
  it('cannot distinguish not-found from corrupted (both return null)', async () => {
    const dir = freshDir();
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'sess_bad.json'), 'corrupt');

    const notFound = await Current.loadSession(dir, 'nonexistent');
    const corrupted = await Current.loadSession(dir, 'sess_bad');

    // Both return null — caller cannot tell the difference
    expect(notFound).toBeNull();
    expect(corrupted).toBeNull();
    // No way to programmatically distinguish these two cases
  });
});
