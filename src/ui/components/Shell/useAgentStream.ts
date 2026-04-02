/**
 * useAgentStream — Extracted from Shell.tsx.
 *
 * Handles:
 *  - Building the shared StreamActions object
 *  - handleSubmit (create session if needed, persist user message, subscribe to agent stream)
 *  - Stream reconnection after HMR / page reload
 *  - Registering sendMessage for cold-replay question continuation
 */

import { useEffect, useCallback, type MutableRefObject } from "react";
import { useMessagesStore } from "@/ui/stores/useMessagesStore";
import { useAgentQuestionStore } from "@/ui/stores/useAgentQuestionStore";
import { trpc as trpcClient } from "@/bridge/trpc";
import { queryClient } from "@/bridge/query-client";
import type { AgentConfig, AgentQuestion, ContentBlock, SessionSummary } from "@/services/types";
import { THINKING_TOKENS, DEFAULT_AGENT_CONFIG } from "../Messages/agentConfig";
import {
  SESSION_TITLE_MAX_LENGTH,
  toSessionSummary,
  handleStreamEvent,
  handleStreamError,
} from "./shellHelpers";

// ─── Shared stream-actions builder ──────────────────────────────────────────

interface StreamActionDeps {
  appendToStreamingMessage: ReturnType<
    typeof useMessagesStore.getState
  >["appendToStreamingMessage"];
  appendToTextBlock: ReturnType<typeof useMessagesStore.getState>["appendToTextBlock"];
  appendToThinkingBlock: ReturnType<typeof useMessagesStore.getState>["appendToThinkingBlock"];
  addToolActivity: ReturnType<typeof useMessagesStore.getState>["addToolActivity"];
  setCurrentTool: ReturnType<typeof useMessagesStore.getState>["setCurrentTool"];
  startToolBlock: ReturnType<typeof useMessagesStore.getState>["startToolBlock"];
  setToolResult: ReturnType<typeof useMessagesStore.getState>["setToolResult"];
  completeRunningTools: ReturnType<typeof useMessagesStore.getState>["completeRunningTools"];
  completeNonTaskTools: ReturnType<typeof useMessagesStore.getState>["completeNonTaskTools"];
  startContentBlock: ReturnType<typeof useMessagesStore.getState>["startContentBlock"];
  finishContentBlock: ReturnType<typeof useMessagesStore.getState>["finishContentBlock"];
  finishStreamingMessage: ReturnType<typeof useMessagesStore.getState>["finishStreamingMessage"];
  setError: (error: string | null) => void;
  planReadyRef: MutableRefObject<(path: string, sessionId: string | null) => void>;
  sessionId: string | null;
}

function buildStreamActions(deps: StreamActionDeps) {
  return {
    appendToStreamingMessage: deps.appendToStreamingMessage,
    appendToTextBlock: deps.appendToTextBlock,
    appendToThinkingBlock: deps.appendToThinkingBlock,
    addToolActivity: deps.addToolActivity,
    setCurrentTool: deps.setCurrentTool,
    startToolBlock: deps.startToolBlock,
    setToolResult: deps.setToolResult,
    completeRunningTools: deps.completeRunningTools,
    completeNonTaskTools: deps.completeNonTaskTools,
    startContentBlock: deps.startContentBlock,
    finishContentBlock: deps.finishContentBlock,
    finishStreamingMessage: deps.finishStreamingMessage,
    setError: deps.setError,
    planReady: (path: string, sid: string | null) => deps.planReadyRef.current(path, sid),
    agentQuestion: (requestId: string, questions: AgentQuestion[]) => {
      useAgentQuestionStore
        .getState()
        .setPending({ requestId, sessionId: deps.sessionId, questions });
    },
  };
}

// ─── Hook ───────────────────────────────────────────────────────────────────

interface UseAgentStreamOptions {
  selectedSessionId: string | null;
  orgId: string;
  newSessionProjectId: string | null;
  isStreaming: boolean;
  restoredMessages: unknown;
  cancelStreamRef: MutableRefObject<(() => void) | null>;
  activeSessionRef: MutableRefObject<string | null>;
  planReadyRef: MutableRefObject<(path: string, sessionId: string | null) => void>;
  trpcQueryKeys: { sessionList: (input: { orgId: string; projectId?: string }) => unknown[] };
  setSelectedSessionId: (id: string | null) => void;
  setNewSessionProjectId: (id: string | null) => void;
  setError: (error: string | null) => void;
}

export function useAgentStream(opts: UseAgentStreamOptions) {
  const addUserMessage = useMessagesStore((s) => s.addUserMessage);
  const startAssistantMessage = useMessagesStore((s) => s.startAssistantMessage);
  const appendToStreamingMessage = useMessagesStore((s) => s.appendToStreamingMessage);
  const finishStreamingMessage = useMessagesStore((s) => s.finishStreamingMessage);
  const addToolActivity = useMessagesStore((s) => s.addToolActivity);
  const setCurrentTool = useMessagesStore((s) => s.setCurrentTool);
  const appendToTextBlock = useMessagesStore((s) => s.appendToTextBlock);
  const appendToThinkingBlock = useMessagesStore((s) => s.appendToThinkingBlock);
  const startContentBlock = useMessagesStore((s) => s.startContentBlock);
  const startToolBlock = useMessagesStore((s) => s.startToolBlock);
  const setToolResult = useMessagesStore((s) => s.setToolResult);
  const completeRunningTools = useMessagesStore((s) => s.completeRunningTools);
  const completeNonTaskTools = useMessagesStore((s) => s.completeNonTaskTools);
  const finishContentBlock = useMessagesStore((s) => s.finishContentBlock);
  const resumeStreaming = useMessagesStore((s) => s.resumeStreaming);
  const applySnapshot = useMessagesStore((s) => s.applySnapshot);
  const setActiveSession = useMessagesStore((s) => s.setActiveSession);

  const actionDeps: StreamActionDeps = {
    appendToStreamingMessage,
    appendToTextBlock,
    appendToThinkingBlock,
    addToolActivity,
    setCurrentTool,
    startToolBlock,
    setToolResult,
    completeRunningTools,
    completeNonTaskTools,
    startContentBlock,
    finishContentBlock,
    finishStreamingMessage,
    setError: opts.setError,
    planReadyRef: opts.planReadyRef,
    sessionId: opts.selectedSessionId,
  };

  // ─── handleSubmit ───────────────────────────────────────────────────────

  const handleSubmit = useCallback(
    ({ content, agentConfig }: { content: string; agentConfig: AgentConfig }) => {
      const userMsgId = addUserMessage(content, agentConfig);
      const assistantMsgId = startAssistantMessage();
      const maxThinkingTokens = THINKING_TOKENS[agentConfig.thinkingLevel];

      void (async () => {
        let sessId = opts.selectedSessionId;
        if (!sessId) {
          try {
            const projectIdForSession = opts.newSessionProjectId ?? undefined;
            const session = await trpcClient.session.create.mutate({
              title: content.slice(0, SESSION_TITLE_MAX_LENGTH),
              orgId: opts.orgId,
              ...(projectIdForSession && { projectId: projectIdForSession }),
            });
            sessId = session.id;
            opts.setSelectedSessionId(sessId);
            setActiveSession(sessId);
            opts.setNewSessionProjectId(null);
            opts.activeSessionRef.current = sessId;
            const summary = toSessionSummary(session);
            queryClient.setQueriesData<SessionSummary[]>(
              { queryKey: opts.trpcQueryKeys.sessionList({ orgId: opts.orgId }) },
              (old) => (old ? [summary, ...old] : [summary]),
            );
            if (projectIdForSession) {
              queryClient.setQueriesData<SessionSummary[]>(
                {
                  queryKey: opts.trpcQueryKeys.sessionList({
                    orgId: opts.orgId,
                    projectId: projectIdForSession,
                  }),
                },
                (old) => (old ? [summary, ...old] : [summary]),
              );
            }
          } catch {
            opts.setError("Could not save session. Your conversation is temporary.");
            setTimeout(() => opts.setError(null), 5000);
          }
        }

        if (sessId) {
          trpcClient.session.addMessage
            .mutate({
              sessionId: sessId,
              message: {
                id: userMsgId,
                role: "user" as const,
                content,
                timestamp: Date.now(),
                agentConfig,
              },
            })
            .catch(() => {
              /* best-effort */
            });
        }

        const actions = buildStreamActions({ ...actionDeps, sessionId: sessId });
        const subscription = trpcClient.agent.run.subscribe(
          {
            prompt: content,
            model: agentConfig.model,
            ...(maxThinkingTokens !== undefined ? { maxThinkingTokens } : {}),
            permissionMode: agentConfig.permissionMode,
            sessionId: sessId ?? undefined,
            messageId: assistantMsgId,
          },
          {
            onData: (data) => {
              const isDone = handleStreamEvent(
                data as { type: string; [key: string]: unknown },
                sessId,
                assistantMsgId,
                actions,
                opts.cancelStreamRef,
              );
              if (isDone) subscription.unsubscribe();
            },
            onError: (err) => {
              handleStreamError(
                err,
                sessId,
                assistantMsgId,
                { finishStreamingMessage, setError: opts.setError, completeRunningTools },
                opts.cancelStreamRef,
              );
            },
          },
        );
        opts.cancelStreamRef.current = () => subscription.unsubscribe();
      })();
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- stable refs and store selectors
    [
      addUserMessage,
      startAssistantMessage,
      appendToStreamingMessage,
      finishStreamingMessage,
      addToolActivity,
      setCurrentTool,
      appendToTextBlock,
      appendToThinkingBlock,
      startContentBlock,
      startToolBlock,
      setToolResult,
      completeRunningTools,
      completeNonTaskTools,
      finishContentBlock,
      opts.newSessionProjectId,
      opts.orgId,
      opts.selectedSessionId,
      setActiveSession,
    ],
  );

  // ─── Stream reconnection after HMR / page reload ───────────────────────

  useEffect(() => {
    if (!opts.selectedSessionId || opts.isStreaming) return;
    if (!opts.restoredMessages) return;

    let cancelled = false;
    (async () => {
      try {
        const state = await trpcClient.agent.activeStream.query();
        if (cancelled || !state.running) return;
        if (state.sessionId && state.sessionId !== opts.selectedSessionId) return;

        const messageId = state.messageId ?? `resume_${Date.now()}`;
        resumeStreaming(messageId);

        const actions = buildStreamActions({ ...actionDeps, sessionId: opts.selectedSessionId });
        const subscription = trpcClient.agent.resumeStream.subscribe(undefined, {
          onData: (data) => {
            if (cancelled) return;
            const event = data as { type: string; [key: string]: unknown };
            if (event.type === "snapshot") {
              applySnapshot(event.blocks as ContentBlock[], event.fullText as string);
              const pq = event.pendingQuestion as
                | { requestId: string; questions: AgentQuestion[] }
                | undefined;
              if (pq) {
                useAgentQuestionStore.getState().setPending({
                  requestId: pq.requestId,
                  sessionId: opts.selectedSessionId,
                  questions: pq.questions,
                });
              }
            } else {
              const isDone = handleStreamEvent(
                event,
                opts.selectedSessionId,
                messageId,
                actions,
                opts.cancelStreamRef,
              );
              if (isDone) subscription.unsubscribe();
            }
          },
          onError: (err) => {
            handleStreamError(
              err,
              opts.selectedSessionId,
              messageId,
              { finishStreamingMessage, setError: opts.setError, completeRunningTools },
              opts.cancelStreamRef,
            );
          },
        });
        opts.cancelStreamRef.current = () => subscription.unsubscribe();
      } catch {
        // Server unreachable or no active stream — not an error
      }
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reconnect when session messages are restored
  }, [opts.selectedSessionId, opts.restoredMessages]);

  // ─── Register sendMessage for cold-replay question continuation ─────────

  useEffect(() => {
    useAgentQuestionStore.getState().setSendMessage((content: string) => {
      const msgs = useMessagesStore.getState().messages;
      const lastUserMsg = [...msgs].reverse().find((m) => m.role === "user");
      const agentConfig = lastUserMsg?.agentConfig ?? DEFAULT_AGENT_CONFIG;
      handleSubmit({ content, agentConfig });
    });
  }, [handleSubmit]);

  return { handleSubmit, setActiveSession };
}
