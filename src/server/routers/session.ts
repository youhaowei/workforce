import { z } from 'zod';
import { resolve, relative } from 'path';
import { readFile, realpath, stat } from 'fs/promises';
import { TRPCError } from '@trpc/server';
import { router, publicProcedure } from '../trpc';
import { getSessionService } from '@/services/session';
import { getOrchestrationService } from './_services';
import type { LifecycleState, PlanArtifact } from '@/services/types';

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
    .input(z.object({
      sessionId: z.string(),
      atMessageIndex: z.number().int().min(-1).optional(),
    }))
    .mutation(async ({ input }) => {
      try {
        return await getSessionService().fork(input.sessionId, { atMessageIndex: input.atMessageIndex });
      } catch (err) {
        if (err instanceof Error && err.message.includes('not found'))
          throw new TRPCError({ code: 'NOT_FOUND', message: err.message });
        if (err instanceof Error && (err.message.includes('Invalid message') || err.message.includes('empty session')))
          throw new TRPCError({ code: 'BAD_REQUEST', message: err.message });
        throw err;
      }
    }),

  rewind: publicProcedure
    .input(z.object({
      sessionId: z.string(),
      messageIndex: z.number().int().min(-1),
    }))
    .mutation(async ({ input }) => {
      try {
        return await getSessionService().truncate(input.sessionId, input.messageIndex);
      } catch (err) {
        if (err instanceof Error && err.message.includes('not found'))
          throw new TRPCError({ code: 'NOT_FOUND', message: err.message });
        if (err instanceof Error && err.message.includes('Invalid message'))
          throw new TRPCError({ code: 'BAD_REQUEST', message: err.message });
        throw err;
      }
    }),

  forks: publicProcedure
    .input(z.object({ sessionId: z.string() }))
    .query(async ({ input }) => {
      const children = await getSessionService().getChildren(input.sessionId);
      return children
        .filter((c) => c.metadata?.forkAtMessageId)
        .map((c) => ({
          messageId: c.metadata.forkAtMessageId as string,
          sessionId: c.id,
          title: c.title,
        }));
    }),

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
      toolActivities: z.array(z.object({ name: z.string(), input: z.string() })).optional(),
      contentBlocks: z.array(z.discriminatedUnion('type', [
        z.object({ type: z.literal('text'), text: z.string() }),
        z.object({ type: z.literal('tool_use'), id: z.string(), name: z.string(), input: z.string(), result: z.unknown().optional(), error: z.string().optional(), status: z.enum(['running', 'complete', 'error']) }),
        z.object({ type: z.literal('thinking'), text: z.string() }),
      ])).optional(),
    }))
    .mutation(({ input }) =>
      getSessionService().recordStreamEnd(
        input.sessionId, input.messageId, input.fullContent, input.stopReason, input.toolActivities, input.contentBlocks,
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

  updateBlockResult: publicProcedure
    .input(z.object({
      sessionId: z.string(),
      messageId: z.string(),
      blockId: z.string(),
      result: z.unknown(),
    }))
    .mutation(({ input }) =>
      getSessionService().updateBlockResult(input.sessionId, input.messageId, input.blockId, input.result),
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

  // ─── Session Info ──────────────────────────────────────────────────

  rename: publicProcedure
    .input(z.object({ sessionId: z.string(), title: z.string() }))
    .mutation(({ input }) =>
      getSessionService().updateSession(input.sessionId, { title: input.title }),
    ),

  updateNotes: publicProcedure
    .input(z.object({ sessionId: z.string(), notes: z.string() }))
    .mutation(async ({ input }) => {
      const session = await getSessionService().get(input.sessionId);
      if (!session) throw new TRPCError({ code: 'NOT_FOUND', message: `Session not found: ${input.sessionId}` });
      await getSessionService().updateSession(input.sessionId, {
        metadata: { ...session.metadata, notes: input.notes },
      });
    }),

  // ─── Plan Artifacts ────────────────────────────────────────────────

  readFile: publicProcedure
    .input(z.object({ path: z.string() }))
    .query(async ({ input }) => {
      const projectRoot = process.cwd();
      const resolved = resolve(projectRoot, input.path);
      let real: string;
      try {
        real = await realpath(resolved);
      } catch {
        throw new TRPCError({ code: 'NOT_FOUND', message: `File not found: ${input.path}` });
      }
      const rel = relative(projectRoot, real);
      if (rel.startsWith('..') || resolve(projectRoot, rel) !== real) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Path must be within project directory' });
      }
      const MAX_SIZE = 1024 * 1024; // 1 MB
      const fileStat = await stat(real);
      if (fileStat.size > MAX_SIZE) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: `File too large: ${fileStat.size} bytes (max ${MAX_SIZE})` });
      }
      try {
        return await readFile(real, 'utf-8');
      } catch (err) {
        const code = (err as NodeJS.ErrnoException).code;
        if (code === 'ENOENT') {
          throw new TRPCError({ code: 'NOT_FOUND', message: `File not found: ${input.path}` });
        }
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: `Failed to read file: ${input.path}` });
      }
    }),

  updatePlanArtifact: publicProcedure
    .input(z.object({
      sessionId: z.string(),
      artifact: z.object({
        path: z.string(),
        title: z.string(),
        status: z.enum(['pending_review', 'approved', 'rejected', 'executing']),
        approvedPermission: z.enum(['plan', 'default', 'acceptEdits', 'bypassPermissions']).optional(),
        updatedAt: z.number(),
      }),
    }))
    .mutation(async ({ input }) => {
      const session = await getSessionService().get(input.sessionId);
      if (!session) throw new TRPCError({ code: 'NOT_FOUND', message: `Session not found: ${input.sessionId}` });
      const existing = [...((session.metadata.planArtifacts as PlanArtifact[] | undefined) ?? [])];
      const idx = existing.findIndex((a) => a.path === input.artifact.path);
      if (idx >= 0) {
        existing[idx] = input.artifact;
      } else {
        existing.push(input.artifact);
      }
      await getSessionService().updateSession(input.sessionId, {
        metadata: { ...session.metadata, planArtifacts: existing },
      });
    }),
});
