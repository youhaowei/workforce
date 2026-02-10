import { getDomainService } from './domain';
import { getWorktreeService } from './worktree';
import type {
  AggregateProgress,
  WorkAgentOrchestrationService,
  WorkAgentSession,
  WorkAgentState,
} from './types';

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
  async spawn(input: SpawnInput): Promise<WorkAgentSession> {
    const created = await getDomainService().createWorkAgent({
      title: input.title,
      goal: input.goal,
      workflowId: input.workflowId,
      templateId: input.templateId,
      parentId: input.parentId,
    });

    if (input.isolateWorktree) {
      const repoRoot = input.repoRoot ?? process.cwd();
      const worktree = await getWorktreeService().create({
        sessionId: created.id,
        repoRoot,
        baseRef: input.worktreeBaseRef,
      });
      await getDomainService().createOutput({
        agentId: created.id,
        branchName: worktree.branch,
        worktreePath: worktree.path,
      });
    }

    if (input.activate === false) {
      return created;
    }

    return getDomainService().updateWorkAgentState(created.id, 'active', {
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
    const parent = await getDomainService().getWorkAgent(parentId);
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
    return getDomainService().updateWorkAgentState(id, 'paused', { pauseReason: reason });
  }

  async resume(id: string): Promise<WorkAgentSession> {
    return getDomainService().updateWorkAgentState(id, 'active');
  }

  async cancel(id: string, reason?: string): Promise<WorkAgentSession> {
    const updated = await getDomainService().updateWorkAgentState(id, 'cancelled', {
      pauseReason: reason,
    });
    await this.archiveWorktreeIfPresent(id);
    return updated;
  }

  async complete(id: string, progress = 100): Promise<WorkAgentSession> {
    const updated = await getDomainService().updateWorkAgentState(id, 'completed', { progress });
    await this.archiveWorktreeIfPresent(id);
    return updated;
  }

  async fail(id: string, reason?: string): Promise<WorkAgentSession> {
    const updated = await getDomainService().updateWorkAgentState(id, 'failed', {
      pauseReason: reason,
    });
    await this.archiveWorktreeIfPresent(id);
    return updated;
  }

  async getAggregateProgress(parentId: string): Promise<AggregateProgress> {
    const parent = await getDomainService().getWorkAgent(parentId);
    if (!parent) {
      throw new Error(`WorkAgent not found: ${parentId}`);
    }

    const allAgents = await getDomainService().listWorkAgents();
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

  private async archiveWorktreeIfPresent(sessionId: string): Promise<void> {
    const worktree = await getWorktreeService().getBySession(sessionId);
    if (!worktree || worktree.status !== 'active') {
      return;
    }
    await getWorktreeService().archive(sessionId);
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
