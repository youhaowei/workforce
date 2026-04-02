import '@testing-library/jest-dom/vitest';
import { beforeEach } from 'vitest';

class MemoryStorage implements Storage {
  private store = new Map<string, string>();

  get length() {
    return this.store.size;
  }

  clear() {
    this.store.clear();
  }

  getItem(key: string) {
    return this.store.has(key) ? this.store.get(key)! : null;
  }

  key(index: number) {
    return Array.from(this.store.keys())[index] ?? null;
  }

  removeItem(key: string) {
    this.store.delete(key);
  }

  setItem(key: string, value: string) {
    this.store.set(key, String(value));
  }
}

// Wrap in Proxy to support index access (storage["key"] = "val") like real Storage.
function createStorageMock(): Storage {
  const storage = new MemoryStorage();
  return new Proxy(storage, {
    get(target, prop: string) {
      if (prop in target) return (target as unknown as Record<string, unknown>)[prop];
      return target.getItem(prop);
    },
    set(target, prop: string, value: string) {
      target.setItem(prop, value);
      return true;
    },
    deleteProperty(target, prop: string) {
      target.removeItem(prop);
      return true;
    },
  });
}

const localStorageMock = createStorageMock();
const sessionStorageMock = createStorageMock();

beforeEach(() => {
  localStorageMock.clear();
  sessionStorageMock.clear();
});

// In jsdom window === globalThis, so a single defineProperty covers both.
// In Node (non-jsdom), window is undefined — globalThis alone is sufficient.
Object.defineProperty(globalThis, 'localStorage', {
  value: localStorageMock,
  configurable: true,
});

Object.defineProperty(globalThis, 'sessionStorage', {
  value: sessionStorageMock,
  configurable: true,
});
