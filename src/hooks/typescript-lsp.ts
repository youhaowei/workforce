/**
 * TypeScript LSP Hook - Post-tool diagnostics
 *
 * Runs TypeScript type checking after Edit/Write operations
 * on TypeScript files and appends diagnostics to the result.
 *
 * Features:
 * - Post-edit diagnostics via `tsc --noEmit`
 * - Debounced for rapid edits (300ms)
 * - Only activates for .ts/.tsx files
 */

import { dirname } from 'path';
import { access } from 'fs/promises';
import { join } from 'path';
import { execFileNoThrow, type ExecResult } from '../utils/execFileNoThrow';
import type { HookContext, PostHookResult, PostHook } from '../services/types';

// Configuration
const DEBOUNCE_MS = 300;
const TSC_TIMEOUT_MS = 30000;

// State for debouncing
const pendingChecks = new Map<string, NodeJS.Timeout>();

export interface TypeScriptDiagnostic {
  file: string;
  line: number;
  column: number;
  code: string;
  message: string;
  severity: 'error' | 'warning';
}

export interface TypeScriptCheckResult {
  errors: TypeScriptDiagnostic[];
  warnings: TypeScriptDiagnostic[];
  duration: number;
}

/**
 * Parse tsc output into structured diagnostics.
 */
function parseTscOutput(output: string): TypeScriptDiagnostic[] {
  const diagnostics: TypeScriptDiagnostic[] = [];

  // tsc output format: file(line,col): error TS1234: message
  const regex = /^(.+?)\((\d+),(\d+)\):\s+(error|warning)\s+TS(\d+):\s+(.+)$/gm;
  let match;

  while ((match = regex.exec(output)) !== null) {
    diagnostics.push({
      file: match[1],
      line: parseInt(match[2], 10),
      column: parseInt(match[3], 10),
      code: `TS${match[5]}`,
      message: match[6],
      severity: match[4] as 'error' | 'warning',
    });
  }

  return diagnostics;
}

/**
 * Find the tsconfig.json for a file by searching up the directory tree.
 */
async function findTsConfig(filePath: string): Promise<string | null> {
  let dir = dirname(filePath);
  const root = '/';

  while (dir !== root) {
    const tsConfigPath = join(dir, 'tsconfig.json');
    try {
      await access(tsConfigPath);
      return dir;
    } catch {
      // Not found, continue up
      dir = dirname(dir);
    }
  }

  return null;
}

/**
 * Run TypeScript type checking on a file.
 */
async function runTypeCheck(filePath: string): Promise<TypeScriptCheckResult> {
  const startTime = Date.now();
  const projectDir = await findTsConfig(filePath);

  if (!projectDir) {
    // No tsconfig found, skip
    return { errors: [], warnings: [], duration: 0 };
  }

  // Run tsc with noEmit using execFile (safe from injection)
  const result: ExecResult = await execFileNoThrow(
    'npx',
    ['tsc', '--noEmit'],
    {
      cwd: projectDir,
      timeout: TSC_TIMEOUT_MS,
    }
  );

  const output = result.stdout + result.stderr;

  if (result.status === 'success') {
    // No errors
    return {
      errors: [],
      warnings: [],
      duration: Date.now() - startTime,
    };
  }

  if (result.status === 'timeout') {
    // Timeout - return warning
    return {
      errors: [],
      warnings: [
        {
          file: filePath,
          line: 0,
          column: 0,
          code: 'TS0000',
          message: 'TypeScript check timed out',
          severity: 'warning',
        },
      ],
      duration: Date.now() - startTime,
    };
  }

  // Parse errors from output
  const diagnostics = parseTscOutput(output);
  const errors = diagnostics.filter((d) => d.severity === 'error');
  const warnings = diagnostics.filter((d) => d.severity === 'warning');

  return {
    errors,
    warnings,
    duration: Date.now() - startTime,
  };
}

/**
 * Debounced type check - cancels previous pending checks for the same file.
 */
function scheduleTypeCheck(filePath: string): Promise<TypeScriptCheckResult> {
  return new Promise((resolve) => {
    // Cancel any pending check for this file
    const existing = pendingChecks.get(filePath);
    if (existing) {
      clearTimeout(existing);
    }

    // Schedule new check
    const timeout = setTimeout(async () => {
      pendingChecks.delete(filePath);
      const result = await runTypeCheck(filePath);
      resolve(result);
    }, DEBOUNCE_MS);

    pendingChecks.set(filePath, timeout);
  });
}

/**
 * The TypeScript diagnostics post-hook.
 *
 * Register with:
 * hookService.registerPostHook('typescript-diagnostics', typescriptDiagnosticsHook, 10);
 */
export const typescriptDiagnosticsHook: PostHook = async (
  context: HookContext,
  result: unknown
): Promise<PostHookResult> => {
  // Only process Edit and Write tools
  if (!['Edit', 'Write'].includes(context.toolName)) {
    return {};
  }

  // Get file path from args
  const filePath = context.args.file_path as string | undefined;
  if (!filePath) {
    return {};
  }

  // Only process TypeScript files
  if (!filePath.endsWith('.ts') && !filePath.endsWith('.tsx')) {
    return {};
  }

  // Run type check
  const checkResult = await scheduleTypeCheck(filePath);

  // If no errors, return unmodified
  if (checkResult.errors.length === 0 && checkResult.warnings.length === 0) {
    return {};
  }

  // Format diagnostics for display
  const formattedErrors = checkResult.errors.map(
    (d) => `${d.file}:${d.line}:${d.column} - ${d.code}: ${d.message}`
  );

  // Append diagnostics to result
  const modifiedResult = {
    ...(result as Record<string, unknown>),
    typescript_diagnostics: {
      errors: checkResult.errors,
      warnings: checkResult.warnings,
      duration: checkResult.duration,
    },
  };

  // Add warning message if errors found
  if (checkResult.errors.length > 0) {
    (modifiedResult as Record<string, unknown>).typescript_warning =
      `Edit introduced ${checkResult.errors.length} TypeScript error(s):\n${formattedErrors.join('\n')}`;
  }

  return { modifiedResult };
};

/**
 * Cancel all pending type checks.
 */
export function cancelAllPendingChecks(): void {
  for (const timeout of pendingChecks.values()) {
    clearTimeout(timeout);
  }
  pendingChecks.clear();
}

/**
 * Get the number of pending checks.
 */
export function getPendingCheckCount(): number {
  return pendingChecks.size;
}

// Export for testing
export { runTypeCheck, parseTscOutput, findTsConfig };
