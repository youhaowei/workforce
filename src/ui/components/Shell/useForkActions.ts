/**
 * useForkActions — Encapsulates the forks query, forksMap memo,
 * and handleRewind/handleFork callbacks extracted from Shell.
 */

import { useCallback, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTRPC } from "@/bridge/react";
import { trpc as trpcClient } from "@/bridge/trpc";
import { queryClient } from "@/bridge/query-client";
import { useMessagesStore } from "@/ui/stores/useMessagesStore";
import { useDialogStore } from "@/ui/stores/useDialogStore";
import type { ShellError } from "@/ui/stores/shellStore";
import type { ForkInfo } from "../Messages/MessageItem";
import type { ViewType } from "./Shell";

interface UseForkActionsParams {
  selectedSessionId: string | null;
  activeSessionRef: React.RefObject<string | null>;
  handleSelectSession: (sessionId: string) => void;
  setError: (error: ShellError | null) => void;
  currentView: ViewType;
}

export function useForkActions({
  selectedSessionId,
  activeSessionRef,
  handleSelectSession,
  setError,
  currentView,
}: UseForkActionsParams) {
  const trpc = useTRPC();
  const clearMessages = useMessagesStore((s) => s.clearMessages);
  const loadMessages = useMessagesStore((s) => s.loadMessages);

  const { data: forksData } = useQuery(
    trpc.session.forks.queryOptions(
      { sessionId: selectedSessionId! },
      { enabled: !!selectedSessionId && currentView === "sessions" },
    ),
  );

  const forksMap = useMemo(() => {
    if (!forksData || forksData.length === 0) return undefined;
    const map = new Map<string, ForkInfo[]>();
    for (const fork of forksData) {
      const existing = map.get(fork.messageId) ?? [];
      existing.push({ sessionId: fork.sessionId, title: fork.title ?? undefined });
      map.set(fork.messageId, existing);
    }
    return map;
  }, [forksData]);

  /**
   * Find the user message to extract as a draft for edit-and-resend.
   * - On a user message: extract that message.
   * - On an assistant message: walk backwards to find the preceding user message.
   * Returns the index and content, or null if no user message found.
   */
  const findUserMessageDraft = useCallback((messageIndex: number) => {
    const { messages } = useMessagesStore.getState();
    const target = messages[messageIndex];
    if (!target) return null;
    if (target.role === "user") return { index: messageIndex, content: target.content };
    for (let i = messageIndex - 1; i >= 0; i--) {
      if (messages[i].role === "user") return { index: i, content: messages[i].content };
    }
    return null;
  }, []);

  const handleRewind = useCallback(
    async (messageIndex: number) => {
      const sessId = activeSessionRef.current;
      if (!sessId || useMessagesStore.getState().isStreaming) return;

      const draft = findUserMessageDraft(messageIndex);
      const description = draft
        ? "The message will be placed in the input for editing. Messages from this point will be permanently removed."
        : "Messages after this point will be permanently removed.";

      const confirmed = await useDialogStore.getState().confirm({
        title: "Rewind conversation",
        description,
        confirmLabel: "Rewind",
        variant: "destructive",
      });
      if (!confirmed) return;
      if (useMessagesStore.getState().isStreaming) return; // Re-check after dialog

      try {
        // Truncate to just before the user message, or keep up to the target message when no draft.
        // A truncateIndex of -1 means "before the first message" — service.truncate(-1) clears all messages.
        const truncateIndex = draft ? draft.index - 1 : messageIndex;
        const updated = await trpcClient.session.rewind.mutate({
          sessionId: sessId,
          messageIndex: truncateIndex,
        });
        if (activeSessionRef.current !== sessId) return; // Session changed during async op
        clearMessages();
        if (updated.messages.length > 0) {
          loadMessages(updated.messages);
        }
        queryClient.invalidateQueries({ queryKey: trpc.session.list.queryKey() });
        queryClient.invalidateQueries({
          queryKey: trpc.session.forks.queryKey({ sessionId: sessId }),
        });
        if (draft) useMessagesStore.getState().setDraftInput(draft.content);
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Failed to rewind conversation.";
        setError(msg);
        setTimeout(() => setError(null), 5000);
      }
    },
    [clearMessages, loadMessages, trpc, activeSessionRef, setError, findUserMessageDraft],
  );

  const handleFork = useCallback(
    async (messageIndex: number) => {
      const sessId = activeSessionRef.current;
      if (!sessId || useMessagesStore.getState().isStreaming) return;

      const draft = findUserMessageDraft(messageIndex);

      try {
        // Fork excluding the user message so it can be edited in the fork.
        // When draft.index is 0 (first message), pass -1 to create a fork with no messages.
        const forkAtIndex = draft ? draft.index - 1 : messageIndex;

        const forked = await trpcClient.session.fork.mutate({
          sessionId: sessId,
          atMessageIndex: forkAtIndex,
        });
        if (activeSessionRef.current !== sessId) return;
        queryClient.invalidateQueries({ queryKey: trpc.session.list.queryKey() });
        queryClient.invalidateQueries({
          queryKey: trpc.session.forks.queryKey({ sessionId: sessId }),
        });
        handleSelectSession(forked.id);
        if (draft) useMessagesStore.getState().setDraftInput(draft.content);
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Failed to fork conversation.";
        setError(msg);
        setTimeout(() => setError(null), 5000);
      }
    },
    [trpc, handleSelectSession, activeSessionRef, setError, findUserMessageDraft],
  );

  return { forksMap, handleRewind, handleFork };
}
