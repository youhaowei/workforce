/**
 * OrchestrationService Workflow Tests (regression)
 *
 * Tests for multi-step workflow execution, review gates, and step ordering.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createOrchestrationService } from './orchestration';
import type {
  OrchestrationService,
  SessionService,
  TemplateService,
  WorktreeService,
  WorkflowService,
  WorkflowTemplate,
} from './types';
import {
  resetIdCounter,
  createMockSessionService,
  createMockTemplateService,
  createMockWorktreeService,
  createMockWorkflowService,
  createMockReviewService,
} from './__test__/orchestration-helpers';

// Mock AgentInstance to avoid real SDK calls
let agentDelay = 0;

vi.mock('./agent-instance', () => {
  return {
    AgentInstance: class MockAgentInstance {
      public readonly sessionId: string;
      private cancelled = false;

      constructor(sessionId: string, _options: unknown) {
        this.sessionId = sessionId;
      }

      async *run(_prompt: string) {
        const delay = agentDelay;
        if (delay > 0) {
          await new Promise((r) => setTimeout(r, delay));
        }
        if (this.cancelled) return;
        yield { token: 'Hello ', index: 0 };
        yield { token: 'World', index: 1 };
      }

      cancel() { this.cancelled = true; }
      isRunning() { return false; }
      dispose() { this.cancelled = true; }
    },
    AgentError: class extends Error {
      code: string;
      constructor(msg: string, code: string) {
        super(msg);
        this.code = code;
      }
    },
  };
});

describe('executeWorkflow (regression)', () => {
  let sessionService: SessionService;
  let templateService: TemplateService;
  let worktreeService: WorktreeService;
  let workflowService: WorkflowService;
  let service: OrchestrationService;

  const makeWorkflow = (steps: WorkflowTemplate['steps']): WorkflowTemplate => ({
    id: 'wf_reg',
    name: 'Regression WF',
    description: '',
    steps,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    archived: false,
  });

  beforeEach(() => {
    resetIdCounter();
    agentDelay = 0;
    sessionService = createMockSessionService();
    templateService = createMockTemplateService();
    worktreeService = createMockWorktreeService();
    workflowService = createMockWorkflowService();
    service = createOrchestrationService(
      sessionService,
      templateService,
      worktreeService,
      workflowService
    );
  });

  afterEach(() => {
    service.dispose();
    sessionService.dispose();
    templateService.dispose();
    worktreeService.dispose();
    workflowService.dispose();
  });

  it('should execute multi-step workflow in order with correct workflowId', async () => {
    const wf = makeWorkflow([
      { id: 's1', name: 'Step 1', type: 'agent', templateId: 'tpl_test', dependsOn: [], goal: 'First' },
      { id: 's2', name: 'Step 2', type: 'agent', templateId: 'tpl_test', dependsOn: ['s1'], goal: 'Second' },
      { id: 's3', name: 'Step 3', type: 'agent', templateId: 'tpl_test', dependsOn: ['s2'], goal: 'Third' },
    ]);

    workflowService.dispose();
    workflowService = createMockWorkflowService([wf]);
    service.dispose();
    service = createOrchestrationService(
      sessionService,
      templateService,
      worktreeService,
      workflowService
    );

    const parentSession = await service.executeWorkflow('wf_reg', 'ws_1');

    // Wait for all async agents to complete
    await new Promise((r) => setTimeout(r, 100));

    const children = await sessionService.getChildren(parentSession.id);
    expect(children.length).toBe(3);

    // All children should have workflowId === 'wf_reg' (not parentSessionId)
    for (const child of children) {
      const meta = child.metadata as Record<string, unknown>;
      expect(meta.workflowId).toBe('wf_reg');
    }
  });

  it('should set correct workflowStepIndex on child sessions', async () => {
    const wf = makeWorkflow([
      { id: 'a', name: 'A', type: 'agent', templateId: 'tpl_test', dependsOn: [], goal: 'A' },
      { id: 'b', name: 'B', type: 'agent', templateId: 'tpl_test', dependsOn: [], goal: 'B' },
    ]);

    workflowService.dispose();
    workflowService = createMockWorkflowService([wf]);
    service.dispose();
    service = createOrchestrationService(
      sessionService,
      templateService,
      worktreeService,
      workflowService
    );

    const parentSession = await service.executeWorkflow('wf_reg', 'ws_1');
    await new Promise((r) => setTimeout(r, 100));

    const children = await sessionService.getChildren(parentSession.id);
    const indices = children.map((c) => {
      const meta = c.metadata as Record<string, unknown>;
      return meta.workflowStepIndex;
    }).sort();
    expect(indices).toEqual([0, 1]);
  });

  it('should block at review gate until resolved, then continue', async () => {
    const reviewService = createMockReviewService();

    const wf = makeWorkflow([
      { id: 's1', name: 'Work', type: 'agent', templateId: 'tpl_test', dependsOn: [], goal: 'Work' },
      { id: 'gate', name: 'Gate', type: 'review_gate', dependsOn: ['s1'], reviewPrompt: 'Approve?', goal: undefined },
      { id: 's2', name: 'After', type: 'agent', templateId: 'tpl_test', dependsOn: ['gate'], goal: 'After' },
    ]);

    workflowService.dispose();
    workflowService = createMockWorkflowService([wf]);
    service.dispose();
    service = createOrchestrationService(
      sessionService,
      templateService,
      worktreeService,
      workflowService,
      undefined,
      reviewService
    );

    const parentSession = await service.executeWorkflow('wf_reg', 'ws_1');

    // Wait for s1 to complete and gate to block
    await new Promise((r) => setTimeout(r, 100));

    // Should have 1 pending review
    const pending = await reviewService.listPending('ws_1');
    expect(pending.length).toBe(1);

    // Approve the gate
    await reviewService.resolve(pending[0].id, 'ws_1', 'approve');

    // Wait for s2 to complete
    await new Promise((r) => setTimeout(r, 100));

    // Parent should complete
    const parentState = await sessionService.get(parentSession.id);
    const meta = parentState?.metadata as Record<string, unknown>;
    const lifecycle = meta?.lifecycle as { state: string };
    expect(lifecycle.state).toBe('completed');

    reviewService.dispose();
  });

  it('should execute parallel_group by running child steps concurrently', async () => {
    const wf = makeWorkflow([
      { id: 'a1', name: 'Agent 1', type: 'agent', templateId: 'tpl_test', dependsOn: [], goal: 'First' },
      { id: 'a2', name: 'Agent 2', type: 'agent', templateId: 'tpl_test', dependsOn: [], goal: 'Second' },
      { id: 'pg', name: 'Parallel', type: 'parallel_group', dependsOn: [], parallelStepIds: ['a1', 'a2'] },
    ]);

    workflowService.dispose();
    // Return parallel_group as a single batch (the child steps are expanded at runtime)
    workflowService = createMockWorkflowService([wf]);
    // Override getExecutionOrder to only return the parallel_group step
    workflowService.getExecutionOrder = async (_wsId: string, workflowId: string) => {
      // Only the parallel_group appears in the execution order; children are expanded
      const wfInner = await workflowService.get(_wsId, workflowId);
      if (!wfInner) throw new Error('Workflow not found');
      return [['pg']];
    };

    service.dispose();
    service = createOrchestrationService(
      sessionService,
      templateService,
      worktreeService,
      workflowService
    );

    const parentSession = await service.executeWorkflow('wf_reg', 'ws_1');

    // Wait for all async agents to complete
    await new Promise((r) => setTimeout(r, 100));

    const children = await sessionService.getChildren(parentSession.id);
    // Should have 2 child agent sessions (spawned by the parallel_group)
    expect(children.length).toBe(2);

    // Parent workflow should complete
    const parentState = await sessionService.get(parentSession.id);
    const meta = parentState?.metadata as Record<string, unknown>;
    const lifecycle = meta?.lifecycle as { state: string };
    expect(lifecycle.state).toBe('completed');
  });

  it('should fail workflow when review gate is rejected', async () => {
    const reviewService = createMockReviewService();

    const wf = makeWorkflow([
      { id: 's1', name: 'Work', type: 'agent', templateId: 'tpl_test', dependsOn: [], goal: 'Work' },
      { id: 'gate', name: 'Gate', type: 'review_gate', dependsOn: ['s1'], reviewPrompt: 'Approve?', goal: undefined },
    ]);

    workflowService.dispose();
    workflowService = createMockWorkflowService([wf]);
    service.dispose();
    service = createOrchestrationService(
      sessionService,
      templateService,
      worktreeService,
      workflowService,
      undefined,
      reviewService
    );

    const parentSession = await service.executeWorkflow('wf_reg', 'ws_1');

    // Wait for s1 to complete and gate to block
    await new Promise((r) => setTimeout(r, 100));

    // Reject the gate
    const pending = await reviewService.listPending('ws_1');
    expect(pending.length).toBe(1);
    await reviewService.resolve(pending[0].id, 'ws_1', 'reject');

    // Wait for failure
    await new Promise((r) => setTimeout(r, 100));

    // Parent should be failed
    const parentState = await sessionService.get(parentSession.id);
    const meta = parentState?.metadata as Record<string, unknown>;
    const lifecycle = meta?.lifecycle as { state: string };
    expect(lifecycle.state).toBe('failed');

    reviewService.dispose();
  });
});
