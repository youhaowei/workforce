/**
 * ReviewService Tests
 *
 * Tests for review queue CRUD, resolve flow, pending count, and filtering.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdir, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { createReviewService } from './review';
import type { ReviewService } from './types';

const TEST_DIR = join(tmpdir(), 'workforce-review-test-' + Date.now());
const WS_ID = 'ws_test';

function freshService(): ReviewService {
  return createReviewService(TEST_DIR);
}

/** Build a minimal review item input */
function reviewInput(overrides: Record<string, unknown> = {}) {
  return {
    sessionId: 'sess_test',
    orgId: WS_ID,
    type: 'approval' as const,
    title: 'Review this',
    summary: 'An agent wants approval',
    context: {},
    ...overrides,
  };
}

describe('ReviewService', () => {
  beforeAll(async () => {
    await mkdir(join(TEST_DIR, WS_ID, 'reviews'), { recursive: true });
  });

  afterAll(async () => {
    await rm(TEST_DIR, { recursive: true, force: true });
  });

  describe('create', () => {
    it('should create a review item with generated ID', async () => {
      const service = freshService();
      const item = await service.create(reviewInput());

      expect(item.id).toMatch(/^rev_/);
      expect(item.status).toBe('pending');
      expect(item.title).toBe('Review this');
      expect(item.sessionId).toBe('sess_test');
      expect(item.orgId).toBe(WS_ID);
      expect(item.createdAt).toBeLessThanOrEqual(Date.now());

      service.dispose();
    });

    it('should create different types of review items', async () => {
      const service = freshService();

      const approval = await service.create(reviewInput({ type: 'approval' }));
      const clarification = await service.create(reviewInput({ type: 'clarification' }));
      const review = await service.create(reviewInput({ type: 'review' }));

      expect(approval.type).toBe('approval');
      expect(clarification.type).toBe('clarification');
      expect(review.type).toBe('review');

      service.dispose();
    });
  });

  describe('get', () => {
    it('should return review item by ID', async () => {
      const service = freshService();
      const created = await service.create(reviewInput());

      // Clear cache to test disk read
      service.dispose();
      const service2 = freshService();

      const found = await service2.get(created.id, WS_ID);
      expect(found).not.toBeNull();
      expect(found!.title).toBe('Review this');

      service2.dispose();
    });

    it('should return null for non-existent item', async () => {
      const service = freshService();
      const found = await service.get('rev_nonexistent', WS_ID);
      expect(found).toBeNull();
      service.dispose();
    });
  });

  describe('listPending', () => {
    it('should return only pending items', async () => {
      const dir = join(TEST_DIR, 'ws_pending', 'reviews');
      await mkdir(dir, { recursive: true });
      const service = createReviewService(TEST_DIR);

      const item1 = await service.create(reviewInput({ orgId: 'ws_pending', title: 'Pending 1' }));
      await service.create(reviewInput({ orgId: 'ws_pending', title: 'Pending 2' }));
      await service.resolve(item1.id, 'ws_pending', 'approve');

      const pending = await service.listPending('ws_pending');
      expect(pending).toHaveLength(1);
      expect(pending[0].title).toBe('Pending 2');

      service.dispose();
    });
  });

  describe('list', () => {
    it('should return all items for an org', async () => {
      const dir = join(TEST_DIR, 'ws_list', 'reviews');
      await mkdir(dir, { recursive: true });
      const service = createReviewService(TEST_DIR);

      await service.create(reviewInput({ orgId: 'ws_list' }));
      await service.create(reviewInput({ orgId: 'ws_list' }));
      await service.create(reviewInput({ orgId: 'ws_list' }));

      const all = await service.list({ orgId: 'ws_list' });
      expect(all).toHaveLength(3);

      service.dispose();
    });

    it('should filter by status', async () => {
      const dir = join(TEST_DIR, 'ws_filter', 'reviews');
      await mkdir(dir, { recursive: true });
      const service = createReviewService(TEST_DIR);

      const item1 = await service.create(reviewInput({ orgId: 'ws_filter' }));
      await service.create(reviewInput({ orgId: 'ws_filter' }));
      await service.resolve(item1.id, 'ws_filter', 'reject');

      const resolved = await service.list({ orgId: 'ws_filter', status: 'resolved' });
      expect(resolved).toHaveLength(1);

      const pending = await service.list({ orgId: 'ws_filter', status: 'pending' });
      expect(pending).toHaveLength(1);

      service.dispose();
    });
  });

  describe('resolve', () => {
    it('should resolve item with approve action', async () => {
      const service = freshService();
      const item = await service.create(reviewInput());
      const resolved = await service.resolve(item.id, WS_ID, 'approve', 'Looks good');

      expect(resolved.status).toBe('resolved');
      expect(resolved.resolution).toBeDefined();
      expect(resolved.resolution!.action).toBe('approve');
      expect(resolved.resolution!.comment).toBe('Looks good');
      expect(resolved.resolution!.resolvedAt).toBeLessThanOrEqual(Date.now());

      service.dispose();
    });

    it('should resolve item with reject action', async () => {
      const service = freshService();
      const item = await service.create(reviewInput());
      const resolved = await service.resolve(item.id, WS_ID, 'reject', 'Needs work');

      expect(resolved.resolution!.action).toBe('reject');
      expect(resolved.resolution!.comment).toBe('Needs work');

      service.dispose();
    });

    it('should resolve item with edit action', async () => {
      const service = freshService();
      const item = await service.create(reviewInput());
      const resolved = await service.resolve(item.id, WS_ID, 'edit', 'Apply these changes');

      expect(resolved.resolution!.action).toBe('edit');

      service.dispose();
    });

    it('should resolve item with clarify action', async () => {
      const service = freshService();
      const item = await service.create(reviewInput());
      const resolved = await service.resolve(item.id, WS_ID, 'clarify', 'Need more details');

      expect(resolved.resolution!.action).toBe('clarify');

      service.dispose();
    });

    it('should throw for non-existent item', async () => {
      const service = freshService();
      await expect(
        service.resolve('rev_fake', WS_ID, 'approve')
      ).rejects.toThrow('Review item not found');
      service.dispose();
    });

    it('should throw for already resolved item', async () => {
      const service = freshService();
      const item = await service.create(reviewInput());
      await service.resolve(item.id, WS_ID, 'approve');

      await expect(
        service.resolve(item.id, WS_ID, 'reject')
      ).rejects.toThrow('already resolved');

      service.dispose();
    });

    it('should persist resolution to disk', async () => {
      const service = freshService();
      const item = await service.create(reviewInput());
      await service.resolve(item.id, WS_ID, 'approve', 'Persisted');
      service.dispose();

      const service2 = freshService();
      const found = await service2.get(item.id, WS_ID);
      expect(found?.status).toBe('resolved');
      expect(found?.resolution?.action).toBe('approve');
      expect(found?.resolution?.comment).toBe('Persisted');

      service2.dispose();
    });
  });

  describe('pendingCount', () => {
    it('should count pending items', async () => {
      const dir = join(TEST_DIR, 'ws_count', 'reviews');
      await mkdir(dir, { recursive: true });
      const service = createReviewService(TEST_DIR);

      await service.create(reviewInput({ orgId: 'ws_count' }));
      await service.create(reviewInput({ orgId: 'ws_count' }));
      const item3 = await service.create(reviewInput({ orgId: 'ws_count' }));
      await service.resolve(item3.id, 'ws_count', 'approve');

      const count = await service.pendingCount('ws_count');
      expect(count).toBe(2);

      service.dispose();
    });

    it('should return 0 for empty org', async () => {
      const service = freshService();
      const count = await service.pendingCount('ws_empty');
      expect(count).toBe(0);
      service.dispose();
    });
  });
});
