import { router, publicProcedure } from '../trpc';
import { getEventBus } from '@shared/event-bus';
import type { BusEvent } from '@shared/event-bus';

const MAX_QUEUE_SIZE = 1000;

export const eventsRouter = router({
  /**
   * SSE subscription that forwards all EventBus events to the client.
   * Uses a push-based pattern: EventBus callback → bounded queue → async generator yield.
   * Queue drops oldest events when backpressure exceeds MAX_QUEUE_SIZE.
   */
  subscribe: publicProcedure.subscription(async function* ({ signal }) {
    const bus = getEventBus();

    const queue: BusEvent[] = [];
    let resolve: (() => void) | null = null;

    const unsubscribe = bus.on('*', (event) => {
      if (queue.length >= MAX_QUEUE_SIZE) {
        queue.shift(); // drop oldest under backpressure
      }
      queue.push(event);
      if (resolve) {
        resolve();
        resolve = null;
      }
    });

    try {
      while (!signal?.aborted) {
        if (queue.length > 0) {
          yield queue.shift()!;
        } else {
          // Wait for next event or abort
          await new Promise<void>((r) => {
            resolve = r;
            // Also resolve on abort so we can exit the loop
            signal?.addEventListener('abort', () => r(), { once: true });
          });
        }
      }
    } finally {
      unsubscribe();
    }
  }),
});
