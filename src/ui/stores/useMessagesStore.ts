/**
 * Messages Store (Zustand) — Replaces SolidJS messagesStore.ts
 *
 * Manages chat messages and streaming state.
 * Streaming content is tracked separately from committed messages
 * to avoid re-rendering the message list during token accumulation.
 */

import { create } from "zustand";
import { immer } from "zustand/middleware/immer";
import type {
  AgentConfig,
  ContentBlock,
  ToolActivity,
  ToolCall,
  ToolResult,
} from "@/services/types";

// =============================================================================
// Types
// =============================================================================

export interface MessageState {
  id: string;
  role: "user" | "assistant" | "system";
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
  /** Draft input set by rewind/fork — consumed once by MessageInput. */
  draftInput: string | null;

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
  setDraftInput: (value: string | null) => void;
  loadMessages: (
    messages: Array<{
      id: string;
      role: string;
      content: string;
      timestamp: number;
      agentConfig?: AgentConfig;
      toolCalls?: ToolCall[];
      toolResults?: ToolResult[];
      toolActivities?: ToolActivity[];
      contentBlocks?: ContentBlock[];
    }>,
  ) => void;

  // Reconnection actions
  resumeStreaming: (messageId: string) => void;
  applySnapshot: (blocks: ContentBlock[], fullText: string) => void;

  // Block-level streaming actions
  startContentBlock: (index: number, blockType: string, id?: string, name?: string) => void;
  appendToTextBlock: (text: string) => void;
  appendToThinkingBlock: (text: string) => void;
  startToolBlock: (toolUseId: string, name: string, input: string, inputRaw?: unknown) => void;
  setToolResult: (toolUseId: string, result: unknown, isError: boolean) => void;
  completeRunningTools: () => void;
  completeNonTaskTools: () => void;
  finishContentBlock: (index: number) => void;
}

// =============================================================================
// Helpers
// =============================================================================

function generateId(): string {
  return `msg_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

function completeRunningBlocks(blocks: ContentBlock[]): ContentBlock[] {
  return blocks.map((block) =>
    block.status === "running" ? { ...block, status: "complete" as const } : block,
  );
}

// =============================================================================
// Store
// =============================================================================

export const useMessagesStore = create<MessagesStore>()(
  immer((set) => ({
    messages: [],
    activeSessionId: null,
    streamingContent: "",
    streamingBlocks: [],
    streamingMessageId: null,
    isStreaming: false,
    pendingToolActivities: [],
    currentTool: null,
    draftInput: null,

    addUserMessage: (content, agentConfig) => {
      const id = generateId();
      set((state) => {
        state.messages.push({
          id,
          role: "user",
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
          role: "assistant",
          content: "",
          timestamp: Date.now(),
          isStreaming: true,
        });
        state.streamingMessageId = id;
        state.streamingContent = "";
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
              msg.contentBlocks = completeRunningBlocks(state.streamingBlocks);
            }
          }
        }
        state.streamingMessageId = null;
        state.streamingContent = "";
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
        state.streamingContent = "";
        state.streamingBlocks = [];
        state.isStreaming = false;
        state.pendingToolActivities = [];
        state.currentTool = null;
        state.draftInput = null;
      });
    },

    setActiveSession: (sessionId) => {
      set((state) => {
        state.activeSessionId = sessionId;
      });
    },

    setDraftInput: (value) => {
      set((state) => {
        state.draftInput = value;
      });
    },

    loadMessages: (messages) => {
      set((state) => {
        state.messages = messages.map((m) => ({
          id: m.id,
          role: m.role as "user" | "assistant" | "system",
          content: m.content,
          timestamp: m.timestamp,
          isStreaming: false,
          agentConfig: m.agentConfig,
          toolCalls: m.toolCalls,
          toolResults: m.toolResults,
          toolActivities: m.toolActivities,
          // Persisted blocks may have stale 'running' status from mid-stream snapshots.
          // Since these messages are finalized, mark all blocks as complete.
          contentBlocks: m.contentBlocks ? completeRunningBlocks(m.contentBlocks) : undefined,
        }));
      });
    },

    // ─── Reconnection actions ──────────────────────────────────────

    resumeStreaming: (messageId) => {
      set((state) => {
        // Find existing message or create a new streaming entry
        const existing = state.messages.find((m: MessageState) => m.id === messageId);
        if (existing) {
          existing.isStreaming = true;
        } else {
          state.messages.push({
            id: messageId,
            role: "assistant",
            content: "",
            timestamp: Date.now(),
            isStreaming: true,
          });
        }
        state.streamingMessageId = messageId;
        state.streamingContent = "";
        state.streamingBlocks = [];
        state.isStreaming = true;
        state.pendingToolActivities = [];
        state.currentTool = null;
      });
    },

    applySnapshot: (blocks, fullText) => {
      set((state) => {
        state.streamingBlocks = blocks;
        state.streamingContent = fullText;
        const msg = state.streamingMessageId
          ? state.messages.find((m: MessageState) => m.id === state.streamingMessageId)
          : null;
        if (msg) {
          msg.content = fullText;
          msg.contentBlocks = blocks;
        }
      });
    },

    // ─── Block-level streaming actions ──────────────────────────────

    startContentBlock: (_index, blockType, id, name) => {
      set((state) => {
        // Mark the previous block complete if it was still running
        const prev = state.streamingBlocks[state.streamingBlocks.length - 1];
        if (
          prev &&
          (prev.type === "text" || prev.type === "thinking") &&
          prev.status === "running"
        ) {
          prev.status = "complete";
        }
        if (blockType === "text") {
          state.streamingBlocks.push({ type: "text", text: "", status: "running" });
        } else if (blockType === "tool_use" && id && name) {
          state.streamingBlocks.push({ type: "tool_use", id, name, input: "", status: "running" });
        } else if (blockType === "thinking") {
          state.streamingBlocks.push({ type: "thinking", text: "", status: "running" });
        }
      });
    },

    appendToTextBlock: (text) => {
      set((state) => {
        const last = state.streamingBlocks[state.streamingBlocks.length - 1];
        if (last && last.type === "text") {
          last.text += text;
        } else {
          // No active text block — start one implicitly
          state.streamingBlocks.push({ type: "text", text, status: "running" });
        }
      });
    },

    appendToThinkingBlock: (text) => {
      set((state) => {
        const last = state.streamingBlocks[state.streamingBlocks.length - 1];
        if (last && last.type === "thinking") {
          last.text += text;
        } else {
          state.streamingBlocks.push({ type: "thinking", text, status: "running" });
        }
      });
    },

    startToolBlock: (toolUseId, name, input, inputRaw) => {
      set((state) => {
        // content_block_start may have already created a block with this ID — merge instead of duplicating
        const existing = state.streamingBlocks.find(
          (b): b is ContentBlock & { type: "tool_use" } =>
            b.type === "tool_use" && b.id === toolUseId,
        );
        if (existing) {
          existing.input = input;
          existing.name = name;
          if (inputRaw !== undefined) existing.inputRaw = inputRaw;
        } else {
          // Mark the previous text/thinking block complete before adding a tool block
          const prev = state.streamingBlocks[state.streamingBlocks.length - 1];
          if (
            prev &&
            (prev.type === "text" || prev.type === "thinking") &&
            prev.status === "running"
          ) {
            prev.status = "complete";
          }
          state.streamingBlocks.push({
            type: "tool_use",
            id: toolUseId,
            name,
            input,
            inputRaw,
            status: "running",
          });
        }
      });
    },

    setToolResult: (toolUseId, result, isError) => {
      set((state) => {
        const block = state.streamingBlocks.find(
          (b): b is ContentBlock & { type: "tool_use" } =>
            b.type === "tool_use" && b.id === toolUseId,
        );
        if (block) {
          block.status = isError ? "error" : "complete";
          if (isError) {
            block.error = typeof result === "string" ? result : JSON.stringify(result);
          } else {
            block.result = result;
          }
        }
      });
    },

    completeRunningTools: () => {
      set((state) => {
        for (const block of state.streamingBlocks) {
          if (block.status === "running") {
            block.status = "complete";
          }
        }
      });
    },

    completeNonTaskTools: () => {
      set((state) => {
        const taskLike = new Set(["Task", "Agent", "Explore", "AskUserQuestion"]);
        for (const block of state.streamingBlocks) {
          if (
            block.type === "tool_use" &&
            block.status === "running" &&
            !taskLike.has(block.name)
          ) {
            block.status = "complete";
          }
        }
      });
    },

    finishContentBlock: (_index) => {
      set((state) => {
        // Mark the most recent running text/thinking block as complete.
        // We walk backwards to find it since content_block_stop doesn't carry block identity.
        for (let i = state.streamingBlocks.length - 1; i >= 0; i--) {
          const block = state.streamingBlocks[i];
          if ((block.type === "text" || block.type === "thinking") && block.status === "running") {
            block.status = "complete";
            break;
          }
        }
      });
    },
  })),
);
