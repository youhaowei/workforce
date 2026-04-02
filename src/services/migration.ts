/**
 * Migration Framework — Ordered, idempotent, ledger-tracked migrations.
 *
 * Migrations are registered as named functions with string IDs that sort
 * lexicographically (e.g. "001_sessions_json_to_jsonl"). On each run the
 * framework reads a ledger file, diffs against registered migrations, and
 * executes unapplied ones in order. Results are appended to the ledger
 * after each migration completes.
 *
 * Design goals:
 * - Adding a future migration = register a new Migration object.
 * - Already-run migrations are skipped via ledger lookup.
 * - Individual item failures within a migration are non-fatal.
 */

import { readFile, writeFile, mkdir, readdir, rename } from 'fs/promises';
import { join } from 'path';
import { createLogger } from 'tracey';

const log = createLogger('Migration');

// =============================================================================
// Types
// =============================================================================

export interface Migration {
  /** Sortable unique ID, e.g. "001_sessions_json_to_jsonl" */
  id: string;
  description: string;
  /**
   * Execute the migration. Must be **idempotent**: already-processed items
   * should be skipped (increment `result.skipped`), not re-processed.
   * If `result.failed > 0`, the migration is NOT recorded in the ledger
   * and will be retried on next startup.
   */
  run: (dataDir: string) => Promise<MigrationResult>;
}

export interface MigrationResult {
  migrated: number;
  skipped: number;
  failed: number;
  errors: string[];
}

interface LedgerEntry {
  id: string;
  appliedAt: number;
  durationMs: number;
  result: MigrationResult;
}

interface Ledger {
  applied: LedgerEntry[];
}

// =============================================================================
// Ledger I/O
// =============================================================================

function ledgerPath(dataDir: string): string {
  return join(dataDir, '_migrations.json');
}

async function readLedger(dataDir: string): Promise<Ledger> {
  try {
    const raw = await readFile(ledgerPath(dataDir), 'utf-8');
    return JSON.parse(raw) as Ledger;
  } catch {
    return { applied: [] };
  }
}

async function writeLedger(dataDir: string, ledger: Ledger): Promise<void> {
  await mkdir(dataDir, { recursive: true });
  const finalPath = ledgerPath(dataDir);
  const tmpPath = finalPath + '.tmp';
  await writeFile(tmpPath, JSON.stringify(ledger, null, 2), 'utf-8');
  await rename(tmpPath, finalPath);
}

// =============================================================================
// Registry
// =============================================================================

const registry: Migration[] = [];

/**
 * Register a migration. Migrations execute in ID-sort order.
 * Call this at module scope so all migrations are registered before
 * `runMigrations` is invoked.
 */
export function registerMigration(migration: Migration): void {
  registry.push(migration);
}

// =============================================================================
// Runner
// =============================================================================

/**
 * Execute all unapplied migrations in ID order.
 *
 * Safe to call multiple times — already-applied migrations (per ledger)
 * are skipped. Individual item failures within a migration are logged
 * but do not block subsequent migrations.
 */
export async function runMigrations(dataDir: string): Promise<void> {
  const ledger = await readLedger(dataDir);
  const appliedIds = new Set(ledger.applied.map((e) => e.id));

  // Sort registry by ID for deterministic order
  const sorted = [...registry].sort((a, b) => a.id.localeCompare(b.id));
  const pending = sorted.filter((m) => !appliedIds.has(m.id));

  if (pending.length === 0) return;

  log.info({ count: pending.length }, `${pending.length} pending migration(s) to run`);

  for (const migration of pending) {
    const start = Date.now();
    log.info({ id: migration.id, description: migration.description }, `Running: ${migration.id} — ${migration.description}`);

    try {
      const result = await migration.run(dataDir);
      const durationMs = Date.now() - start;

      if (result.errors.length > 0) {
        log.warn({ id: migration.id, migrated: result.migrated, skipped: result.skipped, failed: result.failed, durationMs, errors: result.errors }, `${migration.id}: ${result.migrated} migrated, ${result.skipped} skipped, ${result.failed} failed (${durationMs}ms)`);
      } else {
        log.info({ id: migration.id, migrated: result.migrated, skipped: result.skipped, failed: result.failed, durationMs }, `${migration.id}: ${result.migrated} migrated, ${result.skipped} skipped, ${result.failed} failed (${durationMs}ms)`);
      }

      // Skip ledger recording if any items failed — migration will retry next run
      if (result.failed > 0) {
        log.warn({ id: migration.id, failed: result.failed }, `${migration.id}: ${result.failed} failures — will retry next run`);
        continue;
      }

      ledger.applied.push({
        id: migration.id,
        appliedAt: Date.now(),
        durationMs,
        result,
      });

      // Flush ledger after each migration for crash safety
      await writeLedger(dataDir, ledger);
    } catch (err) {
      // Migration-level failure: log and continue with next migration
      log.error({ id: migration.id, error: err instanceof Error ? err.message : String(err) }, `${migration.id} FAILED`);
    }
  }
}

// =============================================================================
// Built-in Migration: 001_sessions_json_to_jsonl
// =============================================================================

/**
 * Convert legacy `.json` session files to `.jsonl` (line-delimited JSON).
 *
 * For each `{sessionId}.json`:
 * 1. Parse the JSON envelope (version + session).
 * 2. Write a `.jsonl` with a `header` line + one `message` line per message.
 * 3. Rename the original to `.json.migrated.{timestamp}`.
 *
 * Skips if a matching `.jsonl` already exists.
 * On parse error: logs warning, increments `failed`, continues.
 */
async function migrateSessionsJsonToJsonl(dataDir: string): Promise<MigrationResult> {
  const sessionsDir = join(dataDir, 'sessions');
  const result: MigrationResult = { migrated: 0, skipped: 0, failed: 0, errors: [] };

  let fileNames: string[];
  try {
    fileNames = await readdir(sessionsDir);
  } catch {
    // No sessions directory yet — nothing to migrate
    return result;
  }

  const jsonFiles = fileNames.filter(
    (name) => name.endsWith('.json') && !name.includes('.backup') && !name.includes('.migrated'),
  );

  for (const fileName of jsonFiles) {
    const sessionId = fileName.replace('.json', '');
    const jsonPath = join(sessionsDir, fileName);
    const jsonlPath = join(sessionsDir, `${sessionId}.jsonl`);

    // Skip if JSONL already exists
    try {
      await readFile(jsonlPath, 'utf-8');
      result.skipped++;
      continue;
    } catch {
      // JSONL doesn't exist — proceed with migration
    }

    try {
      const raw = await readFile(jsonPath, 'utf-8');
      const parsed = JSON.parse(raw) as { version: number; session: Record<string, unknown> };
      const session = parsed.session as {
        id: string;
        title?: string;
        createdAt: number;
        updatedAt: number;
        parentId?: string;
        messages: Array<{ id: string; role: string; content: string; timestamp: number; toolCalls?: unknown[]; toolResults?: unknown[] }>;
        metadata: Record<string, unknown>;
      };

      // Build JSONL lines
      const lines: string[] = [];

      // Header line
      lines.push(JSON.stringify({
        t: 'header',
        v: 2,
        id: session.id,
        title: session.title,
        createdAt: session.createdAt,
        updatedAt: session.updatedAt,
        parentId: session.parentId,
        metadata: session.metadata,
      }));

      // Message lines
      for (const msg of session.messages) {
        lines.push(JSON.stringify({
          t: 'message',
          id: msg.id,
          role: msg.role,
          content: msg.content,
          timestamp: msg.timestamp,
          toolCalls: msg.toolCalls,
          toolResults: msg.toolResults,
        }));
      }

      await writeFile(jsonlPath, lines.join('\n') + '\n', 'utf-8');

      // Backup original
      const backupPath = `${jsonPath}.migrated.${Date.now()}`;
      await rename(jsonPath, backupPath);

      result.migrated++;
    } catch (err) {
      result.failed++;
      result.errors.push(`${sessionId}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return result;
}

registerMigration({
  id: '001_sessions_json_to_jsonl',
  description: 'Convert legacy JSON session files to JSONL format',
  run: migrateSessionsJsonToJsonl,
});

// =============================================================================
// Exports for testing
// =============================================================================

export { readLedger, writeLedger, migrateSessionsJsonToJsonl };
