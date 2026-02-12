import { mkdir, readFile, rename, writeFile } from 'fs/promises';
import { join } from 'path';
import { getDataDir } from './data-dir';
import {
  migrateSessionsJsonToJsonl,
  shouldMigrateSessionsJsonToJsonl,
} from './migrate-sessions-json-to-jsonl';

export interface StartupMigrationLogger {
  log: (message: string) => void;
  warn: (message: string) => void;
}

export interface StartupMigrationDecision {
  run: boolean;
  reason?: string;
}

export interface StartupMigrationContext {
  dataDir: string;
  logger: StartupMigrationLogger;
}

export interface StartupMigration {
  id: string;
  description: string;
  shouldRun: (context: StartupMigrationContext) => Promise<StartupMigrationDecision>;
  run: (context: StartupMigrationContext) => Promise<void>;
}

export interface StartupMigrationStateEntry {
  status: 'ran' | 'not_needed';
  timestamp: number;
  reason?: string;
}

export interface StartupMigrationStateFile {
  version: 1;
  migrations: Record<string, StartupMigrationStateEntry>;
}

export interface StartupMigrationRunReport {
  ran: string[];
  skippedAlreadyDecided: string[];
  skippedNotNeeded: string[];
  failed: Array<{ id: string; reason: string }>;
}

export interface StartupMigrationRunnerOptions {
  dataDir?: string;
  logger?: StartupMigrationLogger;
}

const MIGRATION_STATE_FILENAME = 'startup-migrations-state.json';

function stateFilePath(dataDir: string): string {
  return join(dataDir, MIGRATION_STATE_FILENAME);
}

function defaultState(): StartupMigrationStateFile {
  return {
    version: 1,
    migrations: {},
  };
}

async function loadState(dataDir: string): Promise<StartupMigrationStateFile> {
  await mkdir(dataDir, { recursive: true });
  const filePath = stateFilePath(dataDir);

  try {
    const raw = await readFile(filePath, 'utf-8');
    const parsed = JSON.parse(raw) as Partial<StartupMigrationStateFile>;

    if (
      parsed?.version === 1 &&
      parsed.migrations &&
      typeof parsed.migrations === 'object' &&
      !Array.isArray(parsed.migrations)
    ) {
      return {
        version: 1,
        migrations: parsed.migrations,
      };
    }

    return defaultState();
  } catch (err) {
    const error = err as NodeJS.ErrnoException;
    if (error.code === 'ENOENT') {
      return defaultState();
    }

    // Corrupted state file: rotate and reset.
    try {
      await rename(filePath, `${filePath}.corrupt.${Date.now()}`);
    } catch {
      // Best effort only.
    }
    return defaultState();
  }
}

async function saveState(dataDir: string, state: StartupMigrationStateFile): Promise<void> {
  await mkdir(dataDir, { recursive: true });
  const filePath = stateFilePath(dataDir);
  const tmpPath = `${filePath}.tmp.${process.pid}.${Date.now()}`;
  await writeFile(tmpPath, JSON.stringify(state, null, 2), 'utf-8');
  await rename(tmpPath, filePath);
}

export async function runStartupMigrations(
  migrations: StartupMigration[],
  options: StartupMigrationRunnerOptions = {},
): Promise<StartupMigrationRunReport> {
  const dataDir = options.dataDir ?? getDataDir();
  const logger = options.logger ?? console;

  const state = await loadState(dataDir);
  const context: StartupMigrationContext = { dataDir, logger };

  const report: StartupMigrationRunReport = {
    ran: [],
    skippedAlreadyDecided: [],
    skippedNotNeeded: [],
    failed: [],
  };

  for (const migration of migrations) {
    const existing = state.migrations[migration.id];
    if (existing) {
      report.skippedAlreadyDecided.push(migration.id);
      logger.log(
        `[Startup Migration] ${migration.id} skipped (${existing.status}${existing.reason ? `: ${existing.reason}` : ''})`,
      );
      continue;
    }

    const decision = await migration.shouldRun(context);
    if (!decision.run) {
      state.migrations[migration.id] = {
        status: 'not_needed',
        timestamp: Date.now(),
        reason: decision.reason,
      };
      await saveState(dataDir, state);

      report.skippedNotNeeded.push(migration.id);
      logger.log(
        `[Startup Migration] ${migration.id} not needed${decision.reason ? ` (${decision.reason})` : ''}`,
      );
      continue;
    }

    try {
      await migration.run(context);
      state.migrations[migration.id] = {
        status: 'ran',
        timestamp: Date.now(),
      };
      await saveState(dataDir, state);

      report.ran.push(migration.id);
      logger.log(`[Startup Migration] ${migration.id} completed`);
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      report.failed.push({ id: migration.id, reason });
      logger.warn(`[Startup Migration] ${migration.id} failed: ${reason}`);
      throw err;
    }
  }

  return report;
}

const sessionsJsonToJsonlMigration: StartupMigration = {
  id: 'sessions-json-to-jsonl-v2',
  description: 'Migrate legacy session .json files to append-only .jsonl format',
  async shouldRun(context) {
    const sessionsDir = join(context.dataDir, 'sessions');
    const needed = await shouldMigrateSessionsJsonToJsonl(sessionsDir);
    return {
      run: needed,
      reason: needed ? undefined : 'no legacy .json session files found',
    };
  },
  async run(context) {
    const sessionsDir = join(context.dataDir, 'sessions');
    const report = await migrateSessionsJsonToJsonl({
      dir: sessionsDir,
      failFast: false,
    });

    context.logger.log(
      `[Session Migration] migrated=${report.migrated} skipped=${report.skipped} failed=${report.failed}`,
    );

    if (report.failed > 0) {
      for (const failure of report.failures) {
        context.logger.warn(`[Session Migration] failed ${failure.sessionId}: ${failure.reason}`);
      }
      throw new Error(`Session migration failed (${report.failed} session${report.failed === 1 ? '' : 's'})`);
    }
  },
};

const DEFAULT_STARTUP_MIGRATIONS: StartupMigration[] = [sessionsJsonToJsonlMigration];

export async function runDefaultStartupMigrations(
  options: StartupMigrationRunnerOptions = {},
): Promise<StartupMigrationRunReport> {
  return runStartupMigrations(DEFAULT_STARTUP_MIGRATIONS, options);
}

export function getDefaultStartupMigrationIds(): string[] {
  return DEFAULT_STARTUP_MIGRATIONS.map((migration) => migration.id);
}

export function getStartupMigrationStatePath(dataDir = getDataDir()): string {
  return stateFilePath(dataDir);
}
