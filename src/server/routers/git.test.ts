import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdir, rm, writeFile } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { createCaller } from "./index";
import { resetGitRouterCache } from "./git";

let repoDir: string;
let caller: ReturnType<typeof createCaller>;

async function initGitRepo(dir: string) {
  const { execFileNoThrow } = await import("@/utils/execFileNoThrow");
  const git = (...args: string[]) => execFileNoThrow("git", args, { cwd: dir });
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
        "cwd is not a git repository root",
      );
    } finally {
      await rm(nonGitDir, { recursive: true, force: true });
    }
  });

  it("rejects a path that does not exist", async () => {
    await expect(caller.git.status({ cwd: "/tmp/does-not-exist-ever-12345" })).rejects.toThrow(
      "cwd is not a git repository root",
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
