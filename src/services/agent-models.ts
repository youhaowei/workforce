/**
 * Agent model cache — disk-backed with stale-while-revalidate.
 *
 * Extracted from agent.ts to keep file sizes manageable.
 */

import { readFileSync } from 'fs';
import { writeFile, mkdir } from 'fs/promises';
import { join } from 'path';
import type { AgentModelInfo } from './types';
import { createLogger } from 'tracey';
import { getDataDir } from './data-dir';

const log = createLogger('Agent');

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
        log.info({ count: parsed.models.length }, `Hydrated ${parsed.models.length} models from disk cache (sync)`);
      }
    } catch {
      // No disk cache available — first run.
    }
  }

  /** Fetch fresh models from the Anthropic API directly (no CLI subprocess). */
  private async refreshFromSdk(): Promise<AgentModelInfo[]> {
    try {
      const apiKey = process.env.ANTHROPIC_API_KEY ?? process.env.ANTHROPIC_AUTH_TOKEN;
      if (!apiKey) {
        log.debug('No API key available for model refresh, using cache/fallbacks');
        return this.cache ?? FALLBACK_MODELS;
      }

      // The /v1/models endpoint paginates (default limit=20, max=1000).
      // Use limit=1000 to minimize round-trips, then follow `has_more` / `last_id`
      // cursor pagination to collect all models.
      const allModels: Array<{ id: string; display_name: string; created_at?: string }> = [];
      let afterId: string | undefined;

      do {
        const url = new URL('https://api.anthropic.com/v1/models');
        url.searchParams.set('limit', '1000');
        if (afterId) url.searchParams.set('after_id', afterId);

        const res = await fetch(url.toString(), {
          headers: {
            'x-api-key': apiKey,
            'anthropic-version': '2023-06-01',
          },
          signal: AbortSignal.timeout(10_000),
        });
        if (!res.ok) throw new Error(`API returned ${res.status}`);

        const page = await res.json() as {
          data: Array<{ id: string; display_name: string; created_at?: string }>;
          has_more: boolean;
          last_id: string | null;
        };

        allModels.push(...page.data);

        if (page.has_more && page.last_id) {
          afterId = page.last_id;
        } else {
          break;
        }
      } while (afterId);

      const normalized: AgentModelInfo[] = allModels.map((m) => ({
        id: m.id,
        displayName: m.display_name,
        description: '',
      }));
      this.cache = normalized;
      this.cacheAt = Date.now();
      writeDiskModelCache(normalized).catch(() => {});
      log.info({ count: normalized.length }, `Model refresh complete: ${normalized.length} models`);
      return normalized;
    } catch (err) {
      log.error({ error: err instanceof Error ? err.message : String(err) }, 'Model refresh failed');
      return this.cache ?? FALLBACK_MODELS;
    }
  }
}
