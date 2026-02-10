/**
 * tRPC v11 initialization — shared router/procedure factories.
 *
 * Uses superjson so Date, Map, Set etc. survive serialization.
 * All procedures are public (auth is handled at the Hono/Tauri layer).
 */

import { initTRPC } from '@trpc/server';
import superjson from 'superjson';

const t = initTRPC.create({
  transformer: superjson,
});

export const router = t.router;
export const publicProcedure = t.procedure;
export const createCallerFactory = t.createCallerFactory;
