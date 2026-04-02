/**
 * Bash Tool Formatter
 *
 * Formats command output with terminal-style display.
 */

export interface BashResult {
  stdout?: string;
  stderr?: string;
  exitCode?: number;
  command?: string;
  duration?: number;
}

/**
 * Strip ANSI escape codes for plain text display.
 * For full color support, use a terminal emulator component.
 */
export function stripAnsi(str: string): string {
  // eslint-disable-next-line no-control-regex
  return str.replace(/\x1b\[[0-9;]*m/g, '');
}

export function formatBash(result: unknown): { summary: string; detail: string; isError: boolean } {
  if (!result || typeof result !== 'object') {
    return { summary: 'Command executed', detail: String(result ?? ''), isError: false };
  }

  const r = result as BashResult;
  const exitCode = r.exitCode ?? 0;
  const isError = exitCode !== 0;

  let summary = r.command ? `$ ${r.command}` : 'Command executed';
  if (r.duration !== undefined) {
    summary += ` (${r.duration}ms)`;
  }
  if (isError) {
    summary += ` [exit ${exitCode}]`;
  }

  let detail = '';
  if (r.stdout) {
    detail += stripAnsi(r.stdout);
  }
  if (r.stderr) {
    detail += (detail ? '\n\n' : '') + `stderr:\n${stripAnsi(r.stderr)}`;
  }

  return { summary, detail, isError };
}

/**
 * Truncate long output with "... (N more lines)" indicator.
 */
export function truncateOutput(output: string, maxLines = 50): { text: string; truncated: boolean } {
  const lines = output.split('\n');
  if (lines.length <= maxLines) {
    return { text: output, truncated: false };
  }

  const truncated = lines.slice(0, maxLines).join('\n');
  const remaining = lines.length - maxLines;
  return {
    text: `${truncated}\n... (${remaining} more lines)`,
    truncated: true,
  };
}
