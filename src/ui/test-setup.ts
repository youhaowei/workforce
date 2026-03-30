import '@testing-library/jest-dom/vitest';

// Provide a working localStorage for jsdom environments where the built-in
// stub may not implement all methods (setItem, clear, etc.).
const localStorageMap = new Map<string, string>();
Object.defineProperty(globalThis, 'localStorage', {
  value: {
    getItem: (key: string) => localStorageMap.get(key) ?? null,
    setItem: (key: string, value: string) => localStorageMap.set(key, value),
    removeItem: (key: string) => localStorageMap.delete(key),
    clear: () => localStorageMap.clear(),
    get length() { return localStorageMap.size; },
    key: (i: number) => [...localStorageMap.keys()][i] ?? null,
  },
  writable: true,
});
