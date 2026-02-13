/**
 * POC: Effect-based session persistence
 *
 * Same operations as session-persistence-current.ts, reimplemented with Effect
 * to evaluate error modeling, composability, and readability trade-offs.
 *
 * Key differences from current style:
 * - Every error is a tagged, typed value — callers see the full error union
 * - "not found" vs "corrupted" vs "I/O error" are distinct in the type system
 * - Recovery strategies (backup, skip, warn) are explicit combinators
 * - External API surface unchanged: wrapper functions return Promises
 */

import { readFile, writeFile, readdir, mkdir, rename, unlink } from 'fs/promises';
import { join } from 'path';
import { Effect, Data, pipe } from 'effect';
import type { Session } from '../types';

// =============================================================================
// Error types — tagged unions, exhaustively matchable
// =============================================================================

/** File does not exist on disk */
export class SessionNotFound extends Data.TaggedError('SessionNotFound')<{
  readonly sessionId: string;
  readonly path: string;
}> {}

/** JSON could not be parsed (corrupted file) */
export class SessionCorrupted extends Data.TaggedError('SessionCorrupted')<{
  readonly sessionId: string;
  readonly path: string;
  readonly cause: SyntaxError;
}> {}

/** Session file has an unrecognized version number */
export class UnknownVersion extends Data.TaggedError('UnknownVersion')<{
  readonly sessionId: string;
  readonly version: number;
  readonly session: Session;
}> {}

/** Generic filesystem I/O error */
export class DiskIOError extends Data.TaggedError('DiskIOError')<{
  readonly operation: 'read' | 'write' | 'delete' | 'readdir' | 'mkdir' | 'rename';
  readonly path: string;
  readonly cause: unknown;
}> {}

/** Backup of corrupted file failed (non-fatal) */
export class BackupFailed extends Data.TaggedError('BackupFailed')<{
  readonly originalPath: string;
  readonly cause: unknown;
}> {}

// Union of all persistence errors for type-level visibility
export type SessionPersistenceError =
  | SessionNotFound
  | SessionCorrupted
  | UnknownVersion
  | DiskIOError
  | BackupFailed;

// =============================================================================
// Configuration
// =============================================================================

const SESSION_VERSION = 1;

interface SessionFile {
  version: number;
  session: Session;
  _unknown?: Record<string, unknown>;
}

// =============================================================================
// Core Effects — typed, composable operations
// =============================================================================

/**
 * Read and parse a session file.
 *
 * Error channel: SessionNotFound | SessionCorrupted | DiskIOError
 *
 * Compare to current:
 *   try { readFile + JSON.parse } catch { if ENOENT... if SyntaxError... throw }
 *
 * With Effect, each failure mode is a separate tagged error.
 * The caller can see exactly what can go wrong from the type signature.
 */
const readSessionFile = (
  sessionsDir: string,
  sessionId: string
): Effect.Effect<SessionFile, SessionNotFound | SessionCorrupted | DiskIOError> => {
  const filePath = join(sessionsDir, `${sessionId}.json`);

  return pipe(
    // Step 1: Read raw file
    Effect.tryPromise({
      try: () => readFile(filePath, 'utf-8'),
      catch: (err) => {
        const error = err as NodeJS.ErrnoException;
        if (error.code === 'ENOENT') {
          return new SessionNotFound({ sessionId, path: filePath });
        }
        return new DiskIOError({ operation: 'read', path: filePath, cause: err });
      },
    }),
    // Step 2: Parse JSON
    Effect.flatMap((raw) =>
      Effect.try({
        try: () => JSON.parse(raw) as SessionFile,
        catch: (err) =>
          new SessionCorrupted({
            sessionId,
            path: filePath,
            cause: err as SyntaxError,
          }),
      })
    )
  );
};

/**
 * Migrate a session file to the current version.
 *
 * Error channel: UnknownVersion (non-fatal, carries best-effort session)
 *
 * Compare to current:
 *   switch(version) { case 1: ...; default: console.warn(); return session }
 *
 * With Effect, the unknown-version case is an explicit tagged error that
 * the caller can choose to recover from (catchTag) or propagate.
 */
const migrateVersion = (
  sessionId: string,
  file: SessionFile
): Effect.Effect<Session, UnknownVersion> => {
  const { version, session, ...unknown } = file;

  switch (version) {
    case 1:
      return Effect.succeed({
        ...session,
        metadata: {
          ...session.metadata,
          _preserved: Object.keys(unknown).length > 0 ? unknown : undefined,
        },
      });

    default:
      return Effect.fail(
        new UnknownVersion({ sessionId, version, session })
      );
  }
};

/**
 * Back up a corrupted session file.
 *
 * Error channel: BackupFailed (non-fatal)
 */
const backupCorruptedFile = (
  filePath: string
): Effect.Effect<string, BackupFailed> => {
  const backupPath = `${filePath}.backup.${Date.now()}`;
  return pipe(
    Effect.tryPromise({
      try: () => rename(filePath, backupPath),
      catch: (err) => new BackupFailed({ originalPath: filePath, cause: err }),
    }),
    Effect.map(() => backupPath)
  );
};

// =============================================================================
// Composed operations — the interesting part
// =============================================================================

/**
 * Load a session from disk with full error recovery pipeline.
 *
 * This is the Effect equivalent of loadSessionFromDir(). The composition
 * reads top-to-bottom as a pipeline of:
 *   read → migrate → (recover unknown version) → (recover corruption)
 *
 * Every recovery step is explicit and type-checked.
 *
 * Return type: Effect<Session | null, DiskIOError>
 *   - SessionNotFound → null (recovered)
 *   - SessionCorrupted → backup + null (recovered)
 *   - UnknownVersion → best-effort session (recovered with warning)
 *   - DiskIOError → propagated (caller must handle)
 */
export const loadSessionEffect = (
  sessionsDir: string,
  sessionId: string
): Effect.Effect<Session | null, DiskIOError> =>
  pipe(
    readSessionFile(sessionsDir, sessionId),
    Effect.flatMap((file) => migrateVersion(sessionId, file)),

    // Recover from unknown version: use best-effort session, log warning
    Effect.catchTag('UnknownVersion', (err) =>
      pipe(
        Effect.logWarning(`Unknown session version ${err.version}, attempting load`),
        Effect.map(() => err.session)
      )
    ),

    // Recover from corrupted JSON: backup the file, return null
    Effect.catchTag('SessionCorrupted', (err) =>
      pipe(
        Effect.logError(`Session ${sessionId} corrupted, creating backup`),
        Effect.flatMap(() => backupCorruptedFile(err.path)),
        // Even if backup fails, we still return null (non-fatal)
        Effect.catchTag('BackupFailed', () => Effect.void),
        Effect.map(() => null as Session | null)
      )
    ),

    // Recover from not-found: return null
    Effect.catchTag('SessionNotFound', () =>
      Effect.succeed(null as Session | null)
    )
  );

/**
 * Save a session to disk.
 *
 * Error channel: DiskIOError
 *
 * Compare to current: two raw awaits with no error context.
 * With Effect, both mkdir and writeFile failures are wrapped with context.
 */
export const saveSessionEffect = (
  sessionsDir: string,
  session: Session
): Effect.Effect<void, DiskIOError> => {
  const filePath = join(sessionsDir, `${session.id}.json`);

  const { _preserved, ...metadata } = session.metadata as {
    _preserved?: Record<string, unknown>;
    [key: string]: unknown;
  };

  const file: SessionFile = {
    version: SESSION_VERSION,
    session: { ...session, metadata },
    ...(_preserved ?? {}),
  };

  return pipe(
    Effect.tryPromise({
      try: () => mkdir(sessionsDir, { recursive: true }),
      catch: (err) => new DiskIOError({ operation: 'mkdir', path: sessionsDir, cause: err }),
    }),
    Effect.flatMap(() =>
      Effect.tryPromise({
        try: () => writeFile(filePath, JSON.stringify(file, null, 2), 'utf-8'),
        catch: (err) => new DiskIOError({ operation: 'write', path: filePath, cause: err }),
      })
    )
  );
};

/**
 * Delete a session file from disk.
 *
 * Current code silently swallows all errors. Here we surface them explicitly
 * so the caller can choose: ignore via catchAll, or handle specific cases.
 *
 * Error channel: DiskIOError
 */
export const deleteSessionEffect = (
  sessionsDir: string,
  sessionId: string
): Effect.Effect<void, DiskIOError> => {
  const filePath = join(sessionsDir, `${sessionId}.json`);
  return Effect.tryPromise({
    try: () => unlink(filePath),
    catch: (err) => new DiskIOError({ operation: 'delete', path: filePath, cause: err }),
  });
};

/**
 * Load all sessions from a directory.
 *
 * Error channel: DiskIOError (only for readdir; individual load failures recovered)
 *
 * Compare to current: nested try/catch with console.error.
 * With Effect: explicit recovery per-file, aggregate results.
 */
export const loadAllSessionsEffect = (
  sessionsDir: string
): Effect.Effect<Map<string, Session>, DiskIOError> =>
  pipe(
    // Ensure directory exists
    Effect.tryPromise({
      try: () => mkdir(sessionsDir, { recursive: true }),
      catch: (err) => new DiskIOError({ operation: 'mkdir', path: sessionsDir, cause: err }),
    }),

    // Read directory entries
    Effect.flatMap(() =>
      Effect.tryPromise({
        try: () => readdir(sessionsDir, { withFileTypes: true }),
        catch: (err) => new DiskIOError({ operation: 'readdir', path: sessionsDir, cause: err }),
      })
    ),

    // Filter to .json session files
    Effect.map((entries) =>
      entries.filter(
        (e) => e.isFile() && e.name.endsWith('.json') && !e.name.includes('.backup')
      )
    ),

    // Load each file, collecting successes into a Map
    Effect.flatMap((files) => {
      const loadEffects = files.map((file) => {
        const sessionId = file.name.replace('.json', '');
        return pipe(
          loadSessionEffect(sessionsDir, sessionId),
          Effect.map(
            (session) => [sessionId, session] as const
          )
        );
      });

      return pipe(
        Effect.all(loadEffects, { concurrency: 'unbounded' }),
        Effect.map((results) => {
          const map = new Map<string, Session>();
          for (const [id, session] of results) {
            if (session) map.set(id, session);
          }
          return map;
        })
      );
    })
  );

// =============================================================================
// Promise wrappers — keep external API unchanged
// =============================================================================

/**
 * Promise wrapper for loadSessionEffect.
 * Strips the Effect runtime — callers get the same Promise<Session | null>
 * signature as the current implementation.
 */
export async function loadSession(
  sessionsDir: string,
  sessionId: string
): Promise<Session | null> {
  return Effect.runPromise(
    pipe(
      loadSessionEffect(sessionsDir, sessionId),
      // DiskIOError is the only remaining error — surface as thrown Error
      Effect.catchTag('DiskIOError', (err) =>
        Effect.die(new Error(`Disk I/O error (${err.operation}) at ${err.path}: ${err.cause}`))
      )
    )
  );
}

export async function saveSession(
  sessionsDir: string,
  session: Session
): Promise<void> {
  return Effect.runPromise(
    pipe(
      saveSessionEffect(sessionsDir, session),
      Effect.catchTag('DiskIOError', (err) =>
        Effect.die(new Error(`Disk I/O error (${err.operation}) at ${err.path}: ${err.cause}`))
      )
    )
  );
}

export async function deleteSession(
  sessionsDir: string,
  sessionId: string
): Promise<void> {
  return Effect.runPromise(
    pipe(
      deleteSessionEffect(sessionsDir, sessionId),
      // Match current behavior: swallow delete errors
      Effect.catchAll(() => Effect.void)
    )
  );
}

export async function loadAllSessions(
  sessionsDir: string
): Promise<Map<string, Session>> {
  return Effect.runPromise(
    pipe(
      loadAllSessionsEffect(sessionsDir),
      Effect.catchTag('DiskIOError', (err) => {
        console.error('Failed to load sessions:', err.cause);
        return Effect.succeed(new Map<string, Session>());
      })
    )
  );
}

export { SESSION_VERSION };
