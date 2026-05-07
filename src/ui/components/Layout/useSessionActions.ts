import { useCallback } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useShellStore } from "@/ui/stores/shellStore";
import { useMessagesStore } from "@/ui/stores/useMessagesStore";
import { useAgentQuestionStore } from "@/ui/stores/useAgentQuestionStore";
import { trpc as trpcClient } from "@/bridge/trpc";
import { queryClient } from "@/bridge/query-client";
import { useTRPC } from "@/bridge/react";
import type { ViewType } from "@/ui/hooks/useCurrentView";
import { SELECTED_SESSION_STORAGE_KEY } from "./shellHelpers";

interface UseSessionActionsParams {
  selectedProjectId: string | null;
  currentView: ViewType;
  cancelStreamRef: React.RefObject<(() => void) | null>;
  activeSessionRef: React.RefObject<string | null>;
  lastLoadedSessionRef: React.RefObject<string | null>;
  setActiveSession: (id: string | null) => void;
  setSelectedSessionId: (id: string | null) => void;
}

export function useSessionActions({
  selectedProjectId,
  currentView,
  cancelStreamRef,
  activeSessionRef,
  lastLoadedSessionRef,
  setActiveSession,
  setSelectedSessionId,
}: UseSessionActionsParams) {
  const navigate = useNavigate();
  const trpc = useTRPC();
  const setSidebarMode = useShellStore((s) => s.setSidebarMode);
  const setNewSessionProjectId = useShellStore((s) => s.setNewSessionProjectId);
  const setCurrentTool = useMessagesStore((s) => s.setCurrentTool);
  const finishStreamingMessage = useMessagesStore((s) => s.finishStreamingMessage);
  const clearMessages = useMessagesStore((s) => s.clearMessages);

  const cancelActiveStream = useCallback(() => {
    trpcClient.agent.cancel.mutate().catch(() => {});
    if (cancelStreamRef.current) {
      cancelStreamRef.current();
      cancelStreamRef.current = null;
    }
    setCurrentTool(null);
  }, [setCurrentTool, cancelStreamRef]);

  const handleCancel = useCallback(() => {
    const sessId = activeSessionRef.current;
    const msgId = useMessagesStore.getState().streamingMessageId;
    cancelActiveStream();
    useAgentQuestionStore.getState().clear();
    if (sessId && msgId) {
      trpcClient.session.streamAbort
        .mutate({ sessionId: sessId, messageId: msgId, reason: "user_cancelled" })
        .catch(() => {});
    }
    finishStreamingMessage();
  }, [cancelActiveStream, finishStreamingMessage, activeSessionRef]);

  const handleSelectSession = useCallback(
    (sessionId: string) => {
      const hasMessages = useMessagesStore.getState().messages.length > 0;
      const alreadyActive = sessionId === activeSessionRef.current && hasMessages;

      if (!alreadyActive) {
        cancelActiveStream();
        finishStreamingMessage();
        useAgentQuestionStore.getState().clear();
        setNewSessionProjectId(null);
        clearMessages();
        setActiveSession(sessionId);
        setSelectedSessionId(sessionId);
        activeSessionRef.current = sessionId;
        lastLoadedSessionRef.current = null;
        queryClient.invalidateQueries({
          queryKey: trpc.session.messages.queryKey({ sessionId }),
        });
      }

      navigate({ to: "/sessions/$id", params: { id: sessionId } });
    },
    [
      cancelActiveStream,
      finishStreamingMessage,
      setNewSessionProjectId,
      clearMessages,
      setActiveSession,
      setSelectedSessionId,
      activeSessionRef,
      lastLoadedSessionRef,
      trpc,
      navigate,
    ],
  );

  const handleDeleteSession = useCallback(
    (sessionId: string) => {
      if (sessionId !== activeSessionRef.current) return;
      cancelActiveStream();
      useAgentQuestionStore.getState().clear();
      clearMessages();
      setActiveSession(null);
      setSelectedSessionId(null);
      setNewSessionProjectId(null);
      activeSessionRef.current = null;
      lastLoadedSessionRef.current = null;
      localStorage.removeItem(SELECTED_SESSION_STORAGE_KEY);
    },
    [
      cancelActiveStream,
      clearMessages,
      setActiveSession,
      setSelectedSessionId,
      setNewSessionProjectId,
      activeSessionRef,
      lastLoadedSessionRef,
    ],
  );

  const handleCreateSession = useCallback(() => {
    cancelActiveStream();
    useAgentQuestionStore.getState().clear();
    clearMessages();
    setActiveSession(null);
    setSelectedSessionId(null);
    setNewSessionProjectId(currentView === "projects" ? selectedProjectId : null);
    activeSessionRef.current = null;
    lastLoadedSessionRef.current = null;
    navigate({ to: "/sessions" });
    setSidebarMode("expanded");
  }, [
    cancelActiveStream,
    clearMessages,
    setActiveSession,
    setSelectedSessionId,
    setNewSessionProjectId,
    currentView,
    selectedProjectId,
    activeSessionRef,
    lastLoadedSessionRef,
    navigate,
    setSidebarMode,
  ]);

  return {
    cancelActiveStream,
    handleCancel,
    handleSelectSession,
    handleDeleteSession,
    handleCreateSession,
    finishStreamingMessage,
    clearMessages,
  };
}
