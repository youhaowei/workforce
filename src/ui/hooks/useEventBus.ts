/**
 * EventBus Hooks - SolidJS integration for EventBus
 *
 * Provides reactive hooks for subscribing to EventBus events.
 * Automatically cleans up subscriptions on component unmount.
 */

import { onCleanup, createSignal, batch, Accessor } from 'solid-js';
import { getEventBus, type BusEvent, type EventTypeName, type EventPayload } from '@shared/event-bus';

/**
 * Subscribe to a specific event type with automatic cleanup.
 *
 * @param eventType - The event type to subscribe to
 * @param handler - Callback function for events
 */
export function useEventBus<T extends EventTypeName>(
  eventType: T,
  handler: (event: EventPayload<T>) => void
): void {
  const bus = getEventBus();
  const unsubscribe = bus.on(eventType, handler);
  onCleanup(unsubscribe);
}

/**
 * Subscribe to multiple event types with automatic cleanup.
 *
 * @param handlers - Map of event types to handlers
 */
export function useEventBusMultiple(
  handlers: Partial<{ [K in EventTypeName]: (event: EventPayload<K>) => void }>
): void {
  const bus = getEventBus();
  const unsubscribes: Array<() => void> = [];

  for (const [eventType, handler] of Object.entries(handlers)) {
    if (handler) {
      unsubscribes.push(bus.on(eventType as EventTypeName, handler as (event: BusEvent) => void));
    }
  }

  onCleanup(() => {
    for (const unsub of unsubscribes) {
      unsub();
    }
  });
}

/**
 * Hook for streaming tokens with batched updates.
 *
 * Accumulates tokens and batches updates using requestAnimationFrame
 * to prevent excessive re-renders during high-frequency streaming.
 *
 * @returns Accessor for accumulated tokens and clear function
 */
export function useTokenStream(): {
  tokens: Accessor<string>;
  clear: () => void;
  isActive: Accessor<boolean>;
} {
  const [tokens, setTokens] = createSignal('');
  const [isActive, setIsActive] = createSignal(false);
  const bus = getEventBus();

  let pendingTokens = '';
  let frameScheduled = false;
  let lastUpdateTime = 0;

  const MIN_BATCH_INTERVAL_MS = 33; // ~30 updates/sec max

  const flush = () => {
    const now = Date.now();

    // Enforce rate limit
    if (now - lastUpdateTime < MIN_BATCH_INTERVAL_MS && pendingTokens.length < 100) {
      // Reschedule if we're rate-limited and don't have much content
      requestAnimationFrame(flush);
      return;
    }

    if (pendingTokens) {
      batch(() => {
        setTokens((prev) => prev + pendingTokens);
        pendingTokens = '';
        lastUpdateTime = now;
      });
    }
    frameScheduled = false;
  };

  const unsubscribe = bus.on('TokenDelta', (event) => {
    pendingTokens += event.token;
    setIsActive(true);

    if (!frameScheduled) {
      frameScheduled = true;
      requestAnimationFrame(flush);
    }
  });

  const clear = () => {
    batch(() => {
      setTokens('');
      setIsActive(false);
      pendingTokens = '';
    });
  };

  onCleanup(() => {
    unsubscribe();
    if (frameScheduled) {
      // Flush any remaining tokens on cleanup
      setTokens((prev) => prev + pendingTokens);
    }
  });

  return { tokens, clear, isActive };
}

/**
 * Hook for tracking active tools.
 *
 * @returns Accessor for active tool IDs and count
 */
export function useActiveTools(): {
  activeToolIds: Accessor<string[]>;
  count: Accessor<number>;
} {
  const [activeToolIds, setActiveToolIds] = createSignal<string[]>([]);
  const bus = getEventBus();

  const startUnsub = bus.on('ToolStart', (event) => {
    setActiveToolIds((prev) => [...prev, event.toolId]);
  });

  const endUnsub = bus.on('ToolEnd', (event) => {
    setActiveToolIds((prev) => prev.filter((id) => id !== event.toolId));
  });

  onCleanup(() => {
    startUnsub();
    endUnsub();
  });

  return {
    activeToolIds,
    count: () => activeToolIds().length,
  };
}
