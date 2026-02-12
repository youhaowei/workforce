/**
 * ReviewService - Human-in-the-loop review queue
 *
 * Provides:
 * - Create review items from agents (approval, clarification, review)
 * - List pending items per org
 * - Resolve items with approve/reject/edit/clarify actions
 * - Pending count for UI badge
 *
 * Persistence: ~/.workforce/orgs/{orgId}/reviews/{id}.json
 */

import { readFile, writeFile, readdir, mkdir } from 'fs/promises';
import { join } from 'path';
import type { ReviewItem, ReviewAction, ReviewService } from './types';
import { getEventBus } from '@/shared/event-bus';
import { getDataDir } from './data-dir';

// =============================================================================
// Configuration
// =============================================================================

const DEFAULT_ORGS_DIR = join(getDataDir(), 'orgs');

// =============================================================================
// Helpers
// =============================================================================

function generateId(): string {
  return `rev_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

// =============================================================================
// Service Implementation
// =============================================================================

class ReviewServiceImpl implements ReviewService {
  private cache = new Map<string, ReviewItem>();
  private orgsDir: string;

  constructor(orgsDir?: string) {
    this.orgsDir = orgsDir ?? DEFAULT_ORGS_DIR;
  }

  private reviewDir(orgId: string): string {
    return join(this.orgsDir, orgId, 'reviews');
  }

  private reviewPath(orgId: string, id: string): string {
    return join(this.reviewDir(orgId), `${id}.json`);
  }

  private cacheKey(orgId: string, id: string): string {
    return `${orgId}:${id}`;
  }

  async create(
    item: Omit<ReviewItem, 'id' | 'status' | 'createdAt' | 'updatedAt'>
  ): Promise<ReviewItem> {
    const now = Date.now();
    const reviewItem: ReviewItem = {
      ...item,
      id: generateId(),
      status: 'pending',
      createdAt: now,
      updatedAt: now,
    };

    await mkdir(this.reviewDir(item.orgId), { recursive: true });
    await writeFile(
      this.reviewPath(item.orgId, reviewItem.id),
      JSON.stringify(reviewItem, null, 2),
      'utf-8'
    );

    this.cache.set(this.cacheKey(item.orgId, reviewItem.id), reviewItem);

    getEventBus().emit({
      type: 'ReviewItemChange',
      reviewItemId: reviewItem.id,
      sessionId: reviewItem.sessionId,
      orgId: reviewItem.orgId,
      action: 'created',
      timestamp: now,
    });

    return reviewItem;
  }

  async get(id: string, orgId: string): Promise<ReviewItem | null> {
    const key = this.cacheKey(orgId, id);
    if (this.cache.has(key)) {
      return this.cache.get(key)!;
    }

    try {
      const raw = await readFile(this.reviewPath(orgId, id), 'utf-8');
      const item = JSON.parse(raw) as ReviewItem;
      this.cache.set(key, item);
      return item;
    } catch {
      return null;
    }
  }

  async listPending(orgId: string): Promise<ReviewItem[]> {
    const all = await this.loadAll(orgId);
    return all.filter((item) => item.status === 'pending');
  }

  async list(
    options?: { status?: 'pending' | 'resolved'; orgId?: string }
  ): Promise<ReviewItem[]> {
    if (!options?.orgId) {
      // Without orgId, we can only return cached items
      return Array.from(this.cache.values()).filter(
        (item) => !options?.status || item.status === options.status
      );
    }

    const all = await this.loadAll(options.orgId);
    if (options?.status) {
      return all.filter((item) => item.status === options.status);
    }
    return all;
  }

  async resolve(
    id: string,
    orgId: string,
    action: ReviewAction,
    comment?: string
  ): Promise<ReviewItem> {
    const item = await this.get(id, orgId);
    if (!item) {
      throw new Error(`Review item not found: ${id}`);
    }

    if (item.status === 'resolved') {
      throw new Error('Review item already resolved');
    }

    const now = Date.now();
    item.status = 'resolved';
    item.resolution = { action, comment, resolvedAt: now };
    item.updatedAt = now;

    await writeFile(
      this.reviewPath(orgId, id),
      JSON.stringify(item, null, 2),
      'utf-8'
    );
    this.cache.set(this.cacheKey(orgId, id), item);

    getEventBus().emit({
      type: 'ReviewItemChange',
      reviewItemId: id,
      sessionId: item.sessionId,
      orgId,
      action: 'resolved',
      timestamp: now,
    });

    return item;
  }

  async pendingCount(orgId: string): Promise<number> {
    const pending = await this.listPending(orgId);
    return pending.length;
  }

  dispose(): void {
    this.cache.clear();
  }

  // ===========================================================================
  // Private
  // ===========================================================================

  private async loadAll(orgId: string): Promise<ReviewItem[]> {
    const dir = this.reviewDir(orgId);
    try {
      const files = await readdir(dir);
      const items: ReviewItem[] = [];

      for (const file of files) {
        if (!file.endsWith('.json')) continue;
        try {
          const raw = await readFile(join(dir, file), 'utf-8');
          const item = JSON.parse(raw) as ReviewItem;
          items.push(item);
          this.cache.set(this.cacheKey(orgId, item.id), item);
        } catch {
          // Skip corrupted files
        }
      }

      return items;
    } catch {
      return [];
    }
  }
}

// =============================================================================
// Factory
// =============================================================================

export function createReviewService(orgsDir?: string): ReviewService {
  return new ReviewServiceImpl(orgsDir);
}
