/**
 * Dialog Store — Global confirmation dialog state.
 *
 * Provides a promise-based `confirm()` API so any component can trigger
 * a confirmation dialog without managing local AlertDialog state.
 *
 * Usage:
 *   const confirmed = await useDialogStore.getState().confirm({
 *     title: 'Delete project',
 *     description: 'This cannot be undone.',
 *     confirmLabel: 'Delete',
 *     variant: 'destructive',
 *   });
 *   if (confirmed) { ... }
 *
 * The <ConfirmDialog /> component (mounted once in Shell) reads from this store.
 */

import { create } from "zustand";

export type DialogVariant = "default" | "destructive";

export interface ConfirmOptions {
  title: string;
  description: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: DialogVariant;
}

interface DialogState {
  open: boolean;
  options: ConfirmOptions;
  confirm: (options: ConfirmOptions) => Promise<boolean>;
  respond: (confirmed: boolean) => void;
}

const DEFAULT_OPTIONS: ConfirmOptions = {
  title: "",
  description: "",
};

// Module-level ref for the resolve callback — kept outside Zustand state
// to avoid triggering re-renders when the function reference changes.
let resolveRef: ((confirmed: boolean) => void) | null = null;

export const useDialogStore = create<DialogState>((set) => ({
  open: false,
  options: DEFAULT_OPTIONS,

  confirm: (options) =>
    new Promise<boolean>((resolve) => {
      // If a dialog is already open, reject the previous one
      if (resolveRef) resolveRef(false);
      resolveRef = resolve;

      set({ open: true, options });
    }),

  respond: (confirmed) => {
    if (!resolveRef) return;
    resolveRef(confirmed);
    resolveRef = null;
    set({ open: false, options: DEFAULT_OPTIONS });
  },
}));
