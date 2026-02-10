import { z } from 'zod';
import { getWorkspaceService } from '@services/workspace';
import { publicProcedure, t } from '../core';

export const workspaceRouter = t.router({
  current: publicProcedure.query(async () => getWorkspaceService().getCurrent()),
  list: publicProcedure.query(async () => getWorkspaceService().list()),
  create: publicProcedure
    .input(z.object({ name: z.string().min(1) }))
    .mutation(async ({ input }) => getWorkspaceService().create(input.name)),
  switch: publicProcedure
    .input(z.object({ workspaceId: z.string().min(1) }))
    .mutation(async ({ input }) => getWorkspaceService().switch(input.workspaceId)),
});
