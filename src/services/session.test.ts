/**
 * Session Service Tests
 *
 * Tests for session persistence, versioning, and recovery.
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll, afterAll } from 'vitest';
import { mkdir, writeFile, rm, readFile, readdir } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  resetSessionService,
  createSessionService,
  SESSION_VERSION,
} from './session';

// Test directory for session files
const TEST_DIR = join(tmpdir(), 'fuxi-session-test-' + Date.now());

describe('SessionService', () => {
  beforeAll(async () => {
    await mkdir(TEST_DIR, { recursive: true });
  });

  afterAll(async () => {
    await rm(TEST_DIR, { recursive: true, force: true });
  });

  beforeEach(() => {
    resetSessionService();
  });

  afterEach(() => {
    resetSessionService();
  });

  describe('create', () => {
    it('should create a new session with generated ID', async () => {
      const service = createSessionService(TEST_DIR);
      const session = await service.create('Test Session');

      expect(session.id).toMatch(/^sess_/);
      expect(session.title).toBe('Test Session');
      expect(session.messages).toEqual([]);
      expect(session.createdAt).toBeLessThanOrEqual(Date.now());
      expect(session.updatedAt).toBe(session.createdAt);
    });

    it('should create session without title', async () => {
      const service = createSessionService(TEST_DIR);
      const session = await service.create();

      expect(session.title).toBeUndefined();
    });

    it('should persist session to disk', async () => {
      const service = createSessionService(TEST_DIR);
      const session = await service.create('Persisted');

      // Check file exists
      const filePath = join(TEST_DIR, `${session.id}.json`);
      const raw = await readFile(filePath, 'utf-8');
      const parsed = JSON.parse(raw);

      expect(parsed.version).toBe(SESSION_VERSION);
      expect(parsed.session.title).toBe('Persisted');
    });
  });

  describe('get', () => {
    it('should return session by ID', async () => {
      const service = createSessionService(TEST_DIR);
      const created = await service.create('Get Test');
      const retrieved = await service.get(created.id);

      expect(retrieved).not.toBeNull();
      expect(retrieved!.id).toBe(created.id);
      expect(retrieved!.title).toBe('Get Test');
    });

    it('should return null for non-existent session', async () => {
      const service = createSessionService(TEST_DIR);
      const retrieved = await service.get('non-existent-id');

      expect(retrieved).toBeNull();
    });

    it('should use cache on repeated access', async () => {
      const service = createSessionService(TEST_DIR);
      const created = await service.create('Cached');

      const first = await service.get(created.id);
      const second = await service.get(created.id);

      expect(first).toBe(second); // Same reference
    });
  });

  describe('save', () => {
    it('should update session and persist', async () => {
      const service = createSessionService(TEST_DIR);
      const session = await service.create('Save Test');

      session.messages.push({
        id: 'msg_1',
        role: 'user',
        content: 'Hello',
        timestamp: Date.now(),
      });

      await service.save(session);

      // Reload and verify
      const fresh = createSessionService(TEST_DIR);
      const loaded = await fresh.get(session.id);

      expect(loaded!.messages).toHaveLength(1);
      expect(loaded!.messages[0].content).toBe('Hello');
    });

    it('should update updatedAt timestamp', async () => {
      const service = createSessionService(TEST_DIR);
      const session = await service.create('Timestamp Test');
      const originalUpdatedAt = session.updatedAt;

      // Wait a bit to ensure timestamp difference
      await new Promise((resolve) => setTimeout(resolve, 10));

      await service.save(session);

      expect(session.updatedAt).toBeGreaterThan(originalUpdatedAt);
    });
  });

  describe('resume', () => {
    it('should resume existing session', async () => {
      const service = createSessionService(TEST_DIR);
      const created = await service.create('Resume Test');

      const resumed = await service.resume(created.id);

      expect(resumed.id).toBe(created.id);
      expect(service.getCurrent()).toBe(resumed);
    });

    it('should throw for non-existent session', async () => {
      const service = createSessionService(TEST_DIR);

      await expect(service.resume('non-existent')).rejects.toThrow('Session not found');
    });
  });

  describe('fork', () => {
    it('should create new session with parent history', async () => {
      const service = createSessionService(TEST_DIR);
      const parent = await service.create('Parent');

      parent.messages.push({
        id: 'msg_1',
        role: 'user',
        content: 'Original message',
        timestamp: Date.now(),
      });
      await service.save(parent);

      const forked = await service.fork(parent.id);

      expect(forked.id).not.toBe(parent.id);
      expect(forked.parentId).toBe(parent.id);
      expect(forked.title).toBe('Parent (fork)');
      expect(forked.messages).toHaveLength(1);
      expect(forked.messages[0].content).toBe('Original message');
    });

    it('should throw for non-existent parent', async () => {
      const service = createSessionService(TEST_DIR);

      await expect(service.fork('non-existent')).rejects.toThrow('Session not found');
    });
  });

  describe('list', () => {
    it('should list sessions sorted by updatedAt', async () => {
      const service = createSessionService(TEST_DIR);

      const session1 = await service.create('First');
      await new Promise((resolve) => setTimeout(resolve, 10));
      const session2 = await service.create('Second');
      await new Promise((resolve) => setTimeout(resolve, 10));
      const session3 = await service.create('Third');

      const list = await service.list();

      // Most recent first
      const ids = list.map((s) => s.id);
      expect(ids.indexOf(session3.id)).toBeLessThan(ids.indexOf(session2.id));
      expect(ids.indexOf(session2.id)).toBeLessThan(ids.indexOf(session1.id));
    });

    it('should support pagination', async () => {
      const service = createSessionService(TEST_DIR);

      await service.create('A');
      await service.create('B');
      await service.create('C');

      const page1 = await service.list({ limit: 2, offset: 0 });
      const page2 = await service.list({ limit: 2, offset: 2 });

      expect(page1.length).toBeLessThanOrEqual(2);
      expect(page2.length).toBeLessThanOrEqual(2);
    });
  });

  describe('search', () => {
    it('should find sessions by title', async () => {
      const service = createSessionService(TEST_DIR);

      await service.create('TypeScript Project');
      await service.create('Python Script');

      const results = await service.search('typescript');

      expect(results.length).toBeGreaterThanOrEqual(1);
      expect(results[0].session.title).toContain('TypeScript');
      expect(results[0].score).toBe(2.0); // Title match score
    });

    it('should find sessions by message content', async () => {
      const service = createSessionService(TEST_DIR);

      const session = await service.create('Code Help');
      session.messages.push({
        id: 'msg_1',
        role: 'user',
        content: 'How do I implement authentication?',
        timestamp: Date.now(),
      });
      await service.save(session);

      const results = await service.search('authentication');

      expect(results.length).toBeGreaterThanOrEqual(1);
      expect(results[0].matchedText).toContain('authentication');
    });

    it('should return empty for no matches', async () => {
      const service = createSessionService(TEST_DIR);
      await service.create('Something');

      const results = await service.search('xyznonexistent');

      expect(results).toEqual([]);
    });
  });

  describe('delete', () => {
    it('should delete session from cache and disk', async () => {
      const service = createSessionService(TEST_DIR);
      const session = await service.create('To Delete');
      const filePath = join(TEST_DIR, `${session.id}.json`);

      await service.delete(session.id);

      // Verify removed from cache
      expect(await service.get(session.id)).toBeNull();

      // Verify file deleted
      await expect(readFile(filePath)).rejects.toThrow();
    });

    it('should clear current session if deleted', async () => {
      const service = createSessionService(TEST_DIR);
      const session = await service.create('Current');
      await service.resume(session.id);

      expect(service.getCurrent()).not.toBeNull();

      await service.delete(session.id);

      expect(service.getCurrent()).toBeNull();
    });
  });

  describe('version migration', () => {
    it('should handle version 1 sessions', async () => {
      const sessionId = 'sess_v1_test';
      const filePath = join(TEST_DIR, `${sessionId}.json`);

      const v1Data = {
        version: 1,
        session: {
          id: sessionId,
          title: 'V1 Session',
          createdAt: Date.now(),
          updatedAt: Date.now(),
          messages: [],
          metadata: {},
        },
      };

      await writeFile(filePath, JSON.stringify(v1Data));

      // Create fresh service to load from disk
      const service = createSessionService(TEST_DIR);
      const loaded = await service.get(sessionId);

      expect(loaded).not.toBeNull();
      expect(loaded!.title).toBe('V1 Session');
    });

    it('should warn for unknown versions but still load', async () => {
      const sessionId = 'sess_future_test';
      const filePath = join(TEST_DIR, `${sessionId}.json`);

      const futureData = {
        version: 99,
        session: {
          id: sessionId,
          title: 'Future Session',
          createdAt: Date.now(),
          updatedAt: Date.now(),
          messages: [],
          metadata: {},
        },
      };

      await writeFile(filePath, JSON.stringify(futureData));

      const service = createSessionService(TEST_DIR);
      const loaded = await service.get(sessionId);

      expect(loaded).not.toBeNull();
      expect(loaded!.title).toBe('Future Session');
    });
  });

  describe('forward compatibility', () => {
    it('should preserve unknown fields on round-trip', async () => {
      const sessionId = 'sess_forward_test';
      const filePath = join(TEST_DIR, `${sessionId}.json`);

      const dataWithUnknown = {
        version: 1,
        session: {
          id: sessionId,
          title: 'Forward Compat',
          createdAt: Date.now(),
          updatedAt: Date.now(),
          messages: [],
          metadata: {},
        },
        futureTopLevel: 'preserved',
        anotherUnknown: { nested: true },
      };

      await writeFile(filePath, JSON.stringify(dataWithUnknown));

      const service = createSessionService(TEST_DIR);
      const loaded = await service.get(sessionId);

      expect(loaded).not.toBeNull();

      // Modify and save
      loaded!.title = 'Updated Title';
      await service.save(loaded!);

      // Verify unknown fields preserved
      const raw = await readFile(filePath, 'utf-8');
      const parsed = JSON.parse(raw);

      expect(parsed.futureTopLevel).toBe('preserved');
      expect(parsed.anotherUnknown).toEqual({ nested: true });
      expect(parsed.session.title).toBe('Updated Title');
    });
  });

  describe('corruption recovery', () => {
    it('should handle corrupted JSON and create backup', async () => {
      // Use a unique subdirectory for this test to isolate backups
      const corruptTestDir = join(TEST_DIR, 'corrupt-test');
      await mkdir(corruptTestDir, { recursive: true });

      const sessionId = 'sess_corrupted';
      const filePath = join(corruptTestDir, `${sessionId}.json`);

      await writeFile(filePath, '{ invalid json }}}');

      const service = createSessionService(corruptTestDir);
      const loaded = await service.get(sessionId);

      expect(loaded).toBeNull();

      // Backup should be created
      const files = await readdir(corruptTestDir);
      const backupFiles = files.filter((f) =>
        f.startsWith(`${sessionId}.json.backup`)
      );
      expect(backupFiles.length).toBeGreaterThanOrEqual(1);

      // Clean up
      await rm(corruptTestDir, { recursive: true, force: true });
    });
  });

  describe('getCurrent / setCurrent', () => {
    it('should manage current session', async () => {
      const service = createSessionService(TEST_DIR);

      expect(service.getCurrent()).toBeNull();

      const session = await service.create('Current Test');
      service.setCurrent(session);

      expect(service.getCurrent()).toBe(session);

      service.setCurrent(null);
      expect(service.getCurrent()).toBeNull();
    });
  });

  describe('dispose', () => {
    it('should clear all state', async () => {
      const service = createSessionService(TEST_DIR);
      await service.create('Dispose Test');

      service.dispose();

      // After dispose, should be empty (though service is still usable)
      expect(service.getCurrent()).toBeNull();
    });
  });
});
