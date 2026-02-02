/**
 * HotkeyProvider - Central hotkey management for the app
 *
 * Registers global keyboard shortcuts and provides actions to components.
 * Uses solid-primitives/keyboard for reactive shortcut handling.
 */

import { createContext, useContext, JSX } from 'solid-js';
import { createShortcut } from '@solid-primitives/keyboard';

export type HotkeyActions = {
  /** Register the chat input element for focus actions */
  registerInput: (el: HTMLTextAreaElement | null) => void;
  /** Register panel toggle functions */
  registerPanelToggles: (toggles: {
    history?: () => void;
    tasks?: () => void;
  }) => void;
  /** Register new chat action */
  registerNewChat: (fn: () => void) => void;
  /** Register cancel stream action */
  registerCancelStream: (fn: () => void) => void;
};

const HotkeyContext = createContext<HotkeyActions>();

export function useHotkeys(): HotkeyActions {
  const ctx = useContext(HotkeyContext);
  // Return no-op functions if context not available (prevents crashes)
  if (!ctx) {
    console.warn('[useHotkeys] Called outside HotkeyProvider, returning no-ops');
    return {
      registerInput: () => {},
      registerPanelToggles: () => {},
      registerNewChat: () => {},
      registerCancelStream: () => {},
    };
  }
  return ctx;
}

interface HotkeyProviderProps {
  children: JSX.Element;
}

export function HotkeyProvider(props: HotkeyProviderProps) {
  // Registered elements and callbacks
  let inputRef: HTMLTextAreaElement | null = null;
  let toggleHistory: (() => void) | undefined;
  let toggleTasks: (() => void) | undefined;
  let newChatFn: (() => void) | undefined;
  let cancelStreamFn: (() => void) | undefined;

  // Actions that components can call to register themselves
  const actions: HotkeyActions = {
    registerInput: (el) => {
      inputRef = el;
    },
    registerPanelToggles: (toggles) => {
      toggleHistory = toggles.history;
      toggleTasks = toggles.tasks;
    },
    registerNewChat: (fn) => {
      newChatFn = fn;
    },
    registerCancelStream: (fn) => {
      cancelStreamFn = fn;
    },
  };

  // NOTE: Paste is handled natively by the browser/Tauri
  // We don't intercept paste events to avoid breaking clipboard functionality

  // Focus input: Cmd+/ or Ctrl+/
  createShortcut(['Meta', '/'], () => {
    inputRef?.focus();
  }, { preventDefault: true });

  createShortcut(['Control', '/'], () => {
    inputRef?.focus();
  }, { preventDefault: true });

  // Toggle history panel: Cmd+Shift+H
  createShortcut(['Meta', 'Shift', 'H'], () => {
    toggleHistory?.();
  }, { preventDefault: true });

  // Toggle tasks panel: Cmd+Shift+T
  createShortcut(['Meta', 'Shift', 'T'], () => {
    toggleTasks?.();
  }, { preventDefault: true });

  // New chat: Cmd+N or Ctrl+N
  createShortcut(['Meta', 'n'], () => {
    newChatFn?.();
  }, { preventDefault: true });

  createShortcut(['Control', 'n'], () => {
    newChatFn?.();
  }, { preventDefault: true });

  // Escape: Cancel stream or clear input
  createShortcut(['Escape'], () => {
    if (cancelStreamFn) {
      cancelStreamFn();
    } else if (inputRef) {
      inputRef.value = '';
      inputRef.dispatchEvent(new Event('input', { bubbles: true }));
    }
  }, { preventDefault: false });

  return (
    <HotkeyContext.Provider value={actions}>
      {props.children}
    </HotkeyContext.Provider>
  );
}
