/**
 * Git tRPC Router
 *
 * Exposes git operations through tRPC. All endpoints require a `cwd` parameter
 * to specify which directory to operate in (typically a project's rootPath).
 *
 * The service is instantiated per-request with the given cwd rather than using
 * a global singleton, since git operations are directory-scoped.
 */

import { z } from 'zod';
import { router, publicProcedure } from '../trpc';
import { GitService } from '@/services/git';

/** Create a short-lived GitService scoped to the given directory. */
function gitFor(cwd: string): GitService {
  return new GitService({ cwd });
}

export const gitRouter = router({
  /** Get git status (branch, staged/unstaged/untracked files, ahead/behind). */
  status: publicProcedure
    .input(z.object({
      cwd: z.string(),
      forceRefresh: z.boolean().optional(),
    }))
    .query(async ({ input }) => {
      const svc = gitFor(input.cwd);
      const status = await svc.getStatus(input.forceRefresh ?? false);
      return status;
    }),

  /** List branches (local + remote). */
  branches: publicProcedure
    .input(z.object({ cwd: z.string() }))
    .query(async ({ input }) => {
      const svc = gitFor(input.cwd);
      return svc.getBranches();
    }),

  /** Get recent commit log. */
  log: publicProcedure
    .input(z.object({
      cwd: z.string(),
      limit: z.number().optional().default(10),
    }))
    .query(async ({ input }) => {
      const svc = gitFor(input.cwd);
      return svc.getLog(input.limit);
    }),

  /** Get diff (optionally for a specific file, staged or unstaged). */
  diff: publicProcedure
    .input(z.object({
      cwd: z.string(),
      file: z.string().optional(),
      staged: z.boolean().optional().default(false),
    }))
    .query(async ({ input }) => {
      const svc = gitFor(input.cwd);
      return svc.getDiff(input.file, input.staged);
    }),

  /** Stage files. */
  stage: publicProcedure
    .input(z.object({
      cwd: z.string(),
      files: z.array(z.string()).min(1),
    }))
    .mutation(async ({ input }) => {
      const svc = gitFor(input.cwd);
      const ok = await svc.add(...input.files);
      return { success: ok };
    }),

  /** Unstage files. */
  unstage: publicProcedure
    .input(z.object({
      cwd: z.string(),
      files: z.array(z.string()).min(1),
    }))
    .mutation(async ({ input }) => {
      const svc = gitFor(input.cwd);
      const ok = await svc.reset(...input.files);
      return { success: ok };
    }),

  /** Create a commit with a message. Requires staged files. */
  commit: publicProcedure
    .input(z.object({
      cwd: z.string(),
      message: z.string().min(1),
    }))
    .mutation(async ({ input }) => {
      const svc = gitFor(input.cwd);
      return svc.commit(input.message);
    }),

  /** Check if a directory is a git repository. */
  isRepo: publicProcedure
    .input(z.object({ cwd: z.string() }))
    .query(async ({ input }) => {
      const svc = gitFor(input.cwd);
      return svc.isRepo();
    }),

  /** Get the repository root directory. */
  root: publicProcedure
    .input(z.object({ cwd: z.string() }))
    .query(async ({ input }) => {
      const svc = gitFor(input.cwd);
      return svc.getRoot();
    }),

  /** List remotes. */
  remotes: publicProcedure
    .input(z.object({ cwd: z.string() }))
    .query(async ({ input }) => {
      const svc = gitFor(input.cwd);
      return svc.getRemotes();
    }),
});
