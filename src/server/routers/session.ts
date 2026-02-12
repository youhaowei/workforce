import { z } from 'zod';
import { router, publicProcedure } from '../trpc';
import { getSessionService } from '@/services/session';
import { getOrchestrationService } from './_services';
import type { LifecycleState, Message } from '@/services/types';

export const sessionRouter = router({
  list: publicProcedure
    .input(z.object({
      limit: z.number().optional(),
      offset: z.number().optional(),
      orgId: z.string().optional(),
    }).optional())
    .query(({ input }) => getSessionService().list(input ?? undefined)),

  get: publicProcedure
    .input(z.object({
      sessionId: z.string(),
      includeMessages: z.boolean().optional(),
    }))
    .query(({ input }) =>
      getSessionService().get(input.sessionId, {
        includeMessages: input.includeMessages,
      }),
    ),

  messages: publicProcedure
    .input(z.object({
      sessionId: z.string(),
      limit: z.number().int().positive().optional(),
      offset: z.number().int().nonnegative().optional(),
    }))
    .query(({ input }) =>
      getSessionService().getMessages(input.sessionId, {
        limit: input.limit,
        offset: input.offset,
      }),
    ),

  create: publicProcedure
    .input(z.object({ title: z.string().optional() }).optional())
    .mutation(({ input }) => getSessionService().create(input?.title)),

  resume: publicProcedure
    .input(z.object({ sessionId: z.string() }))
    .mutation(({ input }) => getSessionService().resume(input.sessionId)),

  fork: publicProcedure
    .input(z.object({ sessionId: z.string() }))
    .mutation(({ input }) => getSessionService().fork(input.sessionId)),

  delete: publicProcedure
    .input(z.object({ sessionId: z.string() }))
    .mutation(({ input }) => getSessionService().delete(input.sessionId)),

  addMessage: publicProcedure
    .input(z.object({
      sessionId: z.string(),
      message: z.object({
        id: z.string(),
        role: z.enum(['user', 'assistant', 'system']),
        content: z.string(),
        timestamp: z.number(),
        toolCalls: z.array(
          z.object({
            id: z.string(),
            name: z.string(),
            args: z.record(z.unknown()),
          }),
        ).optional(),
        toolResults: z.array(
          z.object({
            toolCallId: z.string(),
            result: z.unknown(),
            error: z.string().optional(),
          }),
        ).optional(),
      }),
    }))
    .mutation(({ input }) =>
      getSessionService().addMessage(input.sessionId, input.message as Message),
    ),

  startAssistantStream: publicProcedure
    .input(z.object({
      sessionId: z.string(),
      messageId: z.string(),
      meta: z.record(z.unknown()).optional(),
    }))
    .mutation(({ input }) =>
      getSessionService().startAssistantStream(input.sessionId, input.messageId, input.meta),
    ),

  appendAssistantDelta: publicProcedure
    .input(z.object({
      sessionId: z.string(),
      messageId: z.string(),
      delta: z.string(),
      seq: z.number().int().nonnegative(),
    }))
    .mutation(({ input }) =>
      getSessionService().appendAssistantDelta(
        input.sessionId,
        input.messageId,
        input.delta,
        input.seq,
      ),
    ),

  finalizeAssistantMessage: publicProcedure
    .input(z.object({
      sessionId: z.string(),
      messageId: z.string(),
      fullContent: z.string(),
      stopReason: z.string(),
    }))
    .mutation(({ input }) =>
      getSessionService().finalizeAssistantMessage(
        input.sessionId,
        input.messageId,
        input.fullContent,
        input.stopReason,
      ),
    ),

  abortAssistantStream: publicProcedure
    .input(z.object({
      sessionId: z.string(),
      messageId: z.string(),
      reason: z.string(),
    }))
    .mutation(({ input }) =>
      getSessionService().abortAssistantStream(
        input.sessionId,
        input.messageId,
        input.reason,
      ),
    ),

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
});
