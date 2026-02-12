/**
 * useEventBus — Subscribe to EventBus events with automatic cleanup.
 *
 * Uses useRef for the callback to avoid re-subscribing on every render.
 */

import { useEffect, useRef } from 'react';
import { getEventBus, type EventTypeName, type EventPayload } from '@/shared/event-bus';

/**
 * Subscribe to a single EventBus event with React lifecycle cleanup.
 */
export function useEventBus<T extends EventTypeName>(
  eventType: T,
  handler: (event: EventPayload<T>) => void,
): void {
  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  useEffect(() => {
    const bus = getEventBus();
    const unsubscribe = bus.on(eventType, (data) => {
      handlerRef.current(data);
    });
    return unsubscribe;
  }, [eventType]);
}
