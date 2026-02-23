import { z } from 'zod';
import { router, publicProcedure } from '../trpc';
import { getSessionService } from '@/services/session';
import { getOrchestrationService } from './_services';
import type { LifecycleState } from '@/services/types';

export const sessionRouter = router({
  list: publicProcedure
    .input(z.object({
      limit: z.number().optional(),
      offset: z.number().optional(),
      orgId: z.string().optional(),
      projectId: z.string().optional(),
    }).optional())
    .query(({ input }) => getSessionService().list(input ?? undefined)),

  get: publicProcedure
    .input(z.object({ sessionId: z.string() }))
    .query(({ input }) => getSessionService().get(input.sessionId)),

  create: publicProcedure
    .input(z.object({
      title: z.string().optional(),
      orgId: z.string().optional(),
      projectId: z.string().optional(),
    }).refine(
      (d) => !d.projectId || !!d.orgId,
      { message: 'orgId is required when projectId is provided', path: ['orgId'] },
    ).optional())
    .mutation(({ input }) => {
      const { title, orgId, projectId } = input ?? {};
      const metadata = orgId || projectId
        ? { ...(orgId && { orgId }), ...(projectId && { projectId }) }
        : undefined;
      return getSessionService().create(title, undefined, metadata);
    }),

  resume: publicProcedure
    .input(z.object({ sessionId: z.string() }))
    .mutation(({ input }) => getSessionService().resume(input.sessionId)),

  fork: publicProcedure
    .input(z.object({ sessionId: z.string() }))
    .mutation(({ input }) => getSessionService().fork(input.sessionId)),

  delete: publicProcedure
    .input(z.object({ sessionId: z.string() }))
    .mutation(({ input }) => getSessionService().delete(input.sessionId)),

  children: publicProcedure
    .input(z.object({ sessionId: z.string() }))
    .query(({ input }) => getSessionService().getChildren(input.sessionId)),

  transition: publicProcedure
    .input(z.object({
      sessionId: z.string(),
      state: z.enum(['created', 'active', 'paused', 'completed', 'failed', 'cancelled']),
      reason: z.string(),
      actor: z.enum(['system', 'user', 'agent']).optional(),
    }))
    .mutation(({ input }) =>
      getSessionService().transitionState(
        input.sessionId,
        input.state as LifecycleState,
        input.reason,
        input.actor,
      ),
    ),

  listByState: publicProcedure
    .input(z.object({
      state: z.enum(['created', 'active', 'paused', 'completed', 'failed', 'cancelled']),
      orgId: z.string().optional(),
    }))
    .query(({ input }) =>
      getSessionService().listByState(input.state as LifecycleState, input.orgId),
    ),

  progress: publicProcedure
    .input(z.object({ sessionId: z.string() }))
    .query(({ input }) =>
      getOrchestrationService().getAggregateProgress(input.sessionId),
    ),

  // ─── Messages ─────────────────────────────────────────────────────

  addMessage: publicProcedure
    .input(z.object({
      sessionId: z.string(),
      message: z.object({
        id: z.string(),
        role: z.enum(['user', 'assistant', 'system']),
        content: z.string(),
        timestamp: z.number(),
        agentConfig: z.object({
          model: z.string(),
          thinkingLevel: z.enum(['off', 'auto', 'low', 'medium', 'high']),
          permissionMode: z.enum(['plan', 'default', 'acceptEdits', 'bypassPermissions']),
        }).optional(),
      }),
    }))
    .mutation(({ input }) =>
      getSessionService().recordMessage(input.sessionId, input.message),
    ),

  // ─── Stream lifecycle ───────────────────────────────────────────────

  streamStart: publicProcedure
    .input(z.object({
      sessionId: z.string(),
      messageId: z.string(),
      meta: z.record(z.unknown()).optional(),
    }))
    .mutation(({ input }) =>
      getSessionService().recordStreamStart(input.sessionId, input.messageId, input.meta),
    ),

  streamDelta: publicProcedure
    .input(z.object({
      sessionId: z.string(),
      messageId: z.string(),
      delta: z.string(),
      seq: z.number(),
    }))
    .mutation(({ input }) =>
      getSessionService().recordStreamDelta(input.sessionId, input.messageId, input.delta, input.seq),
    ),

  streamDeltaBatch: publicProcedure
    .input(z.object({
      sessionId: z.string(),
      messageId: z.string(),
      deltas: z.array(z.object({ delta: z.string(), seq: z.number() })),
    }))
    .mutation(({ input }) =>
      getSessionService().recordStreamDeltaBatch(input.sessionId, input.messageId, input.deltas),
    ),

  streamFinalize: publicProcedure
    .input(z.object({
      sessionId: z.string(),
      messageId: z.string(),
      fullContent: z.string(),
      stopReason: z.string(),
    }))
    .mutation(({ input }) =>
      getSessionService().recordStreamEnd(
        input.sessionId, input.messageId, input.fullContent, input.stopReason,
      ),
    ),

  streamAbort: publicProcedure
    .input(z.object({
      sessionId: z.string(),
      messageId: z.string(),
      reason: z.string(),
    }))
    .mutation(({ input }) =>
      getSessionService().recordStreamAbort(input.sessionId, input.messageId, input.reason),
    ),

  // ─── Messages ───────────────────────────────────────────────────────

  messages: publicProcedure
    .input(z.object({
      sessionId: z.string(),
      limit: z.number().optional(),
      offset: z.number().optional(),
    }))
    .query(({ input }) =>
      getSessionService().getMessages(input.sessionId, {
        limit: input.limit,
        offset: input.offset,
      }),
    ),
});
