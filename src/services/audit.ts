/**
 * AuditService - Append-only audit trail for agent operations
 *
 * Provides:
 * - Record audit entries for state changes, tool use, reviews, spawns, worktree actions
 * - Query by session or org with filtering
 * - Append-only JSONL storage (one JSON object per line)
 *
 * Persistence: ~/.workforce/orgs/{orgId}/audit.jsonl
 */

import { readFile, appendFile, mkdir } from 'fs/promises';
import { join } from 'path';
import type { AuditEntry, AuditEntryType, AuditService } from './types';
import { getEventBus } from '@/shared/event-bus';
import { getDataDir } from './data-dir';

// =============================================================================
// Configuration
// =============================================================================

const DEFAULT_ORGS_DIR = join(getDataDir(), 'orgs');

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
  private orgsDir: string;

  constructor(orgsDir?: string) {
    this.orgsDir = orgsDir ?? DEFAULT_ORGS_DIR;
  }

  private auditPath(orgId: string): string {
    return join(this.orgsDir, orgId, 'audit.jsonl');
  }

  async record(entry: Omit<AuditEntry, 'id' | 'timestamp'>): Promise<AuditEntry> {
    const fullEntry: AuditEntry = {
      ...entry,
      id: generateId(),
      timestamp: Date.now(),
    };

    const dir = join(this.orgsDir, entry.orgId);
    await mkdir(dir, { recursive: true });

    const line = JSON.stringify(fullEntry) + '\n';
    await appendFile(this.auditPath(entry.orgId), line, 'utf-8');

    getEventBus().emit({
      type: 'AuditEntry',
      entryId: fullEntry.id,
      sessionId: fullEntry.sessionId,
      orgId: fullEntry.orgId,
      auditType: fullEntry.type,
      description: fullEntry.description,
      timestamp: fullEntry.timestamp,
    });

    return fullEntry;
  }

  async getForSession(sessionId: string, orgId: string): Promise<AuditEntry[]> {
    const all = await this.readAll(orgId);
    return all.filter((e) => e.sessionId === sessionId);
  }

  async getForOrg(
    orgId: string,
    options?: { limit?: number; offset?: number; type?: AuditEntryType }
  ): Promise<AuditEntry[]> {
    let entries = await this.readAll(orgId);

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

  private async readAll(orgId: string): Promise<AuditEntry[]> {
    try {
      const raw = await readFile(this.auditPath(orgId), 'utf-8');
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

export function createAuditService(orgsDir?: string): AuditService {
  return new AuditServiceImpl(orgsDir);
}
