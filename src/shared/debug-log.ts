/**
 * Debug logging utility that writes to both console and a file.
 * Enable with DEBUG_LOG=1 environment variable.
 */

import { appendFileSync, writeFileSync } from 'fs';
import { join } from 'path';

let LOG_FILE = '';
let initialized = false;

function init(): void {
  if (initialized) return;
  initialized = true;

  try {
    LOG_FILE = join(process.cwd(), 'debug.log');
    writeFileSync(LOG_FILE, `=== Fuxi Debug Log Started ${new Date().toISOString()} ===\n`);
  } catch {
    // Ignore errors in browser environment
  }
}

export function debugLog(component: string, message: string, data?: unknown): void {
  const timestamp = new Date().toISOString();
  const line = `[${timestamp}] [${component}] ${message}${data !== undefined ? ' ' + JSON.stringify(data) : ''}`;

  console.log(line);

  if (!initialized) init();

  if (LOG_FILE) {
    try {
      appendFileSync(LOG_FILE, line + '\n');
    } catch {
      // Ignore errors in browser environment
    }
  }
}

export function getLogPath(): string {
  if (!initialized) init();
  return LOG_FILE;
}
