/**
 * HotkeyProvider — React context for keyboard shortcuts.
 *
 * Uses react-hotkeys-hook for shortcut registration.
 * Components bind via `useHotkey(name, callback)`.
 */

import { createContext, useContext, useCallback, type ReactNode } from 'react';
import { useHotkeys } from 'react-hotkeys-hook';
import { HOTKEYS, type HotkeyName } from './config';

/** Convert our key array format to react-hotkeys-hook string format. */
function toHotkeyString(keys: readonly string[]): string {
  return keys
    .map((k) => {
      if (k === 'Meta') return 'mod';
      if (k === 'Control') return 'ctrl';
      return k.toLowerCase();
    })
    .join('+');
}

interface HotkeyContextValue {
  /** Get the keyboard shortcut display string for a named hotkey. */
  getHotkeyString: (name: HotkeyName) => string;
}

const HotkeyContext = createContext<HotkeyContextValue>({
  getHotkeyString: () => '',
});

export function HotkeyProvider({ children }: { children: ReactNode }) {
  const getHotkeyString = useCallback((name: HotkeyName) => {
    const def = HOTKEYS[name];
    return def ? toHotkeyString(def.keys) : '';
  }, []);

  return (
    <HotkeyContext.Provider value={{ getHotkeyString }}>
      {children}
    </HotkeyContext.Provider>
  );
}

/**
 * Bind a named hotkey to a callback.
 *
 * Uses the centralized HOTKEYS config for key definitions,
 * respecting the `global` flag for form-enabled shortcuts.
 */
export function useHotkey(name: HotkeyName, callback: () => void, enabled = true) {
  const def = HOTKEYS[name];
  const hotkeyStr = toHotkeyString(def.keys);
  const isGlobal = 'global' in def && def.global;

  useHotkeys(
    hotkeyStr,
    (e) => {
      e.preventDefault();
      callback();
    },
    {
      enabled,
      enableOnFormTags: isGlobal ? ['INPUT', 'TEXTAREA', 'SELECT'] : undefined,
    },
  );
}

export function useHotkeyContext() {
  return useContext(HotkeyContext);
}
