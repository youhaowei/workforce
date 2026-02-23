/**
 * tRPC v11 initialization — shared router/procedure factories.
 *
 * Uses superjson so Date, Map, Set etc. survive serialization.
 * All procedures are public (auth is handled at the Hono layer).
 */

import { initTRPC } from '@trpc/server';
import superjson from 'superjson';

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

export const router = t.router;
export const publicProcedure = t.procedure;
export const createCallerFactory = t.createCallerFactory;
