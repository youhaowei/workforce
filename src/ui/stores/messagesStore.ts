/**
 * Messages Store - Reactive state for chat messages
 *
 * Uses SolidJS fine-grained reactivity for optimal performance.
 * Messages are stored as an array with IDs for efficient updates.
 */

import { createStore, produce } from 'solid-js/store';
import { createSignal, batch } from 'solid-js';
import type { Message, ToolCall, ToolResult } from '@services/types';

// =============================================================================
// Types
// =============================================================================

export interface MessageState {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: number;
  isStreaming: boolean;
  toolCalls?: ToolCall[];
  toolResults?: ToolResult[];
}

interface MessagesStoreState {
  messages: MessageState[];
  activeSessionId: string | null;
}

// =============================================================================
// Store Creation
// =============================================================================

const [state, setState] = createStore<MessagesStoreState>({
  messages: [],
  activeSessionId: null,
});

// Track streaming message separately for optimal updates
const [streamingContent, setStreamingContent] = createSignal('');
const [streamingMessageId, setStreamingMessageId] = createSignal<string | null>(null);
const [isStreaming, setIsStreaming] = createSignal(false);

// =============================================================================
// Actions
// =============================================================================

function generateId(): string {
  return `msg_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

export function addUserMessage(content: string): string {
  const id = generateId();
  setState(
    produce((s) => {
      s.messages.push({
        id,
        role: 'user',
        content,
        timestamp: Date.now(),
        isStreaming: false,
      });
    })
  );
  return id;
}

export function startAssistantMessage(): string {
  const id = generateId();
  const prevMsgId = streamingMessageId();
  const prevIsStreaming = isStreaming();

  console.log('[messagesStore] startAssistantMessage:', { newId: id, prevMsgId, prevIsStreaming });

  batch(() => {
    setState(
      produce((s) => {
        s.messages.push({
          id,
          role: 'assistant',
          content: '',
          timestamp: Date.now(),
          isStreaming: true,
        });
      })
    );
    setStreamingMessageId(id);
    setStreamingContent('');
    setIsStreaming(true);
  });

  console.log('[messagesStore] After start:', { msgId: streamingMessageId(), isStreaming: isStreaming() });

  return id;
}

export function appendToStreamingMessage(token: string): void {
  console.log('[messagesStore] appendToStreamingMessage:', token.slice(0, 50));
  setStreamingContent((prev) => prev + token);
}

export function finishStreamingMessage(): void {
  const msgId = streamingMessageId();
  const content = streamingContent();

  console.log('[messagesStore] finishStreamingMessage:', { msgId, contentLength: content.length });

  if (msgId) {
    batch(() => {
      setState(
        produce((s) => {
          const msg = s.messages.find((m) => m.id === msgId);
          if (msg) {
            // Trim only outer whitespace of complete message, preserve internal whitespace
            msg.content = content.trim();
            msg.isStreaming = false;
            console.log('[messagesStore] Updated message:', msg.id, 'content length:', msg.content.length);
          }
        })
      );
      setStreamingMessageId(null);
      setStreamingContent('');
      setIsStreaming(false);
    });
  } else {
    console.log('[messagesStore] finishStreamingMessage: No msgId, nothing to finish');
  }
}

export function addToolCall(messageId: string, toolCall: ToolCall): void {
  setState(
    produce((s) => {
      const msg = s.messages.find((m) => m.id === messageId);
      if (msg) {
        if (!msg.toolCalls) {
          msg.toolCalls = [];
        }
        msg.toolCalls.push(toolCall);
      }
    })
  );
}

export function addToolResult(messageId: string, result: ToolResult): void {
  setState(
    produce((s) => {
      const msg = s.messages.find((m) => m.id === messageId);
      if (msg) {
        if (!msg.toolResults) {
          msg.toolResults = [];
        }
        msg.toolResults.push(result);
      }
    })
  );
}

export function clearMessages(): void {
  batch(() => {
    setState('messages', []);
    setStreamingMessageId(null);
    setStreamingContent('');
    setIsStreaming(false);
  });
}

export function setActiveSession(sessionId: string | null): void {
  setState('activeSessionId', sessionId);
}

export function loadMessages(messages: Message[]): void {
  setState(
    'messages',
    messages.map((m) => ({
      ...m,
      isStreaming: false,
    }))
  );
}

// =============================================================================
// Selectors
// =============================================================================

export function getMessages() {
  return state.messages;
}

export function getStreamingContent() {
  return streamingContent;
}

export function getStreamingMessageId() {
  return streamingMessageId;
}

export function getIsStreaming() {
  return isStreaming;
}

export function getActiveSessionId() {
  return state.activeSessionId;
}

export function getMessageCount() {
  return state.messages.length;
}

// Export store for direct access if needed
export { state as messagesState };
