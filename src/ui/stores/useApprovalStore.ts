import { create } from 'zustand';

interface PendingApproval {
  requestId: string;
  toolName: string;
  input: unknown;
  description: string;
}

export type ApprovalDecision = 'approve' | 'approve_session' | 'deny' | 'cancel';

interface ApprovalStore {
  pending: PendingApproval | null;
  /** The decision submitted (kept for read-only display after submit). */
  submittedDecision: ApprovalDecision | null;
  setPending: (req: PendingApproval) => void;
  submit: (decision: ApprovalDecision) => void;
  clear: () => void;
}

export const useApprovalStore = create<ApprovalStore>((set) => ({
  pending: null,
  submittedDecision: null,
  setPending: (req) => set({ pending: req, submittedDecision: null }),
  submit: (decision) => set({ submittedDecision: decision }),
  clear: () => set({ pending: null, submittedDecision: null }),
}));
