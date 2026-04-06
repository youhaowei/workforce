import { test, expect } from "@playwright/test";
import { execFileSync } from "child_process";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { trpcMutate, trpcQuery, setupTestUserAndOrg } from "./helpers";

// ─── Fixture helpers ─────────────────────────────────────────────────────────

function git(dir: string, ...args: string[]) {
  execFileSync("git", args, { cwd: dir, stdio: "pipe" });
}

/** Create a temp git repo with staged and unstaged changes. */
function createTestRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), "wf-git-e2e-"));

  git(dir, "init");
  git(dir, "config", "user.email", "test@test.com");
  git(dir, "config", "user.name", "Test User");

  // Initial commit so HEAD exists
  writeFileSync(join(dir, "README.md"), "# Test Repo\n");
  git(dir, "add", "README.md");
  git(dir, "commit", "-m", "initial commit");

  // Staged: modify README
  writeFileSync(join(dir, "README.md"), "# Test Repo\n\nUpdated.\n");
  git(dir, "add", "README.md");

  // Staged: new file in subdirectory
  mkdirSync(join(dir, "src"), { recursive: true });
  writeFileSync(join(dir, "src/index.ts"), 'console.log("hello");\n');
  git(dir, "add", "src/index.ts");

  // Unstaged modification (dirty the staged README further)
  writeFileSync(join(dir, "README.md"), "# Test Repo\n\nUpdated.\n\nMore changes.\n");

  // Untracked file
  writeFileSync(join(dir, "notes.txt"), "some notes\n");

  return dir;
}

/** Create a clean git repo (no uncommitted changes). */
function createCleanRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), "wf-git-e2e-clean-"));

  git(dir, "init");
  git(dir, "config", "user.email", "test@test.com");
  git(dir, "config", "user.name", "Test User");
  writeFileSync(join(dir, "README.md"), "# Clean Repo\n");
  git(dir, "add", "README.md");
  git(dir, "commit", "-m", "initial commit");

  return dir;
}

// ─── Tests ───────────────────────────────────────────────────────────────────

test.describe("Git Status UI", () => {
  let orgId: string;
  let dirtyRepoDir: string;
  let cleanRepoDir: string;

  test.beforeAll(async () => {
    await setupTestUserAndOrg();
    dirtyRepoDir = createTestRepo();
    cleanRepoDir = createCleanRepo();
  });

  test.afterAll(() => {
    rmSync(dirtyRepoDir, { recursive: true, force: true });
    rmSync(cleanRepoDir, { recursive: true, force: true });
  });

  test.beforeEach(async ({ page }) => {
    // Fresh org per test
    const org = await trpcMutate("org.create", { name: "Git Test Org" });
    orgId = org.id;
    await trpcMutate("org.activate", { id: orgId });
    await trpcMutate("org.update", { id: orgId, updates: { initialized: true } });

    await page.goto("/");
    // Nav items are links in this branch — wait for the Shell to render
    await expect(page.locator('text=Home').first()).toBeVisible({ timeout: 10000 });
  });

  test.afterEach(async () => {
    if (orgId) {
      try {
        const projects = await trpcQuery("project.list", { orgId });
        for (const p of projects ?? []) {
          await trpcMutate("project.delete", { id: p.id });
        }
        await trpcMutate("org.delete", { id: orgId });
      } catch {
        // Best-effort cleanup
      }
    }
    await setupTestUserAndOrg();
  });

  /** Navigate to a session and open the info panel. */
  async function openSessionWithInfoPanel(
    page: import("@playwright/test").Page,
    sessionTitle: string,
  ) {
    // Navigate to sessions view
    await page.locator('a:has-text("Sessions")').click();
    await expect(page.locator('h2:has-text("Sessions")')).toBeVisible();

    // Click the session row
    const sessionRow = page.locator(`[role="button"]:has-text("${sessionTitle}")`);
    await expect(sessionRow).toBeVisible({ timeout: 5000 });
    await sessionRow.click();

    // Open the info panel (defaults collapsed)
    const hideToggle = page.locator('button[aria-label="Hide info panel"]');
    const isAlreadyOpen = await hideToggle.isVisible().catch(() => false);
    if (!isAlreadyOpen) {
      const infoToggle = page.locator('button[aria-label="Show info panel"]');
      await expect(infoToggle).toBeVisible({ timeout: 3000 });
      await infoToggle.click();
    }
  }

  test("GitStatusBadge shows branch name and dirty dot for dirty repo", async ({ page }) => {
    const project = await trpcMutate("project.create", {
      orgId,
      name: "Dirty Project",
      rootPath: dirtyRepoDir,
    });
    await trpcMutate("session.create", {
      orgId,
      projectId: project.id,
      title: "Dirty Session",
    });

    await page.reload();
    await expect(page.locator('text=Home').first()).toBeVisible({ timeout: 10000 });

    await page.locator('a:has-text("Sessions")').click();
    const sessionRow = page.locator('[role="button"]:has-text("Dirty Session")');
    await expect(sessionRow).toBeVisible({ timeout: 5000 });
    await sessionRow.click();

    // GitStatusBadge should appear with branch name
    const badge = page.locator('[aria-label^="Git: "]');
    await expect(badge).toBeVisible({ timeout: 10000 });

    // Should indicate dirty state in aria-label
    await expect(badge).toHaveAttribute("aria-label", /\(dirty\)/);

    // Branch name "master" or "main" should be visible inside badge
    await expect(badge).toContainText(/ma(ster|in)/);
  });

  test("GitSection shows Staged and Changes groups with counts", async ({ page }) => {
    const project = await trpcMutate("project.create", {
      orgId,
      name: "Groups Project",
      rootPath: dirtyRepoDir,
    });
    await trpcMutate("session.create", {
      orgId,
      projectId: project.id,
      title: "Groups Session",
    });

    await page.reload();
    await expect(page.locator('text=Home').first()).toBeVisible({ timeout: 10000 });
    await openSessionWithInfoPanel(page, "Groups Session");

    // Wait for GitSection to load (polls on open)
    const stagedHeader = page.locator("text=/Staged \\(\\d+\\)/");
    await expect(stagedHeader).toBeVisible({ timeout: 15000 });

    const changesHeader = page.locator("text=/Changes \\(\\d+\\)/");
    await expect(changesHeader).toBeVisible();

    // Staged should include README.md and src/index.ts = 2 files
    await expect(page.locator("text=/Staged \\(2\\)/")).toBeVisible();

    // Changes should include unstaged README.md + untracked notes.txt = 2 files
    await expect(page.locator("text=/Changes \\(2\\)/")).toBeVisible();
  });

  test("FileRow shows filename and directory path separately", async ({ page }) => {
    const project = await trpcMutate("project.create", {
      orgId,
      name: "FileRow Project",
      rootPath: dirtyRepoDir,
    });
    await trpcMutate("session.create", {
      orgId,
      projectId: project.id,
      title: "FileRow Session",
    });

    await page.reload();
    await expect(page.locator('text=Home').first()).toBeVisible({ timeout: 10000 });
    await openSessionWithInfoPanel(page, "FileRow Session");

    // Wait for staged files to render
    await expect(page.locator("text=/Staged \\(\\d+\\)/")).toBeVisible({ timeout: 15000 });

    // src/index.ts should have title attribute with full path and area info
    const srcFileRow = page.locator('button[title*="src/index.ts"]');
    await expect(srcFileRow).toBeVisible();

    // The row should show "index.ts" as filename and "src" as directory
    await expect(srcFileRow).toContainText("index.ts");
    await expect(srcFileRow).toContainText("src");

    // README.md should appear in staged area (use exact "(staged)" to avoid matching "unstaged")
    const readmeRow = page.locator('button[title$="README.md (staged) - click to unstage"]');
    await expect(readmeRow).toBeVisible();
    await expect(readmeRow).toContainText("README.md");
  });

  test("commit flow: input and button, button disabled when empty", async ({ page }) => {
    const project = await trpcMutate("project.create", {
      orgId,
      name: "Commit Flow Project",
      rootPath: dirtyRepoDir,
    });
    await trpcMutate("session.create", {
      orgId,
      projectId: project.id,
      title: "Commit Flow Session",
    });

    await page.reload();
    await expect(page.locator('text=Home').first()).toBeVisible({ timeout: 10000 });
    await openSessionWithInfoPanel(page, "Commit Flow Session");

    // Wait for staged files (commit UI only appears when staged files exist)
    await expect(page.locator("text=/Staged \\(\\d+\\)/")).toBeVisible({ timeout: 15000 });

    // Commit message input should be visible
    const commitInput = page.locator('input[placeholder="Commit message..."]');
    await expect(commitInput).toBeVisible();

    // Commit button should be visible but disabled (empty message)
    const commitButton = page.locator("button").filter({ hasText: /Commit \d+ file/ });
    await expect(commitButton).toBeVisible();
    await expect(commitButton).toBeDisabled();

    // Type a commit message
    await commitInput.fill("test commit message");

    // Button should now be enabled
    await expect(commitButton).toBeEnabled();

    // Clear the message — button should be disabled again
    await commitInput.fill("");
    await expect(commitButton).toBeDisabled();
  });

  test("clean repo shows Working tree clean message", async ({ page }) => {
    const project = await trpcMutate("project.create", {
      orgId,
      name: "Clean Project",
      rootPath: cleanRepoDir,
    });
    await trpcMutate("session.create", {
      orgId,
      projectId: project.id,
      title: "Clean Session",
    });

    await page.reload();
    await expect(page.locator('text=Home').first()).toBeVisible({ timeout: 10000 });
    await openSessionWithInfoPanel(page, "Clean Session");

    // Should show the clean state message
    await expect(page.locator("text=Working tree clean")).toBeVisible({ timeout: 15000 });

    // Should NOT show staged/changes headers
    await expect(page.locator("text=/Staged \\(\\d+\\)/")).not.toBeVisible();
    await expect(page.locator("text=/Changes \\(\\d+\\)/")).not.toBeVisible();

    // Should NOT show commit input
    await expect(page.locator('input[placeholder="Commit message..."]')).not.toBeVisible();

    // GitStatusBadge should NOT indicate dirty
    const badge = page.locator('[aria-label^="Git: "]');
    await expect(badge).toBeVisible({ timeout: 5000 });
    await expect(badge).not.toHaveAttribute("aria-label", /\(dirty\)/);
  });
});
