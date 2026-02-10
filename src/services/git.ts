/**
 * Git Service - Git and GitHub CLI integration
 *
 * Provides:
 * - Git status with caching
 * - Branch operations
 * - Commit history
 * - GitHub CLI (gh) integration for PRs/issues
 */

import { execFileNoThrow, type ExecResult } from '../utils/execFileNoThrow';

// ============================================================================
// Types
// ============================================================================

export interface GitStatus {
  branch: string;
  ahead: number;
  behind: number;
  staged: GitFileChange[];
  unstaged: GitFileChange[];
  untracked: string[];
  isClean: boolean;
}

export interface GitFileChange {
  path: string;
  status: 'added' | 'modified' | 'deleted' | 'renamed' | 'copied' | 'unmerged';
  oldPath?: string; // For renamed files
}

export interface GitCommit {
  hash: string;
  shortHash: string;
  subject: string;
  author: string;
  date: Date;
}

export interface GitBranch {
  name: string;
  isCurrent: boolean;
  isRemote: boolean;
  upstream?: string;
}

export interface GitRemote {
  name: string;
  fetchUrl: string;
  pushUrl: string;
}

export interface PullRequest {
  number: number;
  title: string;
  state: 'open' | 'closed' | 'merged';
  author: string;
  url: string;
  headBranch: string;
  baseBranch: string;
}

export interface GitServiceOptions {
  cwd?: string;
  cacheTtlMs?: number;
}

// ============================================================================
// Git Service
// ============================================================================

export class GitService {
  private cwd: string;
  private cacheTtlMs: number;
  private statusCache: { data: GitStatus; timestamp: number } | null = null;

  constructor(options: GitServiceOptions = {}) {
    this.cwd = options.cwd ?? process.cwd();
    this.cacheTtlMs = options.cacheTtlMs ?? 5000; // 5 second default
  }

  /**
   * Execute a git command.
   */
  private async git(...args: string[]): Promise<ExecResult> {
    return execFileNoThrow('git', args, { cwd: this.cwd });
  }

  /**
   * Execute a gh (GitHub CLI) command.
   */
  private async gh(...args: string[]): Promise<ExecResult> {
    return execFileNoThrow('gh', args, { cwd: this.cwd });
  }

  /**
   * Check if current directory is a git repository.
   */
  async isRepo(): Promise<boolean> {
    const result = await this.git('rev-parse', '--is-inside-work-tree');
    return result.status === 'success' && result.stdout.trim() === 'true';
  }

  /**
   * Get the repository root directory.
   */
  async getRoot(): Promise<string | null> {
    const result = await this.git('rev-parse', '--show-toplevel');
    if (result.status !== 'success') return null;
    return result.stdout.trim();
  }

  /**
   * Invalidate the status cache.
   */
  invalidateCache(): void {
    this.statusCache = null;
  }

  /**
   * Get git status with caching.
   */
  async getStatus(forceRefresh = false): Promise<GitStatus | null> {
    // Check cache
    if (
      !forceRefresh &&
      this.statusCache &&
      Date.now() - this.statusCache.timestamp < this.cacheTtlMs
    ) {
      return this.statusCache.data;
    }

    // Get branch info
    const branchResult = await this.git('branch', '--show-current');
    if (branchResult.status !== 'success') return null;
    const branch = branchResult.stdout.trim() || 'HEAD';

    // Get ahead/behind
    const upstreamResult = await this.git(
      'rev-list',
      '--left-right',
      '--count',
      '@{upstream}...HEAD'
    );
    const { ahead, behind } =
      upstreamResult.status === 'success'
        ? this.parseAheadBehind(upstreamResult.stdout)
        : { ahead: 0, behind: 0 };

    // Get porcelain status
    const statusResult = await this.git('status', '--porcelain=v1', '-z');
    if (statusResult.status !== 'success') return null;

    const { staged, unstaged, untracked } = this.parsePorcelainStatus(statusResult.stdout);

    const status: GitStatus = {
      branch,
      ahead,
      behind,
      staged,
      unstaged,
      untracked,
      isClean: staged.length === 0 && unstaged.length === 0 && untracked.length === 0,
    };

    // Update cache
    this.statusCache = { data: status, timestamp: Date.now() };

    return status;
  }

  private parseAheadBehind(output: string): { ahead: number; behind: number } {
    const [behindStr, aheadStr] = output.trim().split(/\s+/);
    return {
      behind: parseInt(behindStr, 10) || 0,
      ahead: parseInt(aheadStr, 10) || 0,
    };
  }

  private parsePorcelainStatus(output: string): {
    staged: GitFileChange[];
    unstaged: GitFileChange[];
    untracked: string[];
  } {
    const staged: GitFileChange[] = [];
    const unstaged: GitFileChange[] = [];
    const untracked: string[] = [];

    const entries = output.split('\0').filter(Boolean);
    let i = 0;
    while (i < entries.length) {
      const entry = entries[i];
      if (!entry || entry.length < 3) {
        i++;
        continue;
      }

      const indexStatus = entry[0];
      const worktreeStatus = entry[1];
      const path = entry.slice(3);
      const oldPath = this.readOldPath(entries, indexStatus, i);

      if (oldPath) {
        i++;
      }

      if (indexStatus === '?' && worktreeStatus === '?') {
        untracked.push(path);
        i++;
        continue;
      }

      if (indexStatus !== ' ' && indexStatus !== '?') {
        staged.push({
          path,
          status: this.parseStatusChar(indexStatus),
          oldPath,
        });
      }

      if (worktreeStatus !== ' ' && worktreeStatus !== '?') {
        unstaged.push({
          path,
          status: this.parseStatusChar(worktreeStatus),
        });
      }

      i++;
    }

    return { staged, unstaged, untracked };
  }

  private readOldPath(entries: string[], indexStatus: string, index: number): string | undefined {
    if (indexStatus !== 'R' && indexStatus !== 'C') {
      return undefined;
    }
    return entries[index + 1];
  }

  /**
   * Parse git status character to status type.
   */
  private parseStatusChar(
    char: string
  ): 'added' | 'modified' | 'deleted' | 'renamed' | 'copied' | 'unmerged' {
    switch (char) {
      case 'A':
        return 'added';
      case 'M':
        return 'modified';
      case 'D':
        return 'deleted';
      case 'R':
        return 'renamed';
      case 'C':
        return 'copied';
      case 'U':
        return 'unmerged';
      default:
        return 'modified';
    }
  }

  /**
   * Get list of branches.
   */
  async getBranches(): Promise<GitBranch[]> {
    const result = await this.git(
      'branch',
      '-a',
      '--format=%(refname:short)%09%(upstream:short)%09%(HEAD)'
    );
    if (result.status !== 'success') return [];

    const branches: GitBranch[] = [];

    for (const line of result.stdout.trim().split('\n')) {
      if (!line) continue;
      const [name, upstream, head] = line.split('\t');

      branches.push({
        name: name.replace(/^remotes\//, ''),
        isCurrent: head === '*',
        isRemote: name.startsWith('remotes/'),
        upstream: upstream || undefined,
      });
    }

    return branches;
  }

  /**
   * Get recent commits.
   */
  async getLog(limit = 10): Promise<GitCommit[]> {
    const result = await this.git(
      'log',
      `-${limit}`,
      '--format=%H%x00%h%x00%s%x00%an%x00%aI',
      '--'
    );
    if (result.status !== 'success') return [];

    const commits: GitCommit[] = [];

    for (const line of result.stdout.trim().split('\n')) {
      if (!line) continue;
      const [hash, shortHash, subject, author, dateStr] = line.split('\0');

      commits.push({
        hash,
        shortHash,
        subject,
        author,
        date: new Date(dateStr),
      });
    }

    return commits;
  }

  /**
   * Get diff for a file or all files.
   */
  async getDiff(file?: string, staged = false): Promise<string> {
    const args = ['diff'];
    if (staged) args.push('--cached');
    if (file) args.push('--', file);

    const result = await this.git(...args);
    return result.status === 'success' ? result.stdout : '';
  }

  /**
   * Get list of remotes.
   */
  async getRemotes(): Promise<GitRemote[]> {
    const result = await this.git('remote', '-v');
    if (result.status !== 'success') return [];

    const remotes = new Map<string, GitRemote>();

    for (const line of result.stdout.trim().split('\n')) {
      if (!line) continue;
      const match = line.match(/^(\S+)\s+(\S+)\s+\((fetch|push)\)$/);
      if (!match) continue;

      const [, name, url, type] = match;
      const remote = remotes.get(name) ?? { name, fetchUrl: '', pushUrl: '' };

      if (type === 'fetch') {
        remote.fetchUrl = url;
      } else {
        remote.pushUrl = url;
      }

      remotes.set(name, remote);
    }

    return Array.from(remotes.values());
  }

  /**
   * Stage files.
   */
  async add(...files: string[]): Promise<boolean> {
    if (files.length === 0) return false;
    const result = await this.git('add', '--', ...files);
    this.invalidateCache();
    return result.status === 'success';
  }

  /**
   * Unstage files.
   */
  async reset(...files: string[]): Promise<boolean> {
    if (files.length === 0) return false;
    const result = await this.git('reset', 'HEAD', '--', ...files);
    this.invalidateCache();
    return result.status === 'success';
  }

  /**
   * Create a commit.
   */
  async commit(message: string): Promise<{ success: boolean; hash?: string; error?: string }> {
    const result = await this.git('commit', '-m', message);
    this.invalidateCache();

    if (result.status !== 'success') {
      return { success: false, error: result.stderr || result.stdout };
    }

    // Extract commit hash from output
    // Format: [branch (root-commit) abc1234] or [branch abc1234]
    const match = result.stdout.match(/\[[\w/-]+(?:\s+\([^)]+\))?\s+([a-f0-9]+)\]/);
    return { success: true, hash: match?.[1] };
  }

  /**
   * Checkout a branch.
   */
  async checkout(branchOrPath: string, createNew = false): Promise<boolean> {
    const args = ['checkout'];
    if (createNew) args.push('-b');
    args.push(branchOrPath);

    const result = await this.git(...args);
    this.invalidateCache();
    return result.status === 'success';
  }

  /**
   * Pull from remote.
   */
  async pull(remote = 'origin', branch?: string): Promise<{ success: boolean; error?: string }> {
    const args = ['pull', remote];
    if (branch) args.push(branch);

    const result = await this.git(...args);
    this.invalidateCache();

    if (result.status !== 'success') {
      return { success: false, error: result.stderr || result.stdout };
    }

    return { success: true };
  }

  /**
   * Push to remote.
   */
  async push(
    remote = 'origin',
    branch?: string,
    options: { setUpstream?: boolean; force?: boolean } = {}
  ): Promise<{ success: boolean; error?: string }> {
    const args = ['push'];
    if (options.setUpstream) args.push('-u');
    if (options.force) args.push('--force-with-lease'); // Safer than --force
    args.push(remote);
    if (branch) args.push(branch);

    const result = await this.git(...args);

    if (result.status !== 'success') {
      return { success: false, error: result.stderr || result.stdout };
    }

    return { success: true };
  }

  // ============================================================================
  // GitHub CLI (gh) Integration
  // ============================================================================

  /**
   * Check if gh CLI is available and authenticated.
   */
  async isGhAvailable(): Promise<boolean> {
    const result = await this.gh('auth', 'status');
    return result.status === 'success';
  }

  /**
   * List pull requests.
   */
  async listPullRequests(
    state: 'open' | 'closed' | 'merged' | 'all' = 'open',
    limit = 10
  ): Promise<PullRequest[]> {
    const result = await this.gh(
      'pr',
      'list',
      '--state',
      state,
      '--limit',
      String(limit),
      '--json',
      'number,title,state,author,url,headRefName,baseRefName'
    );

    if (result.status !== 'success') return [];

    try {
      const prs = JSON.parse(result.stdout) as Array<{
        number: number;
        title: string;
        state: string;
        author: { login: string };
        url: string;
        headRefName: string;
        baseRefName: string;
      }>;

      return prs.map((pr) => ({
        number: pr.number,
        title: pr.title,
        state: pr.state.toLowerCase() as 'open' | 'closed' | 'merged',
        author: pr.author.login,
        url: pr.url,
        headBranch: pr.headRefName,
        baseBranch: pr.baseRefName,
      }));
    } catch {
      return [];
    }
  }

  /**
   * Get details of a specific PR.
   */
  async getPullRequest(
    numberOrBranch: number | string
  ): Promise<PullRequest | null> {
    const arg =
      typeof numberOrBranch === 'number' ? String(numberOrBranch) : numberOrBranch;

    const result = await this.gh(
      'pr',
      'view',
      arg,
      '--json',
      'number,title,state,author,url,headRefName,baseRefName'
    );

    if (result.status !== 'success') return null;

    try {
      const pr = JSON.parse(result.stdout) as {
        number: number;
        title: string;
        state: string;
        author: { login: string };
        url: string;
        headRefName: string;
        baseRefName: string;
      };

      return {
        number: pr.number,
        title: pr.title,
        state: pr.state.toLowerCase() as 'open' | 'closed' | 'merged',
        author: pr.author.login,
        url: pr.url,
        headBranch: pr.headRefName,
        baseBranch: pr.baseRefName,
      };
    } catch {
      return null;
    }
  }

  /**
   * Create a pull request.
   */
  async createPullRequest(options: {
    title: string;
    body?: string;
    base?: string;
    draft?: boolean;
  }): Promise<{ success: boolean; url?: string; error?: string }> {
    const args = ['pr', 'create', '--title', options.title];

    if (options.body) args.push('--body', options.body);
    if (options.base) args.push('--base', options.base);
    if (options.draft) args.push('--draft');

    const result = await this.gh(...args);

    if (result.status !== 'success') {
      return { success: false, error: result.stderr || result.stdout };
    }

    // gh pr create outputs the PR URL on success
    const url = result.stdout.trim();
    return { success: true, url };
  }

  /**
   * Dispose of the service.
   */
  dispose(): void {
    this.invalidateCache();
  }
}

// ============================================================================
// Singleton
// ============================================================================

let instance: GitService | null = null;

export function getGitService(options?: GitServiceOptions): GitService {
  if (!instance) {
    instance = new GitService(options);
  }
  return instance;
}

export function disposeGitService(): void {
  if (instance) {
    instance.dispose();
    instance = null;
  }
}
