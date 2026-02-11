/**
 * Messages Store (Zustand) — Replaces SolidJS messagesStore.ts
 *
 * Manages chat messages and streaming state.
 * Streaming content is tracked separately from committed messages
 * to avoid re-rendering the message list during token accumulation.
 */

import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import type { ToolCall, ToolResult } from '@/services/types';

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

interface MessagesStore {
  messages: MessageState[];
  activeSessionId: string | null;
  streamingContent: string;
  streamingMessageId: string | null;
  isStreaming: boolean;

  // Actions
  addUserMessage: (content: string) => string;
  startAssistantMessage: () => string;
  appendToStreamingMessage: (token: string) => void;
  finishStreamingMessage: () => void;
  addToolCall: (messageId: string, toolCall: ToolCall) => void;
  addToolResult: (messageId: string, result: ToolResult) => void;
  clearMessages: () => void;
  setActiveSession: (sessionId: string | null) => void;
  loadMessages: (messages: Array<{ id: string; role: string; content: string; timestamp: number; toolCalls?: ToolCall[]; toolResults?: ToolResult[] }>) => void;
}

// =============================================================================
// Helpers
// =============================================================================

function generateId(): string {
  return `msg_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

// =============================================================================
// Store
// =============================================================================

export const useMessagesStore = create<MessagesStore>()(
  immer((set) => ({
    messages: [],
    activeSessionId: null,
    streamingContent: '',
    streamingMessageId: null,
    isStreaming: false,

    addUserMessage: (content) => {
      const id = generateId();
      set((state) => {
        state.messages.push({
          id,
          role: 'user',
          content,
          timestamp: Date.now(),
          isStreaming: false,
        });
      });
      return id;
    },

    startAssistantMessage: () => {
      const id = generateId();
      set((state) => {
        state.messages.push({
          id,
          role: 'assistant',
          content: '',
          timestamp: Date.now(),
          isStreaming: true,
        });
        state.streamingMessageId = id;
        state.streamingContent = '';
        state.isStreaming = true;
      });
      return id;
    },

    appendToStreamingMessage: (token) => {
      set((state) => {
        state.streamingContent += token;
      });
    },

    finishStreamingMessage: () => {
      set((state) => {
        const msgId = state.streamingMessageId;
        if (msgId) {
          const msg = state.messages.find((m: MessageState) => m.id === msgId);
          if (msg) {
            // Trim only outer whitespace of complete message (gotcha #16)
            msg.content = state.streamingContent.trim();
            msg.isStreaming = false;
          }
        }
        state.streamingMessageId = null;
        state.streamingContent = '';
        state.isStreaming = false;
      });
    },

    addToolCall: (messageId, toolCall) => {
      set((state) => {
        const msg = state.messages.find((m: MessageState) => m.id === messageId);
        if (msg) {
          if (!msg.toolCalls) msg.toolCalls = [];
          msg.toolCalls.push(toolCall);
        }
      });
    },

    addToolResult: (messageId, result) => {
      set((state) => {
        const msg = state.messages.find((m: MessageState) => m.id === messageId);
        if (msg) {
          if (!msg.toolResults) msg.toolResults = [];
          msg.toolResults.push(result);
        }
      });
    },

    clearMessages: () => {
      set((state) => {
        state.messages = [];
        state.streamingMessageId = null;
        state.streamingContent = '';
        state.isStreaming = false;
      });
    },

    setActiveSession: (sessionId) => {
      set((state) => {
        state.activeSessionId = sessionId;
      });
    },

    loadMessages: (messages) => {
      set((state) => {
        state.messages = messages.map((m) => ({
          id: m.id,
          role: m.role as 'user' | 'assistant' | 'system',
          content: m.content,
          timestamp: m.timestamp,
          isStreaming: false,
          toolCalls: m.toolCalls,
          toolResults: m.toolResults,
        }));
      });
    },
  })),
);
