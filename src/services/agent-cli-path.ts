import { execFileSync } from 'child_process';
import { createLogger } from 'tracey';

const log = createLogger('AgentCliPath');

let cachedPath: string | undefined;

/**
 * Resolve the system-installed `claude` binary path.
 * Caches the result — the binary location won't change during a session.
 */
export function resolveClaudeCliPath(): string | undefined {
  if (cachedPath !== undefined) return cachedPath || undefined;

  try {
    cachedPath = execFileSync('which', ['claude'], { encoding: 'utf-8' }).trim();
    log.info({ path: cachedPath }, `Resolved claude binary: ${cachedPath}`);
  } catch {
    cachedPath = '';
    log.warn('claude binary not found on PATH');
  }

  return cachedPath || undefined;
}
