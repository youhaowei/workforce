import '@testing-library/jest-dom/vitest';

// Node 22+ exposes a stub `globalThis.localStorage` that has no methods
// (getItem, setItem, clear, etc.). When vitest runs jsdom tests, jsdom's
// localStorage should replace it — but in vitest 1.x it doesn't always
// propagate to `globalThis`. Provide a proper in-memory fallback so
// zustand persist middleware and test code that calls `localStorage.clear()`
// work correctly in both node and jsdom environments.
if (typeof globalThis.localStorage === 'undefined' || typeof globalThis.localStorage.clear !== 'function') {
  const store = new Map<string, string>();
  globalThis.localStorage = {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => { store.set(key, value); },
    removeItem: (key: string) => { store.delete(key); },
    clear: () => { store.clear(); },
    get length() { return store.size; },
    key: (index: number) => [...store.keys()][index] ?? null,
  } as Storage;
}
