import { z } from "zod";
import { router, publicProcedure } from "../trpc";
import { getAuditService } from "./_services";
import type { AuditEntryType } from "@/services/types";

export const auditRouter = router({
  org: publicProcedure
    .input(
      z.object({
        orgId: z.string(),
        limit: z.number().optional(),
        offset: z.number().optional(),
        type: z
          .enum(["state_change", "tool_use", "review_decision", "agent_spawn", "worktree_action"])
          .optional(),
      }),
    )
    .query(({ input }) =>
      getAuditService().getForOrg(input.orgId, {
        limit: input.limit,
        offset: input.offset,
        type: input.type as AuditEntryType | undefined,
      }),
    ),

  session: publicProcedure
    .input(z.object({ sessionId: z.string(), orgId: z.string() }))
    .query(({ input }) => getAuditService().getForSession(input.sessionId, input.orgId)),
});
