/**
 * OrchestrationService Tests
 *
 * Tests for agent spawning, lifecycle management, and aggregate progress
 * using mock dependencies.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createOrchestrationService } from './orchestration';
import type {
  OrchestrationService,
  SessionService,
  TemplateService,
  WorktreeService,
  WorkflowService,
  OrgService,
  Org,
  WorkflowTemplate,
} from './types';
import {
  resetIdCounter,
  createMockSessionService,
  createMockTemplateService,
  createMockWorktreeService,
  createMockWorkflowService,
  createMockOrgService,
} from './__test__/orchestration-helpers';

// =============================================================================
// Mock the AgentInstance to avoid real SDK calls
// =============================================================================

/**
 * Controllable mock agent: agents wait for `agentDelay` ms before yielding tokens.
 * Set agentDelay = 0 for instant completion, or higher to test pause/resume timing.
 */
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
        // Read delay at call time (allows per-test control)
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

// =============================================================================
// Tests
// =============================================================================

describe('OrchestrationService', () => {
  let sessionService: SessionService;
  let templateService: TemplateService;
  let worktreeService: WorktreeService;
  let workflowService: WorkflowService;
  let orgService: OrgService;
  let service: OrchestrationService;

  const defaultOrg: Org = {
    id: 'ws_1',
    name: 'Test Org',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    settings: { allowedTools: [] },
  };

  beforeEach(() => {
    resetIdCounter();
    agentDelay = 0; // Default: instant completion
    sessionService = createMockSessionService();
    templateService = createMockTemplateService();
    worktreeService = createMockWorktreeService();
    workflowService = createMockWorkflowService();
    orgService = createMockOrgService([defaultOrg]);
    service = createOrchestrationService(
      sessionService,
      templateService,
      worktreeService,
      workflowService,
      orgService
    );
  });

  afterEach(() => {
    service.dispose();
    sessionService.dispose();
    templateService.dispose();
    worktreeService.dispose();
    workflowService.dispose();
    orgService.dispose();
  });

  describe('spawn', () => {
    it('should create a WorkAgent session and return it', async () => {
      const session = await service.spawn({
        templateId: 'tpl_test',
        goal: 'Write tests',
        orgId: 'ws_1',
      });

      expect(session.id).toBeTruthy();
      const meta = session.metadata as Record<string, unknown>;
      expect(meta.type).toBe('workagent');
      expect(meta.goal).toBe('Write tests');
    });

    it('should transition session to active state', async () => {
      const session = await service.spawn({
        templateId: 'tpl_test',
        goal: 'Test goal',
        orgId: 'ws_1',
      });

      const meta = session.metadata as Record<string, unknown>;
      const lifecycle = meta.lifecycle as { state: string };
      expect(lifecycle.state).toBe('active');
    });

    it('should throw if template not found', async () => {
      await expect(
        service.spawn({
          templateId: 'tpl_nonexistent',
          goal: 'Fail',
          orgId: 'ws_1',
        })
      ).rejects.toThrow('Template not found');
    });

    it('should set parentId when provided', async () => {
      // Create parent session first
      const parent = await sessionService.create('Parent');

      const child = await service.spawn({
        templateId: 'tpl_test',
        goal: 'Child task',
        parentSessionId: parent.id,
        orgId: 'ws_1',
      });

      // Re-fetch to verify parentId was persisted
      const fetched = await sessionService.get(child.id);
      expect(fetched?.parentId).toBe(parent.id);
    });

    it('should create worktree when isolateWorktree is true', async () => {
      const session = await service.spawn({
        templateId: 'tpl_test',
        goal: 'Isolated task',
        orgId: 'ws_1',
        isolateWorktree: true,
      });

      // Check worktree was created
      const wt = worktreeService.getForSession(session.id);
      expect(wt).not.toBeNull();
      expect(wt!.sessionId).toBe(session.id);

      // Check session metadata has worktree path
      const meta = session.metadata as Record<string, unknown>;
      expect(meta.worktreePath).toBeTruthy();
    });

    it('should use process.cwd() for worktree isolation', async () => {
      const session = await service.spawn({
        templateId: 'tpl_test',
        goal: 'Isolated task',
        orgId: 'ws_1',
        isolateWorktree: true,
      });

      // The worktree should have been created with process.cwd()
      const wt = worktreeService.getForSession(session.id);
      expect(wt).not.toBeNull();
      expect(wt!.repoRoot).toBe(process.cwd());

      // Session metadata should also have repoRoot
      const meta = session.metadata as Record<string, unknown>;
      expect(meta.repoRoot).toBe(process.cwd());
    });

    it('should pass allowedTools from org settings to agent', async () => {
      // Create org with allowed tools
      const restrictedWs: Org = {
        id: 'ws_restricted',
        name: 'Restricted',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        settings: { allowedTools: ['bash', 'read'] },
      };
      orgService.dispose();
      orgService = createMockOrgService([defaultOrg, restrictedWs]);
      service.dispose();
      service = createOrchestrationService(
        sessionService,
        templateService,
        worktreeService,
        workflowService,
        orgService
      );

      const session = await service.spawn({
        templateId: 'tpl_test',
        goal: 'Restricted task',
        orgId: 'ws_restricted',
      });

      // Session should be created successfully
      expect(session.id).toBeTruthy();
      const meta = session.metadata as Record<string, unknown>;
      expect(meta.repoRoot).toBe(process.cwd());
    });

    it('should eventually transition to completed after agent finishes', async () => {
      const session = await service.spawn({
        templateId: 'tpl_test',
        goal: 'Quick task',
        orgId: 'ws_1',
      });

      // Wait for the async agent to complete
      await new Promise((resolve) => setTimeout(resolve, 50));

      const updated = await sessionService.get(session.id);
      const meta = updated?.metadata as Record<string, unknown>;
      const lifecycle = meta?.lifecycle as { state: string };
      expect(lifecycle.state).toBe('completed');
    });
  });

  describe('cancel', () => {
    it('should transition session to cancelled', async () => {
      const session = await service.spawn({
        templateId: 'tpl_test',
        goal: 'Cancel me',
        orgId: 'ws_1',
      });

      await service.cancel(session.id, 'User requested');

      const updated = await sessionService.get(session.id);
      const meta = updated?.metadata as Record<string, unknown>;
      const lifecycle = meta?.lifecycle as { state: string };
      expect(lifecycle.state).toBe('cancelled');
    });

    it('should remove instance from active set', async () => {
      const session = await service.spawn({
        templateId: 'tpl_test',
        goal: 'Cancel me',
        orgId: 'ws_1',
      });

      await service.cancel(session.id);

      const instances = service.getActiveInstances();
      expect(instances.has(session.id)).toBe(false);
    });
  });

  describe('pause', () => {
    it('should transition session to paused', async () => {
      agentDelay = 500; // Slow agent so we can pause before it completes
      const session = await service.spawn({
        templateId: 'tpl_test',
        goal: 'Pause me',
        orgId: 'ws_1',
      });

      await service.pause(session.id, 'Awaiting review');

      const updated = await sessionService.get(session.id);
      const meta = updated?.metadata as Record<string, unknown>;
      const lifecycle = meta?.lifecycle as { state: string };
      expect(lifecycle.state).toBe('paused');
    });
  });

  describe('resume', () => {
    it('should transition session back to active', async () => {
      agentDelay = 500; // Slow agent for pause/resume
      const session = await service.spawn({
        templateId: 'tpl_test',
        goal: 'Resume me',
        orgId: 'ws_1',
      });

      await service.pause(session.id, 'Paused');

      agentDelay = 500; // Resumed agent also slow
      await service.resume(session.id);

      // Check immediately — agent should still be running
      const updated = await sessionService.get(session.id);
      const meta = updated?.metadata as Record<string, unknown>;
      const lifecycle = meta?.lifecycle as { state: string };
      expect(lifecycle.state).toBe('active');
    });

    it('should throw if session not found', async () => {
      await expect(service.resume('sess_fake')).rejects.toThrow('Session not found');
    });

    it('should throw if session is not paused', async () => {
      agentDelay = 500; // Slow agent so state is 'active' when we try resume
      const session = await service.spawn({
        templateId: 'tpl_test',
        goal: 'Not paused',
        orgId: 'ws_1',
      });

      // Session is active, not paused — resume should fail
      await expect(service.resume(session.id)).rejects.toThrow('Cannot resume session in state');
    });
  });

  describe('getAggregateProgress', () => {
    it('should aggregate child session progress', async () => {
      const parent = await sessionService.create('Parent');

      // Spawn child1 with instant completion
      agentDelay = 0;
      await service.spawn({
        templateId: 'tpl_test',
        goal: 'Task 1',
        parentSessionId: parent.id,
        orgId: 'ws_1',
      });

      // Let child1 complete
      await new Promise((resolve) => setTimeout(resolve, 20));

      // Spawn child2 with slow agent, then immediately pause it
      agentDelay = 2000;
      const child2 = await service.spawn({
        templateId: 'tpl_test',
        goal: 'Task 2',
        parentSessionId: parent.id,
        orgId: 'ws_1',
      });
      await service.pause(child2.id, 'Needs review');

      // Spawn child3 with instant completion
      agentDelay = 0;
      await service.spawn({
        templateId: 'tpl_test',
        goal: 'Task 3',
        parentSessionId: parent.id,
        orgId: 'ws_1',
      });

      // Let child3 complete
      await new Promise((resolve) => setTimeout(resolve, 20));

      const progress = await service.getAggregateProgress(parent.id);
      expect(progress.total).toBe(3);
      expect(progress.paused).toBe(1);
      expect(progress.completed).toBe(2);
    });

    it('should return zeros for parent with no children', async () => {
      const parent = await sessionService.create('Empty Parent');
      const progress = await service.getAggregateProgress(parent.id);

      expect(progress.total).toBe(0);
      expect(progress.progress).toBe(0);
    });
  });

  describe('getActiveInstances', () => {
    it('should track active instances', async () => {
      await service.spawn({
        templateId: 'tpl_test',
        goal: 'Task A',
        orgId: 'ws_1',
      });

      const instances = service.getActiveInstances();
      expect(instances).toBeInstanceOf(Map);
    });
  });

  describe('executeWorkflow', () => {
    it('should throw if WorkflowService is not available', async () => {
      const serviceNoWf = createOrchestrationService(
        sessionService,
        templateService,
        worktreeService,
        undefined,
        orgService
      );

      await expect(
        serviceNoWf.executeWorkflow('wf_1', 'ws_1')
      ).rejects.toThrow('WorkflowService not available');

      serviceNoWf.dispose();
    });

    it('should throw if workflow not found', async () => {
      await expect(
        service.executeWorkflow('wf_nonexistent', 'ws_1')
      ).rejects.toThrow('Workflow not found');
    });

    it('should create a parent session for the workflow', async () => {
      const wf: WorkflowTemplate = {
        id: 'wf_exec',
        name: 'Exec Test',
        description: '',
        steps: [
          { id: 's1', name: 'Step 1', type: 'agent', templateId: 'tpl_test', dependsOn: [], goal: 'Do step 1' },
        ],
        createdAt: Date.now(),
        updatedAt: Date.now(),
        archived: false,
      };

      workflowService.dispose();
      workflowService = createMockWorkflowService([wf]);
      service.dispose();
      service = createOrchestrationService(
        sessionService,
        templateService,
        worktreeService,
        workflowService,
        orgService
      );

      const parentSession = await service.executeWorkflow('wf_exec', 'ws_1');
      expect(parentSession.id).toBeTruthy();

      const meta = parentSession.metadata as Record<string, unknown>;
      expect(meta.type).toBe('workagent');
    });
  });

  describe('dispose', () => {
    it('should clean up all instances', async () => {
      await service.spawn({
        templateId: 'tpl_test',
        goal: 'Task',
        orgId: 'ws_1',
      });

      service.dispose();

      const instances = service.getActiveInstances();
      expect(instances.size).toBe(0);
    });
  });
});
