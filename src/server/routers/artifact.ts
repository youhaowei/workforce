import { z } from 'zod';
import { router, publicProcedure } from '../trpc';
import { getArtifactService } from '@/services/artifact';

const ARTIFACT_ID_REGEX = /^art_[a-z0-9_]+$/;
const DANGEROUS_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const safeMetadata = z.record(z.unknown()).refine(
  (obj) => !Object.keys(obj).some((k) => DANGEROUS_KEYS.has(k)),
  { message: 'Metadata contains forbidden keys (__proto__, constructor, prototype)' }
);

const authorSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('user'), id: z.string() }),
  z.object({ type: z.literal('agent'), sessionId: z.string(), actionId: z.string() }),
  z.object({ type: z.literal('system') }),
]);

const commentInputSchema = z.object({
  artifactId: z.string().regex(ARTIFACT_ID_REGEX),
  content: z.string().max(10_000),
  severity: z.enum(['suggestion', 'issue', 'question', 'praise']),
  anchor: z.object({
    line: z.number().optional(),
    startCol: z.number().optional(),
    endCol: z.number().optional(),
    section: z.string().optional(),
  }).optional(),
  author: authorSchema,
});

export const artifactRouter = router({
  list: publicProcedure
    .input(z.object({
      orgId: z.string().optional(),
      projectId: z.string().optional(),
      mimeType: z.enum(['text/markdown', 'text/html', 'text/csv', 'application/json', 'image/svg+xml', 'text/plain']).optional(),
      status: z.enum(['draft', 'pending_review', 'approved', 'rejected', 'executing', 'archived']).optional(),
      sessionId: z.string().optional(),
    }).optional())
    .query(({ input }) => getArtifactService().list(input ?? undefined)),

  get: publicProcedure
    .input(z.object({ artifactId: z.string().regex(ARTIFACT_ID_REGEX) }))
    .query(({ input }) => getArtifactService().get(input.artifactId)),

  create: publicProcedure
    .input(z.object({
      orgId: z.string().min(1),
      projectId: z.string().optional(),
      title: z.string().max(500),
      mimeType: z.enum(['text/markdown', 'text/html', 'text/csv', 'application/json', 'image/svg+xml', 'text/plain']),
      filePath: z.string().max(1024),
      content: z.string().max(2_000_000).optional(),
      status: z.enum(['draft', 'pending_review', 'approved', 'rejected', 'executing', 'archived']).optional(),
      createdBy: authorSchema,
      sessionId: z.string().optional(),
      metadata: safeMetadata.optional(),
    }))
    .mutation(({ input }) => getArtifactService().create(input)),

  update: publicProcedure
    .input(z.object({
      artifactId: z.string().regex(ARTIFACT_ID_REGEX),
      patch: z.object({
        title: z.string().max(500).optional(),
        status: z.enum(['draft', 'pending_review', 'approved', 'rejected', 'executing', 'archived']).optional(),
        content: z.string().max(2_000_000).optional(),
        metadata: safeMetadata.optional(),
      }),
    }))
    .mutation(({ input }) => getArtifactService().update(input.artifactId, input.patch)),

  delete: publicProcedure
    .input(z.object({ artifactId: z.string().regex(ARTIFACT_ID_REGEX) }))
    .mutation(({ input }) => getArtifactService().delete(input.artifactId)),

  linkToSession: publicProcedure
    .input(z.object({ artifactId: z.string().regex(ARTIFACT_ID_REGEX), sessionId: z.string() }))
    .mutation(({ input }) => getArtifactService().linkToSession(input.artifactId, input.sessionId)),

  addComment: publicProcedure
    .input(commentInputSchema)
    .mutation(({ input }) => getArtifactService().addComment(input.artifactId, input)),

  submitReview: publicProcedure
    .input(z.object({
      artifactId: z.string().regex(ARTIFACT_ID_REGEX),
      action: z.enum(['approve', 'reject', 'edit', 'clarify']),
      comments: z.array(commentInputSchema),
      summary: z.string().max(5_000).optional(),
      author: authorSchema,
    }))
    .mutation(({ input }) => {
      const { artifactId, ...rest } = input;
      return getArtifactService().submitReview(artifactId, {
        ...rest,
        artifactId,
        comments: input.comments.map((c) => ({
          ...c,
          artifactId, // override to prevent mismatch
          id: '', // generated server-side
          createdAt: 0,
        })),
      });
    }),

});
