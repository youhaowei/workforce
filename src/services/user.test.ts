/**
 * UserService Tests
 *
 * Tests for user identity CRUD and persistence.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdir, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { createUserService } from './user';

const TEST_DIR = join(tmpdir(), 'workforce-user-test-' + Date.now());

describe('UserService', () => {
  beforeAll(async () => {
    await mkdir(TEST_DIR, { recursive: true });
  });

  afterAll(async () => {
    await rm(TEST_DIR, { recursive: true, force: true });
  });

  describe('create', () => {
    it('should create a user with generated ID and avatar color', async () => {
      const service = createUserService(join(TEST_DIR, 'create-test.json'));
      const user = await service.create('Jane Doe');

      expect(user.id).toMatch(/^user_/);
      expect(user.displayName).toBe('Jane Doe');
      expect(user.avatarColor).toMatch(/^#[0-9A-Fa-f]{6}$/);
      expect(user.createdAt).toBeLessThanOrEqual(Date.now());

      service.dispose();
    });

    it('should throw when user already exists', async () => {
      const service = createUserService(join(TEST_DIR, 'create-dup.json'));
      await service.create('First');
      await expect(service.create('Second')).rejects.toThrow('User already exists');

      service.dispose();
    });
  });

  describe('get', () => {
    it('should return null when no user exists', async () => {
      const service = createUserService(join(TEST_DIR, 'get-null.json'));
      const user = await service.get();

      expect(user).toBeNull();

      service.dispose();
    });

    it('should return the user after creation', async () => {
      const service = createUserService(join(TEST_DIR, 'get-test.json'));
      await service.create('Alice');
      const user = await service.get();

      expect(user).not.toBeNull();
      expect(user!.displayName).toBe('Alice');

      service.dispose();
    });
  });

  describe('exists', () => {
    it('should return false when no user exists', async () => {
      const service = createUserService(join(TEST_DIR, 'exists-false.json'));
      expect(await service.exists()).toBe(false);

      service.dispose();
    });

    it('should return true after creation', async () => {
      const service = createUserService(join(TEST_DIR, 'exists-true.json'));
      await service.create('Bob');
      expect(await service.exists()).toBe(true);

      service.dispose();
    });
  });

  describe('update', () => {
    it('should update display name and recompute avatar color', async () => {
      const service = createUserService(join(TEST_DIR, 'update-test.json'));
      const original = await service.create('Charlie');

      const updated = await service.update({ displayName: 'Charles' });

      expect(updated.displayName).toBe('Charles');
      expect(updated.id).toBe(original.id);
      expect(updated.createdAt).toBe(original.createdAt);
      expect(updated.updatedAt).toBeGreaterThanOrEqual(original.updatedAt);

      service.dispose();
    });

    it('should throw when no user exists', async () => {
      const service = createUserService(join(TEST_DIR, 'update-throw.json'));
      await expect(service.update({ displayName: 'X' })).rejects.toThrow('No user exists');

      service.dispose();
    });
  });

  describe('persistence', () => {
    it('should load user from disk on new instance', async () => {
      const filePath = join(TEST_DIR, 'persist-test.json');

      const service1 = createUserService(filePath);
      await service1.create('Persisted');
      service1.dispose();

      const service2 = createUserService(filePath);
      const user = await service2.get();

      expect(user).not.toBeNull();
      expect(user!.displayName).toBe('Persisted');

      service2.dispose();
    });
  });
});
