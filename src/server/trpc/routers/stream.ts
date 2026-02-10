import { z } from 'zod';
import { getAgentService } from '@services/agent';
import { getEventBus } from '@shared/event-bus';
import { publicProcedure, t } from '../core';

type QueryStreamEvent =
  | {
      type: 'token';
      token: string;
    }
  | {
      type: 'done';
    }
  | {
      type: 'error';
      message: string;
    };

type QueueResolver<T> = (value: IteratorResult<T>) => void;

function createAsyncQueue<T>(signal: AbortSignal) {
  const values: T[] = [];
  const waiters: Array<QueueResolver<T>> = [];
  let closed = false;

  const flush = (value: IteratorResult<T>) => {
    const waiter = waiters.shift();
    if (waiter) {
      waiter(value);
      return true;
    }
    return false;
  };

  const close = () => {
    if (closed) return;
    closed = true;
    while (flush({ done: true, value: undefined as never })) {
      // drain all pending waiters
    }
  };

  const push = (value: T) => {
    if (closed) return;
    if (!flush({ done: false, value })) {
      values.push(value);
    }
  };

  signal.addEventListener('abort', close, { once: true });

  async function* iterator(): AsyncGenerator<T> {
    try {
      while (!closed) {
        if (values.length > 0) {
          const next = values.shift();
          if (next !== undefined) {
            yield next;
          }
          continue;
        }

        const result = await new Promise<IteratorResult<T>>((resolve) => {
          waiters.push(resolve);
        });
        if (result.done) break;
        yield result.value;
      }
    } finally {
      close();
    }
  }

  return { push, close, iterator };
}

export const streamRouter = t.router({
  cancel: publicProcedure.mutation(() => {
    getAgentService().cancel();
    return { ok: true };
  }),

  query: publicProcedure
    .input(
      z.object({
        prompt: z.string().min(1),
      })
    )
    .subscription(async function* ({ input, signal }): AsyncGenerator<QueryStreamEvent, void, unknown> {
      const agent = getAgentService();
      const abortSignal = signal ?? new AbortController().signal;
      const onAbort = () => {
        agent.cancel();
      };
      abortSignal.addEventListener('abort', onAbort, { once: true });

      try {
        for await (const delta of agent.query(input.prompt)) {
          if (abortSignal.aborted) {
            break;
          }
          yield {
            type: 'token',
            token: delta.token,
          };
        }

        if (!abortSignal.aborted) {
          yield { type: 'done' };
        }
      } catch (error) {
        if (!abortSignal.aborted) {
          const message = error instanceof Error ? error.message : String(error);
          yield {
            type: 'error',
            message,
          };
        }
      } finally {
        abortSignal.removeEventListener('abort', onAbort);
      }
    }),

  events: publicProcedure.subscription(async function* ({ signal }) {
    const abortSignal = signal ?? new AbortController().signal;
    const bus = getEventBus();
    const queue = createAsyncQueue<unknown>(abortSignal);
    const unsubscribe = bus.on('*', (event) => {
      queue.push(event);
    });

    try {
      yield* queue.iterator();
    } finally {
      unsubscribe();
      queue.close();
    }
  }),
});
