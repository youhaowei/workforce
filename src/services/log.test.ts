/**
 * Log Service Tests
 *
 * Tests for structured logging, redaction, and persistence.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdir, rm, readFile, readdir } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { LogService, redact, getLogService, disposeLogService } from './log';

// Test directory
let testDir: string;
let service: LogService;

beforeEach(async () => {
  // Create fresh test directory
  testDir = join(tmpdir(), `workforce-log-test-${Date.now()}`);
  await mkdir(testDir, { recursive: true });

  // Create service with test directory
  service = new LogService({
    logDir: testDir,
    maxEntries: 100,
    flushIntervalMs: 60000, // Long interval for tests
    minLevel: 'debug',
  });
});

afterEach(async () => {
  disposeLogService();
  try {
    await rm(testDir, { recursive: true, force: true });
  } catch {
    // Ignore cleanup errors
  }
});

// ============================================================================
// Redaction Tests
// ============================================================================

describe('redaction', () => {
  it('redacts Anthropic API keys', () => {
    const text = 'Using key sk-ant-api03-abcdefghijklmnopqrstuvwxyz12345';
    expect(redact(text)).toBe('Using key [REDACTED]');
  });

  it('redacts short-form API keys', () => {
    const text = 'Key: sk-abc123def456ghi789jkl012mno345';
    expect(redact(text)).toBe('Key: [REDACTED]');
  });

  it('redacts Bearer tokens', () => {
    const text = 'Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.xxx';
    expect(redact(text)).toBe('Authorization: [REDACTED]');
  });

  it('redacts password fields', () => {
    const text = 'password: mysecretpassword123';
    expect(redact(text)).toBe('[REDACTED]');
  });

  it('redacts GitHub PATs', () => {
    const text = 'Token: ghp_abcdefghijklmnopqrstuvwxyz123456789a';
    expect(redact(text)).toBe('Token: [REDACTED]');
  });

  it('redacts GitHub fine-grained PATs', () => {
    const text = 'Using github_pat_11ABCDEFG0hijklmno12_pqrstuvwxyz';
    expect(redact(text)).toBe('Using [REDACTED]');
  });

  it('redacts GitHub OAuth tokens', () => {
    const text = 'OAuth: gho_abcdefghijklmnopqrstuvwxyz123456789a';
    expect(redact(text)).toBe('OAuth: [REDACTED]');
  });

  it('preserves non-sensitive text', () => {
    const text = 'Hello world, this is a normal message';
    expect(redact(text)).toBe(text);
  });

  it('handles multiple sensitive items', () => {
    const text = 'Key1: sk-abc123def456ghi789jkl012mno345, password: secret';
    const result = redact(text);
    expect(result).toContain('[REDACTED]');
    expect(result).not.toContain('sk-abc');
    expect(result).not.toContain('secret');
  });
});

// ============================================================================
// Basic Logging Tests
// ============================================================================

describe('basic logging', () => {
  it('logs entries to buffer', () => {
    service.info('general', 'Test message');
    expect(service.getEntryCount()).toBe(1);
  });

  it('logs with data', () => {
    service.info('api', 'API call', { model: 'claude-3', count: 100 });
    const entries = service.getEntries();
    expect(entries[0].data).toEqual({ model: 'claude-3', count: 100 });
  });

  it('logs different levels', () => {
    service.debug('general', 'Debug');
    service.info('general', 'Info');
    service.warn('general', 'Warn');
    service.error('general', 'Error');

    expect(service.getEntryCount()).toBe(4);
    expect(service.getEntriesByLevel('debug')).toHaveLength(1);
    expect(service.getEntriesByLevel('info')).toHaveLength(1);
    expect(service.getEntriesByLevel('warn')).toHaveLength(1);
    expect(service.getEntriesByLevel('error')).toHaveLength(1);
  });

  it('logs different categories', () => {
    service.info('api', 'API');
    service.info('tool', 'Tool');
    service.info('event', 'Event');
    service.info('perf', 'Perf');

    expect(service.getEntriesByCategory('api')).toHaveLength(1);
    expect(service.getEntriesByCategory('tool')).toHaveLength(1);
    expect(service.getEntriesByCategory('event')).toHaveLength(1);
    expect(service.getEntriesByCategory('perf')).toHaveLength(1);
  });

  it('adds timestamp automatically', () => {
    const before = Date.now();
    service.info('general', 'Test');
    const after = Date.now();

    const entry = service.getEntries()[0];
    expect(entry.timestamp).toBeGreaterThanOrEqual(before);
    expect(entry.timestamp).toBeLessThanOrEqual(after);
  });
});

// ============================================================================
// Level Filtering Tests
// ============================================================================

describe('level filtering', () => {
  it('filters below minimum level', () => {
    const infoService = new LogService({
      logDir: testDir,
      minLevel: 'info',
    });

    infoService.debug('general', 'Debug - should be filtered');
    infoService.info('general', 'Info - should pass');

    expect(infoService.getEntryCount()).toBe(1);
    expect(infoService.getEntries()[0].message).toBe('Info - should pass');
  });

  it('passes at minimum level', () => {
    const warnService = new LogService({
      logDir: testDir,
      minLevel: 'warn',
    });

    warnService.info('general', 'Info');
    warnService.warn('general', 'Warn');
    warnService.error('general', 'Error');

    expect(warnService.getEntryCount()).toBe(2);
  });
});

// ============================================================================
// Buffer Management Tests
// ============================================================================

describe('buffer management', () => {
  it('respects max entries limit', () => {
    const smallService = new LogService({
      logDir: testDir,
      maxEntries: 5,
    });

    for (let i = 0; i < 10; i++) {
      smallService.info('general', `Message ${i}`);
    }

    expect(smallService.getEntryCount()).toBe(5);
    // Should have the last 5 messages
    const entries = smallService.getEntries();
    expect(entries[0].message).toBe('Message 5');
    expect(entries[4].message).toBe('Message 9');
  });

  it('clears buffer', () => {
    service.info('general', 'Test 1');
    service.info('general', 'Test 2');
    expect(service.getEntryCount()).toBe(2);

    service.clear();
    expect(service.getEntryCount()).toBe(0);
  });
});

// ============================================================================
// Redaction in Logging Tests
// ============================================================================

describe('automatic redaction', () => {
  it('redacts messages', () => {
    service.info('general', 'Using key sk-ant-api03-abcdefghijklmnopqrstuvwxyz12345');
    const entry = service.getEntries()[0];
    expect(entry.message).toBe('Using key [REDACTED]');
  });

  it('redacts data values', () => {
    service.info('api', 'Request', {
      apiKey: 'sk-abc123def456ghi789jkl012mno345',
      model: 'claude-3',
    });

    const entry = service.getEntries()[0];
    expect(entry.data?.apiKey).toBe('[REDACTED]');
    expect(entry.data?.model).toBe('claude-3');
  });

  it('redacts sensitive key names entirely', () => {
    service.info('general', 'Config', {
      password: 'mysecret',
      token: 'abc123',
      authorization: 'Bearer xyz',
      username: 'john', // Not sensitive
    });

    const entry = service.getEntries()[0];
    expect(entry.data?.password).toBe('[REDACTED]');
    expect(entry.data?.token).toBe('[REDACTED]');
    expect(entry.data?.authorization).toBe('[REDACTED]');
    expect(entry.data?.username).toBe('john');
  });
});

// ============================================================================
// Flush Tests
// ============================================================================

describe('flush to disk', () => {
  it('writes logs to file', async () => {
    service.info('general', 'Test message 1');
    service.warn('api', 'Test message 2');

    const filepath = await service.flush();
    expect(filepath).not.toBeNull();

    const content = await readFile(filepath!, 'utf-8');
    expect(content).toContain('Test message 1');
    expect(content).toContain('Test message 2');
    expect(content).toContain('[INFO]');
    expect(content).toContain('[WARN]');
  });

  it('clears buffer after flush', async () => {
    service.info('general', 'Test');
    expect(service.getEntryCount()).toBe(1);

    await service.flush();
    expect(service.getEntryCount()).toBe(0);
  });

  it('returns null for empty buffer', async () => {
    const result = await service.flush();
    expect(result).toBeNull();
  });

  it('creates unique filenames', async () => {
    service.info('general', 'First');
    await service.flush();

    // Small delay to ensure different timestamp
    await new Promise((r) => setTimeout(r, 10));

    service.info('general', 'Second');
    await service.flush();

    const files = await readdir(testDir);
    expect(files.length).toBe(2);
  });
});

// ============================================================================
// Convenience Methods Tests
// ============================================================================

describe('convenience methods', () => {
  it('logApiRequest logs API info', () => {
    service.logApiRequest({
      model: 'claude-3-opus',
      inputTokens: 100,
      outputTokens: 500,
      latencyMs: 1500,
      success: true,
    });

    const entry = service.getEntries()[0];
    expect(entry.category).toBe('api');
    expect(entry.data?.model).toBe('claude-3-opus');
    expect(entry.data?.latencyMs).toBe(1500);
  });

  it('logPerf logs performance data', () => {
    service.logPerf('startup', 250, { phase: 'init' });

    const entry = service.getEntries()[0];
    expect(entry.category).toBe('perf');
    expect(entry.message).toContain('250ms');
    expect(entry.data?.durationMs).toBe(250);
  });
});

// ============================================================================
// Singleton Tests
// ============================================================================

describe('singleton', () => {
  it('getLogService returns same instance', () => {
    disposeLogService();
    const s1 = getLogService({ logDir: testDir });
    const s2 = getLogService();
    expect(s1).toBe(s2);
  });

  it('disposeLogService clears instance', () => {
    const s1 = getLogService({ logDir: testDir });
    disposeLogService();
    const s2 = getLogService({ logDir: testDir });
    expect(s1).not.toBe(s2);
  });
});
