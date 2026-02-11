import { getDomainService } from './domain';
import { getWorktreeService } from './worktree';
import type {
  AggregateProgress,
  WorkAgentOrchestrationService,
  WorkAgentSession,
  WorkAgentState,
} from './types';

type DomainGateway = ReturnType<typeof getDomainService>;
type WorktreeGateway = ReturnType<typeof getWorktreeService>;

type SpawnInput = {
  title: string;
  goal: string;
  workflowId?: string;
  templateId?: string;
  parentId?: string;
  activate?: boolean;
  isolateWorktree?: boolean;
  repoRoot?: string;
  worktreeBaseRef?: string;
};

class WorkAgentOrchestrationServiceImpl implements WorkAgentOrchestrationService {
  constructor(
    private readonly domain: DomainGateway = getDomainService(),
    private readonly worktrees: WorktreeGateway = getWorktreeService()
  ) {}

  async spawn(input: SpawnInput): Promise<WorkAgentSession> {
    const created = await this.domain.createWorkAgent({
      title: input.title,
      goal: input.goal,
      workflowId: input.workflowId,
      templateId: input.templateId,
      parentId: input.parentId,
    });

    await this.setupWorktreeIsolationIfNeeded(created.id, input);

    if (input.activate === false) {
      return created;
    }

    return this.domain.updateWorkAgentState(created.id, 'active', {
      progress: Math.max(created.progress, 1),
    });
  }

  async spawnChild(
    parentId: string,
    input: {
      title: string;
      goal: string;
      templateId?: string;
      workflowId?: string;
      activate?: boolean;
      isolateWorktree?: boolean;
      repoRoot?: string;
      worktreeBaseRef?: string;
    }
  ): Promise<WorkAgentSession> {
    const parent = await this.domain.getWorkAgent(parentId);
    if (!parent) {
      throw new Error(`Parent WorkAgent not found: ${parentId}`);
    }

    return this.spawn({
      title: input.title,
      goal: input.goal,
      templateId: input.templateId,
      workflowId: input.workflowId,
      parentId,
      activate: input.activate,
      isolateWorktree: input.isolateWorktree,
      repoRoot: input.repoRoot,
      worktreeBaseRef: input.worktreeBaseRef,
    });
  }

  async pause(id: string, reason: string): Promise<WorkAgentSession> {
    return this.domain.updateWorkAgentState(id, 'paused', { pauseReason: reason });
  }

  async resume(id: string): Promise<WorkAgentSession> {
    return this.domain.updateWorkAgentState(id, 'active');
  }

  async cancel(id: string, reason?: string): Promise<WorkAgentSession> {
    return this.transitionAndArchive(id, 'cancelled', { pauseReason: reason });
  }

  async complete(id: string, progress = 100): Promise<WorkAgentSession> {
    return this.transitionAndArchive(id, 'completed', { progress });
  }

  async fail(id: string, reason?: string): Promise<WorkAgentSession> {
    return this.transitionAndArchive(id, 'failed', { pauseReason: reason });
  }

  async getAggregateProgress(parentId: string): Promise<AggregateProgress> {
    const parent = await this.domain.getWorkAgent(parentId);
    if (!parent) {
      throw new Error(`WorkAgent not found: ${parentId}`);
    }

    const allAgents = await this.domain.listWorkAgents();
    const children = allAgents.filter((agent) => agent.parentId === parent.id);

    const counts: Record<WorkAgentState, number> = {
      created: 0,
      active: 0,
      paused: 0,
      completed: 0,
      failed: 0,
      cancelled: 0,
    };

    for (const child of children) {
      counts[child.state] += 1;
    }

    const total = children.length;
    const terminal = counts.completed + counts.failed + counts.cancelled;
    const progress = total === 0 ? 0 : Math.round((terminal / total) * 100);

    return {
      total,
      created: counts.created,
      active: counts.active,
      paused: counts.paused,
      completed: counts.completed,
      failed: counts.failed,
      cancelled: counts.cancelled,
      progress,
    };
  }

  dispose(): void {}

  private async setupWorktreeIsolationIfNeeded(
    sessionId: string,
    input: Pick<SpawnInput, 'isolateWorktree' | 'repoRoot' | 'worktreeBaseRef'>
  ): Promise<void> {
    if (!input.isolateWorktree) {
      return;
    }

    const repoRoot = input.repoRoot ?? process.cwd();
    const worktree = await this.worktrees.create({
      sessionId,
      repoRoot,
      baseRef: input.worktreeBaseRef,
    });
    await this.domain.createOutput({
      agentId: sessionId,
      branchName: worktree.branch,
      worktreePath: worktree.path,
    });
  }

  private async transitionAndArchive(
    id: string,
    state: 'cancelled' | 'completed' | 'failed',
    options: { pauseReason?: string; progress?: number }
  ): Promise<WorkAgentSession> {
    const updated = await this.domain.updateWorkAgentState(id, state, options);
    await this.archiveWorktreeIfPresent(id);
    return updated;
  }

  private async archiveWorktreeIfPresent(sessionId: string): Promise<void> {
    const worktree = await this.worktrees.getBySession(sessionId);
    if (!worktree || worktree.status !== 'active') {
      return;
    }
    await this.worktrees.archive(sessionId);
  }
}

let _instance: WorkAgentOrchestrationService | null = null;

export function getWorkAgentOrchestrationService(): WorkAgentOrchestrationService {
  return (_instance ??= new WorkAgentOrchestrationServiceImpl());
}

export function resetWorkAgentOrchestrationService(): void {
  if (_instance) {
    _instance.dispose();
    _instance = null;
  }
}
