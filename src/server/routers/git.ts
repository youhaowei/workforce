import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { existsSync } from "fs";
import { resolve, isAbsolute } from "path";
import { router, publicProcedure } from "../trpc";
import { GitService } from "@/services/git";
import { prompt } from "unifai";
import { getOrgService } from "@/services/org";

const DEFAULT_UTILITY_MODEL = "haiku";

const SMART_COMMIT_PROMPT = `You are a git commit assistant. Your job is to stage all changes and create well-structured conventional commits.

Instructions:
1. Run \`git status\` to see all changes
2. Run \`git diff\` and \`git diff --cached\` to understand what changed
3. Stage ALL files with \`git add -A\`
4. Analyze the staged changes and split them into logical commits grouped by concern
5. For each logical group: unstage everything, stage only that group's files, then commit with a conventional commit message
6. If the changes are small or cohesive, a single commit is fine

Commit message format: type(scope): description
- Types: feat, fix, refactor, docs, test, chore, style, perf
- Scope is optional, derived from the primary directory/module affected
- Description is lowercase, imperative mood, no period

After all commits are created, run \`git log --oneline -10\` so I can see what was committed.

Important: Do NOT explain what you're doing. Just execute the git commands and commit.`;


// ─── validation ─────────────────────────────────────────────────────────────

const relativePath = z
  .string()
  .refine(
    (f) => !isAbsolute(f) && !f.split(/[/\\]/).includes(".."),
    "file paths must be relative within repo",
  );

function assertAbsolute(cwd: string): string {
  if (!isAbsolute(cwd)) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "cwd must be an absolute path" });
  }
  return resolve(cwd);
}

function findGitRoot(from: string): string | null {
  let dir = from;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    if (existsSync(resolve(dir, ".git"))) return dir;
    const parent = resolve(dir, "..");
    if (parent === dir) return null; // filesystem root
    dir = parent;
  }
}

function validateGitCwd(cwd: string): string {
  const resolved = assertAbsolute(cwd);
  const root = findGitRoot(resolved);
  if (!root) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "cwd is not inside a git repository" });
  }
  return root;
}

// ─── service cache (LRU-capped) ─────────────────────────────────────────────

const MAX_CACHED_SERVICES = 20;
const serviceCache = new Map<string, GitService>();

function gitFor(cwd: string): GitService {
  const validated = validateGitCwd(cwd);
  let svc = serviceCache.get(validated);
  if (svc) {
    // Move to end (most-recently-used)
    serviceCache.delete(validated);
    serviceCache.set(validated, svc);
    return svc;
  }
  // Evict oldest entry if at capacity
  if (serviceCache.size >= MAX_CACHED_SERVICES) {
    const oldest = serviceCache.keys().next().value!;
    serviceCache.get(oldest)?.dispose();
    serviceCache.delete(oldest);
  }
  svc = new GitService({ cwd: validated });
  serviceCache.set(validated, svc);
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
      const status = await gitFor(input.cwd).getStatus(input.forceRefresh ?? false);
      if (!status) {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Failed to read git status" });
      }
      return status;
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
      if (!ok) {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Failed to stage files" });
      }
      return { success: true };
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
      if (!ok) {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Failed to unstage files" });
      }
      return { success: true };
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
    if (!isAbsolute(input.cwd)) return false;
    return findGitRoot(resolve(input.cwd)) !== null;
  }),

  root: publicProcedure.input(z.object({ cwd: z.string() })).query(async ({ input }) => {
    return gitFor(input.cwd).getRoot();
  }),

  remotes: publicProcedure.input(z.object({ cwd: z.string() })).query(async ({ input }) => {
    return gitFor(input.cwd).getRemotes();
  }),

  smartCommit: publicProcedure
    .input(z.object({ cwd: z.string() }))
    .mutation(async ({ input }) => {
      const cwd = validateGitCwd(input.cwd);
      const svc = gitFor(cwd);

      // Snapshot HEAD so we can detect commits made during the run
      const logBefore = await svc.getLog(1);
      const headBefore = logBefore[0]?.hash ?? null;

      const org = await getOrgService().getCurrent();
      const model = org?.settings?.utilityModel ?? DEFAULT_UTILITY_MODEL;

      let promptError: string | null = null;
      let text = "";

      try {
        const result = await prompt("claude", SMART_COMMIT_PROMPT, {
          model,
          cwd,
          permissionMode: "bypassPermissions",
          allowedTools: ["Bash", "Read"],
          maxTurns: 15,
        });
        text = result.text;
      } catch (err) {
        promptError = err instanceof Error ? err.message : "Smart commit failed";
      }

      // Always invalidate cache — commits may have been created even on error
      svc.invalidateCache();

      // Check what actually happened in git — log is newest-first
      const logAfter = await svc.getLog(10);
      const headIdx = headBefore ? logAfter.findIndex((c) => c.hash === headBefore) : -1;
      const newCommits = headIdx === -1 ? logAfter : logAfter.slice(0, headIdx);

      if (newCommits.length > 0) {
        return {
          success: true,
          commits: newCommits.map((c) => ({ hash: c.shortHash, message: c.subject })),
          text,
          ...(promptError && { warning: promptError }),
        };
      }

      if (promptError) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: promptError,
        });
      }

      return { success: true, commits: [], text };
    }),
});
