/**
 * Log Service - Observability and debugging
 *
 * Provides structured logging with:
 * - Ring buffer for recent logs
 * - Automatic redaction of sensitive data
 * - Periodic flush to disk
 * - Crash recovery via exception handlers
 */

import { mkdir, writeFile, appendFile } from 'fs/promises';
import { join } from 'path';
import { homedir } from 'os';
import { getEventBus } from '../shared/event-bus';

// ============================================================================
// Types
// ============================================================================

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';
export type LogCategory = 'api' | 'tool' | 'event' | 'perf' | 'session' | 'general';

export interface LogEntry {
  timestamp: number;
  level: LogLevel;
  category: LogCategory;
  message: string;
  data?: Record<string, unknown>;
}

export interface LogServiceOptions {
  maxEntries?: number;
  logDir?: string;
  flushIntervalMs?: number;
  minLevel?: LogLevel;
}

// ============================================================================
// Redaction
// ============================================================================

const REDACT_PATTERNS = [
  /sk-[a-zA-Z0-9]{20,}/g, // Anthropic API keys
  /sk-ant-[a-zA-Z0-9-]+/g, // Anthropic API keys (alternate format)
  /Bearer [a-zA-Z0-9._-]+/gi, // Auth headers
  /password["'\s:=]+[^\s,}"']+/gi, // Password fields
  /ghp_[a-zA-Z0-9]{36}/g, // GitHub personal access tokens
  /gho_[a-zA-Z0-9]{36}/g, // GitHub OAuth tokens
  /github_pat_[a-zA-Z0-9_]{22,}/g, // GitHub fine-grained PATs
];

/**
 * Redact sensitive data from a string.
 */
export function redact(text: string): string {
  return REDACT_PATTERNS.reduce(
    (result, pattern) => result.replace(pattern, '[REDACTED]'),
    text
  );
}

/**
 * Deep redact an object - redacts string values recursively.
 */
function deepRedact(obj: unknown): unknown {
  if (typeof obj === 'string') {
    return redact(obj);
  }
  if (Array.isArray(obj)) {
    return obj.map(deepRedact);
  }
  if (obj && typeof obj === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj)) {
      // Redact values for sensitive keys entirely
      const lowerKey = key.toLowerCase();
      if (
        lowerKey.includes('password') ||
        lowerKey.includes('secret') ||
        lowerKey.includes('token') ||
        lowerKey.includes('api_key') ||
        lowerKey.includes('apikey') ||
        lowerKey === 'authorization'
      ) {
        result[key] = '[REDACTED]';
      } else {
        result[key] = deepRedact(value);
      }
    }
    return result;
  }
  return obj;
}

// ============================================================================
// Log Level Ordering
// ============================================================================

const LOG_LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

// ============================================================================
// Log Service
// ============================================================================

export class LogService {
  private buffer: LogEntry[] = [];
  private readonly maxEntries: number;
  private readonly logDir: string;
  private readonly flushIntervalMs: number;
  private readonly minLevel: LogLevel;

  private flushInterval: ReturnType<typeof setInterval> | null = null;
  private isSetup = false;

  constructor(options: LogServiceOptions = {}) {
    this.maxEntries = options.maxEntries ?? 1000;
    this.logDir = options.logDir ?? join(homedir(), '.workforce', 'logs');
    this.flushIntervalMs = options.flushIntervalMs ?? 5 * 60 * 1000; // 5 minutes
    this.minLevel = options.minLevel ?? 'info';
  }

  /**
   * Initialize the log service - sets up handlers and intervals.
   */
  async setup(): Promise<void> {
    if (this.isSetup) return;

    // Ensure log directory exists
    await mkdir(this.logDir, { recursive: true, mode: 0o700 });

    // Set up periodic flush
    this.flushInterval = setInterval(() => {
      this.flush().catch(console.error);
    }, this.flushIntervalMs);

    // Set up crash handlers
    process.on('uncaughtException', (error) => {
      this.error('general', 'Uncaught exception', { error: error.message, stack: error.stack });
      this.flush().catch(console.error);
    });

    process.on('unhandledRejection', (reason) => {
      this.error('general', 'Unhandled rejection', { reason: String(reason) });
      this.flush().catch(console.error);
    });

    process.on('beforeExit', () => {
      this.flush().catch(console.error);
    });

    // Subscribe to EventBus for automatic logging
    this.subscribeToEvents();

    this.isSetup = true;
  }

  /**
   * Subscribe to EventBus events for automatic logging.
   */
  private subscribeToEvents(): void {
    const bus = getEventBus();

    // Log tool events
    bus.on('ToolStart', (event) => {
      this.info('tool', `Tool started: ${event.toolName}`, {
        toolId: event.toolId,
        toolName: event.toolName,
      });
    });

    bus.on('ToolEnd', (event) => {
      this.info('tool', `Tool ended: ${event.toolName}`, {
        toolId: event.toolId,
        toolName: event.toolName,
        duration: event.duration,
      });
    });

    // Log session events
    bus.on('SessionChange', (event) => {
      this.info('session', `Session ${event.action}: ${event.sessionId}`, {
        sessionId: event.sessionId,
        action: event.action,
      });
    });

    // Log errors
    bus.on('BridgeError', (event) => {
      this.error('general', `Bridge error: ${event.error}`, {
        source: event.source,
        code: event.code,
      });
    });
  }

  /**
   * Add a log entry.
   */
  log(entry: Omit<LogEntry, 'timestamp'>): void {
    // Check level filter
    if (LOG_LEVEL_ORDER[entry.level] < LOG_LEVEL_ORDER[this.minLevel]) {
      return;
    }

    // Redact sensitive data
    const safeEntry: LogEntry = {
      ...entry,
      timestamp: Date.now(),
      message: redact(entry.message),
      data: entry.data ? (deepRedact(entry.data) as Record<string, unknown>) : undefined,
    };

    // Add to buffer
    this.buffer.push(safeEntry);

    // Trim if over limit
    if (this.buffer.length > this.maxEntries) {
      this.buffer.shift();
    }
  }

  /**
   * Convenience methods for each log level.
   */
  debug(category: LogCategory, message: string, data?: Record<string, unknown>): void {
    this.log({ level: 'debug', category, message, data });
  }

  info(category: LogCategory, message: string, data?: Record<string, unknown>): void {
    this.log({ level: 'info', category, message, data });
  }

  warn(category: LogCategory, message: string, data?: Record<string, unknown>): void {
    this.log({ level: 'warn', category, message, data });
  }

  error(category: LogCategory, message: string, data?: Record<string, unknown>): void {
    this.log({ level: 'error', category, message, data });
  }

  /**
   * Log API request (without content).
   */
  logApiRequest(data: {
    model: string;
    inputTokens?: number;
    outputTokens?: number;
    latencyMs?: number;
    success: boolean;
    error?: string;
  }): void {
    this.info('api', 'API request', {
      model: data.model,
      inputTokens: data.inputTokens,
      outputTokens: data.outputTokens,
      latencyMs: data.latencyMs,
      success: data.success,
      error: data.error,
    });
  }

  /**
   * Log performance timing.
   */
  logPerf(operation: string, durationMs: number, data?: Record<string, unknown>): void {
    this.info('perf', `${operation}: ${durationMs}ms`, {
      operation,
      durationMs,
      ...data,
    });
  }

  /**
   * Get all entries in the buffer.
   */
  getEntries(): ReadonlyArray<LogEntry> {
    return this.buffer;
  }

  /**
   * Get entries filtered by level.
   */
  getEntriesByLevel(level: LogLevel): LogEntry[] {
    return this.buffer.filter((e) => e.level === level);
  }

  /**
   * Get entries filtered by category.
   */
  getEntriesByCategory(category: LogCategory): LogEntry[] {
    return this.buffer.filter((e) => e.category === category);
  }

  /**
   * Get entry count.
   */
  getEntryCount(): number {
    return this.buffer.length;
  }

  /**
   * Clear the buffer.
   */
  clear(): void {
    this.buffer = [];
  }

  /**
   * Flush buffer to disk.
   */
  async flush(): Promise<string | null> {
    if (this.buffer.length === 0) {
      return null;
    }

    const entries = [...this.buffer];
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `workforce-${timestamp}.log`;
    const filepath = join(this.logDir, filename);

    try {
      const content = entries
        .map((e) => {
          const time = new Date(e.timestamp).toISOString();
          const data = e.data ? ` ${JSON.stringify(e.data)}` : '';
          return `[${time}] [${e.level.toUpperCase()}] [${e.category}] ${e.message}${data}`;
        })
        .join('\n');

      await writeFile(filepath, content + '\n', { mode: 0o600 });

      // Clear buffer after successful flush
      this.buffer = [];

      return filepath;
    } catch (error) {
      console.error('Failed to flush logs:', error);
      return null;
    }
  }

  /**
   * Append to a specific log file (for continuous logging).
   */
  async appendToFile(filepath: string, entry: LogEntry): Promise<void> {
    const time = new Date(entry.timestamp).toISOString();
    const data = entry.data ? ` ${JSON.stringify(entry.data)}` : '';
    const line = `[${time}] [${entry.level.toUpperCase()}] [${entry.category}] ${entry.message}${data}\n`;

    await appendFile(filepath, line, { mode: 0o600 });
  }

  /**
   * Dispose of the service.
   */
  async dispose(): Promise<void> {
    if (this.flushInterval) {
      clearInterval(this.flushInterval);
      this.flushInterval = null;
    }

    // Final flush
    await this.flush();

    this.isSetup = false;
  }
}

// ============================================================================
// Singleton
// ============================================================================

let instance: LogService | null = null;

export function getLogService(options?: LogServiceOptions): LogService {
  if (!instance) {
    instance = new LogService(options);
  }
  return instance;
}

export async function initLogService(options?: LogServiceOptions): Promise<LogService> {
  const service = getLogService(options);
  await service.setup();
  return service;
}

export function disposeLogService(): void {
  if (instance) {
    instance.dispose().catch(console.error);
    instance = null;
  }
}
