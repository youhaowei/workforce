import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { existsSync } from "fs";
import { resolve, isAbsolute } from "path";
import { router, publicProcedure } from "../trpc";
import { GitService } from "@/services/git";
import { runSDKQuery } from "@/services/sdk-adapter";
import { getOrgService } from "@/services/org";
import { createLogger } from "tracey";

const logger = createLogger("git-router");

const DEFAULT_UTILITY_MODEL = "haiku";

const SMART_COMMIT_PROMPT = `You are a git commit assistant. Your job is to create well-structured conventional commits.

Instructions:
1. Run \`git status\` to see all changes (staged, unstaged, untracked)
2. Run \`git diff\` to understand what changed
3. Group the changes into logical commits by concern (feature, fix, refactor, etc.)
4. For each group: stage only that group's files with \`git add <file1> <file2> ...\`, then commit
5. If all changes are cohesive, stage them together and make a single commit
6. Do NOT use \`git add -A\` or \`git add .\` — always stage specific files

Commit message format: type(scope): description
- Types: feat, fix, refactor, docs, test, chore, style, perf
- Scope is optional, derived from the primary directory/module affected
- Description is lowercase, imperative mood, no period

After all commits are created, run \`git log --oneline -10\` so I can see what was committed.

Important: Do NOT explain what you're doing. Just execute the git commands and commit.`;

/** Extract commit message from a git commit command string (quoted -m args only). */
function extractCommitMessage(cmd: string): string | null {
  const match = cmd.match(/git\s+commit\s+.*-m\s+(["'])(.+?)\1/s);
  return match?.[2] ?? null;
}

const ALLOWED_GIT_SUBCOMMANDS = new Set([
  "status",
  "diff",
  "add",
  "commit",
  "log",
  "show",
  "rev-parse",
]);

/** Flags that make otherwise safe subcommands destructive. */
const DANGEROUS_FLAGS = /--hard|--force|--amend|-D\b|-f\b/;
const SHELL_METACHARACTERS = /[;&|`$(){}[\]<>\n]/;
/** Block mass-staging flags/args anywhere in `git add` args (not just first position). */
const STAGE_ALL_FLAGS = /\b(-A|--all|-u|--update)\b/;
const STAGE_ALL_DOT = /(^|\s)\.(\s|$)/;

/** Only approve safe, non-destructive, single git commands in Bash. */
function gitOnlyApproval(request: {
  description: string;
  detail: unknown;
}): Promise<"approve" | "deny"> {
  if (request.description === "Tool: Read") return Promise.resolve("approve");
  if (request.description === "Tool: Bash") {
    const cmd = String((request.detail as Record<string, unknown>)?.command ?? "").trimStart();
    if (cmd.startsWith("git ")) {
      if (SHELL_METACHARACTERS.test(cmd)) return Promise.resolve("deny");
      const rest = cmd.slice(4).trimStart();
      const subcommand = rest.split(/\s/)[0];
      if (subcommand === "add" && (STAGE_ALL_FLAGS.test(rest) || STAGE_ALL_DOT.test(rest))) {
        return Promise.resolve("deny");
      }
      if (ALLOWED_GIT_SUBCOMMANDS.has(subcommand) && !DANGEROUS_FLAGS.test(rest)) {
        return Promise.resolve("approve");
      }
    }
  }
  return Promise.resolve("deny");
}

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
    serviceCache.delete(validated);
    serviceCache.set(validated, svc);
    return svc;
  }
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
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to read git status",
        });
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

  pull: publicProcedure.input(z.object({ cwd: z.string() })).mutation(async ({ input }) => {
    const svc = gitFor(input.cwd);
    // GitService.pull() invalidates its own cache internally.
    const result = await svc.pull();
    if (!result.success) {
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: result.error ?? "Pull failed",
      });
    }
    return { success: true };
  }),

  push: publicProcedure.input(z.object({ cwd: z.string() })).mutation(async ({ input }) => {
    const svc = gitFor(input.cwd);
    const status = await svc.getStatus(true);
    // Auto-set upstream on first push for new branches
    const needsUpstream = !!status && !status.hasUpstream;
    const branch = needsUpstream ? status?.branch : undefined;
    const result = await svc.push("origin", branch, { setUpstream: needsUpstream });
    svc.invalidateCache();
    if (!result.success) {
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: result.error ?? "Push failed",
      });
    }
    return { success: true };
  }),

  smartCommit: publicProcedure.input(z.object({ cwd: z.string() })).subscription(async function* ({
    input,
  }) {
    const cwd = validateGitCwd(input.cwd);
    const svc = gitFor(cwd);

    const logBefore = await svc.getLog(1);
    const headBefore = logBefore[0]?.hash ?? null;

    const org = await getOrgService().getCurrent();
    const model = org?.settings?.utilityModel ?? DEFAULT_UTILITY_MODEL;

    yield { type: "status" as const, message: "Analyzing changes..." };

    let error: string | null = null;

    try {
      const result = runSDKQuery(SMART_COMMIT_PROMPT, {
        sdkOptions: {
          model,
          cwd,
          permissionMode: "default",
          allowedTools: ["Bash", "Read"],
          maxTurns: 15,
        },
        onApprovalRequest: gitOnlyApproval,
      });
      if (!result.ok) {
        throw result.error;
      }
      const handle = result.value;
      for await (const event of handle.events) {
        if (event.type === "tool_start" && event.name === "Bash") {
          const cmd = String((event.inputRaw as Record<string, unknown>)?.command ?? "");
          const commitMsg = extractCommitMessage(cmd);
          if (commitMsg) {
            yield { type: "committing" as const, message: commitMsg };
          }
        }
      }
    } catch (err) {
      logger.error({ cwd, err }, "smartCommit failed");
      error = err instanceof Error ? err.message : "Smart commit failed";
    }

    svc.invalidateCache();

    const logAfter = await svc.getLog(20);
    const headIdx = headBefore ? logAfter.findIndex((c) => c.hash === headBefore) : -1;
    const newCommits = headIdx === -1 ? logAfter : logAfter.slice(0, headIdx);

    yield {
      type: "done" as const,
      commits: newCommits.map((c) => ({ hash: c.shortHash, message: c.subject })),
      ...(error && { error }),
    };
  }),
});
