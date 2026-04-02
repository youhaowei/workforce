/**
 * Session Upgrade System — Version-aware lazy upgrades on session load.
 *
 * Uses @wystack/version's SchemaVersion to track the current session schema.
 * When a session's version is behind, registered upgraders run in order,
 * writing new records to the journal. The caller then re-replays to get
 * the clean, upgraded session.
 *
 * Upgraders are atomic per version step: if any upgrader in a version fails,
 * that version is not bumped and will retry on next load.
 */

import { SchemaVersion } from '@wystack/version';
import { semver, isoFrom, isoNow, type SemVer } from '@wystack/types';
import type { Session, JournalMeta } from './types';
import { replaySession, appendRecords, JSONL_VERSION } from './session-journal';
import { createLogger } from 'tracey';

const log = createLogger('SessionUpgrade');

// =============================================================================
// Schema Definition
// =============================================================================

/** Current session schema version — bump when adding upgraders. */
export const SESSION_SCHEMA_VERSION = semver('0.4.0');

export const sessionSchema = new SchemaVersion({
  current: SESSION_SCHEMA_VERSION,
  changelog: [
    {
      version: semver('0.3.0'),
      date: isoFrom('2026-02-01'),
      description: 'Baseline JSONL format with messages, tool calls, and metadata',
      breaking: false,
    },
    {
      version: semver('0.4.0'),
      date: isoFrom('2026-03-18'),
      description: 'Extract plan artifacts from CC sessions',
      breaking: false,
    },
  ],
});

// =============================================================================
// Upgrader Registry
// =============================================================================

export interface UpgradeContext {
  session: Session;
  sessionsDir: string;
}

export interface Upgrader {
  id: string;
  /** Only run if this returns true */
  applicable: (ctx: UpgradeContext) => boolean;
  /** Run the upgrade. Write records to journal as needed. */
  run: (ctx: UpgradeContext) => Promise<void>;
}

/** Upgraders keyed by the version they bring the session TO. */
const upgradersByVersion = new Map<string, Upgrader[]>();

export function registerUpgrader(version: SemVer, upgrader: Upgrader) {
  const key = version as string;
  const list = upgradersByVersion.get(key) ?? [];
  list.push(upgrader);
  upgradersByVersion.set(key, list);
}

// =============================================================================
// Core: loadSession
// =============================================================================

export interface LoadResult {
  session: Session;
  maxSeq: number;
  upgraded: boolean;
}

/**
 * Load a session with automatic upgrades.
 *
 * 1. replaySession() → get session + version
 * 2. Check staleness via SchemaVersion
 * 3. If stale: run upgraders (they write records to journal)
 * 4. replaySession() again → clean upgraded session
 * 5. Return
 */
export async function loadSession(sessionsDir: string, sessionId: string): Promise<LoadResult | null> {
  const firstPass = await replaySession(sessionsDir, sessionId);
  if (!firstPass) return null;

  const { session, maxSeq } = firstPass;
  const sessionVersion = session.metadata._schemaVersion as string | undefined ?? JSONL_VERSION;

  const staleness = sessionSchema.checkStaleness({
    schemaVersion: semver(sessionVersion),
    versionedAt: isoNow(), // not time-based, so this doesn't matter
  });

  if (!staleness.stale) {
    return { session, maxSeq, upgraded: false };
  }

  log.info({ sessionId, from: sessionVersion, to: SESSION_SCHEMA_VERSION }, 'Session needs upgrade');

  // Get changelog entries between session version and current
  const changes = sessionSchema.changesSince(semver(sessionVersion));
  let upgraded = false;

  for (const change of changes) {
    const upgraders = upgradersByVersion.get(change.version as string) ?? [];
    if (upgraders.length === 0) continue;

    const ctx: UpgradeContext = { session, sessionsDir };
    let versionSuccess = true;

    for (const upgrader of upgraders) {
      if (!upgrader.applicable(ctx)) continue;

      try {
        await upgrader.run(ctx);
        log.info({ sessionId, upgrader: upgrader.id, version: change.version }, 'Upgrader completed');
        upgraded = true;
      } catch (err) {
        log.error({ sessionId, upgrader: upgrader.id, err }, `Upgrader failed: ${upgrader.id}`);
        versionSuccess = false;
        break; // Atomic: stop this version step on failure
      }
    }

    if (!versionSuccess) break; // Don't proceed to later versions

    // Stamp the version
    await appendRecords(sessionsDir, sessionId, [{
      t: 'meta', seq: 0, ts: Date.now(),
      patch: { _schemaVersion: change.version as string },
    } satisfies JournalMeta]);
  }

  if (!upgraded) {
    // No upgraders ran (all skipped), but still stamp the version
    const versionStr = SESSION_SCHEMA_VERSION as string;
    await appendRecords(sessionsDir, sessionId, [{
      t: 'meta', seq: 0, ts: Date.now(),
      patch: { _schemaVersion: versionStr },
    } satisfies JournalMeta]);
    session.metadata._schemaVersion = versionStr;
    return { session, maxSeq, upgraded: false };
  }

  // Re-replay to pick up records written by upgraders
  const secondPass = await replaySession(sessionsDir, sessionId);
  if (!secondPass) return { session, maxSeq, upgraded: true }; // shouldn't happen

  return { session: secondPass.session, maxSeq: secondPass.maxSeq, upgraded: true };
}

// =============================================================================
// Built-in Upgrader: Extract CC Plan Artifacts (0.4.0)
// =============================================================================

registerUpgrader(semver('0.4.0'), {
  id: 'extract-cc-plans',

  applicable: (ctx) => ctx.session.metadata.source === 'claude-code',

  async run(ctx) {
    const { extractPlansFromRecords } = await import('./artifact-extractor');
    const { getArtifactService } = await import('./artifact');

    // session.records is populated by replaySession()'s applyRecord() default case,
    // which pushes unknown record types (tool_call, hook, file_change, etc.) into it.
    const records = ctx.session.records ?? [];
    const plans = extractPlansFromRecords(records);
    if (plans.length === 0) return;

    const artifactService = getArtifactService();
    await artifactService.ensureInitialized();

    // Check existing to avoid duplicates
    const existing = await artifactService.list({ sessionId: ctx.session.id });
    const existingPaths = new Set(existing.map((a) => a.filePath));

    const orgId = (ctx.session.metadata.orgId as string) ?? '';

    for (const plan of plans) {
      if (existingPaths.has(plan.filePath)) continue;
      await artifactService.create({
        orgId,
        title: plan.title,
        mimeType: 'text/markdown',
        filePath: plan.filePath,
        content: plan.content,
        createdBy: { type: 'system' },
        sessionId: ctx.session.id,
        metadata: { source: 'cc_import', originalTimestamp: plan.timestamp },
      });
      log.info({ sessionId: ctx.session.id, filePath: plan.filePath }, 'Created plan artifact from CC session');
    }
  },
});
