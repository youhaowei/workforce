import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { tmpdir } from 'os';
import { join } from 'path';
import { mkdirSync, writeFileSync, rmSync, readFileSync } from 'fs';

// Mock data-dir to use a temp directory per test
let testDir = '';
vi.mock('./data-dir', () => ({
  getDataDir: () => testDir,
}));

import { readLastUsedModelSync, writeLastUsedModel, ModelCache } from './agent-models';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

function mockModelsResponse(models: Array<{ id: string; display_name: string }>) {
  mockFetch.mockResolvedValueOnce({
    ok: true,
    json: async () => ({ data: models }),
  });
}

function createTestDir(): string {
  const dir = join(tmpdir(), `workforce-agent-models-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

describe('agent-models', () => {
  beforeEach(() => {
    testDir = createTestDir();
    vi.clearAllMocks();
  });

  afterEach(async () => {
    // ModelCache/writeDiskModelCache persist in the background; give the file
    // write a little time to settle before removing the temp directory.
    await new Promise((resolve) => setTimeout(resolve, 200));
    rmSync(testDir, { recursive: true, force: true });
    delete process.env.ANTHROPIC_API_KEY;
  });

  describe('readLastUsedModelSync', () => {
    it('returns null when no file exists', () => {
      expect(readLastUsedModelSync()).toBeNull();
    });

    it('reads persisted model from disk', () => {
      const cacheDir = join(testDir, 'cache');
      mkdirSync(cacheDir, { recursive: true });
      writeFileSync(join(cacheDir, 'last-model.json'), JSON.stringify({ model: 'claude-opus-4-6' }));
      expect(readLastUsedModelSync()).toBe('claude-opus-4-6');
    });

    it('returns null for invalid JSON', () => {
      const cacheDir = join(testDir, 'cache');
      mkdirSync(cacheDir, { recursive: true });
      writeFileSync(join(cacheDir, 'last-model.json'), 'not json');
      expect(readLastUsedModelSync()).toBeNull();
    });

    it('returns null if model field is not a string', () => {
      const cacheDir = join(testDir, 'cache');
      mkdirSync(cacheDir, { recursive: true });
      writeFileSync(join(cacheDir, 'last-model.json'), JSON.stringify({ model: 42 }));
      expect(readLastUsedModelSync()).toBeNull();
    });
  });

  describe('writeLastUsedModel', () => {
    /** Poll until a file exists and is valid JSON, or timeout. */
    async function waitForFile(path: string, timeoutMs = 2000): Promise<string> {
      const start = Date.now();
      while (Date.now() - start < timeoutMs) {
        try {
          const raw = readFileSync(path, 'utf-8');
          JSON.parse(raw); // validate it's complete JSON
          return raw;
        } catch {
          await new Promise((r) => setTimeout(r, 20));
        }
      }
      throw new Error(`File not ready after ${timeoutMs}ms: ${path}`);
    }

    it('persists model to disk', async () => {
      writeLastUsedModel('claude-sonnet-4-6');
      const raw = await waitForFile(join(testDir, 'cache', 'last-model.json'));
      expect(JSON.parse(raw)).toEqual({ model: 'claude-sonnet-4-6' });
    });

    it('creates cache directory if needed', async () => {
      writeLastUsedModel('claude-haiku-4-5-20251001');
      const raw = await waitForFile(join(testDir, 'cache', 'last-model.json'));
      expect(JSON.parse(raw).model).toBe('claude-haiku-4-5-20251001');
    });
  });

  describe('ModelCache', () => {
    it('returns API models on cold start (no disk cache)', async () => {
      process.env.ANTHROPIC_API_KEY = 'test-key';
      mockModelsResponse([
        { id: 'opus', display_name: 'Opus' },
        { id: 'sonnet', display_name: 'Sonnet' },
      ]);

      const cache = new ModelCache();
      const models = await cache.getSupportedModels();

      expect(models).toEqual([
        { id: 'opus', displayName: 'Opus', description: '' },
        { id: 'sonnet', displayName: 'Sonnet', description: '' },
      ]);
      expect(mockFetch).toHaveBeenCalledOnce();
    });

    it('hydrates from disk cache and returns immediately', async () => {
      const diskModels = [{ id: 'cached', displayName: 'Cached', description: 'From disk' }];
      const cacheDir = join(testDir, 'cache');
      mkdirSync(cacheDir, { recursive: true });
      writeFileSync(join(cacheDir, 'model-cache.json'), JSON.stringify({
        models: diskModels,
        cachedAt: Date.now(),
      }));

      // API call will hang — but we should get disk cache instantly
      mockFetch.mockImplementation(() => new Promise(() => {}));

      const cache = new ModelCache();
      const models = await cache.getSupportedModels();
      expect(models).toEqual(diskModels);
    });

    it('returns fallback models when API fails and no disk cache', async () => {
      process.env.ANTHROPIC_API_KEY = 'test-key';
      mockFetch.mockRejectedValueOnce(new Error('network error'));

      const cache = new ModelCache();
      const models = await cache.getSupportedModels();

      expect(models.length).toBeGreaterThanOrEqual(3);
      expect(models.some((m) => m.id.includes('opus'))).toBe(true);
    });

    it('deduplicates concurrent getSupportedModels calls', async () => {
      process.env.ANTHROPIC_API_KEY = 'test-key';
      let resolveCall!: (v: Response) => void;
      mockFetch.mockImplementation(() => new Promise((r) => { resolveCall = r; }));

      const cache = new ModelCache();
      const p1 = cache.getSupportedModels();
      const p2 = cache.getSupportedModels();

      resolveCall({
        ok: true,
        json: async () => ({ data: [{ id: 'opus', display_name: 'Opus' }] }),
      } as Response);

      const [r1, r2] = await Promise.all([p1, p2]);
      expect(r1).toEqual(r2);
      expect(mockFetch).toHaveBeenCalledOnce();
    });

    it('paginates when has_more is true', async () => {
      process.env.ANTHROPIC_API_KEY = 'test-key';
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ data: [{ id: 'page1', display_name: 'Page1' }], has_more: true, last_id: 'page1' }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ data: [{ id: 'page2', display_name: 'Page2' }], has_more: false }),
        });

      const cache = new ModelCache();
      const models = await cache.getSupportedModels();

      expect(models).toEqual([
        { id: 'page1', displayName: 'Page1', description: '' },
        { id: 'page2', displayName: 'Page2', description: '' },
      ]);
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });
  });
});
