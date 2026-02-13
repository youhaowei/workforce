/**
 * POC: Current async/await + try/catch session persistence
 *
 * Extracted from src/services/session.ts to serve as the "before" baseline
 * for the Effect POC comparison. External API surface is identical.
 */

import { readFile, writeFile, readdir, mkdir, rename, unlink } from 'fs/promises';
import { join } from 'path';
import type { Session } from '../types';

// =============================================================================
// Types
// =============================================================================

const SESSION_VERSION = 1;

interface SessionFile {
  version: number;
  session: Session;
  _unknown?: Record<string, unknown>;
}

// =============================================================================
// Error paths in current style:
//
// 1. loadSession  → ENOENT (file not found)        → returns null
// 2. loadSession  → SyntaxError (corrupted JSON)    → backs up, returns null
// 3. loadSession  → unknown version                 → warn + best-effort load
// 4. loadSession  → other I/O error                 → throws
// 5. saveSession  → mkdir/write failure             → throws
// 6. deleteSession → unlink failure                 → silently swallowed
// 7. loadAll      → readdir failure                 → logged, continues
// 8. loadAll      → individual file failure         → skipped
//
// Problems:
//  - null conflates "not found" with "corrupted" (caller can't distinguish)
//  - thrown errors lack domain context (raw ErrnoException)
//  - silent catch in delete hides real problems
//  - ensureInitialized swallows readdir errors
// =============================================================================

/**
 * Load a session from disk with version migration and corruption recovery.
 */
export async function loadSession(
  sessionsDir: string,
  sessionId: string
): Promise<Session | null> {
  const filePath = join(sessionsDir, `${sessionId}.json`);

  try {
    const raw = await readFile(filePath, 'utf-8');
    const parsed = JSON.parse(raw) as SessionFile;
    const { version, session, ...unknown } = parsed;

    switch (version) {
      case 1:
        return {
          ...session,
          metadata: {
            ...session.metadata,
            _preserved: Object.keys(unknown).length > 0 ? unknown : undefined,
          },
        };

      default:
        console.warn(`Unknown session version ${version}, attempting load`);
        return session;
    }
  } catch (err) {
    const error = err as NodeJS.ErrnoException;

    if (error.code === 'ENOENT') {
      return null;
    }

    if (err instanceof SyntaxError) {
      console.error(`Session ${sessionId} corrupted, creating backup`);
      try {
        const backupPath = `${filePath}.backup.${Date.now()}`;
        await rename(filePath, backupPath);
      } catch {
        // Ignore backup errors
      }
      return null;
    }

    throw error;
  }
}

/**
 * Save a session to disk with versioning.
 */
export async function saveSession(sessionsDir: string, session: Session): Promise<void> {
  await mkdir(sessionsDir, { recursive: true });

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

  await writeFile(filePath, JSON.stringify(file, null, 2), 'utf-8');
}

/**
 * Delete a session file from disk.
 */
export async function deleteSession(sessionsDir: string, sessionId: string): Promise<void> {
  try {
    await unlink(join(sessionsDir, `${sessionId}.json`));
  } catch {
    // Ignore file deletion errors — current behavior
  }
}

/**
 * Load all sessions from a directory.
 * Skips corrupted/unreadable files.
 */
export async function loadAllSessions(sessionsDir: string): Promise<Map<string, Session>> {
  const sessions = new Map<string, Session>();

  try {
    await mkdir(sessionsDir, { recursive: true });

    const entries = await readdir(sessionsDir, { withFileTypes: true });
    const sessionFiles = entries.filter(
      (e) => e.isFile() && e.name.endsWith('.json') && !e.name.includes('.backup')
    );

    for (const file of sessionFiles) {
      const sessionId = file.name.replace('.json', '');
      const session = await loadSession(sessionsDir, sessionId);
      if (session) {
        sessions.set(sessionId, session);
      }
    }
  } catch (err) {
    const error = err as NodeJS.ErrnoException;
    if (error.code !== 'ENOENT') {
      console.error('Failed to load sessions:', error);
    }
  }

  return sessions;
}

export { SESSION_VERSION };
