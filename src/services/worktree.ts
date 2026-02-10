import { mkdir, readFile, rm, writeFile } from 'fs/promises';
import { join } from 'path';
import { execFileNoThrow } from '../utils/execFileNoThrow';
import { getWorkspaceService } from './workspace';
import type { WorktreeInfo, WorktreeService } from './types';

type WorktreeState = {
  entries: WorktreeInfo[];
};

function defaultBranchName(sessionId: string): string {
  return `workforce/${sessionId}`;
}

class WorktreeServiceImpl implements WorktreeService {
  private async getWorktreeRoot(): Promise<string> {
    const workspace = await getWorkspaceService().getCurrent();
    return join(workspace.rootPath, 'worktrees');
  }

  private async getStateFile(): Promise<string> {
    const root = await this.getWorktreeRoot();
    return join(root, 'state.json');
  }

  private async readState(): Promise<WorktreeState> {
    const stateFile = await this.getStateFile();
    try {
      const raw = await readFile(stateFile, 'utf-8');
      const entries = JSON.parse(raw) as WorktreeInfo[];
      return { entries };
    } catch {
      return { entries: [] };
    }
  }

  private async writeState(state: WorktreeState): Promise<void> {
    const stateFile = await this.getStateFile();
    await mkdir(await this.getWorktreeRoot(), { recursive: true });
    await writeFile(stateFile, JSON.stringify(state.entries, null, 2), 'utf-8');
  }

  async create(input: {
    sessionId: string;
    repoRoot: string;
    branchName?: string;
    baseRef?: string;
  }): Promise<WorktreeInfo> {
    const state = await this.readState();
    const existing = state.entries.find((entry) => entry.sessionId === input.sessionId);
    if (existing && existing.status !== 'deleted') {
      return existing;
    }

    const worktreePath = join(await this.getWorktreeRoot(), `agent-${input.sessionId}`);
    const branchName = input.branchName ?? defaultBranchName(input.sessionId);
    const baseRef = input.baseRef ?? 'HEAD';

    await mkdir(await this.getWorktreeRoot(), { recursive: true });
    const result = await execFileNoThrow(
      'git',
      ['worktree', 'add', '-b', branchName, worktreePath, baseRef],
      { cwd: input.repoRoot }
    );

    if (result.status !== 'success') {
      throw new Error(result.stderr || result.stdout || 'Failed to create git worktree');
    }

    const now = Date.now();
    const created: WorktreeInfo = {
      sessionId: input.sessionId,
      repoRoot: input.repoRoot,
      path: worktreePath,
      branch: branchName,
      baseRef,
      status: 'active',
      createdAt: now,
      updatedAt: now,
    };

    const withoutDeleted = state.entries.filter((entry) => entry.sessionId !== input.sessionId);
    state.entries = [...withoutDeleted, created];
    await this.writeState(state);

    return created;
  }

  async getBySession(sessionId: string): Promise<WorktreeInfo | null> {
    const state = await this.readState();
    return state.entries.find((entry) => entry.sessionId === sessionId) ?? null;
  }

  async list(): Promise<WorktreeInfo[]> {
    const state = await this.readState();
    return state.entries;
  }

  async archive(sessionId: string): Promise<WorktreeInfo> {
    const state = await this.readState();
    const index = state.entries.findIndex((entry) => entry.sessionId === sessionId);
    if (index < 0) {
      throw new Error(`Worktree not found for session: ${sessionId}`);
    }

    const entry = state.entries[index];
    if (entry.status === 'archived') {
      return entry;
    }

    await execFileNoThrow('git', ['worktree', 'remove', entry.path, '--force'], {
      cwd: entry.repoRoot,
    });
    await execFileNoThrow('git', ['worktree', 'prune'], { cwd: entry.repoRoot });

    const archived: WorktreeInfo = {
      ...entry,
      status: 'archived',
      updatedAt: Date.now(),
    };
    state.entries[index] = archived;
    await this.writeState(state);
    return archived;
  }

  async delete(sessionId: string): Promise<void> {
    const state = await this.readState();
    const entry = state.entries.find((item) => item.sessionId === sessionId);
    if (!entry) {
      return;
    }

    await execFileNoThrow('git', ['worktree', 'remove', entry.path, '--force'], {
      cwd: entry.repoRoot,
    });
    await rm(entry.path, { recursive: true, force: true });
    await execFileNoThrow('git', ['worktree', 'prune'], { cwd: entry.repoRoot });
    await execFileNoThrow('git', ['branch', '-D', entry.branch], { cwd: entry.repoRoot });

    const nextEntries = state.entries.filter((item) => item.sessionId !== sessionId);
    await this.writeState({ entries: nextEntries });
  }

  dispose(): void {}
}

let _instance: WorktreeService | null = null;

export function getWorktreeService(): WorktreeService {
  return (_instance ??= new WorktreeServiceImpl());
}

export function resetWorktreeService(): void {
  if (_instance) {
    _instance.dispose();
    _instance = null;
  }
}
