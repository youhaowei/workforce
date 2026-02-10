/**
 * WorkspaceService Tests
 *
 * Tests for workspace CRUD, persistence, and event emission.
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll, afterAll } from 'vitest';
import { mkdir, rm, readFile } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { createWorkspaceService } from './workspace';
import { createEventBus, type EventBus } from '@shared/event-bus';

const TEST_DIR = join(tmpdir(), 'workforce-workspace-test-' + Date.now());

// Override global event bus for testing
let testBus: EventBus;

describe('WorkspaceService', () => {
  beforeAll(async () => {
    await mkdir(TEST_DIR, { recursive: true });
  });

  afterAll(async () => {
    await rm(TEST_DIR, { recursive: true, force: true });
  });

  beforeEach(() => {
    testBus = createEventBus();
  });

  afterEach(() => {
    testBus.dispose();
  });

  describe('create', () => {
    it('should create a workspace with generated ID', async () => {
      const service = createWorkspaceService(TEST_DIR);
      const ws = await service.create('My Project', '/home/user/project');

      expect(ws.id).toMatch(/^ws_/);
      expect(ws.name).toBe('My Project');
      expect(ws.rootPath).toBe('/home/user/project');
      expect(ws.settings.allowedTools).toEqual([]);
      expect(ws.createdAt).toBeLessThanOrEqual(Date.now());

      service.dispose();
    });

    it('should persist workspace to disk', async () => {
      const dir = join(TEST_DIR, 'persist-test');
      await mkdir(dir, { recursive: true });

      const service = createWorkspaceService(dir);
      const ws = await service.create('Persisted', '/tmp/test');

      const filePath = join(dir, ws.id, 'workspace.json');
      const raw = await readFile(filePath, 'utf-8');
      const saved = JSON.parse(raw);

      expect(saved.name).toBe('Persisted');
      expect(saved.rootPath).toBe('/tmp/test');

      service.dispose();
    });
  });

  describe('get', () => {
    it('should return workspace by ID', async () => {
      const service = createWorkspaceService(join(TEST_DIR, 'get-test'));
      const created = await service.create('Test', '/tmp');
      const found = await service.get(created.id);

      expect(found).not.toBeNull();
      expect(found!.name).toBe('Test');

      service.dispose();
    });

    it('should return null for non-existent workspace', async () => {
      const service = createWorkspaceService(join(TEST_DIR, 'get-null'));
      const found = await service.get('ws_nonexistent');

      expect(found).toBeNull();

      service.dispose();
    });
  });

  describe('update', () => {
    it('should update workspace properties', async () => {
      const service = createWorkspaceService(join(TEST_DIR, 'update-test'));
      const ws = await service.create('Original', '/tmp');

      const updated = await service.update(ws.id, {
        name: 'Updated',
        description: 'A description',
        settings: { allowedTools: ['bash', 'read'], costWarningThreshold: 5.0 },
      });

      expect(updated.name).toBe('Updated');
      expect(updated.description).toBe('A description');
      expect(updated.settings.allowedTools).toEqual(['bash', 'read']);
      expect(updated.settings.costWarningThreshold).toBe(5.0);
      expect(updated.updatedAt).toBeGreaterThanOrEqual(ws.updatedAt);
      // Immutable fields preserved
      expect(updated.id).toBe(ws.id);
      expect(updated.createdAt).toBe(ws.createdAt);

      service.dispose();
    });

    it('should throw for non-existent workspace', async () => {
      const service = createWorkspaceService(join(TEST_DIR, 'update-throw'));
      await expect(service.update('ws_fake', { name: 'X' })).rejects.toThrow('Workspace not found');

      service.dispose();
    });
  });

  describe('list', () => {
    it('should return all workspaces', async () => {
      const service = createWorkspaceService(join(TEST_DIR, 'list-test'));

      await service.create('First', '/a');
      await service.create('Second', '/b');
      await service.create('Third', '/c');

      const list = await service.list();
      expect(list).toHaveLength(3);
      const names = list.map((w) => w.name).sort();
      expect(names).toEqual(['First', 'Second', 'Third']);

      service.dispose();
    });
  });

  describe('delete', () => {
    it('should remove workspace from memory and disk', async () => {
      const dir = join(TEST_DIR, 'delete-test');
      const service = createWorkspaceService(dir);
      const ws = await service.create('ToDelete', '/tmp');

      await service.delete(ws.id);

      const found = await service.get(ws.id);
      expect(found).toBeNull();

      const list = await service.list();
      expect(list).toHaveLength(0);

      service.dispose();
    });

    it('should clear current workspace if deleted', async () => {
      const service = createWorkspaceService(join(TEST_DIR, 'delete-current'));
      const ws = await service.create('Current', '/tmp');
      service.setCurrent(ws);

      expect(service.getCurrent()).not.toBeNull();

      await service.delete(ws.id);

      expect(service.getCurrent()).toBeNull();

      service.dispose();
    });
  });

  describe('current workspace', () => {
    it('should track current workspace', async () => {
      const service = createWorkspaceService(join(TEST_DIR, 'current-test'));
      const ws = await service.create('Active', '/tmp');

      expect(service.getCurrent()).toBeNull();

      service.setCurrent(ws);
      expect(service.getCurrent()?.id).toBe(ws.id);

      service.setCurrent(null);
      expect(service.getCurrent()).toBeNull();

      service.dispose();
    });
  });

  describe('persistence across instances', () => {
    it('should load workspaces from disk on new instance', async () => {
      const dir = join(TEST_DIR, 'reload-test');

      // Create workspace with first instance
      const service1 = createWorkspaceService(dir);
      const ws = await service1.create('Reloaded', '/tmp');
      service1.dispose();

      // Load with second instance
      const service2 = createWorkspaceService(dir);
      const found = await service2.get(ws.id);

      expect(found).not.toBeNull();
      expect(found!.name).toBe('Reloaded');

      service2.dispose();
    });
  });
});
