/**
 * useServerEventInvalidation — Replaces polling with SSE-driven cache invalidation.
 *
 * Subscribes to the server's events SSE stream and invalidates React Query
 * caches when relevant domain events arrive. On SSE error, invalidates all
 * caches as a catch-up measure.
 */

import { useEffect } from "react";
import { trpc } from "@/bridge/trpc";
import { queryClient } from "@/bridge/query-client";

/** Map event types to the React Query key prefixes they should invalidate. */
const EVENT_TO_QUERY_KEYS: Record<string, string[][]> = {
  SessionChange: [["session"]],
  LifecycleTransition: [["session"]],
  ReviewItemChange: [["review"]],
  ProjectChange: [["project"]],
  TaskUpdate: [["task"]],
  TaskNotification: [["task"]],
};

export function useServerEventInvalidation() {
  useEffect(() => {
    const subscription = trpc.events.subscribe.subscribe(undefined, {
      onData: (event) => {
        const ev = event as { type: string };
        const keys = EVENT_TO_QUERY_KEYS[ev.type];
        if (keys) {
          for (const queryKey of keys) {
            queryClient.invalidateQueries({ queryKey });
          }
        }
      },
      onError: () => {
        // SSE disconnected — invalidate everything as catch-up
        queryClient.invalidateQueries();
      },
    });

    return () => subscription.unsubscribe();
  }, []);
}
