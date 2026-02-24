/**
 * Messages Store (Zustand) — Replaces SolidJS messagesStore.ts
 *
 * Manages chat messages and streaming state.
 * Streaming content is tracked separately from committed messages
 * to avoid re-rendering the message list during token accumulation.
 */

import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import type { AgentConfig, ContentBlock, ToolActivity, ToolCall, ToolResult } from '@/services/types';

// =============================================================================
// Types
// =============================================================================

export interface MessageState {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: number;
  isStreaming: boolean;
  agentConfig?: AgentConfig;
  toolCalls?: ToolCall[];
  toolResults?: ToolResult[];
  toolActivities?: ToolActivity[];
  contentBlocks?: ContentBlock[];
}

interface MessagesStore {
  messages: MessageState[];
  activeSessionId: string | null;
  streamingContent: string;
  streamingBlocks: ContentBlock[];
  streamingMessageId: string | null;
  isStreaming: boolean;
  pendingToolActivities: ToolActivity[];
  currentTool: string | null;

  // Actions
  addUserMessage: (content: string, agentConfig?: AgentConfig) => string;
  startAssistantMessage: () => string;
  appendToStreamingMessage: (token: string) => void;
  finishStreamingMessage: () => void;
  addToolActivity: (name: string, input: string) => void;
  setCurrentTool: (name: string | null) => void;
  addToolCall: (messageId: string, toolCall: ToolCall) => void;
  addToolResult: (messageId: string, result: ToolResult) => void;
  clearMessages: () => void;
  setActiveSession: (sessionId: string | null) => void;
  loadMessages: (messages: Array<{ id: string; role: string; content: string; timestamp: number; agentConfig?: AgentConfig; toolCalls?: ToolCall[]; toolResults?: ToolResult[]; toolActivities?: ToolActivity[]; contentBlocks?: ContentBlock[] }>) => void;

  // Block-level streaming actions
  startContentBlock: (index: number, blockType: string, id?: string, name?: string) => void;
  appendToTextBlock: (text: string) => void;
  startToolBlock: (toolUseId: string, name: string, input: string) => void;
  setToolResult: (toolUseId: string, result: unknown, isError: boolean) => void;
  finishContentBlock: (index: number) => void;
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
    streamingBlocks: [],
    streamingMessageId: null,
    isStreaming: false,
    pendingToolActivities: [],
    currentTool: null,

    addUserMessage: (content, agentConfig) => {
      const id = generateId();
      set((state) => {
        state.messages.push({
          id,
          role: 'user',
          content,
          timestamp: Date.now(),
          isStreaming: false,
          agentConfig,
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
        state.streamingBlocks = [];
        state.isStreaming = true;
        state.pendingToolActivities = [];
        state.currentTool = null;
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
            if (state.pendingToolActivities.length > 0) {
              msg.toolActivities = [...state.pendingToolActivities];
            }
            if (state.streamingBlocks.length > 0) {
              msg.contentBlocks = [...state.streamingBlocks];
            }
          }
        }
        state.streamingMessageId = null;
        state.streamingContent = '';
        state.streamingBlocks = [];
        state.isStreaming = false;
        state.pendingToolActivities = [];
        state.currentTool = null;
      });
    },

    addToolActivity: (name, input) => {
      set((state) => {
        state.pendingToolActivities.push({ name, input });
      });
    },

    setCurrentTool: (name) => {
      set((state) => {
        state.currentTool = name;
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
        state.streamingBlocks = [];
        state.isStreaming = false;
        state.pendingToolActivities = [];
        state.currentTool = null;
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
          agentConfig: m.agentConfig,
          toolCalls: m.toolCalls,
          toolResults: m.toolResults,
          toolActivities: m.toolActivities,
          contentBlocks: m.contentBlocks,
        }));
      });
    },

    // ─── Block-level streaming actions ──────────────────────────────

    startContentBlock: (_index, blockType, id, name) => {
      set((state) => {
        if (blockType === 'text') {
          state.streamingBlocks.push({ type: 'text', text: '' });
        } else if (blockType === 'tool_use' && id && name) {
          state.streamingBlocks.push({ type: 'tool_use', id, name, input: '', status: 'running' });
        } else if (blockType === 'thinking') {
          state.streamingBlocks.push({ type: 'thinking', text: '' });
        }
      });
    },

    appendToTextBlock: (text) => {
      set((state) => {
        const last = state.streamingBlocks[state.streamingBlocks.length - 1];
        if (last && last.type === 'text') {
          last.text += text;
        } else {
          // No active text block — start one implicitly
          state.streamingBlocks.push({ type: 'text', text });
        }
      });
    },

    startToolBlock: (toolUseId, name, input) => {
      set((state) => {
        state.streamingBlocks.push({
          type: 'tool_use', id: toolUseId, name, input, status: 'running',
        });
      });
    },

    setToolResult: (toolUseId, result, isError) => {
      set((state) => {
        const block = state.streamingBlocks.find(
          (b): b is ContentBlock & { type: 'tool_use' } => b.type === 'tool_use' && b.id === toolUseId,
        );
        if (block) {
          block.status = isError ? 'error' : 'complete';
          if (isError) {
            block.error = typeof result === 'string' ? result : JSON.stringify(result);
          } else {
            block.result = result;
          }
        }
      });
    },

    finishContentBlock: (_index) => {
      // Block completion is implicit — the block is already in streamingBlocks.
      // This hook exists for future use (e.g. marking thinking blocks complete).
    },
  })),
);
