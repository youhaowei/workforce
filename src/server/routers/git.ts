import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { existsSync } from "fs";
import { resolve, isAbsolute } from "path";
import { router, publicProcedure } from "../trpc";
import { GitService } from "@/services/git";

// ─── validation ─────────────────────────────────────────────────────────────

const relativePath = z
  .string()
  .refine(
    (f) => !isAbsolute(f) && !f.split("/").includes(".."),
    "file paths must be relative within repo",
  );

function assertAbsolute(cwd: string): string {
  if (!isAbsolute(cwd)) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "cwd must be an absolute path" });
  }
  return resolve(cwd);
}

function validateGitCwd(cwd: string): string {
  const resolved = assertAbsolute(cwd);
  if (!existsSync(resolve(resolved, ".git"))) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "cwd is not a git repository root" });
  }
  return resolved;
}

// ─── service cache ──────────────────────────────────────────────────────────

const serviceCache = new Map<string, GitService>();

function gitFor(cwd: string): GitService {
  const validated = validateGitCwd(cwd);
  let svc = serviceCache.get(validated);
  if (!svc) {
    svc = new GitService({ cwd: validated });
    serviceCache.set(validated, svc);
  }
  return svc;
}

/** Clear the service cache (for test teardown). */
export function resetGitRouterCache(): void {
  for (const svc of serviceCache.values()) svc.dispose();
  serviceCache.clear();
}

export const gitRouter = router({
  status: publicProcedure
    .input(
      z.object({
        cwd: z.string(),
        forceRefresh: z.boolean().optional(),
      }),
    )
    .query(async ({ input }) => {
      const svc = gitFor(input.cwd);
      return svc.getStatus(input.forceRefresh ?? false);
    }),

  branches: publicProcedure.input(z.object({ cwd: z.string() })).query(async ({ input }) => {
    return gitFor(input.cwd).getBranches();
  }),

  log: publicProcedure
    .input(
      z.object({
        cwd: z.string(),
        limit: z.number().optional().default(10),
      }),
    )
    .query(async ({ input }) => {
      return gitFor(input.cwd).getLog(input.limit);
    }),

  diff: publicProcedure
    .input(
      z.object({
        cwd: z.string(),
        file: relativePath.optional(),
        staged: z.boolean().optional().default(false),
      }),
    )
    .query(async ({ input }) => {
      return gitFor(input.cwd).getDiff(input.file, input.staged);
    }),

  stage: publicProcedure
    .input(
      z.object({
        cwd: z.string(),
        files: z.array(relativePath).min(1),
      }),
    )
    .mutation(async ({ input }) => {
      const ok = await gitFor(input.cwd).add(...input.files);
      return { success: ok, ...(!ok && { error: "git add failed" }) };
    }),

  unstage: publicProcedure
    .input(
      z.object({
        cwd: z.string(),
        files: z.array(relativePath).min(1),
      }),
    )
    .mutation(async ({ input }) => {
      const ok = await gitFor(input.cwd).reset(...input.files);
      return { success: ok, ...(!ok && { error: "git reset failed" }) };
    }),

  commit: publicProcedure
    .input(
      z.object({
        cwd: z.string(),
        message: z.string().min(1),
      }),
    )
    .mutation(async ({ input }) => {
      return gitFor(input.cwd).commit(input.message);
    }),

  isRepo: publicProcedure.input(z.object({ cwd: z.string() })).query(({ input }) => {
    const resolved = assertAbsolute(input.cwd);
    return existsSync(resolve(resolved, ".git"));
  }),

  root: publicProcedure.input(z.object({ cwd: z.string() })).query(async ({ input }) => {
    return gitFor(input.cwd).getRoot();
  }),

  remotes: publicProcedure.input(z.object({ cwd: z.string() })).query(async ({ input }) => {
    return gitFor(input.cwd).getRemotes();
  }),
});
