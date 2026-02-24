import type { ContentBlock, Session, SessionSummary, ToolActivity } from '@/services/types';
import type { SidebarMode, ViewType } from './Shell';
import { SERVER_URL } from '@/bridge/config';
import { useMessagesStore } from '@/ui/stores/useMessagesStore';
import { trpc as trpcClient } from '@/bridge/trpc';

export const SIDEBAR_STORAGE_KEY = 'workforce-sidebar-mode';
export const SESSIONS_PANEL_STORAGE_KEY = 'workforce-sessions-collapsed';
export const VIEW_STORAGE_KEY = 'workforce-current-view';
export const SELECTED_SESSION_STORAGE_KEY = 'workforce-selected-session';
export const SESSION_TITLE_MAX_LENGTH = 80;

export const VALID_VIEWS = new Set<ViewType>([
  'home',
  'board',
  'queue',
  'sessions',
  'projects',
  'templates',
  'workflows',
  'orgs',
  'audit',
  'detail',
]);

// =============================================================================
// State Initializers (read from localStorage)
// =============================================================================

export function getInitialView(): ViewType {
  const stored = localStorage.getItem(VIEW_STORAGE_KEY);
  if (stored && VALID_VIEWS.has(stored as ViewType)) {
    return stored === 'detail' ? 'board' : (stored as ViewType);
  }
  return 'home';
}

export function getInitialSidebarMode(): SidebarMode {
  const stored = localStorage.getItem(SIDEBAR_STORAGE_KEY);
  if (stored === 'true') return 'collapsed';
  if (stored === 'collapsed' || stored === 'hidden') return stored;
  return 'expanded';
}

/** Handle subscription-level transport errors (distinct from SSE 'error' events). */
export function handleStreamError(
  err: unknown,
  sessId: string | null,
  assistantMsgId: string,
  actions: Pick<StreamEventActions, 'finishStreamingMessage' | 'setError' | 'flushDeltas'>,
  cancelStreamRef: { current: (() => void) | null },
) {
  actions.finishStreamingMessage();
  actions.setError(err instanceof Error ? err.message : String(err));
  cancelStreamRef.current = null;
  actions.flushDeltas();
  if (sessId) {
    trpcClient.session.streamAbort.mutate({
      sessionId: sessId, messageId: assistantMsgId,
      reason: err instanceof Error ? err.message : String(err),
    }).catch(() => {/* best-effort */});
  }
}

export async function checkServerConnection(): Promise<boolean> {
  try {
    const response = await fetch(`${SERVER_URL}/health`, { method: 'GET' });
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
  addToolActivity: (name: string, input: string) => void;
  setCurrentTool: (name: string | null) => void;
  startToolBlock: (toolUseId: string, name: string, input: string) => void;
  setToolResult: (toolUseId: string, result: unknown, isError: boolean) => void;
  startContentBlock: (index: number, blockType: string, id?: string, name?: string) => void;
  finishContentBlock: (index: number) => void;
  finishStreamingMessage: () => void;
  setError: (error: string) => void;
  planReady: (path: string, sessId: string | null) => void;
  onDelta: (delta: string, seq: number) => void;
  flushDeltas: () => void;
}

/** Handle a single SSE event from the agent subscription. Returns true if stream is done. */
export function handleStreamEvent(
  data: { type: string; [key: string]: unknown },
  sessId: string | null,
  assistantMsgId: string,
  actions: StreamEventActions,
  cancelStreamRef: { current: (() => void) | null },
): boolean {
  switch (data.type) {
    case 'token':
      actions.setCurrentTool(null);
      actions.appendToStreamingMessage(data.data as string);
      actions.appendToTextBlock(data.data as string);
      actions.onDelta(data.data as string, 0); // seq managed by caller
      return false;

    case 'tool_start':
      actions.addToolActivity(data.name as string, data.input as string);
      actions.setCurrentTool(data.name as string);
      if (data.toolUseId) actions.startToolBlock(data.toolUseId as string, data.name as string, data.input as string);
      return false;

    case 'tool_result':
      if (data.toolUseId) actions.setToolResult(data.toolUseId as string, data.result, !!data.isError);
      return false;

    case 'content_block_start':
      actions.startContentBlock(data.index as number, data.blockType as string, data.id as string | undefined, data.name as string | undefined);
      return false;

    case 'content_block_stop':
      actions.finishContentBlock(data.index as number);
      return false;

    case 'status':
      actions.setCurrentTool(data.data as string);
      return false;

    case 'plan_ready':
      actions.planReady(data.path as string, sessId);
      return false;

    case 'done':
      finalizeStream(sessId, assistantMsgId, actions, cancelStreamRef);
      return true;

    case 'error':
      actions.finishStreamingMessage();
      actions.setError(data.data as string);
      cancelStreamRef.current = null;
      actions.flushDeltas();
      if (sessId) {
        trpcClient.session.streamAbort.mutate({
          sessionId: sessId, messageId: assistantMsgId, reason: data.data as string,
        }).catch(() => {/* best-effort */});
      }
      return true;

    default:
      return false;
  }
}

function finalizeStream(
  sessId: string | null,
  assistantMsgId: string,
  actions: StreamEventActions,
  cancelStreamRef: { current: (() => void) | null },
) {
  const storeState = useMessagesStore.getState();
  const fullContent = storeState.streamingContent;
  const contentBlocks: ContentBlock[] | undefined =
    storeState.streamingBlocks.length > 0 ? [...storeState.streamingBlocks] : undefined;
  const toolActivities: ToolActivity[] = [...storeState.pendingToolActivities];
  actions.finishStreamingMessage();
  cancelStreamRef.current = null;
  actions.flushDeltas();
  if (sessId) {
    trpcClient.session.streamFinalize.mutate({
      sessionId: sessId,
      messageId: assistantMsgId,
      fullContent: fullContent.trim(),
      stopReason: 'end_turn',
      ...(toolActivities.length > 0 && { toolActivities }),
      ...(contentBlocks && { contentBlocks }),
    }).catch(() => {/* best-effort */});
  }
}
