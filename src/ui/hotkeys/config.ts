/**
 * Hotkey Configuration - Central source of truth for all keyboard shortcuts
 *
 * Key naming follows web standards:
 * - 'Meta' = Cmd on Mac, Win on Windows
 * - 'Control' = Ctrl
 * - 'Alt' = Option on Mac
 * - 'Shift' = Shift
 */

export type HotkeyDefinition = {
  keys: string[];
  description: string;
  /** If true, works even when input is focused */
  global?: boolean;
};

export const HOTKEYS = {
  // Input actions
  paste: {
    keys: ['Meta', 'v'],
    description: 'Paste from clipboard',
    global: true,
  },
  pasteCtrl: {
    keys: ['Control', 'v'],
    description: 'Paste from clipboard (Ctrl)',
    global: true,
  },

  // Chat actions
  sendMessage: {
    keys: ['Enter'],
    description: 'Send message',
  },
  newLine: {
    keys: ['Shift', 'Enter'],
    description: 'New line in message',
  },
  cancelStream: {
    keys: ['Escape'],
    description: 'Cancel streaming / Clear input',
  },

  // Navigation
  focusInput: {
    keys: ['Meta', '/'],
    description: 'Focus chat input',
    global: true,
  },
  focusInputCtrl: {
    keys: ['Control', '/'],
    description: 'Focus chat input (Ctrl)',
    global: true,
  },

  // Panels
  toggleHistory: {
    keys: ['Meta', 'Shift', 'h'],
    description: 'Toggle history panel',
    global: true,
  },
  toggleTasks: {
    keys: ['Meta', 'Shift', 't'],
    description: 'Toggle tasks panel',
    global: true,
  },

  // Session
  newChat: {
    keys: ['Meta', 'n'],
    description: 'New chat session',
    global: true,
  },
  newChatCtrl: {
    keys: ['Control', 'n'],
    description: 'New chat session (Ctrl)',
    global: true,
  },
} as const;

export type HotkeyName = keyof typeof HOTKEYS;
