import { getDomainService } from './domain';
import { getWorkAgentOrchestrationService } from './orchestration';
import type {
  WorkflowExecutionResult,
  WorkflowExecutionService,
  WorkflowStep,
  WorkflowTemplate,
} from './types';

function getExecutionOrder(workflow: WorkflowTemplate): string[][] {
  const stepIds = new Set(workflow.steps.map((step) => step.id));

  for (const step of workflow.steps) {
    for (const dep of step.dependsOn) {
      if (!stepIds.has(dep)) {
        throw new Error(`Step "${step.id}" depends on missing step "${dep}"`);
      }
    }
  }

  const inDegree = new Map<string, number>();
  const dependents = new Map<string, string[]>();
  for (const step of workflow.steps) {
    inDegree.set(step.id, step.dependsOn.length);
    if (!dependents.has(step.id)) {
      dependents.set(step.id, []);
    }
    for (const dep of step.dependsOn) {
      const list = dependents.get(dep) ?? [];
      list.push(step.id);
      dependents.set(dep, list);
    }
  }

  const remaining = new Set(workflow.steps.map((step) => step.id));
  const batches: string[][] = [];

  while (remaining.size > 0) {
    const batch: string[] = [];
    for (const stepId of remaining) {
      if ((inDegree.get(stepId) ?? 0) === 0) {
        batch.push(stepId);
      }
    }

    if (batch.length === 0) {
      throw new Error(`Workflow "${workflow.id}" has a dependency cycle`);
    }

    batches.push(batch);
    for (const stepId of batch) {
      remaining.delete(stepId);
      for (const dep of dependents.get(stepId) ?? []) {
        inDegree.set(dep, (inDegree.get(dep) ?? 1) - 1);
      }
    }
  }

  return batches;
}

function stepGoal(step: WorkflowStep): string {
  const configuredGoal = step.config && typeof step.config.goal === 'string'
    ? step.config.goal
    : undefined;
  return configuredGoal ?? `Workflow step: ${step.name}`;
}

function stepIsolation(step: WorkflowStep): {
  isolateWorktree: boolean;
  repoRoot?: string;
  worktreeBaseRef?: string;
} {
  const isolateWorktree =
    step.config && typeof step.config.isolateWorktree === 'boolean'
      ? step.config.isolateWorktree
      : false;
  const repoRoot =
    step.config && typeof step.config.repoRoot === 'string'
      ? step.config.repoRoot
      : undefined;
  const worktreeBaseRef =
    step.config && typeof step.config.worktreeBaseRef === 'string'
      ? step.config.worktreeBaseRef
      : undefined;
  return { isolateWorktree, repoRoot, worktreeBaseRef };
}

class WorkflowExecutionServiceImpl implements WorkflowExecutionService {
  getExecutionOrder(workflow: WorkflowTemplate): string[][] {
    return getExecutionOrder(workflow);
  }

  async executeWorkflow(workflowId: string, goal?: string): Promise<WorkflowExecutionResult> {
    const workflows = await getDomainService().listWorkflowTemplates();
    const workflow = workflows.find((item) => item.id === workflowId);
    if (!workflow) {
      throw new Error(`Workflow not found: ${workflowId}`);
    }

    const orchestration = getWorkAgentOrchestrationService();
    const parent = await orchestration.spawn({
      title: `Workflow: ${workflow.name}`,
      goal: goal ?? workflow.description,
      workflowId: workflow.id,
      activate: true,
    });

    const stepMap = new Map(workflow.steps.map((step) => [step.id, step]));
    const batches = getExecutionOrder(workflow);
    const spawnedChildIds: string[] = [];

    for (const batch of batches) {
      for (const stepId of batch) {
        const step = stepMap.get(stepId);
        if (!step) continue;

        if (step.reviewGate) {
          const review = await getDomainService().createReview({
            sourceAgentId: parent.id,
            workflowId: workflow.id,
            summary: `Review gate: ${step.name}`,
            recommendation: `Approve to continue workflow "${workflow.name}".`,
          });

          await orchestration.pause(parent.id, `Waiting for review on step "${step.name}"`);

          return {
            workflowId: workflow.id,
            parentAgentId: parent.id,
            spawnedChildIds,
            blockedByReview: true,
            blockedStepId: step.id,
            blockedReviewId: review.id,
          };
        }

        const child = await orchestration.spawnChild(parent.id, {
          title: step.name,
          goal: stepGoal(step),
          templateId: step.templateId,
          workflowId: workflow.id,
          activate: true,
          ...stepIsolation(step),
        });
        spawnedChildIds.push(child.id);
      }
    }

    await orchestration.complete(parent.id, 100);

    return {
      workflowId: workflow.id,
      parentAgentId: parent.id,
      spawnedChildIds,
      blockedByReview: false,
    };
  }

  dispose(): void {}
}

let _instance: WorkflowExecutionService | null = null;

export function getWorkflowExecutionService(): WorkflowExecutionService {
  return (_instance ??= new WorkflowExecutionServiceImpl());
}

export function resetWorkflowExecutionService(): void {
  if (_instance) {
    _instance.dispose();
    _instance = null;
  }
}
