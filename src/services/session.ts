/**
 * SessionService - Session persistence and management
 *
 * Provides:
 * - Session CRUD operations with disk persistence
 * - Resume and fork functionality
 * - Full-text search across sessions
 * - Versioned file format with forward compatibility
 * - Corruption recovery with backups
 */

import { readFile, writeFile, readdir, mkdir, rename, unlink } from 'fs/promises';
import { join } from 'path';
import type {
  SessionService,
  Session,
  SessionSearchResult,
  Message,
  WorkAgentConfig,
  LifecycleState,
  SessionLifecycle,
} from './types';
import { VALID_TRANSITIONS } from './types';
import { getEventBus } from '@/shared/event-bus';
import { getDataDir } from './data-dir';

// =============================================================================
// Configuration
// =============================================================================

const SESSIONS_DIR = join(getDataDir(), 'sessions');
const SESSION_VERSION = 1;

// =============================================================================
// Types
// =============================================================================

interface SessionFile {
  version: number;
  session: Session;
  _unknown?: Record<string, unknown>;
}

// =============================================================================
// Helpers
// =============================================================================

function generateId(): string {
  return `sess_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Load a session from disk with version migration and corruption recovery.
 * @param sessionsDir - Directory containing session files
 * @param sessionId - Session ID to load
 */
async function loadSessionFromDir(
  sessionsDir: string,
  sessionId: string
): Promise<Session | null> {
  const filePath = join(sessionsDir, `${sessionId}.json`);

  try {
    const raw = await readFile(filePath, 'utf-8');
    const parsed = JSON.parse(raw) as SessionFile;
    const { version, session, ...unknown } = parsed;

    // Version migration
    switch (version) {
      case 1:
        // Current version - no migration needed
        return {
          ...session,
          // Preserve unknown fields for forward compatibility
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
      // Corrupted JSON - try to backup and recover
      console.error(`Session ${sessionId} corrupted, creating backup`);
      try {
        const backupPath = `${filePath}.backup.${Date.now()}`;
        await rename(filePath, backupPath);
        console.log(`Backup created at ${backupPath}`);
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
 * @param sessionsDir - Directory to save session files
 * @param session - Session to save
 */
async function saveSessionToDir(sessionsDir: string, session: Session): Promise<void> {
  await mkdir(sessionsDir, { recursive: true });

  const filePath = join(sessionsDir, `${session.id}.json`);

  // Extract preserved unknown fields
  const { _preserved, ...metadata } = session.metadata as {
    _preserved?: Record<string, unknown>;
    [key: string]: unknown;
  };

  const file: SessionFile = {
    version: SESSION_VERSION,
    session: {
      ...session,
      metadata,
    },
    ...(_preserved ?? {}),
  };

  await writeFile(filePath, JSON.stringify(file, null, 2), 'utf-8');
}

// =============================================================================
// Service Implementation
// =============================================================================

class SessionServiceImpl implements SessionService {
  private sessions = new Map<string, Session>();
  private currentSession: Session | null = null;
  private sessionsDir: string;
  private initialized = false;

  constructor(sessionsDir?: string) {
    this.sessionsDir = sessionsDir ?? SESSIONS_DIR;
  }

  /**
   * Initialize by loading session index from disk.
   */
  private async ensureInitialized(): Promise<void> {
    if (this.initialized) return;

    try {
      await mkdir(this.sessionsDir, { recursive: true });

      const entries = await readdir(this.sessionsDir, { withFileTypes: true });
      const sessionFiles = entries.filter(
        (e) => e.isFile() && e.name.endsWith('.json') && !e.name.includes('.backup')
      );

      for (const file of sessionFiles) {
        const sessionId = file.name.replace('.json', '');
        const session = await loadSessionFromDir(this.sessionsDir, sessionId);
        if (session) {
          this.sessions.set(sessionId, session);
        }
      }
    } catch (err) {
      const error = err as NodeJS.ErrnoException;
      if (error.code !== 'ENOENT') {
        console.error('Failed to initialize sessions:', error);
      }
    }

    this.initialized = true;
  }

  async create(title?: string): Promise<Session> {
    await this.ensureInitialized();

    const now = Date.now();
    const session: Session = {
      id: generateId(),
      title,
      createdAt: now,
      updatedAt: now,
      messages: [],
      metadata: {},
    };

    this.sessions.set(session.id, session);
    await saveSessionToDir(this.sessionsDir, session);

    getEventBus().emit({
      type: 'SessionChange',
      sessionId: session.id,
      action: 'created',
      timestamp: now,
    });

    return session;
  }

  async get(sessionId: string): Promise<Session | null> {
    await this.ensureInitialized();

    // Check cache first
    if (this.sessions.has(sessionId)) {
      return this.sessions.get(sessionId)!;
    }

    // Try loading from disk
    const session = await loadSessionFromDir(this.sessionsDir, sessionId);
    if (session) {
      this.sessions.set(sessionId, session);
    }

    return session;
  }

  async save(session: Session): Promise<void> {
    await this.ensureInitialized();

    session.updatedAt = Date.now();
    this.sessions.set(session.id, session);
    await saveSessionToDir(this.sessionsDir, session);
  }

  async resume(sessionId: string): Promise<Session> {
    const session = await this.get(sessionId);
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`);
    }

    this.currentSession = session;

    getEventBus().emit({
      type: 'SessionChange',
      sessionId: session.id,
      action: 'resumed',
      timestamp: Date.now(),
    });

    return session;
  }

  async fork(sessionId: string): Promise<Session> {
    const parent = await this.get(sessionId);
    if (!parent) {
      throw new Error(`Session not found: ${sessionId}`);
    }

    const now = Date.now();
    const forked: Session = {
      id: generateId(),
      title: parent.title ? `${parent.title} (fork)` : undefined,
      createdAt: now,
      updatedAt: now,
      parentId: parent.id,
      messages: [...parent.messages],
      metadata: { ...parent.metadata },
    };

    this.sessions.set(forked.id, forked);
    await saveSessionToDir(this.sessionsDir, forked);

    getEventBus().emit({
      type: 'SessionChange',
      sessionId: forked.id,
      action: 'created',
      timestamp: now,
    });

    return forked;
  }

  async list(options?: { limit?: number; offset?: number }): Promise<Session[]> {
    await this.ensureInitialized();

    const all = Array.from(this.sessions.values());
    const sorted = all.sort((a, b) => b.updatedAt - a.updatedAt);

    const offset = options?.offset ?? 0;
    const limit = options?.limit ?? sorted.length;

    return sorted.slice(offset, offset + limit);
  }

  async search(query: string): Promise<SessionSearchResult[]> {
    await this.ensureInitialized();

    const results: SessionSearchResult[] = [];
    const lowerQuery = query.toLowerCase();

    for (const session of this.sessions.values()) {
      // Search in title
      if (session.title?.toLowerCase().includes(lowerQuery)) {
        results.push({
          session,
          matchedText: session.title,
          score: 2.0, // Higher score for title matches
        });
        continue;
      }

      // Search in messages
      for (const message of session.messages) {
        const content = message.content.toLowerCase();
        const index = content.indexOf(lowerQuery);

        if (index !== -1) {
          const start = Math.max(0, index - 30);
          const end = Math.min(content.length, index + query.length + 30);
          const matchedText = message.content.slice(start, end);

          results.push({
            session,
            matchedText,
            score: 1.0,
          });
          break;
        }
      }
    }

    return results.sort((a, b) => b.score - a.score);
  }

  async delete(sessionId: string): Promise<void> {
    await this.ensureInitialized();

    const session = this.sessions.get(sessionId);
    if (session) {
      this.sessions.delete(sessionId);

      if (this.currentSession?.id === sessionId) {
        this.currentSession = null;
      }

      // Delete file from disk
      try {
        await unlink(join(this.sessionsDir, `${sessionId}.json`));
      } catch {
        // Ignore file deletion errors
      }

      getEventBus().emit({
        type: 'SessionChange',
        sessionId,
        action: 'terminated',
        timestamp: Date.now(),
      });
    }
  }

  /**
   * Add a message to a session.
   */
  async addMessage(sessionId: string, message: Message): Promise<void> {
    const session = await this.get(sessionId);
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`);
    }

    session.messages.push(message);
    await this.save(session);
  }

  getCurrent(): Session | null {
    return this.currentSession;
  }

  setCurrent(session: Session | null): void {
    this.currentSession = session;
  }

  async createWorkAgent(config: WorkAgentConfig): Promise<Session> {
    await this.ensureInitialized();

    const now = Date.now();
    const lifecycle: SessionLifecycle = {
      state: 'created',
      stateHistory: [],
    };

    const session: Session = {
      id: generateId(),
      title: config.goal,
      createdAt: now,
      updatedAt: now,
      messages: [],
      metadata: {
        type: 'workagent' as const,
        lifecycle,
        templateId: config.templateId,
        goal: config.goal,
        workflowId: config.workflowId,
        workflowStepIndex: config.workflowStepIndex,
        worktreePath: config.worktreePath,
        workspaceId: config.workspaceId,
        repoRoot: config.repoRoot,
      },
    };

    this.sessions.set(session.id, session);
    await saveSessionToDir(this.sessionsDir, session);

    getEventBus().emit({
      type: 'SessionChange',
      sessionId: session.id,
      action: 'created',
      timestamp: now,
    });

    return session;
  }

  async transitionState(
    sessionId: string,
    newState: LifecycleState,
    reason: string,
    actor: 'system' | 'user' | 'agent' = 'system'
  ): Promise<Session> {
    const session = await this.get(sessionId);
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`);
    }

    const lifecycle = session.metadata.lifecycle as SessionLifecycle | undefined;
    const currentState: LifecycleState = lifecycle?.state ?? 'created';

    const allowed = VALID_TRANSITIONS[currentState];
    if (!allowed.includes(newState)) {
      throw new Error(
        `Invalid state transition: ${currentState} → ${newState}. ` +
        `Allowed transitions: ${allowed.join(', ') || 'none'}`
      );
    }

    const now = Date.now();
    const updatedLifecycle: SessionLifecycle = {
      state: newState,
      stateHistory: [
        ...(lifecycle?.stateHistory ?? []),
        { from: currentState, to: newState, reason, timestamp: now, actor },
      ],
      pauseReason: newState === 'paused' ? reason : undefined,
      failureReason: newState === 'failed' ? reason : undefined,
      completionSummary: newState === 'completed' ? reason : lifecycle?.completionSummary,
    };

    session.metadata = {
      ...session.metadata,
      lifecycle: updatedLifecycle,
    };

    await this.save(session);

    getEventBus().emit({
      type: 'LifecycleTransition',
      sessionId,
      from: currentState,
      to: newState,
      reason,
      actor,
      timestamp: now,
    });

    return session;
  }

  async listByState(state: LifecycleState, workspaceId?: string): Promise<Session[]> {
    await this.ensureInitialized();

    return Array.from(this.sessions.values()).filter((session) => {
      const lifecycle = session.metadata.lifecycle as SessionLifecycle | undefined;
      if (!lifecycle || lifecycle.state !== state) return false;
      if (workspaceId && session.metadata.workspaceId !== workspaceId) return false;
      return true;
    });
  }

  async getChildren(parentSessionId: string): Promise<Session[]> {
    await this.ensureInitialized();

    return Array.from(this.sessions.values())
      .filter((session) => session.parentId === parentSessionId)
      .sort((a, b) => b.createdAt - a.createdAt);
  }

  dispose(): void {
    this.sessions.clear();
    this.currentSession = null;
    this.initialized = false;
  }
}

// =============================================================================
// Singleton Management
// =============================================================================

let _instance: SessionServiceImpl | null = null;

export function getSessionService(): SessionService {
  return (_instance ??= new SessionServiceImpl());
}

export function resetSessionService(): void {
  if (_instance) {
    _instance.dispose();
    _instance = null;
  }
}

/**
 * Create a session service with a custom sessions directory.
 * Useful for testing.
 */
export function createSessionService(sessionsDir: string): SessionService {
  return new SessionServiceImpl(sessionsDir);
}

// Export for testing
export { loadSessionFromDir, saveSessionToDir, SESSION_VERSION };
