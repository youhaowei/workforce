/**
 * tRPC v11 initialization — shared router/procedure factories.
 *
 * Uses superjson so Date, Map, Set etc. survive serialization.
 * All procedures are public (auth is handled at the Hono layer).
 *
 * In dev mode, a logging middleware traces every procedure call with
 * timing, input summary, and result size. Output goes to debug.log
 * and console. Subscriptions log start only (streaming data is noisy).
 */

import { initTRPC } from '@trpc/server';
import superjson from 'superjson';
import { debugLog } from '@/shared/debug-log';

export const isDev = process.env.NODE_ENV !== 'production';

const ERROR_HINTS: Record<string, string> = {
  NOT_FOUND: 'Check that the resource ID exists and the org is active.',
  BAD_REQUEST: 'Verify your input matches the expected schema (use tRPC panel for reference).',
  INTERNAL_SERVER_ERROR: 'Check debug.log (GET /debug-log) for server-side stack trace.',
  UNAUTHORIZED: 'Ensure the server has valid Claude CLI credentials (~/.claude/.credentials.json).',
  FORBIDDEN: 'This operation may require an active org to be selected first.',
  TIMEOUT: 'The operation timed out. For long-running tasks, use the background task API.',
  CONFLICT: 'The resource was modified concurrently. Refresh and retry.',
};

const t = initTRPC.create({
  transformer: superjson,
  errorFormatter({ shape, error }) {
    return {
      ...shape,
      data: {
        ...shape.data,
        hint: ERROR_HINTS[error.code] ?? null,
      },
    };
  },
});

/** Summarize procedure input for logging (avoid dumping huge payloads). */
function summarizeInput(raw: unknown): string {
  if (raw === undefined || raw === null) return '';
  const s = JSON.stringify(raw);
  return s.length > 200 ? s.slice(0, 200) + '…' : s;
}

/** Summarize procedure result for logging. */
function summarizeResult(raw: unknown): string {
  if (raw === undefined || raw === null) return 'null';
  if (Array.isArray(raw)) return `Array(${raw.length})`;
  if (typeof raw === 'object') {
    const keys = Object.keys(raw as Record<string, unknown>);
    return `{${keys.slice(0, 5).join(',')}}`;
  }
  return String(raw).slice(0, 100);
}

const devLoggingMiddleware = t.middleware(async ({ path, type, getRawInput, next }) => {
  const start = performance.now();
  const rawInput = await getRawInput();
  debugLog('tRPC', `→ ${type} ${path} ${summarizeInput(rawInput)}`);

  const result = await next();

  const ms = (performance.now() - start).toFixed(1);
  if (result.ok) {
    debugLog('tRPC', `← ${path} OK ${ms}ms ${summarizeResult(result.data)}`);
  } else {
    debugLog('tRPC', `← ${path} ERROR ${ms}ms ${result.error.message}`);
  }
  return result;
});

export const router = t.router;
export const publicProcedure = isDev
  ? t.procedure.use(devLoggingMiddleware)
  : t.procedure;
export const createCallerFactory = t.createCallerFactory;
