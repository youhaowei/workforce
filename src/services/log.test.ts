/**
 * Log Service Tests
 *
 * Tests for the thin EventBus → tracey wiring layer.
 * Redaction, ring buffer, and file transport tests live in tracey.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { LogService, getLogService, disposeLogService } from './log';

afterEach(() => {
  disposeLogService();
});

describe('LogService', () => {
  it('setup is idempotent', async () => {
    const service = new LogService();
    await service.setup();
    await service.setup(); // second call should be no-op
  });

  it('exposes convenience log methods', () => {
    const service = new LogService();
    // These should not throw
    service.info('general', 'test message');
    service.warn('api', 'warning', { key: 'value' });
    service.error('tool', 'error');
  });

  it('logApiRequest does not throw', () => {
    const service = new LogService();
    service.logApiRequest({
      model: 'claude-3-opus',
      inputTokens: 100,
      outputTokens: 500,
      latencyMs: 1500,
      success: true,
    });
  });

  it('logPerf does not throw', () => {
    const service = new LogService();
    service.logPerf('startup', 250, { phase: 'init' });
  });
});

describe('singleton', () => {
  it('getLogService returns same instance', () => {
    const s1 = getLogService();
    const s2 = getLogService();
    expect(s1).toBe(s2);
  });

  it('disposeLogService clears instance', () => {
    const s1 = getLogService();
    disposeLogService();
    const s2 = getLogService();
    expect(s1).not.toBe(s2);
  });
});
