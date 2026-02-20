import { z } from 'zod';
import { router, publicProcedure } from '../trpc';
import { getUserService } from '@/services/user';

export const userRouter = router({
  get: publicProcedure.query(() => getUserService().get()),

  exists: publicProcedure.query(() => getUserService().exists()),

  create: publicProcedure
    .input(z.object({ displayName: z.string().min(1) }))
    .mutation(({ input }) => getUserService().create(input.displayName)),

  update: publicProcedure
    .input(z.object({
      displayName: z.string().min(1).optional(),
    }))
    .mutation(({ input }) => getUserService().update(input)),

  // Test-only: used by E2E resetServerState() to wipe user identity.
  // Safe in trusted-local model (localhost-only server).
  delete: publicProcedure
    .mutation(() => getUserService().delete()),
});
