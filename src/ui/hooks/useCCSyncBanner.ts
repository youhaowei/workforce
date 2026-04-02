/**
 * useCCSyncBanner — Detects when the active CC session needs syncing.
 * Checks on mount AND listens for live file change events.
 */

import { useState, useEffect, useCallback } from "react";
import { trpc } from "@/bridge/trpc";
import { useTRPC } from "@/bridge/react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

export function useCCSyncBanner(activeSessionId?: string) {
  const trpcUtils = useTRPC();
  const queryClient = useQueryClient();
  const [liveUpdate, setLiveUpdate] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  // Check sync status on mount / session change
  const { data: syncStatus } = useQuery({
    ...trpcUtils.session.checkCCSync.queryOptions({ sessionId: activeSessionId! }),
    enabled: !!activeSessionId,
    staleTime: 10_000,
  });

  const isOutdated = syncStatus?.inSync === false;

  // Reset state when session changes
  useEffect(() => {
    setLiveUpdate(false);
    setDismissed(false);
  }, [activeSessionId]);

  // Clear liveUpdate when server confirms session is in sync
  // (handles syncs triggered externally, e.g. SessionsPanel auto-sync)
  useEffect(() => {
    if (syncStatus?.inSync) {
      setLiveUpdate(false);
    }
  }, [syncStatus?.inSync]);

  // Listen for live cc_source_changed events
  useEffect(() => {
    if (!activeSessionId) return;

    const subscription = trpc.events.subscribe.subscribe(undefined, {
      onData: (event) => {
        const ev = event as { type: string; sessionId?: string; action?: string };
        if (
          ev.type === "SessionChange" &&
          ev.sessionId === activeSessionId &&
          ev.action === "cc_source_changed"
        ) {
          setLiveUpdate(true);
          setDismissed(false);
        }
      },
    });

    return () => subscription.unsubscribe();
  }, [activeSessionId]);

  const hasUpdate = !dismissed && (isOutdated || liveUpdate);

  const syncMutation = useMutation(
    trpcUtils.session.syncCC.mutationOptions({
      onSuccess: () => {
        setLiveUpdate(false);
        void queryClient.invalidateQueries({ queryKey: ["session"] });
      },
      onError: (err) => {
        console.error("CC sync failed:", err);
      },
      onSettled: () => {
        setIsSyncing(false);
      },
    }),
  );

  const handleSync = useCallback(() => {
    if (!activeSessionId || isSyncing) return;
    setIsSyncing(true);
    syncMutation.mutate({ sessionId: activeSessionId });
  }, [activeSessionId, isSyncing, syncMutation]);

  const handleDismiss = useCallback(() => {
    setDismissed(true);
  }, []);

  return { hasUpdate, isSyncing, handleSync, handleDismiss };
}
