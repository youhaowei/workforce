/**
 * Agent model cache — disk-backed with stale-while-revalidate.
 *
 * Extracted from agent.ts to keep file sizes manageable.
 */

import { getSupportedModels } from 'unifai';
import { readFileSync } from 'fs';
import { writeFile, mkdir } from 'fs/promises';
import { join } from 'path';
import type { AgentModelInfo } from './types';
import { buildSdkEnv } from './agent-instance';
import { debugLog } from '@/shared/debug-log';
import { getDataDir } from './data-dir';

// ---------------------------------------------------------------------------
// Disk-backed model cache — survives restarts so cold starts return instantly.
// ---------------------------------------------------------------------------

const MODEL_CACHE_FILENAME = 'model-cache.json';

interface DiskModelCache {
  models: AgentModelInfo[];
  cachedAt: number;
}

/**
 * Hardcoded fallback models returned when both disk cache and SDK subprocess
 * are unavailable (absolute first run, offline, auth failure, etc.).
 * Keeps the model dropdown populated so the UI is never blank.
 */
const FALLBACK_MODELS: AgentModelInfo[] = [
  { id: 'claude-opus-4-6', displayName: 'Opus 4.6', description: 'Most capable model' },
  { id: 'claude-sonnet-4-6', displayName: 'Sonnet 4.6', description: 'Fast and capable' },
  { id: 'claude-sonnet-4-5-20250929', displayName: 'Sonnet 4.5', description: 'Balanced performance' },
  { id: 'claude-haiku-4-5-20251001', displayName: 'Haiku 4.5', description: 'Fastest, lowest cost' },
];

function modelCachePath(): string {
  return join(getDataDir(), 'cache', MODEL_CACHE_FILENAME);
}

async function writeDiskModelCache(models: AgentModelInfo[]): Promise<void> {
  try {
    const dir = join(getDataDir(), 'cache');
    await mkdir(dir, { recursive: true });
    const data: DiskModelCache = { models, cachedAt: Date.now() };
    await writeFile(modelCachePath(), JSON.stringify(data, null, 2), 'utf-8');
  } catch {
    // Best-effort — failure here is non-critical.
  }
}

// ---------------------------------------------------------------------------
// Last-used model — persisted so warm-up targets the right model on restart.
// ---------------------------------------------------------------------------

const LAST_MODEL_FILENAME = 'last-model.json';

function lastModelPath(): string {
  return join(getDataDir(), 'cache', LAST_MODEL_FILENAME);
}

/** Synchronously read the last-used model (called once at startup). */
export function readLastUsedModelSync(): string | null {
  try {
    const raw = readFileSync(lastModelPath(), 'utf-8');
    const parsed = JSON.parse(raw);
    return typeof parsed.model === 'string' ? parsed.model : null;
  } catch {
    return null;
  }
}

/** Persist the last-used model for next startup (best-effort, async). */
export function writeLastUsedModel(model: string): void {
  mkdir(join(getDataDir(), 'cache'), { recursive: true })
    .then(() => writeFile(lastModelPath(), JSON.stringify({ model }), 'utf-8'))
    .catch(() => {});
}

// ---------------------------------------------------------------------------
// ModelCache class — encapsulates caching, dedup, disk hydration, and SDK refresh.
// ---------------------------------------------------------------------------

export class ModelCache {
  private cache: AgentModelInfo[] | null = null;
  private cacheAt = 0;
  /** In-flight getSupportedModels promise — deduplicates concurrent callers. */
  private inflight: Promise<AgentModelInfo[]> | null = null;

  constructor() {
    this.hydrateFromDiskSync();

    // Start the (slow) SDK subprocess refresh immediately so fresh model data
    // is ready as early as possible.
    this.inflight = this.refreshFromSdk().finally(() => {
      this.inflight = null;
    });
  }

  async getSupportedModels(): Promise<AgentModelInfo[]> {
    // If we already have a cache (hydrated from disk or a previous refresh),
    // return it immediately and kick off a background refresh if stale.
    if (this.cache) {
      if (Date.now() - this.cacheAt >= 5 * 60_000 && !this.inflight) {
        this.inflight = this.refreshFromSdk().finally(() => { this.inflight = null; });
      }
      return this.cache;
    }

    // No cache yet (cold start / first run) — await the in-flight SDK refresh
    // so the first caller gets real models instead of hardcoded fallbacks.
    // A 15-second timeout prevents hanging if the SDK subprocess is stuck.
    if (!this.inflight) {
      this.inflight = this.refreshFromSdk().finally(() => { this.inflight = null; });
    }
    try {
      return await Promise.race([
        this.inflight,
        new Promise<AgentModelInfo[]>((_, reject) =>
          setTimeout(() => reject(new Error('model refresh timeout')), 15_000),
        ),
      ]);
    } catch {
      return FALLBACK_MODELS;
    }
  }

  /**
   * Synchronously read the disk model cache into memory.
   * Called once in the constructor so the first call returns instantly.
   */
  private hydrateFromDiskSync(): void {
    try {
      const raw = readFileSync(modelCachePath(), 'utf-8');
      const parsed = JSON.parse(raw) as DiskModelCache;
      if (Array.isArray(parsed.models) && parsed.models.length > 0) {
        this.cache = parsed.models;
        this.cacheAt = Date.now();
        debugLog('Agent', `Hydrated ${parsed.models.length} models from disk cache (sync)`);
      }
    } catch {
      // No disk cache available — first run.
    }
  }

  /** Fetch fresh models from the Claude SDK subprocess and update both caches. */
  private async refreshFromSdk(): Promise<AgentModelInfo[]> {
    try {
      const models = await getSupportedModels('claude', { cwd: process.cwd(), env: buildSdkEnv() });
      const normalized: AgentModelInfo[] = models.map((m) => ({
        id: m.id,
        displayName: m.displayName,
        description: m.description,
      }));
      this.cache = normalized;
      this.cacheAt = Date.now();
      writeDiskModelCache(normalized).catch(() => {});
      debugLog('Agent', `SDK model refresh complete: ${normalized.length} models`);
      return normalized;
    } catch (err) {
      debugLog('Agent', 'SDK model refresh failed', {
        error: err instanceof Error ? err.message : String(err),
      });
      return this.cache ?? FALLBACK_MODELS;
    }
  }
}
