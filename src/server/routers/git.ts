import { z } from 'zod';
import { router, publicProcedure } from '../trpc';
import { getGitService } from '@/services/git';

export const gitRouter = router({
  status: publicProcedure
    .input(z.object({ forceRefresh: z.boolean().optional() }).optional())
    .query(({ input }) => getGitService().getStatus(input?.forceRefresh)),

  branches: publicProcedure
    .query(() => getGitService().getBranches()),

  log: publicProcedure
    .input(z.object({ limit: z.number().min(1).max(100).optional() }).optional())
    .query(({ input }) => getGitService().getLog(input?.limit)),

  diff: publicProcedure
    .input(z.object({
      file: z.string().optional(),
      staged: z.boolean().optional(),
    }).optional())
    .query(({ input }) => getGitService().getDiff(input?.file, input?.staged)),

  remotes: publicProcedure
    .query(() => getGitService().getRemotes()),

  stage: publicProcedure
    .input(z.object({ files: z.array(z.string()).min(1) }))
    .mutation(({ input }) => getGitService().add(...input.files)),

  unstage: publicProcedure
    .input(z.object({ files: z.array(z.string()).min(1) }))
    .mutation(({ input }) => getGitService().reset(...input.files)),

  commit: publicProcedure
    .input(z.object({ message: z.string().min(1) }))
    .mutation(({ input }) => getGitService().commit(input.message)),
});
