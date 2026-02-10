import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { join } from 'path';
import { tmpdir } from 'os';
import { rm } from 'fs/promises';
import {
  getDomainService,
  getWorkflowExecutionService,
  resetDomainService,
  resetWorkAgentOrchestrationService,
  resetWorkflowExecutionService,
  resetWorkspaceService,
} from './index';

let workforceHome = '';

beforeEach(() => {
  workforceHome = join(tmpdir(), `workforce-workflow-exec-test-${Date.now()}`);
  process.env.WORKFORCE_HOME = workforceHome;
  resetWorkspaceService();
  resetDomainService();
  resetWorkAgentOrchestrationService();
  resetWorkflowExecutionService();
});

afterEach(async () => {
  await rm(workforceHome, { recursive: true, force: true });
});

describe('WorkflowExecutionService', () => {
  it('executes workflow steps and links children to workflow id', async () => {
    const workflow = await getDomainService().createWorkflowTemplate({
      name: 'No Gate Workflow',
      description: 'runs all steps',
      steps: [
        { id: 'step-1', name: 'Step 1', dependsOn: [], templateId: 'tpl-1' },
        { id: 'step-2', name: 'Step 2', dependsOn: ['step-1'], templateId: 'tpl-2' },
      ],
    });

    const result = await getWorkflowExecutionService().executeWorkflow(
      workflow.id,
      'execute full workflow'
    );
    expect(result.blockedByReview).toBe(false);
    expect(result.spawnedChildIds).toHaveLength(2);

    const agents = await getDomainService().listWorkAgents();
    const children = agents.filter((agent) => agent.parentId === result.parentAgentId);
    expect(children).toHaveLength(2);
    for (const child of children) {
      expect(child.workflowId).toBe(workflow.id);
    }
  });

  it('pauses parent and creates review when review gate is reached', async () => {
    const workflow = await getDomainService().createWorkflowTemplate({
      name: 'Gated Workflow',
      description: 'blocks on review gate',
      steps: [
        { id: 'step-1', name: 'Step 1', dependsOn: [], templateId: 'tpl-1' },
        { id: 'step-2', name: 'Review', dependsOn: ['step-1'], reviewGate: true },
        { id: 'step-3', name: 'Step 3', dependsOn: ['step-2'], templateId: 'tpl-2' },
      ],
    });

    const result = await getWorkflowExecutionService().executeWorkflow(
      workflow.id,
      'execute gated workflow'
    );

    expect(result.blockedByReview).toBe(true);
    expect(result.blockedStepId).toBe('step-2');
    expect(result.blockedReviewId).toBeTruthy();
    expect(result.spawnedChildIds).toHaveLength(1);

    const parent = await getDomainService().getWorkAgent(result.parentAgentId);
    expect(parent?.state).toBe('paused');

    const reviews = await getDomainService().listReviews();
    const review = reviews.find((item) => item.id === result.blockedReviewId);
    expect(review?.workflowId).toBe(workflow.id);
  });
});
