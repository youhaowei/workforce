import { create } from 'zustand';

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
}

interface ChatState {
  messages: ChatMessage[];
  isStreaming: boolean;
  streamingMessageId: string | null;
  addUserMessage: (content: string) => void;
  startAssistantMessage: () => string;
  appendAssistantToken: (token: string) => void;
  finishAssistantMessage: () => void;
  reset: () => void;
}

function generateId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export const useChatStore = create<ChatState>((set, get) => ({
  messages: [],
  isStreaming: false,
  streamingMessageId: null,

  addUserMessage(content) {
    set((state) => ({
      messages: [
        ...state.messages,
        {
          id: generateId('msg'),
          role: 'user',
          content,
          timestamp: Date.now(),
        },
      ],
    }));
  },

  startAssistantMessage() {
    const id = generateId('msg');
    set((state) => ({
      isStreaming: true,
      streamingMessageId: id,
      messages: [
        ...state.messages,
        {
          id,
          role: 'assistant',
          content: '',
          timestamp: Date.now(),
        },
      ],
    }));
    return id;
  },

  appendAssistantToken(token) {
    const id = get().streamingMessageId;
    if (!id) return;

    set((state) => ({
      messages: state.messages.map((message) =>
        message.id === id
          ? {
              ...message,
              content: message.content + token,
            }
          : message
      ),
    }));
  },

  finishAssistantMessage() {
    set({
      isStreaming: false,
      streamingMessageId: null,
    });
  },

  reset() {
    set({
      messages: [],
      isStreaming: false,
      streamingMessageId: null,
    });
  },
}));
