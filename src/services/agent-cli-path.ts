import { execFileSync } from 'child_process';
import { debugLog } from '@/shared/debug-log';

let cachedPath: string | undefined;

/**
 * Resolve the system-installed `claude` binary path.
 * Caches the result — the binary location won't change during a session.
 */
export function resolveClaudeCliPath(): string | undefined {
  if (cachedPath !== undefined) return cachedPath || undefined;

  try {
    cachedPath = execFileSync('which', ['claude'], { encoding: 'utf-8' }).trim();
    debugLog('AgentCliPath', `Resolved claude binary: ${cachedPath}`);
  } catch {
    cachedPath = '';
    debugLog('AgentCliPath', 'claude binary not found on PATH');
  }

  return cachedPath || undefined;
}
