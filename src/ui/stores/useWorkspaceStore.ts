/**
 * Workspace Store - Tracks which workspace is currently active.
 *
 * Workspace list and CRUD use tRPC queries directly in components.
 * This store only holds the selected workspace ID for cross-component coordination.
 */

import { create } from 'zustand';

interface WorkspaceState {
  currentWorkspaceId: string | null;
  setCurrentWorkspaceId: (id: string | null) => void;
}

export const useWorkspaceStore = create<WorkspaceState>((set) => ({
  currentWorkspaceId: null,
  setCurrentWorkspaceId: (id) => set({ currentWorkspaceId: id }),
}));
