import { afterEach, describe, expect, it } from 'vitest';
import { mkdir, readdir, readFile, rm, writeFile } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  getDefaultStartupMigrationIds,
  getStartupMigrationStatePath,
  runDefaultStartupMigrations,
  runStartupMigrations,
  type StartupMigration,
} from './startup-migrations';

const ROOT_DIR = join(tmpdir(), `workforce-startup-migrations-test-${Date.now()}`);

const cleanupDirs: string[] = [];

async function makeCaseDir(): Promise<string> {
  const dir = join(ROOT_DIR, `case-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  await mkdir(dir, { recursive: true });
  cleanupDirs.push(dir);
  return dir;
}

afterEach(async () => {
  for (const dir of cleanupDirs.splice(0, cleanupDirs.length)) {
    await rm(dir, { recursive: true, force: true });
  }
});

describe('startup-migrations', () => {
  it('records not_needed decisions and skips future checks', async () => {
    const dataDir = await makeCaseDir();

    let shouldRunCalls = 0;
    let runCalls = 0;

    const migrations: StartupMigration[] = [
      {
        id: 'mock-not-needed',
        description: 'test migration',
        async shouldRun() {
          shouldRunCalls += 1;
          return { run: false, reason: 'not required' };
        },
        async run() {
          runCalls += 1;
        },
      },
    ];

    const first = await runStartupMigrations(migrations, { dataDir });
    expect(first.skippedNotNeeded).toEqual(['mock-not-needed']);
    expect(first.skippedAlreadyDecided).toEqual([]);

    const second = await runStartupMigrations(migrations, { dataDir });
    expect(second.skippedAlreadyDecided).toEqual(['mock-not-needed']);
    expect(second.skippedNotNeeded).toEqual([]);

    expect(shouldRunCalls).toBe(1);
    expect(runCalls).toBe(0);
  });

  it('runs migration once and marks it as ran', async () => {
    const dataDir = await makeCaseDir();

    let runCalls = 0;

    const migrations: StartupMigration[] = [
      {
        id: 'mock-runs-once',
        description: 'test migration',
        async shouldRun() {
          return { run: true };
        },
        async run() {
          runCalls += 1;
        },
      },
    ];

    const first = await runStartupMigrations(migrations, { dataDir });
    expect(first.ran).toEqual(['mock-runs-once']);

    const second = await runStartupMigrations(migrations, { dataDir });
    expect(second.skippedAlreadyDecided).toEqual(['mock-runs-once']);

    expect(runCalls).toBe(1);

    const statePath = getStartupMigrationStatePath(dataDir);
    const state = JSON.parse(await readFile(statePath, 'utf-8')) as {
      migrations: Record<string, { status: string }>;
    };
    expect(state.migrations['mock-runs-once']?.status).toBe('ran');
  });

  it('default migration set includes session json->jsonl migration', () => {
    expect(getDefaultStartupMigrationIds()).toContain('sessions-json-to-jsonl-v2');
  });

  it('default startup migration migrates legacy session files once', async () => {
    const dataDir = await makeCaseDir();
    const sessionsDir = join(dataDir, 'sessions');
    await mkdir(sessionsDir, { recursive: true });

    await writeFile(
      join(sessionsDir, 'sess_legacy.json'),
      JSON.stringify({
        version: 1,
        session: {
          id: 'sess_legacy',
          title: 'Legacy Session',
          createdAt: Date.now(),
          updatedAt: Date.now(),
          messages: [],
          metadata: {},
        },
      }),
      'utf-8',
    );

    const first = await runDefaultStartupMigrations({ dataDir });
    expect(first.ran).toContain('sessions-json-to-jsonl-v2');

    const files = await readdir(sessionsDir);
    expect(files).toContain('sess_legacy.jsonl');
    expect(files.some((file) => file.startsWith('sess_legacy.json.bak.'))).toBe(true);

    const second = await runDefaultStartupMigrations({ dataDir });
    expect(second.skippedAlreadyDecided).toContain('sessions-json-to-jsonl-v2');
  });
});
