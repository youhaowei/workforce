import { z } from 'zod';
import { router, publicProcedure } from '../trpc';
import { getAgentService } from '@/services/agent';
import { debugLog } from '@/shared/debug-log';

export const agentRouter = router({
  /**
   * Streaming query via tRPC subscription (SSE).
   * Yields token deltas, then completes.
   */
  query: publicProcedure
    .input(z.object({
      prompt: z.string(),
      model: z.string().optional(),
      maxThinkingTokens: z.number().optional(),
      permissionMode: z.enum(['plan', 'default', 'acceptEdits', 'bypassPermissions']).optional(),
    }))
    .subscription(async function* ({ input }) {
      debugLog('tRPC', 'agent.query subscription started', {
        prompt: input.prompt.slice(0, 100),
        model: input.model,
        maxThinkingTokens: input.maxThinkingTokens,
        permissionMode: input.permissionMode,
      });
      const agent = getAgentService();
      let tokenCount = 0;

      try {
        for await (const event of agent.query(input.prompt, {
          model: input.model,
          maxThinkingTokens: input.maxThinkingTokens,
          permissionMode: input.permissionMode,
        })) {
          if (event.type === 'token') {
            tokenCount++;
            // Important: never trim tokens — preserves whitespace between LLM tokens (gotcha #16)
            yield { type: 'token' as const, data: event.token };
          } else if (event.type === 'tool_start') {
            yield { type: 'tool_start' as const, name: event.name, input: event.input };
          } else if (event.type === 'status') {
            yield { type: 'status' as const, data: event.message };
          } else if (event.type === 'plan_ready') {
            yield { type: 'plan_ready' as const, path: event.path };
          }
        }
        debugLog('tRPC', 'agent.query complete', { totalTokens: tokenCount });
        yield { type: 'done' as const, data: '' };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        debugLog('tRPC', 'agent.query error', { error: message });
        yield { type: 'error' as const, data: message };
      }
    }),

  supportedModels: publicProcedure.query(async () => {
    try {
      return await getAgentService().getSupportedModels();
    } catch (err) {
      debugLog('tRPC', 'supportedModels failed', { error: err instanceof Error ? err.message : String(err) });
      return [];
    }
  }),

  cancel: publicProcedure.mutation(() => {
    getAgentService().cancel();
    return { ok: true };
  }),

  isQuerying: publicProcedure.query(() => ({
    querying: getAgentService().isQuerying(),
  })),
});
