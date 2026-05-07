import type { Session, SessionSummary, AgentQuestion } from "@/services/types";
import type { ShellError } from "@/ui/stores/shellStore";
import { getServerUrl } from "@/bridge/config";
import { trpc as trpcClient } from "@/bridge/trpc";

export const SELECTED_SESSION_STORAGE_KEY = "workforce-selected-session";
export const SESSION_TITLE_MAX_LENGTH = 80;

/** Handle subscription-level transport errors (distinct from SSE 'error' events). */
export function handleStreamError(
  err: unknown,
  sessId: string | null,
  assistantMsgId: string,
  actions: Pick<StreamEventActions, "finishStreamingMessage" | "setError" | "completeRunningTools">,
  cancelStreamRef: { current: (() => void) | null },
) {
  actions.completeRunningTools();
  actions.finishStreamingMessage();
  // Use the same parser as the SSE 'error' path so a structured `{ message, code }`
  // payload reaching the transport-level onError still preserves AUTH_ERROR
  // (and the UI can render the re-auth CTA).
  actions.setError(parseStreamError(err));
  cancelStreamRef.current = null;
  // Server persists partial data in its catch block. Client-side abort is a
  // fallback only for transport errors where the server generator may not fire.
  if (sessId) {
    trpcClient.session.streamAbort
      .mutate({
        sessionId: sessId,
        messageId: assistantMsgId,
        reason: err instanceof Error ? err.message : String(err),
      })
      .catch(() => {
        /* best-effort */
      });
  }
}

export async function checkServerConnection(): Promise<boolean> {
  try {
    const response = await fetch(`${getServerUrl()}/health`, { method: "GET" });
    return response.ok;
  } catch {
    return false;
  }
}

export function toSessionSummary(session: Session): SessionSummary {
  const lastMessage = session.messages[session.messages.length - 1];
  return {
    id: session.id,
    title: session.title,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    parentId: session.parentId,
    metadata: session.metadata,
    messageCount: session.messages.length,
    lastMessagePreview: lastMessage?.content,
  };
}

// =============================================================================
// SSE Event Dispatch
// =============================================================================

export interface StreamEventActions {
  appendToStreamingMessage: (token: string) => void;
  appendToTextBlock: (text: string) => void;
  appendToThinkingBlock: (text: string) => void;
  addToolActivity: (name: string, input: string) => void;
  setCurrentTool: (name: string | null) => void;
  startToolBlock: (toolUseId: string, name: string, input: string, inputRaw?: unknown) => void;
  setToolResult: (toolUseId: string, result: unknown, isError: boolean) => void;
  completeRunningTools: () => void;
  completeNonTaskTools: () => void;
  startContentBlock: (index: number, blockType: string, id?: string, name?: string) => void;
  finishContentBlock: (index: number) => void;
  finishStreamingMessage: () => void;
  setError: (error: ShellError) => void;
  planReady: (path: string, sessId: string | null) => void;
  agentQuestion: (requestId: string, questions: AgentQuestion[]) => void;
}

/**
 * Handle a single SSE event from the agent subscription. Returns true if stream is done.
 * Note: `assistantMsgId` is retained for transport-error abort fallback (handleStreamError).
 */
export function handleStreamEvent(
  data: { type: string; [key: string]: unknown },
  sessId: string | null,
  _assistantMsgId: string,
  actions: StreamEventActions,
  cancelStreamRef: { current: (() => void) | null },
): boolean {
  switch (data.type) {
    case "token":
      actions.setCurrentTool(null);
      actions.appendToStreamingMessage(data.data as string);
      actions.appendToTextBlock(data.data as string);
      return false;

    case "turn_complete":
      return false;

    case "tool_start":
      actions.addToolActivity(data.name as string, data.input as string);
      actions.setCurrentTool(data.name as string);
      if (data.toolUseId)
        actions.startToolBlock(
          data.toolUseId as string,
          data.name as string,
          data.input as string,
          data.inputRaw,
        );
      return false;

    case "tool_result":
      if (data.toolUseId)
        actions.setToolResult(data.toolUseId as string, data.result, !!data.isError);
      return false;

    case "thinking_delta":
      actions.appendToThinkingBlock(data.data as string);
      return false;

    case "content_block_start":
      actions.startContentBlock(
        data.index as number,
        data.blockType as string,
        data.id as string | undefined,
        data.name as string | undefined,
      );
      return false;

    case "content_block_stop":
      actions.finishContentBlock(data.index as number);
      return false;

    case "status":
      actions.setCurrentTool(data.data as string);
      return false;

    case "plan_ready":
      actions.planReady(data.path as string, sessId);
      return false;

    case "agent_question":
      // Complete non-task tools but leave AskUserQuestion in 'running' state
      actions.completeNonTaskTools();
      actions.agentQuestion(data.requestId as string, data.questions as AgentQuestion[]);
      return false;

    case "done":
      // Server already persisted the message_final. UI just cleans up.
      actions.completeRunningTools();
      actions.finishStreamingMessage();
      cancelStreamRef.current = null;
      return true;

    case "error":
      // Server already persisted partial data in its catch block.
      actions.completeRunningTools();
      actions.finishStreamingMessage();
      actions.setError(parseStreamError(data.data));
      cancelStreamRef.current = null;
      return true;

    default:
      return false;
  }
}

export function parseStreamError(error: unknown): ShellError {
  if (typeof error === "string") return error;
  if (error && typeof error === "object") {
    const obj = error as { message?: unknown; code?: unknown; error?: unknown };
    const code = typeof obj.code === "string" ? obj.code : undefined;
    if (typeof obj.message === "string") {
      return { message: obj.message, code };
    }
    // Object lacks `message` — try common server shapes (`{ error: "..." }`)
    // before falling back to a generic label so we never surface "[object Object]".
    if (typeof obj.error === "string") {
      return { message: obj.error, code };
    }
    return { message: "Stream error", code };
  }
  return String(error);
}
