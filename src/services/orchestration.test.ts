/**
 * OrchestrationService Tests
 *
 * Tests for agent spawning, lifecycle management, and aggregate progress
 * using mock dependencies.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createOrchestrationService } from "./orchestration";
import type {
  OrchestrationService,
  SessionService,
  TemplateService,
  WorktreeService,
  WorkflowService,
  OrgService,
  Org,
  WorkflowTemplate,
} from "./types";
import {
  resetIdCounter,
  createMockSessionService,
  createMockTemplateService,
  createMockWorktreeService,
  createMockWorkflowService,
  createMockOrgService,
} from "./__test__/orchestration-helpers";

// =============================================================================
// Mock the AgentInstance to avoid real SDK calls
// =============================================================================

/**
 * Mock agent control surface:
 * - `agentDelay` (legacy): wall-clock sleep before yielding. Use only for
 *   tests that don't care about exact ordering (e.g. "still active during
 *   pause"). Avoid for race tests — sleeps are scheduler-dependent on CI.
 * - `withLatch()`: returns deterministic latches the test can drive. The
 *   mock pops latches in FIFO order each time `run()` is called, so tests
 *   register one latch per spawn that needs control.
 */
let agentDelay = 0;

interface AgentLatch {
  /** Resolves once mock `run()` has begun and is awaiting the finish gate. */
  readonly started: Promise<void>;
  /** Releases the mock to proceed (yield tokens or no-op if cancelled). */
  allowFinish(): void;
  /** Resolves once mock `run()` has fully drained (post-yield). */
  readonly finished: Promise<void>;
}

const pendingLatches: AgentLatch[] = [];

function withLatch(): AgentLatch {
  let signalStarted!: () => void;
  let allowFinishFn!: () => void;
  let signalFinished!: () => void;
  const started = new Promise<void>((r) => (signalStarted = r));
  const canFinish = new Promise<void>((r) => (allowFinishFn = r));
  const finished = new Promise<void>((r) => (signalFinished = r));
  const latch: AgentLatch & {
    _signalStarted: () => void;
    _canFinish: Promise<void>;
    _signalFinished: () => void;
  } = {
    started,
    finished,
    allowFinish: () => allowFinishFn(),
    _signalStarted: signalStarted,
    _canFinish: canFinish,
    _signalFinished: signalFinished,
  };
  pendingLatches.push(latch);
  return latch;
}

vi.mock("./agent-instance", () => {
  return {
    AgentInstance: class MockAgentInstance {
      public readonly sessionId: string;
      private cancelled = false;

      constructor(sessionId: string, _options: unknown) {
        this.sessionId = sessionId;
      }

      async *run(_prompt: string) {
        const latch = pendingLatches.shift() as
          | (AgentLatch & {
              _signalStarted: () => void;
              _canFinish: Promise<void>;
              _signalFinished: () => void;
            })
          | undefined;

        if (latch) {
          latch._signalStarted();
          await latch._canFinish;
        } else if (agentDelay > 0) {
          await new Promise((r) => setTimeout(r, agentDelay));
        }

        try {
          if (this.cancelled) return;
          // Must include type:"token" — runAgent filters on delta.type === "token"
          yield { type: "token" as const, token: "Hello " };
          yield { type: "token" as const, token: "World" };
        } finally {
          latch?._signalFinished();
        }
      }

      cancel() {
        this.cancelled = true;
      }
      isRunning() {
        return false;
      }
      isCancelled() {
        return this.cancelled;
      }
      dispose() {
        this.cancelled = true;
      }
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

describe("OrchestrationService", () => {
  let sessionService: SessionService;
  let templateService: TemplateService;
  let worktreeService: WorktreeService;
  let workflowService: WorkflowService;
  let orgService: OrgService;
  let service: OrchestrationService;

  const defaultOrg: Org = {
    id: "ws_1",
    name: "Test Org",
    createdAt: Date.now(),
    updatedAt: Date.now(),
    settings: { allowedTools: [] },
  };

  beforeEach(() => {
    resetIdCounter();
    agentDelay = 0; // Default: instant completion
    pendingLatches.length = 0; // Clear any latches leaked from previous test
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
      orgService,
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

  describe("spawn", () => {
    it("should create a WorkAgent session and return it", async () => {
      const session = await service.spawn({
        templateId: "tpl_test",
        goal: "Write tests",
        orgId: "ws_1",
      });

      expect(session.id).toBeTruthy();
      const meta = session.metadata as Record<string, unknown>;
      expect(meta.type).toBe("workagent");
      expect(meta.goal).toBe("Write tests");
    });

    it("should transition session to active state", async () => {
      const session = await service.spawn({
        templateId: "tpl_test",
        goal: "Test goal",
        orgId: "ws_1",
      });

      const meta = session.metadata as Record<string, unknown>;
      const lifecycle = meta.lifecycle as { state: string };
      expect(lifecycle.state).toBe("active");
    });

    it("should throw if template not found", async () => {
      await expect(
        service.spawn({
          templateId: "tpl_nonexistent",
          goal: "Fail",
          orgId: "ws_1",
        }),
      ).rejects.toThrow("Template not found");
    });

    it("should set parentId when provided", async () => {
      // Create parent session first
      const parent = await sessionService.create("Parent");

      const child = await service.spawn({
        templateId: "tpl_test",
        goal: "Child task",
        parentSessionId: parent.id,
        orgId: "ws_1",
      });

      // Re-fetch to verify parentId was persisted
      const fetched = await sessionService.get(child.id);
      expect(fetched?.parentId).toBe(parent.id);
    });

    it("should create worktree when isolateWorktree is true", async () => {
      const session = await service.spawn({
        templateId: "tpl_test",
        goal: "Isolated task",
        orgId: "ws_1",
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

    it("should use process.cwd() for worktree isolation", async () => {
      const session = await service.spawn({
        templateId: "tpl_test",
        goal: "Isolated task",
        orgId: "ws_1",
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

    it("should pass allowedTools from org settings to agent", async () => {
      // Create org with allowed tools
      const restrictedWs: Org = {
        id: "ws_restricted",
        name: "Restricted",
        createdAt: Date.now(),
        updatedAt: Date.now(),
        settings: { allowedTools: ["bash", "read"] },
      };
      orgService.dispose();
      orgService = createMockOrgService([defaultOrg, restrictedWs]);
      service.dispose();
      service = createOrchestrationService(
        sessionService,
        templateService,
        worktreeService,
        workflowService,
        orgService,
      );

      const session = await service.spawn({
        templateId: "tpl_test",
        goal: "Restricted task",
        orgId: "ws_restricted",
      });

      // Session should be created successfully
      expect(session.id).toBeTruthy();
      const meta = session.metadata as Record<string, unknown>;
      expect(meta.repoRoot).toBe(process.cwd());
    });

    it("should eventually transition to completed after agent finishes", async () => {
      const session = await service.spawn({
        templateId: "tpl_test",
        goal: "Quick task",
        orgId: "ws_1",
      });

      // Wait for the async agent to complete
      await new Promise((resolve) => setTimeout(resolve, 50));

      const updated = await sessionService.get(session.id);
      const meta = updated?.metadata as Record<string, unknown>;
      const lifecycle = meta?.lifecycle as { state: string };
      expect(lifecycle.state).toBe("completed");
      // Token accumulation path must actually write output — mock yields
      // { type: "token", token: "Hello " } + "World"
      expect(meta.output).toBe("Hello World");
      expect(meta.completionSummary).toBe("Hello World");
    });

    it("should NOT write success metadata when cancelled mid-run", async () => {
      const latch = withLatch();
      const session = await service.spawn({
        templateId: "tpl_test",
        goal: "Cancel me",
        orgId: "ws_1",
      });

      // Deterministic: wait until run() has begun and is parked at the gate.
      await latch.started;
      await service.cancel(session.id, "mid-run cancel");

      // Release the mock — it sees cancelled=true and returns without yielding.
      latch.allowFinish();
      await latch.finished;

      // Wait for runAgent's post-iteration chain (isAlreadyTerminal +
      // metadata write attempt + finally) to fully drain. Poll instead of
      // guessing await depth.
      await vi.waitFor(() => {
        expect(service.getActiveInstances().has(session.id)).toBe(false);
      });

      const updated = await sessionService.get(session.id);
      const meta = updated?.metadata as Record<string, unknown>;
      const lifecycle = meta?.lifecycle as { state: string };
      expect(lifecycle.state).toBe("cancelled");
      // Key assertion: cancelled session must NOT get success metadata overwriting it
      expect(meta.output).toBeUndefined();
      expect(meta.completionSummary).toBeUndefined();
    });
  });

  describe("cancel", () => {
    it("should transition session to cancelled", async () => {
      const session = await service.spawn({
        templateId: "tpl_test",
        goal: "Cancel me",
        orgId: "ws_1",
      });

      await service.cancel(session.id, "User requested");

      const updated = await sessionService.get(session.id);
      const meta = updated?.metadata as Record<string, unknown>;
      const lifecycle = meta?.lifecycle as { state: string };
      expect(lifecycle.state).toBe("cancelled");
    });

    it("should remove instance from active set", async () => {
      const session = await service.spawn({
        templateId: "tpl_test",
        goal: "Cancel me",
        orgId: "ws_1",
      });

      await service.cancel(session.id);

      const instances = service.getActiveInstances();
      expect(instances.has(session.id)).toBe(false);
    });
  });

  describe("pause", () => {
    it("should transition session to paused", async () => {
      agentDelay = 500; // Slow agent so we can pause before it completes
      const session = await service.spawn({
        templateId: "tpl_test",
        goal: "Pause me",
        orgId: "ws_1",
      });

      await service.pause(session.id, "Awaiting review");

      const updated = await sessionService.get(session.id);
      const meta = updated?.metadata as Record<string, unknown>;
      const lifecycle = meta?.lifecycle as { state: string };
      expect(lifecycle.state).toBe("paused");
    });
  });

  describe("resume", () => {
    it("should transition session back to active", async () => {
      agentDelay = 500; // Slow agent for pause/resume
      const session = await service.spawn({
        templateId: "tpl_test",
        goal: "Resume me",
        orgId: "ws_1",
      });

      await service.pause(session.id, "Paused");

      agentDelay = 500; // Resumed agent also slow
      await service.resume(session.id);

      // Check immediately — agent should still be running
      const updated = await sessionService.get(session.id);
      const meta = updated?.metadata as Record<string, unknown>;
      const lifecycle = meta?.lifecycle as { state: string };
      expect(lifecycle.state).toBe("active");
    });

    it("should keep the resumed instance alive while the cancelled run unwinds", async () => {
      const firstLatch = withLatch();
      const secondLatch = withLatch();

      const session = await service.spawn({
        templateId: "tpl_test",
        goal: "Resume race",
        orgId: "ws_1",
      });

      // First run() is parked at its gate. Pause cancels it without releasing.
      await firstLatch.started;
      await service.pause(session.id, "Paused");

      // Resume creates a new instance + starts a fresh run() that parks on
      // secondLatch. Meanwhile the original run() is still parked on
      // firstLatch — release it so its finally block runs. The bug we're
      // guarding against: original's finally tears down the resumed instance.
      await service.resume(session.id);
      await secondLatch.started;
      firstLatch.allowFinish();
      await firstLatch.finished;
      // Drain microtasks so the original runAgent's finally block runs.
      await Promise.resolve();
      await Promise.resolve();

      // Resumed instance must still be in the active set after original cleanup.
      expect(service.getActiveInstances().has(session.id)).toBe(true);
      const midRun = await sessionService.get(session.id);
      const midRunMeta = (midRun?.metadata ?? {}) as Record<string, unknown>;
      expect((midRunMeta.lifecycle as { state: string }).state).toBe("active");

      // Now release the resumed run and verify it completes normally.
      secondLatch.allowFinish();
      await secondLatch.finished;

      // runAgent's post-iteration chain is several awaits (isAlreadyTerminal,
      // get, updateSession, transitionState). Poll instead of guessing depth.
      await vi.waitFor(async () => {
        const s = await sessionService.get(session.id);
        const meta = (s?.metadata ?? {}) as Record<string, unknown>;
        expect((meta.lifecycle as { state: string }).state).toBe("completed");
      });

      const completed = await sessionService.get(session.id);
      const completedMeta = completed?.metadata as Record<string, unknown>;
      expect(completedMeta.output).toBe("Hello World");
    });

    it("should throw if session not found", async () => {
      await expect(service.resume("sess_fake")).rejects.toThrow("Session not found");
    });

    it("should throw if session is not paused", async () => {
      agentDelay = 500; // Slow agent so state is 'active' when we try resume
      const session = await service.spawn({
        templateId: "tpl_test",
        goal: "Not paused",
        orgId: "ws_1",
      });

      // Session is active, not paused — resume should fail
      await expect(service.resume(session.id)).rejects.toThrow("Cannot resume session in state");
    });
  });

  describe("getAggregateProgress", () => {
    it("should aggregate child session progress", async () => {
      const parent = await sessionService.create("Parent");

      // Spawn child1 with instant completion
      agentDelay = 0;
      await service.spawn({
        templateId: "tpl_test",
        goal: "Task 1",
        parentSessionId: parent.id,
        orgId: "ws_1",
      });

      // Let child1 complete
      await new Promise((resolve) => setTimeout(resolve, 20));

      // Spawn child2 with slow agent, then immediately pause it
      agentDelay = 2000;
      const child2 = await service.spawn({
        templateId: "tpl_test",
        goal: "Task 2",
        parentSessionId: parent.id,
        orgId: "ws_1",
      });
      await service.pause(child2.id, "Needs review");

      // Spawn child3 with instant completion
      agentDelay = 0;
      await service.spawn({
        templateId: "tpl_test",
        goal: "Task 3",
        parentSessionId: parent.id,
        orgId: "ws_1",
      });

      // Let child3 complete
      await new Promise((resolve) => setTimeout(resolve, 20));

      const progress = await service.getAggregateProgress(parent.id);
      expect(progress.total).toBe(3);
      expect(progress.paused).toBe(1);
      expect(progress.completed).toBe(2);
    });

    it("should return zeros for parent with no children", async () => {
      const parent = await sessionService.create("Empty Parent");
      const progress = await service.getAggregateProgress(parent.id);

      expect(progress.total).toBe(0);
      expect(progress.progress).toBe(0);
    });
  });

  describe("getActiveInstances", () => {
    it("should track active instances", async () => {
      await service.spawn({
        templateId: "tpl_test",
        goal: "Task A",
        orgId: "ws_1",
      });

      const instances = service.getActiveInstances();
      expect(instances).toBeInstanceOf(Map);
    });
  });

  describe("executeWorkflow", () => {
    it("should throw if WorkflowService is not available", async () => {
      const serviceNoWf = createOrchestrationService(
        sessionService,
        templateService,
        worktreeService,
        undefined,
        orgService,
      );

      await expect(serviceNoWf.executeWorkflow("wf_1", "ws_1")).rejects.toThrow(
        "WorkflowService not available",
      );

      serviceNoWf.dispose();
    });

    it("should throw if workflow not found", async () => {
      await expect(service.executeWorkflow("wf_nonexistent", "ws_1")).rejects.toThrow(
        "Workflow not found",
      );
    });

    it("should create a parent session for the workflow", async () => {
      const wf: WorkflowTemplate = {
        id: "wf_exec",
        name: "Exec Test",
        description: "",
        steps: [
          {
            id: "s1",
            name: "Step 1",
            type: "agent",
            templateId: "tpl_test",
            dependsOn: [],
            goal: "Do step 1",
          },
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
        orgService,
      );

      const parentSession = await service.executeWorkflow("wf_exec", "ws_1");
      expect(parentSession.id).toBeTruthy();

      const meta = parentSession.metadata as Record<string, unknown>;
      expect(meta.type).toBe("workagent");
    });
  });

  describe("dispose", () => {
    it("should clean up all instances", async () => {
      await service.spawn({
        templateId: "tpl_test",
        goal: "Task",
        orgId: "ws_1",
      });

      service.dispose();

      const instances = service.getActiveInstances();
      expect(instances.size).toBe(0);
    });
  });
});
