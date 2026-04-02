/**
 * WorktreeService - Git worktree isolation for concurrent agents
 *
 * Provides:
 * - Create git worktrees for agent sessions
 * - Merge completed worktrees back to parent branch
 * - Archive/delete worktrees
 * - Track worktree state per session
 *
 * Worktree path: {worktreeBase}/workforce-{sessionId}
 * Branch naming: workforce/{sessionId}
 */

import { readFile, writeFile, mkdir, rm } from "fs/promises";
import { join } from "path";
import { execFileNoThrow } from "../utils/execFileNoThrow";
import type { WorktreeInfo, WorktreeService } from "./types";
import { getEventBus } from "@/shared/event-bus";
import { getDataDir } from "./data-dir";

// =============================================================================
// Configuration
// =============================================================================

const DEFAULT_WORKTREE_BASE = join(getDataDir(), "worktrees");

// =============================================================================
// Helpers
// =============================================================================

function branchName(sessionId: string): string {
  return `workforce/${sessionId}`;
}

// =============================================================================
// Service Implementation
// =============================================================================

class WorktreeServiceImpl implements WorktreeService {
  private worktrees = new Map<string, WorktreeInfo>();
  private initialized = false;
  private worktreeBase: string;
  private stateFile: string;

  constructor(worktreeBase?: string) {
    this.worktreeBase = worktreeBase ?? DEFAULT_WORKTREE_BASE;
    this.stateFile = join(this.worktreeBase, ".worktree-state.json");
  }

  private worktreePath(sessionId: string): string {
    return join(this.worktreeBase, `workforce-${sessionId}`);
  }

  private async ensureInitialized(): Promise<void> {
    if (this.initialized) return;

    try {
      const raw = await readFile(this.stateFile, "utf-8");
      const entries = JSON.parse(raw) as WorktreeInfo[];
      for (const entry of entries) {
        this.worktrees.set(entry.sessionId, entry);
      }
    } catch {
      // No state file yet — that's fine
    }

    this.initialized = true;
  }

  private async persistState(): Promise<void> {
    await mkdir(this.worktreeBase, { recursive: true });
    const entries = Array.from(this.worktrees.values());
    await writeFile(this.stateFile, JSON.stringify(entries, null, 2), "utf-8");
  }

  async create(sessionId: string, repoRoot: string, customBranch?: string): Promise<WorktreeInfo> {
    await this.ensureInitialized();

    if (this.worktrees.has(sessionId)) {
      throw new Error(`Worktree already exists for session: ${sessionId}`);
    }

    const wtPath = this.worktreePath(sessionId);
    const branch = customBranch ?? branchName(sessionId);

    await mkdir(this.worktreeBase, { recursive: true });

    const result = await execFileNoThrow("git", ["worktree", "add", "-b", branch, wtPath], {
      cwd: repoRoot,
    });

    if (result.status !== "success") {
      throw new Error(`Failed to create worktree: ${result.stderr || result.stdout}`);
    }

    const info: WorktreeInfo = {
      path: wtPath,
      branch,
      sessionId,
      repoRoot,
      createdAt: Date.now(),
      status: "active",
    };

    this.worktrees.set(sessionId, info);
    await this.persistState();

    getEventBus().emit({
      type: "WorktreeChange",
      sessionId,
      worktreePath: wtPath,
      action: "created",
      timestamp: Date.now(),
    });

    return info;
  }

  async list(repoRoot: string): Promise<WorktreeInfo[]> {
    await this.ensureInitialized();

    return Array.from(this.worktrees.values()).filter((wt) => wt.repoRoot === repoRoot);
  }

  async merge(
    sessionId: string,
    strategy: "merge" | "rebase" = "merge",
  ): Promise<{ success: boolean; conflicts?: string[] }> {
    await this.ensureInitialized();

    const info = this.worktrees.get(sessionId);
    if (!info) {
      throw new Error(`Worktree not found for session: ${sessionId}`);
    }

    if (info.status !== "active") {
      throw new Error(`Cannot merge worktree in state: ${info.status}`);
    }

    const mergeCmd =
      strategy === "rebase"
        ? ["rebase", info.branch]
        : ["merge", info.branch, "--no-ff", "-m", `Merge workforce agent ${sessionId}`];

    const mergeResult = await execFileNoThrow("git", mergeCmd, {
      cwd: info.repoRoot,
    });

    if (mergeResult.status !== "success") {
      const conflictResult = await execFileNoThrow(
        "git",
        ["diff", "--name-only", "--diff-filter=U"],
        { cwd: info.repoRoot },
      );

      const conflicts = conflictResult.stdout.trim().split("\n").filter(Boolean);

      await execFileNoThrow("git", [strategy === "rebase" ? "rebase" : "merge", "--abort"], {
        cwd: info.repoRoot,
      });

      return { success: false, conflicts };
    }

    info.status = "merged";
    await this.persistState();

    getEventBus().emit({
      type: "WorktreeChange",
      sessionId,
      worktreePath: info.path,
      action: "merged",
      timestamp: Date.now(),
    });

    return { success: true };
  }

  async archive(sessionId: string): Promise<void> {
    await this.ensureInitialized();

    const info = this.worktrees.get(sessionId);
    if (!info) {
      throw new Error(`Worktree not found for session: ${sessionId}`);
    }

    if (info.status === "deleted") {
      throw new Error("Worktree already deleted");
    }

    if (info.status === "active") {
      const removeResult = await execFileNoThrow(
        "git",
        ["worktree", "remove", info.path, "--force"],
        { cwd: info.repoRoot },
      );

      if (removeResult.status !== "success") {
        await rm(info.path, { recursive: true, force: true });
        await execFileNoThrow("git", ["worktree", "prune"], { cwd: info.repoRoot });
      }
    }

    info.status = "archived";
    await this.persistState();

    getEventBus().emit({
      type: "WorktreeChange",
      sessionId,
      worktreePath: info.path,
      action: "archived",
      timestamp: Date.now(),
    });
  }

  async delete(sessionId: string): Promise<void> {
    await this.ensureInitialized();

    const info = this.worktrees.get(sessionId);
    if (!info) {
      throw new Error(`Worktree not found for session: ${sessionId}`);
    }

    if (info.status === "active") {
      await execFileNoThrow("git", ["worktree", "remove", info.path, "--force"], {
        cwd: info.repoRoot,
      });
    }

    await rm(info.path, { recursive: true, force: true });
    await execFileNoThrow("git", ["worktree", "prune"], { cwd: info.repoRoot });

    await execFileNoThrow("git", ["branch", "-D", info.branch], { cwd: info.repoRoot });

    const wtPath = info.path;
    this.worktrees.delete(sessionId);
    await this.persistState();

    getEventBus().emit({
      type: "WorktreeChange",
      sessionId,
      worktreePath: wtPath,
      action: "deleted",
      timestamp: Date.now(),
    });
  }

  getForSession(sessionId: string): WorktreeInfo | null {
    return this.worktrees.get(sessionId) ?? null;
  }

  async getDiff(sessionId: string): Promise<string> {
    await this.ensureInitialized();

    const info = this.worktrees.get(sessionId);
    if (!info) {
      throw new Error(`Worktree not found for session: ${sessionId}`);
    }

    const diffResult = await execFileNoThrow("git", ["diff", "HEAD"], {
      cwd: info.path,
    });

    if (diffResult.status !== "success") {
      return "";
    }

    return diffResult.stdout;
  }

  dispose(): void {
    this.worktrees.clear();
    this.initialized = false;
  }
}

// =============================================================================
// Singleton Management
// =============================================================================

let _instance: WorktreeServiceImpl | null = null;

export function getWorktreeService(): WorktreeService {
  return (_instance ??= new WorktreeServiceImpl());
}

export function resetWorktreeService(): void {
  if (_instance) {
    _instance.dispose();
    _instance = null;
  }
}

/**
 * Create a WorktreeService with a custom worktree base directory.
 * Useful for testing.
 */
export function createWorktreeService(worktreeBase: string): WorktreeService {
  return new WorktreeServiceImpl(worktreeBase);
}
