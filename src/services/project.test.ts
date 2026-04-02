/**
 * ProjectService Tests
 *
 * Tests for project CRUD, persistence, Result-based errors, and event emission.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { mkdir, rm, readFile } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { createProjectService } from './project';

const BASE_DIR = join(tmpdir(), 'workforce-project-test-' + Date.now());
let dirCounter = 0;

function freshDir() {
  return join(BASE_DIR, `run-${dirCounter++}`);
}

afterEach(async () => {
  // Clean up all test dirs after each test
});

// Clean up base dir after all tests
import { afterAll, beforeAll } from 'vitest';
beforeAll(async () => {
  await mkdir(BASE_DIR, { recursive: true });
});
afterAll(async () => {
  await rm(BASE_DIR, { recursive: true, force: true });
});

describe('ProjectService', () => {
  describe('create', () => {
    it('creates a project with a generated ID', async () => {
      const service = createProjectService(freshDir());
      const project = await service.create('org1', 'My Project', '/home/user/project');

      expect(project.id).toMatch(/^proj_/);
      expect(project.orgId).toBe('org1');
      expect(project.name).toBe('My Project');
      expect(project.rootPath).toBe('/home/user/project');
      expect(project.color).toMatch(/^#[A-Fa-f0-9]{6}$/);
      expect(project.createdAt).toBeLessThanOrEqual(Date.now());
      expect(project.updatedAt).toBe(project.createdAt);

      service.dispose();
    });

    it('uses custom color when provided', async () => {
      const service = createProjectService(freshDir());
      const project = await service.create('org1', 'Colored', '/tmp', { color: '#FF0000' });

      expect(project.color).toBe('#FF0000');

      service.dispose();
    });

    it('persists project to disk', async () => {
      const dir = freshDir();
      const service = createProjectService(dir);
      const project = await service.create('org1', 'Persisted', '/tmp/test');

      const filePath = join(dir, project.id, 'project.json');
      const raw = await readFile(filePath, 'utf-8');
      const saved = JSON.parse(raw);

      expect(saved.name).toBe('Persisted');
      expect(saved.rootPath).toBe('/tmp/test');

      service.dispose();
    });
  });

  describe('get', () => {
    it('returns project by ID', async () => {
      const service = createProjectService(freshDir());
      const created = await service.create('org1', 'Test', '/tmp');
      const found = await service.get(created.id);

      expect(found).not.toBeNull();
      expect(found!.name).toBe('Test');

      service.dispose();
    });

    it('returns null for non-existent project', async () => {
      const service = createProjectService(freshDir());
      const found = await service.get('proj_nonexistent');

      expect(found).toBeNull();

      service.dispose();
    });
  });

  describe('list', () => {
    it('lists all projects', async () => {
      const service = createProjectService(freshDir());
      await service.create('org1', 'Alpha', '/a');
      await service.create('org1', 'Beta', '/b');
      await service.create('org2', 'Gamma', '/c');

      const all = await service.list();
      expect(all).toHaveLength(3);

      service.dispose();
    });

    it('filters by orgId', async () => {
      const service = createProjectService(freshDir());
      await service.create('org1', 'Alpha', '/a');
      await service.create('org2', 'Beta', '/b');

      const org1 = await service.list('org1');
      expect(org1).toHaveLength(1);
      expect(org1[0].name).toBe('Alpha');

      service.dispose();
    });

    it('returns projects sorted by updatedAt descending', async () => {
      const service = createProjectService(freshDir());
      const first = await service.create('org1', 'First', '/a');
      await service.create('org1', 'Second', '/b');

      // Update first project to bump its updatedAt
      await service.update(first.id, { name: 'First Updated' });

      const all = await service.list('org1');
      expect(all[0].name).toBe('First Updated');

      service.dispose();
    });
  });

  describe('update', () => {
    it('updates project fields and returns ok result', async () => {
      const service = createProjectService(freshDir());
      const project = await service.create('org1', 'Original', '/tmp');
      const result = await service.update(project.id, { name: 'Updated' });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.name).toBe('Updated');
        expect(result.value.updatedAt).toBeGreaterThanOrEqual(project.updatedAt);
      }

      service.dispose();
    });

    it('preserves immutable fields (id, orgId, createdAt)', async () => {
      const service = createProjectService(freshDir());
      const project = await service.create('org1', 'Test', '/tmp');
      const result = await service.update(project.id, { name: 'Changed' });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.id).toBe(project.id);
        expect(result.value.orgId).toBe(project.orgId);
        expect(result.value.createdAt).toBe(project.createdAt);
      }

      service.dispose();
    });

    it('returns ProjectNotFound error for non-existent project', async () => {
      const service = createProjectService(freshDir());
      const result = await service.update('proj_nonexistent', { name: 'X' });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error._tag).toBe('ProjectNotFound');
        expect(result.error.projectId).toBe('proj_nonexistent');
      }

      service.dispose();
    });
  });

  describe('delete', () => {
    it('removes project from list', async () => {
      const service = createProjectService(freshDir());
      const project = await service.create('org1', 'ToDelete', '/tmp');
      await service.delete(project.id);

      const found = await service.get(project.id);
      expect(found).toBeNull();

      service.dispose();
    });

    it('is a no-op for non-existent project', async () => {
      const service = createProjectService(freshDir());
      // Should not throw
      await service.delete('proj_nonexistent');

      service.dispose();
    });
  });

  describe('init persistence', () => {
    it('reloads projects from disk on fresh service instance', async () => {
      const dir = freshDir();

      // Create and dispose first instance
      const service1 = createProjectService(dir);
      const project = await service1.create('org1', 'Persistent', '/home/user');
      service1.dispose();

      // Create second instance — should reload from disk
      const service2 = createProjectService(dir);
      const found = await service2.get(project.id);

      expect(found).not.toBeNull();
      expect(found!.name).toBe('Persistent');
      expect(found!.rootPath).toBe('/home/user');

      service2.dispose();
    });
  });
});
