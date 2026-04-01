import { create } from "zustand";
import type { AgentQuestion } from "@/services/types";

interface PendingQuestion {
  requestId: string;
  sessionId: string | null;
  questions: AgentQuestion[];
}

type SendMessageFn = (content: string) => void;

interface AgentQuestionStore {
  pending: PendingQuestion | null;
  /** Whether the inline QuestionCard is visible in the viewport. */
  cardVisible: boolean;
  /** The answers submitted (kept for read-only display after submit). */
  submittedAnswers: Record<string, string[]> | null;
  /** Callback to send a message as continuation (set by Shell for cold-replay). */
  sendMessage: SendMessageFn | null;
  setPending: (req: PendingQuestion) => void;
  setCardVisible: (visible: boolean) => void;
  setSendMessage: (fn: SendMessageFn) => void;
  submit: (answers: Record<string, string[]>) => void;
  clear: () => void;
}

export const useAgentQuestionStore = create<AgentQuestionStore>((set) => ({
  pending: null,
  cardVisible: false,
  submittedAnswers: null,
  sendMessage: null,
  setPending: (req) => set({ pending: req, cardVisible: false, submittedAnswers: null }),
  setCardVisible: (visible) => set({ cardVisible: visible }),
  setSendMessage: (fn) => set({ sendMessage: fn }),
  submit: (answers) => set({ submittedAnswers: answers }),
  clear: () => set({ pending: null, cardVisible: false, submittedAnswers: null }),
}));
