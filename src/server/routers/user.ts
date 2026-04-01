import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, publicProcedure } from "../trpc";
import { getUserService } from "@/services/user";

export const userRouter = router({
  get: publicProcedure.query(() => getUserService().get()),

  exists: publicProcedure.query(() => getUserService().exists()),

  create: publicProcedure
    .input(z.object({ displayName: z.string().min(1).max(100) }))
    .mutation(async ({ input }) => {
      try {
        return await getUserService().create(input.displayName);
      } catch (err) {
        if (err instanceof Error && err.message.includes("already exists")) {
          throw new TRPCError({ code: "CONFLICT", message: err.message });
        }
        throw err;
      }
    }),

  update: publicProcedure
    .input(
      z.object({
        displayName: z.string().min(1).max(100).optional(),
      }),
    )
    .mutation(({ input }) => getUserService().update(input)),

  // Test-only: used by E2E resetServerState() to wipe user identity.
  // Safe in trusted-local model (localhost-only server).
  delete: publicProcedure.mutation(() => getUserService().delete()),
});
