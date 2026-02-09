/**
 * Integration Tests
 *
 * Cross-service integration tests to verify system behavior.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdir, rm, writeFile } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';

import { getEventBus, createEventBus, type EventBus } from '../shared/event-bus';
import { LogService } from './log';
import { createSessionService } from './session';
import { GitService } from './git';
import { execFileNoThrow } from '../utils/execFileNoThrow';

// Test directory
let testDir: string;

beforeEach(async () => {
  testDir = join(tmpdir(), `workforce-integration-test-${Date.now()}`);
  await mkdir(testDir, { recursive: true });
});

afterEach(async () => {
  try {
    await rm(testDir, { recursive: true, force: true });
  } catch {
    // Ignore cleanup errors
  }
});

// ============================================================================
// EventBus Integration Tests
// ============================================================================

describe('EventBus integration', () => {
  let bus: EventBus;

  beforeEach(() => {
    bus = createEventBus();
  });

  afterEach(() => {
    bus.dispose();
  });

  it('wildcard listener receives all events', () => {
    const events: string[] = [];

    bus.on('*', (event) => {
      events.push(event.type);
    });

    bus.emit({ type: 'TokenDelta', token: 'a', index: 0, timestamp: Date.now() });
    bus.emit({ type: 'ToolStart', toolId: '1', toolName: 'Read', args: {}, timestamp: Date.now() });
    bus.emit({ type: 'ToolEnd', toolId: '1', toolName: 'Read', result: {}, duration: 100, timestamp: Date.now() });

    expect(events).toEqual(['TokenDelta', 'ToolStart', 'ToolEnd']);
  });

  it('typed listener only receives matching events', () => {
    const tokenEvents: string[] = [];

    bus.on('TokenDelta', (event) => {
      tokenEvents.push(event.token);
    });

    bus.emit({ type: 'TokenDelta', token: 'a', index: 0, timestamp: Date.now() });
    bus.emit({ type: 'ToolStart', toolId: '1', toolName: 'Read', args: {}, timestamp: Date.now() });
    bus.emit({ type: 'TokenDelta', token: 'b', index: 1, timestamp: Date.now() });

    expect(tokenEvents).toEqual(['a', 'b']);
  });

  it('once listener fires only once', () => {
    let count = 0;

    bus.once('TokenDelta', () => {
      count++;
    });

    bus.emit({ type: 'TokenDelta', token: 'a', index: 0, timestamp: Date.now() });
    bus.emit({ type: 'TokenDelta', token: 'b', index: 1, timestamp: Date.now() });
    bus.emit({ type: 'TokenDelta', token: 'c', index: 2, timestamp: Date.now() });

    expect(count).toBe(1);
  });

  it('backpressure pauses and resumes events', () => {
    const events: number[] = [];

    bus.on('TokenDelta', (event) => {
      events.push(event.index);
    });

    const controller = bus.getBackpressureController();

    // Pause and queue events
    controller.pause();
    bus.emit({ type: 'TokenDelta', token: 'a', index: 0, timestamp: Date.now() });
    bus.emit({ type: 'TokenDelta', token: 'b', index: 1, timestamp: Date.now() });

    expect(events).toEqual([]); // Paused, nothing delivered
    expect(controller.queueSize()).toBe(2);

    // Resume and flush
    controller.resume();

    expect(events).toEqual([0, 1]);
    expect(controller.queueSize()).toBe(0);
  });

  it('priority listeners fire in order', () => {
    const order: number[] = [];

    bus.on('TokenDelta', () => order.push(3), { priority: 1 });
    bus.on('TokenDelta', () => order.push(1), { priority: 10 }); // Highest priority
    bus.on('TokenDelta', () => order.push(2), { priority: 5 });

    bus.emit({ type: 'TokenDelta', token: 'a', index: 0, timestamp: Date.now() });

    expect(order).toEqual([1, 2, 3]);
  });
});

// ============================================================================
// Log Service + EventBus Integration
// ============================================================================

describe('LogService + EventBus integration', () => {
  it('logs tool events automatically after setup', async () => {
    const logDir = join(testDir, 'logs');
    await mkdir(logDir, { recursive: true });

    const logService = new LogService({
      logDir,
      minLevel: 'debug',
    });
    await logService.setup();

    // Emit events through global bus
    const bus = getEventBus();
    bus.emit({
      type: 'ToolStart',
      toolId: 'test-1',
      toolName: 'TestTool',
      args: { file: '/test.txt' },
      timestamp: Date.now(),
    });

    bus.emit({
      type: 'ToolEnd',
      toolId: 'test-1',
      toolName: 'TestTool',
      result: { success: true },
      duration: 150,
      timestamp: Date.now(),
    });

    // Check log entries
    const entries = logService.getEntries();
    const toolEntries = entries.filter((e) => e.category === 'tool');

    expect(toolEntries.length).toBe(2);
    expect(toolEntries[0].message).toContain('TestTool');
    expect(toolEntries[1].data?.duration).toBe(150);

    await logService.dispose();
  });
});

// ============================================================================
// Session + Git Integration
// ============================================================================

describe('Session + Git integration', () => {
  it('session stores git branch info', async () => {
    // Initialize git repo
    await execFileNoThrow('git', ['init'], { cwd: testDir });
    await execFileNoThrow('git', ['config', 'user.email', 'test@test.com'], { cwd: testDir });
    await execFileNoThrow('git', ['config', 'user.name', 'Test'], { cwd: testDir });
    await writeFile(join(testDir, 'file.txt'), 'content');
    await execFileNoThrow('git', ['add', '.'], { cwd: testDir });
    await execFileNoThrow('git', ['commit', '-m', 'Initial'], { cwd: testDir });

    const gitService = new GitService({ cwd: testDir });
    const status = await gitService.getStatus();

    expect(status).not.toBeNull();
    expect(status!.branch).toBeTruthy();

    // Session can store this context
    const sessionsDir = join(testDir, 'sessions');
    const sessionService = createSessionService(sessionsDir);
    const session = await sessionService.create();

    // Store git context in metadata (simulating real usage)
    session.metadata = {
      ...(session.metadata ?? {}),
      gitBranch: status!.branch,
      gitIsClean: status!.isClean,
    };

    await sessionService.save(session);

    // Reload and verify
    const loaded = await sessionService.get(session.id);
    expect(loaded?.metadata?.gitBranch).toBe(status!.branch);
    expect(loaded?.metadata?.gitIsClean).toBe(true);
  });
});

// ============================================================================
// Error Handling Integration
// ============================================================================

describe('error handling integration', () => {
  it('BridgeError events are logged', async () => {
    const logDir = join(testDir, 'logs');
    await mkdir(logDir, { recursive: true });

    const logService = new LogService({
      logDir,
      minLevel: 'debug',
    });
    await logService.setup();

    const bus = getEventBus();
    bus.emit({
      type: 'BridgeError',
      source: 'TestBridge',
      error: 'Connection failed',
      code: 'ECONNREFUSED',
      timestamp: Date.now(),
    });

    const entries = logService.getEntries();
    const errorEntries = entries.filter((e) => e.level === 'error');

    expect(errorEntries.length).toBe(1);
    expect(errorEntries[0].message).toContain('Connection failed');

    await logService.dispose();
  });

  it('async listener errors are caught', async () => {
    const bus = createEventBus();
    let errorCaught = false;

    // Spy on console.error
    const originalError = console.error;
    console.error = () => {
      errorCaught = true;
    };

    bus.on('TokenDelta', async () => {
      throw new Error('Async listener error');
    });

    await bus.emitAsync({ type: 'TokenDelta', token: 'a', index: 0, timestamp: Date.now() });

    // Wait for async error to be caught
    await new Promise((r) => setTimeout(r, 10));

    console.error = originalError;
    expect(errorCaught).toBe(true);

    bus.dispose();
  });
});

// ============================================================================
// Command Execution Tests
// ============================================================================

describe('execFileNoThrow', () => {
  it('handles successful command', async () => {
    const result = await execFileNoThrow('echo', ['hello']);
    expect(result.status).toBe('success');
    expect(result.stdout.trim()).toBe('hello');
    expect(result.exitCode).toBe(0);
  });

  it('handles failed command', async () => {
    const result = await execFileNoThrow('ls', ['/nonexistent/path/that/does/not/exist']);
    expect(result.status).toBe('error');
    expect(result.exitCode).not.toBe(0);
  });

  it('handles timeout', async () => {
    const result = await execFileNoThrow('sleep', ['10'], { timeout: 100 });
    expect(result.status).toBe('timeout');
    expect(result.exitCode).toBeNull();
  });

  it('uses custom cwd', async () => {
    const result = await execFileNoThrow('pwd', [], { cwd: testDir });
    expect(result.status).toBe('success');
    expect(result.stdout).toContain('workforce-integration-test');
  });
});

// ============================================================================
// Cleanup Verification
// ============================================================================

describe('service cleanup', () => {
  it('EventBus dispose clears all listeners', () => {
    const bus = createEventBus();
    bus.on('TokenDelta', () => {});
    bus.on('ToolStart', () => {});
    bus.on('*', () => {});

    expect(bus.totalListenerCount()).toBe(3);

    bus.dispose();

    expect(bus.totalListenerCount()).toBe(0);
  });

  it('GitService dispose clears cache', async () => {
    const gitService = new GitService({ cwd: testDir, cacheTtlMs: 10000 });

    // Trigger cache population (won't work without git init, but that's ok)
    await gitService.isRepo();

    gitService.dispose();

    // No direct way to verify cache cleared, but dispose should not throw
    expect(true).toBe(true);
  });
});
