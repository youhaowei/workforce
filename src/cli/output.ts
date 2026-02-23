/** Output formatting utilities for CLI commands. */

import type { Command } from 'commander';

export function printJson(data: unknown) {
  console.log(JSON.stringify(data, null, 2));
}

export function printTable(rows: Record<string, unknown>[], columns?: string[]) {
  if (!rows || rows.length === 0) {
    console.log('(empty)');
    return;
  }
  const cols = columns ?? Object.keys(rows[0]);
  const widths = cols.map((c) =>
    Math.max(c.length, ...rows.map((r) => String(r[c] ?? '').length))
  );
  console.log(cols.map((c, i) => c.padEnd(widths[i])).join('  '));
  console.log(cols.map((_, i) => '─'.repeat(widths[i])).join('  '));
  for (const row of rows) {
    console.log(cols.map((c, i) => String(row[c] ?? '').padEnd(widths[i])).join('  '));
  }
}

/** Read the --json flag from the root program's options. */
export function isJsonMode(cmd: Command) {
  return cmd.optsWithGlobals().json === true;
}
