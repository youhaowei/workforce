import { z } from "zod";
import { router, publicProcedure } from "../trpc";
import { getReviewService } from "./_services";
import type { ReviewAction } from "@/services/types";

export const reviewRouter = router({
  list: publicProcedure
    .input(
      z.object({
        orgId: z.string(),
        status: z.enum(["pending", "resolved"]).optional(),
      }),
    )
    .query(({ input }) => getReviewService().list({ orgId: input.orgId, status: input.status })),

  listPending: publicProcedure
    .input(z.object({ orgId: z.string() }))
    .query(({ input }) => getReviewService().listPending(input.orgId)),

  count: publicProcedure
    .input(z.object({ orgId: z.string() }))
    .query(({ input }) => getReviewService().pendingCount(input.orgId)),

  get: publicProcedure
    .input(z.object({ id: z.string(), orgId: z.string() }))
    .query(({ input }) => getReviewService().get(input.id, input.orgId)),

  resolve: publicProcedure
    .input(
      z.object({
        id: z.string(),
        orgId: z.string(),
        action: z.enum(["approve", "reject", "edit", "clarify"]),
        comment: z.string().optional(),
      }),
    )
    .mutation(({ input }) =>
      getReviewService().resolve(
        input.id,
        input.orgId,
        input.action as ReviewAction,
        input.comment,
      ),
    ),
});
