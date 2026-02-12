import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdir, readFile, readdir, rm, writeFile } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  migrateSessionsJsonToJsonl,
  migrateSessionsJsonToJsonlOnStartup,
  shouldMigrateSessionsJsonToJsonl,
} from './migrate-sessions-json-to-jsonl';

const ROOT_DIR = join(tmpdir(), `workforce-session-migrate-test-${Date.now()}`);

let testDir = '';

async function writeLegacySessionFile(dir: string, sessionId: string, title = 'Legacy Session'): Promise<void> {
  await writeFile(
    join(dir, `${sessionId}.json`),
    JSON.stringify({
      version: 1,
      session: {
        id: sessionId,
        title,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        messages: [
          {
            id: `msg_${sessionId}`,
            role: 'user',
            content: 'hello',
            timestamp: Date.now(),
          },
        ],
        metadata: { source: 'legacy' },
      },
    }),
    'utf-8',
  );
}

describe('migrate-sessions-json-to-jsonl', () => {
  beforeEach(async () => {
    testDir = join(ROOT_DIR, `case-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
    await mkdir(testDir, { recursive: true });
  });

  afterEach(async () => {
    if (testDir) {
      await rm(testDir, { recursive: true, force: true });
    }
  });

  afterAll(async () => {
    await rm(ROOT_DIR, { recursive: true, force: true });
  });

  it('supports dry-run without writing files', async () => {
    await writeLegacySessionFile(testDir, 'sess_dry_run');

    const report = await migrateSessionsJsonToJsonl({
      dir: testDir,
      dryRun: true,
    });

    expect(report.migrated).toBe(1);
    expect(report.failed).toBe(0);

    const files = await readdir(testDir);
    expect(files).toContain('sess_dry_run.json');
    expect(files).not.toContain('sess_dry_run.jsonl');
  });

  it('is idempotent by skipping when .jsonl already exists unless force', async () => {
    await writeLegacySessionFile(testDir, 'sess_idempotent');

    const first = await migrateSessionsJsonToJsonl({ dir: testDir });
    expect(first.migrated).toBe(1);

    await writeLegacySessionFile(testDir, 'sess_idempotent', 'Legacy Session Again');
    const second = await migrateSessionsJsonToJsonl({ dir: testDir });
    expect(second.skipped).toBe(1);
    expect(second.migrated).toBe(0);

    const forced = await migrateSessionsJsonToJsonl({ dir: testDir, force: true });
    expect(forced.migrated).toBe(1);
    expect(forced.failed).toBe(0);
  });

  it('creates backup files for migrated .json sessions', async () => {
    await writeLegacySessionFile(testDir, 'sess_backup');

    const report = await migrateSessionsJsonToJsonl({ dir: testDir });
    expect(report.migrated).toBe(1);

    const files = await readdir(testDir);
    expect(files).toContain('sess_backup.jsonl');
    expect(files.some((file) => file.startsWith('sess_backup.json.bak.'))).toBe(true);
  });

  it('reports partial failures while continuing migration by default', async () => {
    await writeLegacySessionFile(testDir, 'sess_good');
    await writeFile(join(testDir, 'sess_bad.json'), '{invalid-json', 'utf-8');

    const report = await migrateSessionsJsonToJsonl({
      dir: testDir,
      failFast: false,
    });

    expect(report.migrated).toBe(1);
    expect(report.failed).toBe(1);
    expect(report.failures).toHaveLength(1);
    expect(report.failures[0]?.sessionId).toBe('sess_bad');

    const files = await readdir(testDir);
    expect(files).toContain('sess_good.jsonl');
    expect(files.some((file) => file.startsWith('sess_good.json.bak.'))).toBe(true);
  });

  it('emits valid jsonl output', async () => {
    await writeLegacySessionFile(testDir, 'sess_validate');
    await migrateSessionsJsonToJsonl({ dir: testDir });

    const content = await readFile(join(testDir, 'sess_validate.jsonl'), 'utf-8');
    const lines = content.trim().split('\n').map((line) => JSON.parse(line));

    expect(lines[0]?.type).toBe('header');
    expect(lines[1]?.type).toBe('message');
  });

  it('supports startup migration preflight logging', async () => {
    await writeLegacySessionFile(testDir, 'sess_startup');
    const logs: string[] = [];
    const warnings: string[] = [];

    const report = await migrateSessionsJsonToJsonlOnStartup({
      dir: testDir,
      logger: {
        log: (message: string) => {
          logs.push(message);
        },
        warn: (message: string) => {
          warnings.push(message);
        },
      },
    });

    expect(report.migrated).toBe(1);
    expect(logs.some((message) => message.includes('[Session Migration]'))).toBe(true);
    expect(warnings).toEqual([]);
  });

  it('can fail startup preflight when configured', async () => {
    await writeLegacySessionFile(testDir, 'sess_ok');
    await writeFile(join(testDir, 'sess_bad.json'), '{invalid-json', 'utf-8');

    await expect(
      migrateSessionsJsonToJsonlOnStartup({
        dir: testDir,
        failOnError: true,
      }),
    ).rejects.toThrow('Session migration failed');
  });

  it('exposes shouldMigrate helper for legacy file detection', async () => {
    expect(await shouldMigrateSessionsJsonToJsonl(testDir)).toBe(false);
    await writeLegacySessionFile(testDir, 'sess_should_run');
    expect(await shouldMigrateSessionsJsonToJsonl(testDir)).toBe(true);
  });
});
