/**
 * Log Service - EventBus → tracey wiring
 *
 * Thin wrapper that subscribes to EventBus events and routes them
 * through tracey's structured logger. Redaction, file transport,
 * ring buffer, and crash handlers are handled by tracey itself.
 */

import { createLogger } from "tracey";
import { getEventBus } from "../shared/event-bus";

export type LogLevel = "debug" | "info" | "warn" | "error";
export type LogCategory = "api" | "tool" | "event" | "perf" | "session" | "general";

const log = createLogger("EventBus");
const apiLog = createLogger("API");
const perfLog = createLogger("Perf");

export class LogService {
  private isSetup = false;

  async setup(): Promise<void> {
    if (this.isSetup) return;
    this.subscribeToEvents();
    this.isSetup = true;
  }

  private subscribeToEvents(): void {
    const bus = getEventBus();

    bus.on("ToolStart", (event) => {
      log.info(
        { toolId: event.toolId, toolName: event.toolName },
        `Tool started: ${event.toolName}`,
      );
    });

    bus.on("ToolEnd", (event) => {
      log.info(
        { toolId: event.toolId, toolName: event.toolName, duration: event.duration },
        `Tool ended: ${event.toolName}`,
      );
    });

    bus.on("SessionChange", (event) => {
      log.info(
        { sessionId: event.sessionId, action: event.action },
        `Session ${event.action}: ${event.sessionId}`,
      );
    });

    bus.on("BridgeError", (event) => {
      log.error({ source: event.source, code: event.code }, `Bridge error: ${event.error}`);
    });
  }

  logApiRequest(data: {
    model: string;
    inputTokens?: number;
    outputTokens?: number;
    latencyMs?: number;
    success: boolean;
    error?: string;
  }): void {
    apiLog.info(data, "API request");
  }

  logPerf(operation: string, durationMs: number, data?: Record<string, unknown>): void {
    perfLog.info({ operation, durationMs, ...data }, `${operation}: ${durationMs}ms`);
  }

  info(category: LogCategory, message: string, data?: Record<string, unknown>): void {
    log.info({ category, ...data }, message);
  }

  warn(category: LogCategory, message: string, data?: Record<string, unknown>): void {
    log.warn({ category, ...data }, message);
  }

  error(category: LogCategory, message: string, data?: Record<string, unknown>): void {
    log.error({ category, ...data }, message);
  }

  async dispose(): Promise<void> {
    this.isSetup = false;
  }
}

let instance: LogService | null = null;

export function getLogService(): LogService {
  if (!instance) {
    instance = new LogService();
  }
  return instance;
}

export async function initLogService(): Promise<LogService> {
  const service = getLogService();
  await service.setup();
  return service;
}

export function disposeLogService(): void {
  instance = null;
}
