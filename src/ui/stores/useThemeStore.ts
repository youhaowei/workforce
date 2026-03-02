import { create } from 'zustand';

export type ThemeMode = 'system' | 'light' | 'dark';

const THEME_STORAGE_KEY = 'workforce-theme';

function getStoredTheme(): ThemeMode {
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY);
    if (stored === 'light' || stored === 'dark' || stored === 'system') return stored;
  } catch {
    // ignore
  }
  return 'system';
}

function getSystemPrefersDark() {
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

function applyTheme(mode: ThemeMode) {
  const isDark = mode === 'dark' || (mode === 'system' && getSystemPrefersDark());
  document.documentElement.classList.toggle('dark', isDark);
}

interface ThemeState {
  mode: ThemeMode;
  setMode: (mode: ThemeMode) => void;
}

export const useThemeStore = create<ThemeState>((set) => {
  const initial = getStoredTheme();
  // Apply immediately on store creation
  applyTheme(initial);

  // Listen for system theme changes
  const mq = window.matchMedia('(prefers-color-scheme: dark)');
  mq.addEventListener('change', () => {
    const current = useThemeStore.getState().mode;
    if (current === 'system') applyTheme('system');
  });

  return {
    mode: initial,
    setMode: (mode) => {
      localStorage.setItem(THEME_STORAGE_KEY, mode);
      applyTheme(mode);
      set({ mode });
    },
  };
});
