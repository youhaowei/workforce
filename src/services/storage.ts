import { appendFile, mkdir, readFile, writeFile } from 'fs/promises';
import { dirname, join } from 'path';
import type { SessionEvent } from './types';

export interface StorageAdapter {
  readJson<T>(workspaceRoot: string, relativePath: string, fallback: T): Promise<T>;
  writeJson(workspaceRoot: string, relativePath: string, data: unknown): Promise<void>;
  appendEvent(workspaceRoot: string, stream: string, event: SessionEvent): Promise<void>;
  readEvents(workspaceRoot: string, stream: string): Promise<SessionEvent[]>;
}

async function ensureParent(path: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
}

export class LocalStorageAdapter implements StorageAdapter {
  async readJson<T>(workspaceRoot: string, relativePath: string, fallback: T): Promise<T> {
    try {
      const path = join(workspaceRoot, relativePath);
      const raw = await readFile(path, 'utf-8');
      return JSON.parse(raw) as T;
    } catch {
      return fallback;
    }
  }

  async writeJson(workspaceRoot: string, relativePath: string, data: unknown): Promise<void> {
    const path = join(workspaceRoot, relativePath);
    await ensureParent(path);
    await writeFile(path, JSON.stringify(data, null, 2), 'utf-8');
  }

  async appendEvent(workspaceRoot: string, stream: string, event: SessionEvent): Promise<void> {
    const path = join(workspaceRoot, 'events', `${stream}.jsonl`);
    await ensureParent(path);
    await appendFile(path, `${JSON.stringify(event)}\n`, 'utf-8');
  }

  async readEvents(workspaceRoot: string, stream: string): Promise<SessionEvent[]> {
    try {
      const path = join(workspaceRoot, 'events', `${stream}.jsonl`);
      const raw = await readFile(path, 'utf-8');
      return raw
        .split('\n')
        .filter(Boolean)
        .map((line) => JSON.parse(line) as SessionEvent);
    } catch {
      return [];
    }
  }
}

// Placeholder for post-MVP sync adapter.
export class ConvexSyncAdapter implements StorageAdapter {
  async readJson<T>(_workspaceRoot: string, _relativePath: string, _fallback: T): Promise<T> {
    throw new Error('ConvexSyncAdapter is not active in MVP');
  }

  async writeJson(_workspaceRoot: string, _relativePath: string, _data: unknown): Promise<void> {
    throw new Error('ConvexSyncAdapter is not active in MVP');
  }

  async appendEvent(_workspaceRoot: string, _stream: string, _event: SessionEvent): Promise<void> {
    throw new Error('ConvexSyncAdapter is not active in MVP');
  }

  async readEvents(_workspaceRoot: string, _stream: string): Promise<SessionEvent[]> {
    throw new Error('ConvexSyncAdapter is not active in MVP');
  }
}

let _storageAdapter: StorageAdapter | null = null;

export function getStorageAdapter(): StorageAdapter {
  return (_storageAdapter ??= new LocalStorageAdapter());
}

export function setStorageAdapter(adapter: StorageAdapter): void {
  _storageAdapter = adapter;
}
