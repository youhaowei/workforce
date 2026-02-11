/**
 * ReviewService - Human-in-the-loop review queue
 *
 * Provides:
 * - Create review items from agents (approval, clarification, review)
 * - List pending items per workspace
 * - Resolve items with approve/reject/edit/clarify actions
 * - Pending count for UI badge
 *
 * Persistence: ~/.workforce/workspaces/{workspaceId}/reviews/{id}.json
 */

import { readFile, writeFile, readdir, mkdir } from 'fs/promises';
import { join } from 'path';
import type { ReviewItem, ReviewAction, ReviewService } from './types';
import { getEventBus } from '@/shared/event-bus';
import { getDataDir } from './data-dir';

// =============================================================================
// Configuration
// =============================================================================

const DEFAULT_WORKSPACES_DIR = join(getDataDir(), 'workspaces');

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
  private workspacesDir: string;

  constructor(workspacesDir?: string) {
    this.workspacesDir = workspacesDir ?? DEFAULT_WORKSPACES_DIR;
  }

  private reviewDir(workspaceId: string): string {
    return join(this.workspacesDir, workspaceId, 'reviews');
  }

  private reviewPath(workspaceId: string, id: string): string {
    return join(this.reviewDir(workspaceId), `${id}.json`);
  }

  private cacheKey(workspaceId: string, id: string): string {
    return `${workspaceId}:${id}`;
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

    await mkdir(this.reviewDir(item.workspaceId), { recursive: true });
    await writeFile(
      this.reviewPath(item.workspaceId, reviewItem.id),
      JSON.stringify(reviewItem, null, 2),
      'utf-8'
    );

    this.cache.set(this.cacheKey(item.workspaceId, reviewItem.id), reviewItem);

    getEventBus().emit({
      type: 'ReviewItemChange',
      reviewItemId: reviewItem.id,
      sessionId: reviewItem.sessionId,
      workspaceId: reviewItem.workspaceId,
      action: 'created',
      timestamp: now,
    });

    return reviewItem;
  }

  async get(id: string, workspaceId: string): Promise<ReviewItem | null> {
    const key = this.cacheKey(workspaceId, id);
    if (this.cache.has(key)) {
      return this.cache.get(key)!;
    }

    try {
      const raw = await readFile(this.reviewPath(workspaceId, id), 'utf-8');
      const item = JSON.parse(raw) as ReviewItem;
      this.cache.set(key, item);
      return item;
    } catch {
      return null;
    }
  }

  async listPending(workspaceId: string): Promise<ReviewItem[]> {
    const all = await this.loadAll(workspaceId);
    return all.filter((item) => item.status === 'pending');
  }

  async list(
    options?: { status?: 'pending' | 'resolved'; workspaceId?: string }
  ): Promise<ReviewItem[]> {
    if (!options?.workspaceId) {
      // Without workspaceId, we can only return cached items
      return Array.from(this.cache.values()).filter(
        (item) => !options?.status || item.status === options.status
      );
    }

    const all = await this.loadAll(options.workspaceId);
    if (options?.status) {
      return all.filter((item) => item.status === options.status);
    }
    return all;
  }

  async resolve(
    id: string,
    workspaceId: string,
    action: ReviewAction,
    comment?: string
  ): Promise<ReviewItem> {
    const item = await this.get(id, workspaceId);
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
      this.reviewPath(workspaceId, id),
      JSON.stringify(item, null, 2),
      'utf-8'
    );
    this.cache.set(this.cacheKey(workspaceId, id), item);

    getEventBus().emit({
      type: 'ReviewItemChange',
      reviewItemId: id,
      sessionId: item.sessionId,
      workspaceId,
      action: 'resolved',
      timestamp: now,
    });

    return item;
  }

  async pendingCount(workspaceId: string): Promise<number> {
    const pending = await this.listPending(workspaceId);
    return pending.length;
  }

  dispose(): void {
    this.cache.clear();
  }

  // ===========================================================================
  // Private
  // ===========================================================================

  private async loadAll(workspaceId: string): Promise<ReviewItem[]> {
    const dir = this.reviewDir(workspaceId);
    try {
      const files = await readdir(dir);
      const items: ReviewItem[] = [];

      for (const file of files) {
        if (!file.endsWith('.json')) continue;
        try {
          const raw = await readFile(join(dir, file), 'utf-8');
          const item = JSON.parse(raw) as ReviewItem;
          items.push(item);
          this.cache.set(this.cacheKey(workspaceId, item.id), item);
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

export function createReviewService(workspacesDir?: string): ReviewService {
  return new ReviewServiceImpl(workspacesDir);
}
