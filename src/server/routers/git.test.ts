import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdir, rm, writeFile } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { execFileNoThrow } from "@/utils/execFileNoThrow";
import { createCaller } from "./index";
import { resetGitRouterCache } from "./git";

let repoDir: string;
let caller: ReturnType<typeof createCaller>;

async function initGitRepo(dir: string) {
  const git = async (...args: string[]) => {
    const result = await execFileNoThrow("git", args, { cwd: dir });
    if (result.exitCode !== 0) {
      throw new Error(`git ${args.join(" ")} failed: ${result.stderr || result.stdout}`);
    }
  };
  await git("init");
  await git("config", "user.email", "test@test.com");
  await git("config", "user.name", "Test User");
  await writeFile(join(dir, "README.md"), "# Test\n");
  await git("add", "README.md");
  await git("commit", "-m", "Initial commit");
}

beforeEach(async () => {
  repoDir = join(tmpdir(), `git-router-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await mkdir(repoDir, { recursive: true });
  await initGitRepo(repoDir);
  caller = createCaller({});
});

afterEach(async () => {
  resetGitRouterCache();
  await rm(repoDir, { recursive: true, force: true });
});

// ─── cwd validation ─────────────────────────────────────────────────────────

describe("cwd validation", () => {
  it("rejects a non-git directory", async () => {
    const nonGitDir = join(tmpdir(), `non-git-${Date.now()}`);
    await mkdir(nonGitDir, { recursive: true });

    try {
      await expect(caller.git.status({ cwd: nonGitDir })).rejects.toThrow(
        "cwd is not inside a git repository",
      );
    } finally {
      await rm(nonGitDir, { recursive: true, force: true });
    }
  });

  it("rejects a path that does not exist", async () => {
    const missingDir = join(
      tmpdir(),
      `does-not-exist-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    await expect(caller.git.status({ cwd: missingDir })).rejects.toThrow(
      "cwd is not inside a git repository",
    );
  });

  it("rejects a relative path", async () => {
    await expect(caller.git.status({ cwd: "../relative/path" })).rejects.toThrow(
      "cwd must be an absolute path",
    );
  });
});

// ─── status ─────────────────────────────────────────────────────────────────

describe("git.status", () => {
  it("returns clean status after initial commit", async () => {
    const status = await caller.git.status({ cwd: repoDir });
    expect(status).not.toBeNull();
    expect(status!.isClean).toBe(true);
    expect(status!.staged).toEqual([]);
  });

  it("detects untracked files", async () => {
    await writeFile(join(repoDir, "new.txt"), "hello");
    const status = await caller.git.status({ cwd: repoDir, forceRefresh: true });
    expect(status!.isClean).toBe(false);
    expect(status!.untracked).toContain("new.txt");
  });
});

// ─── stage / unstage ────────────────────────────────────────────────────────

describe("git.stage / git.unstage", () => {
  it("stages and unstages a file via the router", async () => {
    await writeFile(join(repoDir, "file.txt"), "data");

    const stageResult = await caller.git.stage({ cwd: repoDir, files: ["file.txt"] });
    expect(stageResult.success).toBe(true);

    let status = await caller.git.status({ cwd: repoDir, forceRefresh: true });
    expect(status!.staged).toHaveLength(1);

    const unstageResult = await caller.git.unstage({ cwd: repoDir, files: ["file.txt"] });
    expect(unstageResult.success).toBe(true);

    status = await caller.git.status({ cwd: repoDir, forceRefresh: true });
    expect(status!.staged).toHaveLength(0);
  });
});

// ─── commit ─────────────────────────────────────────────────────────────────

describe("git.commit", () => {
  it("creates a commit through the router", async () => {
    await writeFile(join(repoDir, "commit.txt"), "content");
    await caller.git.stage({ cwd: repoDir, files: ["commit.txt"] });

    const result = await caller.git.commit({ cwd: repoDir, message: "Router commit" });
    expect(result.success).toBe(true);
    expect(result.hash).toBeTruthy();
  });

  it("fails commit with nothing staged", async () => {
    const result = await caller.git.commit({ cwd: repoDir, message: "Empty" });
    expect(result.success).toBe(false);
    expect(result.error).toBeTruthy();
  });
});

// ─── other queries ──────────────────────────────────────────────────────────

describe("git queries", () => {
  it("isRepo returns true for valid repo", async () => {
    expect(await caller.git.isRepo({ cwd: repoDir })).toBe(true);
  });

  it("isRepo returns false for non-repo directory", async () => {
    const nonGitDir = join(tmpdir(), `non-git-isrepo-${Date.now()}`);
    await mkdir(nonGitDir, { recursive: true });
    try {
      expect(await caller.git.isRepo({ cwd: nonGitDir })).toBe(false);
    } finally {
      await rm(nonGitDir, { recursive: true, force: true });
    }
  });

  it("isRepo returns false for relative path", async () => {
    expect(await caller.git.isRepo({ cwd: "relative/path" })).toBe(false);
  });

  it("root returns repo root directory", async () => {
    const root = await caller.git.root({ cwd: repoDir });
    // macOS: /var → /private/var symlink, git resolves to realpath
    expect(root).toContain(repoDir.replace(/^\/private/, ""));
  });

  it("stage rejects absolute file paths", async () => {
    await expect(caller.git.stage({ cwd: repoDir, files: ["/etc/passwd"] })).rejects.toThrow();
  });

  it("stage rejects path traversal", async () => {
    await expect(caller.git.stage({ cwd: repoDir, files: ["../../etc/passwd"] })).rejects.toThrow();
  });

  it("branches returns at least one branch", async () => {
    const branches = await caller.git.branches({ cwd: repoDir });
    expect(branches.length).toBeGreaterThan(0);
  });

  it("log returns commit history", async () => {
    const log = await caller.git.log({ cwd: repoDir, limit: 5 });
    expect(log.length).toBeGreaterThan(0);
    expect(log[0].subject).toBe("Initial commit");
  });

  it("diff returns empty for clean repo", async () => {
    const diff = await caller.git.diff({ cwd: repoDir });
    expect(diff).toBe("");
  });

  it("remotes returns empty for local repo", async () => {
    const remotes = await caller.git.remotes({ cwd: repoDir });
    expect(remotes).toEqual([]);
  });
});

// ─── empty repo (no commits yet) ────────────────────────────────────────────

describe("empty repo (no commits)", () => {
  let emptyRepo: string;

  beforeEach(async () => {
    emptyRepo = join(tmpdir(), `git-empty-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    await mkdir(emptyRepo, { recursive: true });
    const git = async (...args: string[]) => {
      const result = await execFileNoThrow("git", args, { cwd: emptyRepo });
      if (result.exitCode !== 0) {
        throw new Error(`git ${args.join(" ")} failed: ${result.stderr || result.stdout}`);
      }
    };
    await git("init");
    await git("config", "user.email", "test@test.com");
    await git("config", "user.name", "Test User");
  });

  afterEach(async () => {
    await rm(emptyRepo, { recursive: true, force: true });
  });

  it("getStatus returns valid status with isClean true on empty repo", async () => {
    // git diff HEAD fails (no HEAD), getDiffStats returns {0,0}; status --porcelain succeeds
    const status = await caller.git.status({ cwd: emptyRepo, forceRefresh: true });
    expect(status).not.toBeNull();
    expect(status!.isClean).toBe(true);
    expect(status!.insertions).toBe(0);
    expect(status!.deletions).toBe(0);
    expect(status!.hasUpstream).toBe(false);
  });

  it("isRepo returns true for empty (uncommitted) repo", async () => {
    expect(await caller.git.isRepo({ cwd: emptyRepo })).toBe(true);
  });

  it("log returns empty array for empty repo", async () => {
    const log = await caller.git.log({ cwd: emptyRepo });
    expect(log).toEqual([]);
  });

  it("commit on empty repo with staged file creates root commit", async () => {
    await writeFile(join(emptyRepo, "a.txt"), "hello");
    await caller.git.stage({ cwd: emptyRepo, files: ["a.txt"] });
    const result = await caller.git.commit({ cwd: emptyRepo, message: "root commit" });
    expect(result.success).toBe(true);
    expect(result.hash).toBeTruthy();
  });
});

// ─── cwd walks up to find .git ───────────────────────────────────────────────

describe("findGitRoot walks up", () => {
  it("accepts a subdirectory inside the repo", async () => {
    const subdir = join(repoDir, "nested", "deep");
    await mkdir(subdir, { recursive: true });
    const status = await caller.git.status({ cwd: subdir });
    expect(status).not.toBeNull();
    expect(status!.isClean).toBe(true);
  });

  it("isRepo returns true for a subdirectory", async () => {
    const subdir = join(repoDir, "sub");
    await mkdir(subdir, { recursive: true });
    expect(await caller.git.isRepo({ cwd: subdir })).toBe(true);
  });
});

// ─── status fields: hasUpstream, insertions, deletions ───────────────────────

describe("git.status fields", () => {
  it("hasUpstream is false for a local-only repo", async () => {
    const status = await caller.git.status({ cwd: repoDir });
    expect(status!.hasUpstream).toBe(false);
    expect(status!.ahead).toBe(0);
    expect(status!.behind).toBe(0);
  });

  it("reports insertions and deletions for unstaged edits", async () => {
    // Overwrite README with extra lines (+3 net)
    await writeFile(join(repoDir, "README.md"), "# Test\nline2\nline3\nline4\n");
    const status = await caller.git.status({ cwd: repoDir, forceRefresh: true });
    // getDiffStats compares working tree to HEAD
    expect(status!.insertions).toBeGreaterThan(0);
  });

  it("returns 0 insertions and deletions for clean repo", async () => {
    const status = await caller.git.status({ cwd: repoDir });
    expect(status!.insertions).toBe(0);
    expect(status!.deletions).toBe(0);
  });

  it("branch name is populated", async () => {
    const status = await caller.git.status({ cwd: repoDir });
    expect(status!.branch).toBeTruthy();
    expect(typeof status!.branch).toBe("string");
  });
});

// ─── stage / unstage with special-character filenames ───────────────────────

describe("stage/unstage with special-character filenames", () => {
  it("stages a file with spaces in the name", async () => {
    const filename = "my file with spaces.txt";
    await writeFile(join(repoDir, filename), "data");
    const result = await caller.git.stage({ cwd: repoDir, files: [filename] });
    expect(result.success).toBe(true);

    const status = await caller.git.status({ cwd: repoDir, forceRefresh: true });
    expect(status!.staged.some((f) => f.path === filename)).toBe(true);
  });

  it("stages a file with unicode characters", async () => {
    const filename = "résumé_données_日本語.txt";
    await writeFile(join(repoDir, filename), "unicode content");
    const result = await caller.git.stage({ cwd: repoDir, files: [filename] });
    expect(result.success).toBe(true);

    const status = await caller.git.status({ cwd: repoDir, forceRefresh: true });
    expect(status!.staged.length).toBeGreaterThan(0);
  });

  it("unstages a file with spaces in the name", async () => {
    const filename = "spaced file.txt";
    await writeFile(join(repoDir, filename), "data");
    await caller.git.stage({ cwd: repoDir, files: [filename] });

    const unstageResult = await caller.git.unstage({ cwd: repoDir, files: [filename] });
    expect(unstageResult.success).toBe(true);

    const status = await caller.git.status({ cwd: repoDir, forceRefresh: true });
    expect(status!.staged).toHaveLength(0);
  });
});

// ─── LRU cache eviction (R5) ────────────────────────────────────────────────

describe("LRU service cache", () => {
  it("evicts oldest entry when cap of 20 is exceeded", async () => {
    // We cannot directly inspect the cache, so we verify that the 21st repo
    // is accepted without error (eviction does not throw).
    const repos: string[] = [];
    try {
      for (let i = 0; i < 21; i++) {
        const dir = join(
          tmpdir(),
          `git-lru-${Date.now()}-${i}-${Math.random().toString(36).slice(2)}`,
        );
        repos.push(dir);
        await mkdir(dir, { recursive: true });
        await initGitRepo(dir);
      }

      // Calling status on all 21 repos should succeed — eviction is transparent
      for (const dir of repos) {
        const status = await caller.git.status({ cwd: dir, forceRefresh: true });
        expect(status).not.toBeNull();
      }
    } finally {
      for (const dir of repos) {
        await rm(dir, { recursive: true, force: true });
      }
    }
  });

  it("LRU hit promotes entry — re-querying first repo after 20 others does not break it", async () => {
    const repos: string[] = [];
    try {
      // Create first repo and query it (sets it as first/oldest)
      const firstDir = join(
        tmpdir(),
        `git-lru-first-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      );
      repos.push(firstDir);
      await mkdir(firstDir, { recursive: true });
      await initGitRepo(firstDir);
      await caller.git.status({ cwd: firstDir, forceRefresh: true });

      // Re-query firstDir to promote it to MRU (should survive the next 19 insertions)
      await caller.git.status({ cwd: firstDir, forceRefresh: true });

      // Fill 19 more repos
      for (let i = 0; i < 19; i++) {
        const dir = join(
          tmpdir(),
          `git-lru-fill-${Date.now()}-${i}-${Math.random().toString(36).slice(2)}`,
        );
        repos.push(dir);
        await mkdir(dir, { recursive: true });
        await initGitRepo(dir);
        await caller.git.status({ cwd: dir, forceRefresh: true });
      }

      // firstDir was promoted to MRU — it should still be in cache (not evicted).
      // We can only verify this externally by confirming a query still works.
      const status = await caller.git.status({ cwd: firstDir, forceRefresh: true });
      expect(status).not.toBeNull();
    } finally {
      for (const dir of repos) {
        await rm(dir, { recursive: true, force: true });
      }
    }
  });
});

// ─── push with no remote ─────────────────────────────────────────────────────

describe("git.push", () => {
  it("throws when no remote exists", async () => {
    // Local-only repo — push must fail with a TRPC error
    await expect(caller.git.push({ cwd: repoDir })).rejects.toThrow();
  });
});
