/**
 * Search Tool Formatters
 *
 * Formats output for Glob and Grep tools.
 */

export interface GlobResult {
  files: string[];
  pattern: string;
  cwd?: string;
}

export interface GrepMatch {
  file: string;
  line: number;
  content: string;
  contextBefore?: string[];
  contextAfter?: string[];
}

export interface GrepResult {
  matches: GrepMatch[];
  pattern: string;
  totalMatches: number;
  filesSearched?: number;
}

export function formatGlob(result: unknown): { summary: string; files: string[] } {
  if (!result || typeof result !== 'object') {
    return { summary: 'Search completed', files: [] };
  }

  const r = result as GlobResult;
  const count = r.files?.length ?? 0;

  return {
    summary: `Found ${count} file${count !== 1 ? 's' : ''} matching "${r.pattern}"`,
    files: r.files ?? [],
  };
}

export function formatGrep(result: unknown): { summary: string; matches: GrepMatch[] } {
  if (!result || typeof result !== 'object') {
    return { summary: 'Search completed', matches: [] };
  }

  const r = result as GrepResult;
  const matchCount = r.totalMatches ?? r.matches?.length ?? 0;
  const fileCount = new Set(r.matches?.map((m) => m.file) ?? []).size;

  return {
    summary: `Found ${matchCount} match${matchCount !== 1 ? 'es' : ''} in ${fileCount} file${fileCount !== 1 ? 's' : ''} for "${r.pattern}"`,
    matches: r.matches ?? [],
  };
}

/**
 * Format a single grep match with context lines.
 */
export function formatGrepMatch(match: GrepMatch): string {
  const lines: string[] = [];

  if (match.contextBefore) {
    for (const ctx of match.contextBefore) {
      lines.push(`   ${ctx}`);
    }
  }

  lines.push(`${match.line}: ${match.content}`);

  if (match.contextAfter) {
    for (const ctx of match.contextAfter) {
      lines.push(`   ${ctx}`);
    }
  }

  return lines.join('\n');
}
