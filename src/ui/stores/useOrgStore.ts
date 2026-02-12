/**
 * Org Store - Tracks which org is currently active.
 *
 * Org list and CRUD use tRPC queries directly in components.
 * This store only holds the selected org ID for cross-component coordination.
 */

import { create } from 'zustand';

interface OrgState {
  currentOrgId: string | null;
  setCurrentOrgId: (id: string | null) => void;
}

export const useOrgStore = create<OrgState>((set) => ({
  currentOrgId: null,
  setCurrentOrgId: (id) => set({ currentOrgId: id }),
}));
