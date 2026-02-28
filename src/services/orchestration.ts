/**
 * OrchestrationService - Multi-agent coordination and lifecycle management
 *
 * Provides:
 * - Spawn WorkAgent sessions with optional worktree isolation
 * - Cancel, pause, and resume agents
 * - Track aggregate progress across child sessions
 * - Execute workflow templates
 *
 * Composes: SessionService, TemplateService, WorktreeService, AgentInstance
 */

import { AgentInstance } from './agent-instance';
import { getEventBus } from '@/shared/event-bus';
import type {
  OrchestrationService,
  SpawnOptions,
  AggregateProgress,
  Session,
  SessionService,
  TemplateService,
  WorktreeService,
  WorkflowService,
  OrgService,
  ReviewService,
  ReviewAction,
  AgentTone,
  VerboseLevel,
} from './types';
import type { Unsubscribe, ReviewItemChangeEvent } from '@/shared/event-bus';

// =============================================================================
// Implementation
// =============================================================================

const REVIEW_GATE_TIMEOUT_MS = 60 * 60 * 1000; // 1 hour

class OrchestrationServiceImpl implements OrchestrationService {
  private instances = new Map<string, AgentInstance>();

  constructor(
    private sessionService: SessionService,
    private templateService: TemplateService,
    private worktreeService: WorktreeService,
    private workflowService: WorkflowService | null,
    private orgService: OrgService | null = null,
    private reviewService: ReviewService | null = null
  ) {}

  async spawn(options: SpawnOptions): Promise<Session> {
    const { templateId, goal, parentSessionId, orgId, isolateWorktree } = options;

    // 1. Load template
    const template = await this.templateService.get(orgId, templateId);
    if (!template) {
      throw new Error(`Template not found: ${templateId}`);
    }

    // 1b. Fetch org to get settings (e.g. allowedTools)
    const org = this.orgService
      ? await this.orgService.get(orgId)
      : null;
    const repoRoot = process.cwd();

    // 2. Create WorkAgent session (parentId is immutable lineage, set at creation)
    const session = await this.sessionService.createWorkAgent({
      templateId,
      goal,
      orgId,
      workflowId: options.workflowId,
      workflowStepIndex: options.workflowStepIndex,
      repoRoot,
      parentId: parentSessionId,
    });

    // 3. Create worktree if requested
    let cwd = repoRoot;
    if (isolateWorktree) {
      const worktreeInfo = await this.worktreeService.create(session.id, repoRoot);
      cwd = worktreeInfo.path;

      // Update session metadata with worktree path
      await this.sessionService.updateSession(session.id, {
        metadata: { ...session.metadata, worktreePath: worktreeInfo.path },
      });
    }

    // 4. Compose system prompt from template + org behavioral defaults
    const agentDefaults = org?.settings?.agentDefaults;
    const systemPrompt = this.buildSystemPrompt(
      template.systemPrompt,
      template.constraints,
      goal,
      agentDefaults?.tone,
      agentDefaults?.verboseLevel,
    );

    // 5. Create agent instance — pass allowed tools from org settings
    const allowedTools = org?.settings.allowedTools;
    const instance = new AgentInstance(session.id, {
      cwd,
      systemPrompt,
      allowedTools: allowedTools?.length ? allowedTools : undefined,
    });
    this.instances.set(session.id, instance);

    // 6. Transition to active
    await this.sessionService.transitionState(session.id, 'active', 'Agent spawned', 'system');

    // Emit spawn event
    getEventBus().emit({
      type: 'AgentSpawned',
      sessionId: session.id,
      parentSessionId,
      templateId,
      goal,
      orgId,
      timestamp: Date.now(),
    });

    // 7. Start agent in background (fire-and-forget)
    this.runAgent(session.id, goal);

    return session;
  }

  async cancel(sessionId: string, reason?: string): Promise<void> {
    const instance = this.instances.get(sessionId);
    if (instance) {
      instance.cancel();
      instance.dispose();
      this.instances.delete(sessionId);
    }

    await this.sessionService.transitionState(
      sessionId,
      'cancelled',
      reason ?? 'Cancelled by user',
      'user'
    );
  }

  async pause(sessionId: string, reason: string): Promise<void> {
    const instance = this.instances.get(sessionId);
    if (instance) {
      instance.cancel();
    }

    await this.sessionService.transitionState(sessionId, 'paused', reason, 'system');
  }

  async resume(sessionId: string): Promise<void> {
    const session = await this.sessionService.get(sessionId);
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`);
    }

    const metadata = session.metadata as Record<string, unknown>;
    const lifecycle = metadata.lifecycle as { state: string } | undefined;
    if (lifecycle?.state !== 'paused') {
      throw new Error(`Cannot resume session in state: ${lifecycle?.state ?? 'unknown'}`);
    }

    // Transition back to active
    await this.sessionService.transitionState(sessionId, 'active', 'Resumed', 'user');

    // Re-create agent instance and restart
    const goal = (metadata.goal as string) ?? '';
    const cwd = (metadata.worktreePath as string)
      ?? (metadata.repoRoot as string)
      ?? process.cwd();
    const systemPrompt = (metadata.systemPrompt as string) ?? undefined;

    // Re-fetch org settings for allowedTools
    const oId = metadata.orgId as string | undefined;
    let allowedTools: string[] | undefined;
    if (oId && this.orgService) {
      const org = await this.orgService.get(oId);
      if (org?.settings.allowedTools.length) {
        allowedTools = org.settings.allowedTools;
      }
    }

    const instance = new AgentInstance(sessionId, { cwd, systemPrompt, allowedTools });
    this.instances.set(sessionId, instance);

    this.runAgent(sessionId, goal);
  }

  async stopInstance(sessionId: string): Promise<void> {
    const instance = this.instances.get(sessionId);
    if (instance) {
      instance.cancel();
      instance.dispose();
      this.instances.delete(sessionId);
    }
  }

  async getAggregateProgress(parentSessionId: string): Promise<AggregateProgress> {
    const children = await this.sessionService.getChildren(parentSessionId);
    const total = children.length;

    let completed = 0;
    let failed = 0;
    let active = 0;
    let paused = 0;

    for (const child of children) {
      const meta = child.metadata as Record<string, unknown>;
      const lifecycle = meta.lifecycle as { state: string } | undefined;
      const state = lifecycle?.state ?? 'created';

      switch (state) {
        case 'completed':
          completed++;
          break;
        case 'failed':
          failed++;
          break;
        case 'active':
          active++;
          break;
        case 'paused':
          paused++;
          break;
      }
    }

    const progress = total > 0 ? Math.round(((completed + failed) / total) * 100) : 0;

    return { total, completed, failed, active, paused, progress };
  }

  async executeWorkflow(workflowId: string, orgId: string): Promise<Session> {
    if (!this.workflowService) {
      throw new Error('WorkflowService not available');
    }

    const workflow = await this.workflowService.get(orgId, workflowId);
    if (!workflow) {
      throw new Error(`Workflow not found: ${workflowId}`);
    }

    // Create a parent session for the workflow
    const parentSession = await this.sessionService.createWorkAgent({
      templateId: '',
      goal: `Execute workflow: ${workflow.name}`,
      orgId,
      workflowId,
    });

    await this.sessionService.transitionState(parentSession.id, 'active', 'Workflow started', 'system');

    // Get execution order (parallel batches)
    const batches = await this.workflowService.getExecutionOrder(orgId, workflowId);

    // Execute batches sequentially, steps within each batch in parallel
    this.runWorkflow(parentSession.id, workflow, batches, orgId);

    return parentSession;
  }

  getActiveInstances(): Map<string, AgentInstance> {
    return new Map(this.instances);
  }

  dispose(): void {
    for (const [, instance] of this.instances) {
      instance.cancel();
      instance.dispose();
    }
    this.instances.clear();
  }

  // ===========================================================================
  // Private
  // ===========================================================================

  private buildSystemPrompt(
    base: string,
    constraints: string[],
    goal: string,
    tone?: AgentTone,
    verboseLevel?: VerboseLevel,
  ): string {
    const parts: string[] = [];

    // Prepend behavioral preamble from org/template defaults
    const tonePreamble = this.getTonePreamble(tone);
    const verbosePreamble = this.getVerbosePreamble(verboseLevel);
    if (tonePreamble || verbosePreamble) {
      parts.push('## Communication Style');
      if (tonePreamble) parts.push(tonePreamble);
      if (verbosePreamble) parts.push(verbosePreamble);
      parts.push('');
    }

    parts.push(base);

    if (constraints.length > 0) {
      parts.push('\n## Constraints');
      for (const c of constraints) {
        parts.push(`- ${c}`);
      }
    }

    parts.push(`\n## Goal\n${goal}`);

    return parts.join('\n');
  }

  private getTonePreamble(tone?: AgentTone): string {
    switch (tone) {
      case 'friendly': return 'Be warm and approachable. Explain your reasoning.';
      case 'professional': return 'Be professional and precise. Focus on clarity.';
      case 'direct': return 'Be direct and concise. Skip pleasantries.';
      case 'technical': return 'Use technical language. Assume domain expertise.';
      default: return '';
    }
  }

  private getVerbosePreamble(level?: VerboseLevel): string {
    switch (level) {
      case 'concise': return 'Keep responses brief.';
      case 'balanced': return 'Provide moderate detail.';
      case 'thorough': return 'Provide detailed explanations with examples.';
      case 'exhaustive': return 'Be comprehensive. Cover edge cases and alternatives.';
      default: return '';
    }
  }

  /**
   * Run the agent asynchronously. Drains the generator to completion,
   * accumulates output, and transitions session state accordingly.
   */
  private async runAgent(sessionId: string, goal: string): Promise<void> {
    const instance = this.instances.get(sessionId);
    if (!instance) return;

    try {
      const tokens: string[] = [];
      for await (const delta of instance.run(goal)) {
        if (delta.type === 'token') {
          tokens.push(delta.token);
        }
      }

      // Agent completed successfully
      const output = tokens.join('');
      const session = await this.sessionService.get(sessionId);
      if (session) {
        await this.sessionService.updateSession(sessionId, {
          metadata: { ...session.metadata, output, completionSummary: output.slice(0, 500) },
        });
      }

      await this.sessionService.transitionState(sessionId, 'completed', 'Agent finished', 'system');
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await this.sessionService.transitionState(sessionId, 'failed', message, 'system').catch(() => {
        // Ignore if already transitioned (e.g. cancelled)
      });
    } finally {
      const inst = this.instances.get(sessionId);
      if (inst) {
        inst.dispose();
        this.instances.delete(sessionId);
      }
    }
  }

  /**
   * Wait for a review item to be resolved via EventBus notification.
   * Returns the resolution action, or throws on timeout.
   */
  private waitForReviewResolution(reviewItemId: string, orgId: string): Promise<ReviewAction> {
    return new Promise<ReviewAction>((resolve, reject) => {
      let unsubscribe: Unsubscribe | null = null;
      let timer: ReturnType<typeof setTimeout> | null = null;

      const cleanup = () => {
        if (unsubscribe) unsubscribe();
        if (timer) clearTimeout(timer);
      };

      unsubscribe = getEventBus().on('ReviewItemChange', async (event: ReviewItemChangeEvent) => {
        if (event.reviewItemId !== reviewItemId || event.action !== 'resolved') return;

        cleanup();
        const item = await this.reviewService!.get(reviewItemId, orgId);
        if (item?.resolution) {
          resolve(item.resolution.action);
        } else {
          resolve('approve');
        }
      });

      timer = setTimeout(() => {
        cleanup();
        reject(new Error(`Review gate timed out after ${REVIEW_GATE_TIMEOUT_MS}ms for item ${reviewItemId}`));
      }, REVIEW_GATE_TIMEOUT_MS);
    });
  }

  /**
   * Execute workflow batches sequentially. Steps within each batch run in parallel.
   */
  private async runWorkflow(
    parentSessionId: string,
    workflow: { id: string; steps: Array<{ id: string; type: string; templateId?: string; goal?: string; reviewPrompt?: string; parallelStepIds?: string[] }> },
    batches: string[][],
    orgId: string
  ): Promise<void> {
    try {
      const stepMap = new Map(workflow.steps.map((s) => [s.id, s]));
      const executedSteps = new Set<string>();

      const executeStep = async (stepId: string) => {
        // Deduplicate: parallel_group children may also appear in batches
        if (executedSteps.has(stepId)) return;
        executedSteps.add(stepId);

        const step = stepMap.get(stepId);
        if (!step) return;

        switch (step.type) {
          case 'agent': {
            if (!step.templateId) break;
            const stepIndex = workflow.steps.findIndex((s) => s.id === stepId);
            await this.spawn({
              templateId: step.templateId,
              goal: step.goal ?? `Workflow step: ${step.id}`,
              parentSessionId,
              orgId,
              workflowId: workflow.id,
              workflowStepIndex: stepIndex >= 0 ? stepIndex : undefined,
            });
            break;
          }

          case 'review_gate': {
            if (!this.reviewService) {
              throw new Error('ReviewService not available for review_gate step');
            }

            const reviewItem = await this.reviewService.create({
              sessionId: parentSessionId,
              orgId,
              workflowId: workflow.id,
              workflowStepId: stepId,
              type: 'approval',
              title: `Review gate: ${step.reviewPrompt ?? step.goal ?? stepId}`,
              summary: step.reviewPrompt ?? `Workflow paused at step ${stepId} for review`,
              context: { workflowName: workflow.id, stepId },
            });

            const action = await this.waitForReviewResolution(reviewItem.id, orgId);
            if (action === 'reject') {
              throw new Error(`Review gate rejected at step ${stepId}`);
            }
            break;
          }

          case 'parallel_group': {
            const childIds = step.parallelStepIds ?? [];
            await Promise.all(childIds.map((childId) => executeStep(childId)));
            break;
          }
        }
      };

      for (const batch of batches) {
        await Promise.all(batch.map(executeStep));
      }

      // Workflow completed
      await this.sessionService.transitionState(
        parentSessionId,
        'completed',
        'Workflow completed',
        'system'
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await this.sessionService.transitionState(
        parentSessionId,
        'failed',
        `Workflow failed: ${message}`,
        'system'
      ).catch(() => {});
    }
  }
}

// =============================================================================
// Factory
// =============================================================================

export function createOrchestrationService(
  sessionService: SessionService,
  templateService: TemplateService,
  worktreeService: WorktreeService,
  workflowService?: WorkflowService,
  orgService?: OrgService,
  reviewService?: ReviewService
): OrchestrationService {
  return new OrchestrationServiceImpl(
    sessionService,
    templateService,
    worktreeService,
    workflowService ?? null,
    orgService ?? null,
    reviewService ?? null
  );
}
