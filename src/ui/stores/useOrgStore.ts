/**
 * Org Store - Tracks which org is currently active.
 *
 * Org list and CRUD use tRPC queries directly in components.
 * This store only holds the selected org ID for cross-component coordination.
 *
 * Persisted to localStorage so the active org survives page reloads
 * without waiting for the server round-trip (eliminates the extra
 * loading→done render cycle in SetupGate).
 */

import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface OrgState {
  currentOrgId: string | null;
  setCurrentOrgId: (id: string | null) => void;
}

export const useOrgStore = create<OrgState>()(
  persist(
    (set) => ({
      currentOrgId: null,
      setCurrentOrgId: (id) => set({ currentOrgId: id }),
    }),
    { name: 'workforce-org-store' },
  ),
);
