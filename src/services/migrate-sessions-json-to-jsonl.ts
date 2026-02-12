import { mkdir, readFile, readdir, rename } from 'fs/promises';
import { join } from 'path';
import { fileURLToPath } from 'url';
import type { Message, Session } from './types';
import { getDataDir } from './data-dir';
import { saveSessionToDir } from './session';

export interface MigrationOptions {
  dir: string;
  dryRun?: boolean;
  force?: boolean;
  failFast?: boolean;
}

export interface StartupMigrationOptions {
  dir?: string;
  force?: boolean;
  failOnError?: boolean;
  logger?: Pick<Console, 'log' | 'warn'>;
}

export interface MigrationFailure {
  sessionId: string;
  reason: string;
}

export interface MigrationReport {
  migrated: number;
  skipped: number;
  failed: number;
  failures: MigrationFailure[];
}

interface LegacySessionFile {
  version?: number;
  session?: unknown;
}

function usage(): string {
  return [
    'Usage: bun run src/services/migrate-sessions-json-to-jsonl.ts [options]',
    '',
    'Options:',
    '  --dir <path>      Sessions directory (default: ~/.workforce/sessions)',
    '  --dry-run         Validate and report without writing files',
    '  --force           Overwrite existing .jsonl targets',
    '  --fail-fast       Stop on first failure (default: false)',
    '  --help            Show this help',
  ].join('\n');
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function normalizeLegacySession(raw: unknown, fallbackSessionId: string): Session {
  if (!isObjectRecord(raw)) {
    throw new Error('Invalid session payload: expected object');
  }

  const id = typeof raw.id === 'string' ? raw.id : fallbackSessionId;
  if (!id) {
    throw new Error('Invalid session payload: missing id');
  }

  const createdAt = typeof raw.createdAt === 'number' ? raw.createdAt : Date.now();
  const updatedAt = typeof raw.updatedAt === 'number' ? raw.updatedAt : createdAt;

  const title = typeof raw.title === 'string' ? raw.title : undefined;
  const parentId = typeof raw.parentId === 'string' ? raw.parentId : undefined;

  const metadata = isObjectRecord(raw.metadata) ? raw.metadata : {};

  const messagesRaw = Array.isArray(raw.messages) ? raw.messages : [];
  const messages: Message[] = messagesRaw
    .filter((message) => isObjectRecord(message))
    .map((message, index): Message => {
      const messageId = typeof message.id === 'string'
        ? message.id
        : `msg_migrated_${index}`;

      const role: Message['role'] =
        message.role === 'user' || message.role === 'assistant' || message.role === 'system'
          ? message.role
          : 'user';

      const content = typeof message.content === 'string' ? message.content : '';
      const timestamp = typeof message.timestamp === 'number' ? message.timestamp : updatedAt;

      return {
        id: messageId,
        role,
        content,
        timestamp,
        toolCalls: Array.isArray(message.toolCalls)
          ? (message.toolCalls as Message['toolCalls'])
          : undefined,
        toolResults: Array.isArray(message.toolResults)
          ? (message.toolResults as Message['toolResults'])
          : undefined,
      };
    });

  return {
    id,
    title,
    createdAt,
    updatedAt,
    parentId,
    metadata,
    messages,
  };
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await readFile(path, 'utf-8');
    return true;
  } catch {
    return false;
  }
}

export async function shouldMigrateSessionsJsonToJsonl(dir: string): Promise<boolean> {
  await mkdir(dir, { recursive: true });
  const entries = await readdir(dir, { withFileTypes: true });
  return entries.some(
    (entry) => entry.isFile() && entry.name.endsWith('.json') && !entry.name.includes('.json.bak.'),
  );
}

export async function migrateSessionsJsonToJsonl(options: MigrationOptions): Promise<MigrationReport> {
  const dir = options.dir;
  const dryRun = options.dryRun ?? false;
  const force = options.force ?? false;
  const failFast = options.failFast ?? false;

  await mkdir(dir, { recursive: true });

  const report: MigrationReport = {
    migrated: 0,
    skipped: 0,
    failed: 0,
    failures: [],
  };

  const entries = await readdir(dir, { withFileTypes: true });
  const jsonFiles = entries.filter(
    (entry) => entry.isFile() && entry.name.endsWith('.json') && !entry.name.includes('.json.bak.')
  );

  for (const entry of jsonFiles) {
    const sourcePath = join(dir, entry.name);
    const sessionId = entry.name.slice(0, -'.json'.length);
    const targetPath = join(dir, `${sessionId}.jsonl`);

    try {
      if (!force && (await pathExists(targetPath))) {
        report.skipped += 1;
        continue;
      }

      const raw = await readFile(sourcePath, 'utf-8');
      const parsed = JSON.parse(raw) as LegacySessionFile;
      const normalized = normalizeLegacySession(parsed.session, sessionId);

      if (dryRun) {
        report.migrated += 1;
        continue;
      }

      await saveSessionToDir(dir, normalized);

      const backupPath = `${sourcePath}.bak.${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      await rename(sourcePath, backupPath);
      report.migrated += 1;
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      report.failed += 1;
      report.failures.push({ sessionId, reason });
      if (failFast) {
        break;
      }
    }
  }

  return report;
}

export async function migrateSessionsJsonToJsonlOnStartup(
  options: StartupMigrationOptions = {},
): Promise<MigrationReport> {
  const dir = options.dir ?? join(getDataDir(), 'sessions');
  const logger = options.logger ?? console;

  const needed = await shouldMigrateSessionsJsonToJsonl(dir);
  if (!needed) {
    const emptyReport: MigrationReport = {
      migrated: 0,
      skipped: 0,
      failed: 0,
      failures: [],
    };
    logger.log('[Session Migration] skipped (no legacy .json session files)');
    return emptyReport;
  }

  const report = await migrateSessionsJsonToJsonl({
    dir,
    force: options.force ?? false,
    failFast: false,
  });

  logger.log(
    `[Session Migration] migrated=${report.migrated} skipped=${report.skipped} failed=${report.failed}`,
  );

  if (report.failed > 0) {
    for (const failure of report.failures) {
      logger.warn(`[Session Migration] failed ${failure.sessionId}: ${failure.reason}`);
    }
  }

  if (options.failOnError && report.failed > 0) {
    throw new Error(`Session migration failed (${report.failed} session${report.failed === 1 ? '' : 's'})`);
  }

  return report;
}

function parseCliArgs(argv: string[]): MigrationOptions | 'help' {
  const options: MigrationOptions = {
    dir: join(getDataDir(), 'sessions'),
    dryRun: false,
    force: false,
    failFast: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === '--help' || arg === '-h') {
      return 'help';
    }

    if (arg === '--dir') {
      const value = argv[index + 1];
      if (!value) {
        throw new Error('--dir requires a value');
      }
      options.dir = value;
      index += 1;
      continue;
    }

    if (arg === '--dry-run') {
      options.dryRun = true;
      continue;
    }

    if (arg === '--force') {
      options.force = true;
      continue;
    }

    if (arg === '--fail-fast') {
      options.failFast = true;
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  return options;
}

function printReport(report: MigrationReport): void {
  console.log(`migrated=${report.migrated} skipped=${report.skipped} failed=${report.failed}`);

  if (report.failures.length > 0) {
    console.log('failed sessions:');
    for (const failure of report.failures) {
      console.log(`- ${failure.sessionId}: ${failure.reason}`);
    }
  }
}

async function runCli(): Promise<void> {
  const parsed = parseCliArgs(process.argv.slice(2));
  if (parsed === 'help') {
    console.log(usage());
    return;
  }

  const report = await migrateSessionsJsonToJsonl(parsed);
  printReport(report);

  if (report.failed > 0) {
    process.exitCode = 1;
  }
}

const isMain = process.argv[1] === fileURLToPath(import.meta.url);
if (isMain) {
  runCli().catch((err) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
  });
}
