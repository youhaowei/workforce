/**
 * AuditService - Append-only audit trail for agent operations
 *
 * Provides:
 * - Record audit entries for state changes, tool use, reviews, spawns, worktree actions
 * - Query by session or workspace with filtering
 * - Append-only JSONL storage (one JSON object per line)
 *
 * Persistence: ~/.workforce/workspaces/{workspaceId}/audit.jsonl
 */

import { readFile, appendFile, mkdir } from 'fs/promises';
import { join } from 'path';
import type { AuditEntry, AuditEntryType, AuditService } from './types';
import { getEventBus } from '@shared/event-bus';
import { getDataDir } from './data-dir';

// =============================================================================
// Configuration
// =============================================================================

const DEFAULT_WORKSPACES_DIR = join(getDataDir(), 'workspaces');

// =============================================================================
// Helpers
// =============================================================================

function generateId(): string {
  return `aud_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

// =============================================================================
// Service Implementation
// =============================================================================

class AuditServiceImpl implements AuditService {
  private workspacesDir: string;

  constructor(workspacesDir?: string) {
    this.workspacesDir = workspacesDir ?? DEFAULT_WORKSPACES_DIR;
  }

  private auditPath(workspaceId: string): string {
    return join(this.workspacesDir, workspaceId, 'audit.jsonl');
  }

  async record(entry: Omit<AuditEntry, 'id' | 'timestamp'>): Promise<AuditEntry> {
    const fullEntry: AuditEntry = {
      ...entry,
      id: generateId(),
      timestamp: Date.now(),
    };

    const dir = join(this.workspacesDir, entry.workspaceId);
    await mkdir(dir, { recursive: true });

    const line = JSON.stringify(fullEntry) + '\n';
    await appendFile(this.auditPath(entry.workspaceId), line, 'utf-8');

    getEventBus().emit({
      type: 'AuditEntry',
      entryId: fullEntry.id,
      sessionId: fullEntry.sessionId,
      workspaceId: fullEntry.workspaceId,
      auditType: fullEntry.type,
      description: fullEntry.description,
      timestamp: fullEntry.timestamp,
    });

    return fullEntry;
  }

  async getForSession(sessionId: string, workspaceId: string): Promise<AuditEntry[]> {
    const all = await this.readAll(workspaceId);
    return all.filter((e) => e.sessionId === sessionId);
  }

  async getForWorkspace(
    workspaceId: string,
    options?: { limit?: number; offset?: number; type?: AuditEntryType }
  ): Promise<AuditEntry[]> {
    let entries = await this.readAll(workspaceId);

    if (options?.type) {
      entries = entries.filter((e) => e.type === options.type);
    }

    // Sort newest first
    entries.sort((a, b) => b.timestamp - a.timestamp);

    const offset = options?.offset ?? 0;
    const limit = options?.limit ?? entries.length;
    return entries.slice(offset, offset + limit);
  }

  dispose(): void {
    // Nothing to clean up — stateless reads
  }

  // ===========================================================================
  // Private
  // ===========================================================================

  private async readAll(workspaceId: string): Promise<AuditEntry[]> {
    try {
      const raw = await readFile(this.auditPath(workspaceId), 'utf-8');
      const lines = raw.trim().split('\n').filter(Boolean);
      const entries: AuditEntry[] = [];

      for (const line of lines) {
        try {
          entries.push(JSON.parse(line) as AuditEntry);
        } catch {
          // Skip malformed lines
        }
      }

      return entries;
    } catch {
      return [];
    }
  }
}

// =============================================================================
// Factory
// =============================================================================

export function createAuditService(workspacesDir?: string): AuditService {
  return new AuditServiceImpl(workspacesDir);
}
