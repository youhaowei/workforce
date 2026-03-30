/**
 * Migration Framework Tests
 *
 * Tests for ledger tracking, ordered execution, idempotency,
 * and the built-in 001_sessions_json_to_jsonl migration.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdir, writeFile, readFile, readdir, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  runMigrations,
  registerMigration,
  resetTestMigrations,
  readLedger,
  writeLedger,
  migrateSessionsJsonToJsonl,
} from './migration';

// Each test suite gets its own temp root
const TEST_ROOT = join(tmpdir(), 'workforce-migration-test-' + Date.now());
let testIdx = 0;
function nextDir(): string {
  return join(TEST_ROOT, `case-${testIdx++}`);
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Write a legacy v1 .json session file */
async function writeLegacySession(
  sessionsDir: string,
  sessionId: string,
  messages: Array<{ id: string; role: string; content: string; timestamp: number }> = [],
) {
  await mkdir(sessionsDir, { recursive: true });
  const data = {
    version: 1,
    session: {
      id: sessionId,
      title: `Session ${sessionId}`,
      createdAt: 1700000000000,
      updatedAt: 1700000001000,
      messages,
      metadata: {},
    },
  };
  await writeFile(join(sessionsDir, `${sessionId}.json`), JSON.stringify(data), 'utf-8');
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('Migration Framework', () => {
  beforeEach(async () => {
    await mkdir(TEST_ROOT, { recursive: true });
  });

  afterEach(async () => {
    resetTestMigrations();
    await rm(TEST_ROOT, { recursive: true, force: true }).catch(() => {});
  });

  describe('runMigrations', () => {
    it('should create ledger file if missing', async () => {
      const dir = nextDir();
      await mkdir(dir, { recursive: true });

      // Run with built-in migration (no sessions dir = nothing to migrate)
      await runMigrations(dir);

      const ledger = await readLedger(dir);
      // The built-in 001 migration should be recorded
      expect(ledger.applied.length).toBeGreaterThanOrEqual(1);
      expect(ledger.applied.some((e) => e.id === '001_sessions_json_to_jsonl')).toBe(true);
    });

    it('should skip already-applied migrations', async () => {
      const dir = nextDir();
      await mkdir(dir, { recursive: true });

      // Pre-populate ledger with the built-in migration
      await writeLedger(dir, {
        applied: [
          { id: '001_sessions_json_to_jsonl', appliedAt: Date.now(), durationMs: 0, result: { migrated: 0, skipped: 0, failed: 0, errors: [] } },
        ],
      });

      // Run — should be a no-op (migration already applied)
      await runMigrations(dir);

      const ledger = await readLedger(dir);
      // Still just the one entry
      expect(ledger.applied).toHaveLength(1);
    });

    it('should execute migrations in ID-sort order', async () => {
      const dir = nextDir();
      await mkdir(dir, { recursive: true });

      const executionOrder: string[] = [];

      // Register test migrations with out-of-order IDs
      registerMigration({
        id: '999_test_migration_b',
        description: 'Test B',
        run: async () => {
          executionOrder.push('B');
          return { migrated: 0, skipped: 0, failed: 0, errors: [] };
        },
      });
      registerMigration({
        id: '998_test_migration_a',
        description: 'Test A',
        run: async () => {
          executionOrder.push('A');
          return { migrated: 0, skipped: 0, failed: 0, errors: [] };
        },
      });

      await runMigrations(dir);

      // A (998) should run before B (999)
      const aIdx = executionOrder.indexOf('A');
      const bIdx = executionOrder.indexOf('B');
      expect(aIdx).toBeLessThan(bIdx);
    });

    it('should NOT record migration in ledger when result.failed > 0', async () => {
      const dir = nextDir();
      await mkdir(dir, { recursive: true });

      // Pre-populate ledger so built-in migration is already done
      await writeLedger(dir, {
        applied: [
          { id: '001_sessions_json_to_jsonl', appliedAt: Date.now(), durationMs: 0, result: { migrated: 0, skipped: 0, failed: 0, errors: [] } },
        ],
      });

      registerMigration({
        id: '995_partial_failure',
        description: 'Has partial failures',
        run: async () => ({ migrated: 2, skipped: 0, failed: 1, errors: ['item_x: parse error'] }),
      });

      await runMigrations(dir);

      const ledger = await readLedger(dir);
      // Partial failure migration should NOT be in the ledger
      expect(ledger.applied.some((e) => e.id === '995_partial_failure')).toBe(false);
    });

    it('should retry partially failed migration on next run', async () => {
      const dir = nextDir();
      await mkdir(dir, { recursive: true });

      // Pre-populate ledger so built-in migration is already done
      await writeLedger(dir, {
        applied: [
          { id: '001_sessions_json_to_jsonl', appliedAt: Date.now(), durationMs: 0, result: { migrated: 0, skipped: 0, failed: 0, errors: [] } },
        ],
      });

      let runCount = 0;
      registerMigration({
        id: '994_retry_test',
        description: 'First run fails, second succeeds',
        run: async () => {
          runCount++;
          if (runCount === 1) {
            return { migrated: 1, skipped: 0, failed: 1, errors: ['item_y: failed'] };
          }
          return { migrated: 0, skipped: 2, failed: 0, errors: [] };
        },
      });

      // First run — partial failure, not recorded
      await runMigrations(dir);
      let ledger = await readLedger(dir);
      expect(ledger.applied.some((e) => e.id === '994_retry_test')).toBe(false);
      expect(runCount).toBe(1);

      // Second run — all clear, gets recorded
      await runMigrations(dir);
      ledger = await readLedger(dir);
      expect(ledger.applied.some((e) => e.id === '994_retry_test')).toBe(true);
      expect(runCount).toBe(2);
    });

    it('should continue past migration-level failures', async () => {
      const dir = nextDir();
      await mkdir(dir, { recursive: true });

      registerMigration({
        id: '997_will_throw',
        description: 'This migration throws',
        run: async () => {
          throw new Error('Boom!');
        },
      });

      registerMigration({
        id: '996_should_still_run',
        description: 'This should still run',
        run: async () => ({ migrated: 1, skipped: 0, failed: 0, errors: [] }),
      });

      // Should not throw even though 997 fails
      await runMigrations(dir);

      const ledger = await readLedger(dir);
      // 996 should be recorded (it ran before 997 in sort order)
      expect(ledger.applied.some((e) => e.id === '996_should_still_run')).toBe(true);
      // 997 threw at migration level, so it's NOT in the ledger
      expect(ledger.applied.some((e) => e.id === '997_will_throw')).toBe(false);
    });
  });

  describe('writeLedger (atomic)', () => {
    it('should leave no .tmp file after write', async () => {
      const dir = nextDir();
      await mkdir(dir, { recursive: true });

      await writeLedger(dir, {
        applied: [
          { id: 'test_ledger', appliedAt: Date.now(), durationMs: 5, result: { migrated: 1, skipped: 0, failed: 0, errors: [] } },
        ],
      });

      const files = await readdir(dir);
      const tmpFiles = files.filter((f) => f.endsWith('.tmp'));
      expect(tmpFiles).toHaveLength(0);

      // Verify content is correct
      const ledger = await readLedger(dir);
      expect(ledger.applied).toHaveLength(1);
      expect(ledger.applied[0].id).toBe('test_ledger');
    });
  });

  describe('001_sessions_json_to_jsonl', () => {
    it('should convert .json session to .jsonl', async () => {
      const dir = nextDir();
      const sessionsDir = join(dir, 'sessions');

      await writeLegacySession(sessionsDir, 'sess_convert', [
        { id: 'msg_1', role: 'user', content: 'Hello', timestamp: 1700000000000 },
        { id: 'msg_2', role: 'assistant', content: 'Hi there!', timestamp: 1700000001000 },
      ]);

      const result = await migrateSessionsJsonToJsonl(dir);

      expect(result.migrated).toBe(1);
      expect(result.skipped).toBe(0);
      expect(result.failed).toBe(0);

      // JSONL file should exist
      const jsonlContent = await readFile(join(sessionsDir, 'sess_convert.jsonl'), 'utf-8');
      const lines = jsonlContent.trim().split('\n');
      expect(lines.length).toBe(3); // header + 2 messages

      // Parse header
      const header = JSON.parse(lines[0]);
      expect(header.t).toBe('header');
      expect(header.v).toBe(2);
      expect(header.id).toBe('sess_convert');
      expect(header.title).toBe('Session sess_convert');

      // Parse messages
      const msg1 = JSON.parse(lines[1]);
      expect(msg1.t).toBe('message');
      expect(msg1.role).toBe('user');
      expect(msg1.content).toBe('Hello');

      const msg2 = JSON.parse(lines[2]);
      expect(msg2.t).toBe('message');
      expect(msg2.role).toBe('assistant');
      expect(msg2.content).toBe('Hi there!');

      // Original .json should be renamed to .json.migrated.*
      const files = await readdir(sessionsDir);
      const migratedFiles = files.filter((f) => f.includes('.migrated.'));
      expect(migratedFiles).toHaveLength(1);
      expect(migratedFiles[0]).toMatch(/^sess_convert\.json\.migrated\.\d+$/);
    });

    it('should skip if .jsonl already exists', async () => {
      const dir = nextDir();
      const sessionsDir = join(dir, 'sessions');

      await writeLegacySession(sessionsDir, 'sess_skip');
      // Pre-create the JSONL file
      await writeFile(join(sessionsDir, 'sess_skip.jsonl'), '{"t":"header"}\n', 'utf-8');

      const result = await migrateSessionsJsonToJsonl(dir);

      expect(result.migrated).toBe(0);
      expect(result.skipped).toBe(1);
    });

    it('should handle corrupt .json gracefully', async () => {
      const dir = nextDir();
      const sessionsDir = join(dir, 'sessions');
      await mkdir(sessionsDir, { recursive: true });

      await writeFile(join(sessionsDir, 'sess_bad.json'), '{ invalid json }}}', 'utf-8');

      const result = await migrateSessionsJsonToJsonl(dir);

      expect(result.failed).toBe(1);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toContain('sess_bad');
    });

    it('should skip .backup and .migrated files', async () => {
      const dir = nextDir();
      const sessionsDir = join(dir, 'sessions');
      await mkdir(sessionsDir, { recursive: true });

      await writeFile(join(sessionsDir, 'sess_old.json.backup.123'), '{}', 'utf-8');
      await writeFile(join(sessionsDir, 'sess_old.json.migrated.456'), '{}', 'utf-8');

      const result = await migrateSessionsJsonToJsonl(dir);

      expect(result.migrated).toBe(0);
      expect(result.skipped).toBe(0);
      expect(result.failed).toBe(0);
    });

    it('should handle empty sessions directory', async () => {
      const dir = nextDir();
      const sessionsDir = join(dir, 'sessions');
      await mkdir(sessionsDir, { recursive: true });

      const result = await migrateSessionsJsonToJsonl(dir);

      expect(result.migrated).toBe(0);
      expect(result.skipped).toBe(0);
      expect(result.failed).toBe(0);
    });

    it('should handle missing sessions directory', async () => {
      const dir = nextDir();
      await mkdir(dir, { recursive: true });
      // No sessions subdirectory

      const result = await migrateSessionsJsonToJsonl(dir);

      expect(result.migrated).toBe(0);
    });

    it('should migrate multiple sessions', async () => {
      const dir = nextDir();
      const sessionsDir = join(dir, 'sessions');

      await writeLegacySession(sessionsDir, 'sess_a', [
        { id: 'msg_1', role: 'user', content: 'A', timestamp: 1 },
      ]);
      await writeLegacySession(sessionsDir, 'sess_b', []);

      const result = await migrateSessionsJsonToJsonl(dir);

      expect(result.migrated).toBe(2);

      // Both JSONL files should exist
      const files = await readdir(sessionsDir);
      expect(files.filter((f) => f.endsWith('.jsonl'))).toHaveLength(2);
    });
  });
});
