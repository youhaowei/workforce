/**
 * ArtifactService Tests
 *
 * Tests for artifact CRUD, filtering, session linking, comments, and reviews.
 * Uses isolated temp directories per test to avoid shared state.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { mkdir, rm, writeFile } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { createArtifactService } from './artifact';
import type { ArtifactService, Author } from './types';

let testCounter = 0;
function nextDir() {
  return join(tmpdir(), `workforce-artifact-test-${process.pid}-${++testCounter}`);
}

function freshService(dir: string): ArtifactService {
  return createArtifactService(dir);
}

const USER_AUTHOR: Author = { type: 'user', id: 'user-1' };

async function createSampleArtifact(service: ArtifactService, overrides: Partial<Parameters<ArtifactService['create']>[0]> = {}) {
  return service.create({
    orgId: 'org-test',
    title: 'Sample Plan',
    mimeType: 'text/markdown',
    filePath: '/plans/sample.md',
    content: '# Sample Plan\n\nContent here',
    createdBy: USER_AUTHOR,
    ...overrides,
  });
}

describe('ArtifactService', () => {
  const dirs: string[] = [];

  afterEach(async () => {
    await Promise.all(dirs.map((d) => rm(d, { recursive: true, force: true })));
    dirs.length = 0;
  });

  function makeDir() {
    const dir = nextDir();
    dirs.push(dir);
    return dir;
  }

  describe('create and get', () => {
    it('should create an artifact and retrieve it by id', async () => {
      const dir = makeDir();
      await mkdir(dir, { recursive: true });
      const service = freshService(dir);
      const artifact = await createSampleArtifact(service);

      expect(artifact.id).toMatch(/^art_/);
      expect(artifact.title).toBe('Sample Plan');
      expect(artifact.mimeType).toBe('text/markdown');
      expect(artifact.status).toBe('draft');
      expect(artifact.sessionLinks).toEqual([]);
      expect(artifact.pendingComments).toEqual([]);
      expect(artifact.reviews).toEqual([]);

      const retrieved = await service.get(artifact.id);
      expect(retrieved).not.toBeNull();
      expect(retrieved!.id).toBe(artifact.id);
      expect(retrieved!.title).toBe('Sample Plan');

      service.dispose();
    });

    it('should return null for a nonexistent artifact id', async () => {
      const dir = makeDir();
      await mkdir(dir, { recursive: true });
      const service = freshService(dir);
      const result = await service.get('art_nonexistent');
      expect(result).toBeNull();
      service.dispose();
    });

    it('should set createdAt and updatedAt timestamps on creation', async () => {
      const dir = makeDir();
      await mkdir(dir, { recursive: true });
      const service = freshService(dir);
      const before = Date.now();
      const artifact = await createSampleArtifact(service);
      const after = Date.now();

      expect(artifact.createdAt).toBeGreaterThanOrEqual(before);
      expect(artifact.createdAt).toBeLessThanOrEqual(after);
      expect(artifact.updatedAt).toBe(artifact.createdAt);

      service.dispose();
    });

    it('should include sessionId in sessionLinks when provided at creation', async () => {
      const dir = makeDir();
      await mkdir(dir, { recursive: true });
      const service = freshService(dir);
      const artifact = await createSampleArtifact(service, { sessionId: 'sess-abc' });

      expect(artifact.sessionLinks).toEqual(['sess-abc']);

      service.dispose();
    });

    it('should persist artifact to disk so a new service instance can load it', async () => {
      const dir = makeDir();
      await mkdir(dir, { recursive: true });
      const serviceA = freshService(dir);
      const artifact = await createSampleArtifact(serviceA);
      serviceA.dispose();

      const serviceB = freshService(dir);
      const retrieved = await serviceB.get(artifact.id);
      expect(retrieved).not.toBeNull();
      expect(retrieved!.title).toBe('Sample Plan');

      serviceB.dispose();
    });
  });

  describe('list with filters', () => {
    it('should list all artifacts when no filter is provided', async () => {
      const dir = makeDir();
      await mkdir(dir, { recursive: true });
      const service = freshService(dir);
      await createSampleArtifact(service, { title: 'A', mimeType: 'text/markdown' });
      await createSampleArtifact(service, { title: 'B', mimeType: 'application/json' });

      const all = await service.list();
      const titles = all.map((a) => a.title);
      expect(titles).toContain('A');
      expect(titles).toContain('B');

      service.dispose();
    });

    it('should filter by mimeType', async () => {
      const dir = makeDir();
      await mkdir(dir, { recursive: true });
      const service = freshService(dir);
      await createSampleArtifact(service, { title: 'Markdown doc', mimeType: 'text/markdown' });
      await createSampleArtifact(service, { title: 'JSON doc', mimeType: 'application/json' });

      const markdownOnly = await service.list({ mimeType: 'text/markdown' });
      expect(markdownOnly.every((a) => a.mimeType === 'text/markdown')).toBe(true);
      expect(markdownOnly.some((a) => a.title === 'Markdown doc')).toBe(true);
      expect(markdownOnly.some((a) => a.title === 'JSON doc')).toBe(false);

      service.dispose();
    });

    it('should filter by status', async () => {
      const dir = makeDir();
      await mkdir(dir, { recursive: true });
      const service = freshService(dir);
      const artifact = await createSampleArtifact(service, { title: 'Draft one' });
      await service.update(artifact.id, { status: 'approved' });
      await createSampleArtifact(service, { title: 'Another draft' });

      const approved = await service.list({ status: 'approved' });
      expect(approved.every((a) => a.status === 'approved')).toBe(true);
      expect(approved.some((a) => a.title === 'Draft one')).toBe(true);
      expect(approved.some((a) => a.title === 'Another draft')).toBe(false);

      service.dispose();
    });

    it('should filter by sessionId', async () => {
      const dir = makeDir();
      await mkdir(dir, { recursive: true });
      const service = freshService(dir);
      await createSampleArtifact(service, { title: 'Linked', sessionId: 'sess-xyz' });
      await createSampleArtifact(service, { title: 'Unlinked' });

      const linked = await service.list({ sessionId: 'sess-xyz' });
      expect(linked).toHaveLength(1);
      expect(linked[0].title).toBe('Linked');

      service.dispose();
    });

    it('should filter by orgId', async () => {
      const dir = makeDir();
      await mkdir(dir, { recursive: true });
      const service = freshService(dir);
      await createSampleArtifact(service, { orgId: 'org-alpha', title: 'Alpha artifact' });
      await createSampleArtifact(service, { orgId: 'org-beta', title: 'Beta artifact' });

      const alpha = await service.list({ orgId: 'org-alpha' });
      expect(alpha).toHaveLength(1);
      expect(alpha[0].title).toBe('Alpha artifact');

      service.dispose();
    });

    it('should filter by projectId', async () => {
      const dir = makeDir();
      await mkdir(dir, { recursive: true });
      const service = freshService(dir);
      await createSampleArtifact(service, { projectId: 'proj-1', title: 'Project artifact' });
      await createSampleArtifact(service, { title: 'No project' });

      const filtered = await service.list({ projectId: 'proj-1' });
      expect(filtered).toHaveLength(1);
      expect(filtered[0].title).toBe('Project artifact');

      service.dispose();
    });

    it('should return results sorted by updatedAt descending', async () => {
      const dir = makeDir();
      await mkdir(dir, { recursive: true });
      const service = freshService(dir);
      const _first = await createSampleArtifact(service, { title: 'OlderArtifact' });
      // Ensure distinct timestamps
      await new Promise((r) => setTimeout(r, 2));
      const second = await createSampleArtifact(service, { title: 'NewerArtifact' });
      await new Promise((r) => setTimeout(r, 2));
      await service.update(second.id, { title: 'NewerArtifactUpdated' });

      const all = await service.list();
      const ownTitles = all
        .filter((a) => ['OlderArtifact', 'NewerArtifactUpdated'].includes(a.title))
        .map((a) => a.title);
      // The most recently updated artifact should appear first
      expect(ownTitles[0]).toBe('NewerArtifactUpdated');
      expect(ownTitles[1]).toBe('OlderArtifact');

      service.dispose();
    });
  });

  describe('update', () => {
    it('should update title', async () => {
      const dir = makeDir();
      await mkdir(dir, { recursive: true });
      const service = freshService(dir);
      const artifact = await createSampleArtifact(service);
      const updated = await service.update(artifact.id, { title: 'New Title' });

      expect(updated.title).toBe('New Title');
      expect((await service.get(artifact.id))!.title).toBe('New Title');

      service.dispose();
    });

    it('should update status', async () => {
      const dir = makeDir();
      await mkdir(dir, { recursive: true });
      const service = freshService(dir);
      const artifact = await createSampleArtifact(service);
      const updated = await service.update(artifact.id, { status: 'pending_review' });

      expect(updated.status).toBe('pending_review');

      service.dispose();
    });

    it('should update content', async () => {
      const dir = makeDir();
      await mkdir(dir, { recursive: true });
      const service = freshService(dir);
      const artifact = await createSampleArtifact(service);
      const updated = await service.update(artifact.id, { content: '# Updated\n\nNew body' });

      expect(updated.content).toBe('# Updated\n\nNew body');

      service.dispose();
    });

    it('should merge metadata rather than replace it entirely', async () => {
      const dir = makeDir();
      await mkdir(dir, { recursive: true });
      const service = freshService(dir);
      const artifact = await createSampleArtifact(service, {
        metadata: { priority: 'high', tags: ['alpha'] },
      });
      const updated = await service.update(artifact.id, { metadata: { version: 2 } });

      expect(updated.metadata).toMatchObject({ priority: 'high', tags: ['alpha'], version: 2 });

      service.dispose();
    });

    it('should advance updatedAt after an update', async () => {
      const dir = makeDir();
      await mkdir(dir, { recursive: true });
      const service = freshService(dir);
      const artifact = await createSampleArtifact(service);
      const before = Date.now();
      const updated = await service.update(artifact.id, { title: 'Changed' });

      expect(updated.updatedAt).toBeGreaterThanOrEqual(before);

      service.dispose();
    });

    it('should throw when updating a nonexistent artifact', async () => {
      const dir = makeDir();
      await mkdir(dir, { recursive: true });
      const service = freshService(dir);
      await expect(service.update('art_ghost', { title: 'Oops' })).rejects.toThrow('art_ghost');
      service.dispose();
    });
  });

  describe('delete', () => {
    it('should delete artifact so get() returns null afterwards', async () => {
      const dir = makeDir();
      await mkdir(dir, { recursive: true });
      const service = freshService(dir);
      const artifact = await createSampleArtifact(service);
      await service.delete(artifact.id);

      expect(await service.get(artifact.id)).toBeNull();

      service.dispose();
    });

    it('should throw when deleting a nonexistent artifact', async () => {
      const dir = makeDir();
      await mkdir(dir, { recursive: true });
      const service = freshService(dir);
      await expect(service.delete('art_ghost')).rejects.toThrow('art_ghost');
      service.dispose();
    });

    it('should remove artifact from list() after deletion', async () => {
      const dir = makeDir();
      await mkdir(dir, { recursive: true });
      const service = freshService(dir);
      const artifact = await createSampleArtifact(service, { title: 'To delete' });
      await service.delete(artifact.id);

      const all = await service.list();
      expect(all.some((a) => a.id === artifact.id)).toBe(false);

      service.dispose();
    });
  });

  describe('linkToSession', () => {
    it('should add sessionId to sessionLinks', async () => {
      const dir = makeDir();
      await mkdir(dir, { recursive: true });
      const service = freshService(dir);
      const artifact = await createSampleArtifact(service);
      await service.linkToSession(artifact.id, 'sess-linked');

      const updated = await service.get(artifact.id);
      expect(updated!.sessionLinks).toContain('sess-linked');

      service.dispose();
    });

    it('should not duplicate sessionId when linked twice', async () => {
      const dir = makeDir();
      await mkdir(dir, { recursive: true });
      const service = freshService(dir);
      const artifact = await createSampleArtifact(service);
      await service.linkToSession(artifact.id, 'sess-dup');
      await service.linkToSession(artifact.id, 'sess-dup');

      const updated = await service.get(artifact.id);
      expect(updated!.sessionLinks.filter((s) => s === 'sess-dup')).toHaveLength(1);

      service.dispose();
    });

    it('should throw when linking to a nonexistent artifact', async () => {
      const dir = makeDir();
      await mkdir(dir, { recursive: true });
      const service = freshService(dir);
      await expect(service.linkToSession('art_ghost', 'sess-1')).rejects.toThrow('art_ghost');
      service.dispose();
    });
  });

  describe('addComment', () => {
    it('should add comment to pendingComments', async () => {
      const dir = makeDir();
      await mkdir(dir, { recursive: true });
      const service = freshService(dir);
      const artifact = await createSampleArtifact(service);
      const comment = await service.addComment(artifact.id, {
        artifactId: artifact.id,
        content: 'Looks good',
        severity: 'praise',
        author: USER_AUTHOR,
      });

      expect(comment.id).toMatch(/^cmt_/);
      expect(comment.content).toBe('Looks good');

      const updated = await service.get(artifact.id);
      expect(updated!.pendingComments).toHaveLength(1);
      expect(updated!.pendingComments[0].id).toBe(comment.id);

      service.dispose();
    });

    it('should accumulate multiple pending comments', async () => {
      const dir = makeDir();
      await mkdir(dir, { recursive: true });
      const service = freshService(dir);
      const artifact = await createSampleArtifact(service);
      await service.addComment(artifact.id, {
        artifactId: artifact.id,
        content: 'First comment',
        severity: 'suggestion',
        author: USER_AUTHOR,
      });
      await service.addComment(artifact.id, {
        artifactId: artifact.id,
        content: 'Second comment',
        severity: 'issue',
        author: USER_AUTHOR,
      });

      const updated = await service.get(artifact.id);
      expect(updated!.pendingComments).toHaveLength(2);

      service.dispose();
    });

    it('should throw when adding comment to nonexistent artifact', async () => {
      const dir = makeDir();
      await mkdir(dir, { recursive: true });
      const service = freshService(dir);
      await expect(
        service.addComment('art_ghost', {
          artifactId: 'art_ghost',
          content: 'Note',
          severity: 'suggestion',
          author: USER_AUTHOR,
        })
      ).rejects.toThrow('art_ghost');
      service.dispose();
    });
  });

  describe('submitReview', () => {
    it('should create a review, merge pendingComments, and clear pendingComments', async () => {
      const dir = makeDir();
      await mkdir(dir, { recursive: true });
      const service = freshService(dir);
      const artifact = await createSampleArtifact(service);

      // Add a pending comment before submitting the review
      await service.addComment(artifact.id, {
        artifactId: artifact.id,
        content: 'Check this section',
        severity: 'issue',
        author: USER_AUTHOR,
      });

      const review = await service.submitReview(artifact.id, {
        artifactId: artifact.id,
        action: 'approve',
        comments: [],
        summary: 'LGTM',
        author: USER_AUTHOR,
      });

      expect(review.id).toMatch(/^rev_/);
      expect(review.action).toBe('approve');
      expect(review.summary).toBe('LGTM');
      // The pending comment should be merged into the review
      expect(review.comments).toHaveLength(1);
      expect(review.comments[0].content).toBe('Check this section');

      const updated = await service.get(artifact.id);
      // Pending comments must be cleared after submit
      expect(updated!.pendingComments).toHaveLength(0);
      expect(updated!.reviews).toHaveLength(1);

      service.dispose();
    });

    it('should set status to approved when action is approve', async () => {
      const dir = makeDir();
      await mkdir(dir, { recursive: true });
      const service = freshService(dir);
      const artifact = await createSampleArtifact(service);
      await service.submitReview(artifact.id, {
        artifactId: artifact.id,
        action: 'approve',
        comments: [],
        author: USER_AUTHOR,
      });

      const updated = await service.get(artifact.id);
      expect(updated!.status).toBe('approved');

      service.dispose();
    });

    it('should set status to rejected when action is reject', async () => {
      const dir = makeDir();
      await mkdir(dir, { recursive: true });
      const service = freshService(dir);
      const artifact = await createSampleArtifact(service);
      await service.submitReview(artifact.id, {
        artifactId: artifact.id,
        action: 'reject',
        comments: [],
        author: USER_AUTHOR,
      });

      const updated = await service.get(artifact.id);
      expect(updated!.status).toBe('rejected');

      service.dispose();
    });

    it('should preserve current status for non-approve/reject actions', async () => {
      const dir = makeDir();
      await mkdir(dir, { recursive: true });
      const service = freshService(dir);
      const artifact = await createSampleArtifact(service);
      await service.submitReview(artifact.id, {
        artifactId: artifact.id,
        action: 'clarify',
        comments: [],
        author: USER_AUTHOR,
      });

      const updated = await service.get(artifact.id);
      expect(updated!.status).toBe('draft');

      service.dispose();
    });

    it('should merge review-provided comments with pending comments', async () => {
      const dir = makeDir();
      await mkdir(dir, { recursive: true });
      const service = freshService(dir);
      const artifact = await createSampleArtifact(service);

      await service.addComment(artifact.id, {
        artifactId: artifact.id,
        content: 'Pending comment',
        severity: 'suggestion',
        author: USER_AUTHOR,
      });

      const review = await service.submitReview(artifact.id, {
        artifactId: artifact.id,
        action: 'edit',
        comments: [
          {
            id: `cmt_inline`,
            artifactId: artifact.id,
            content: 'Inline review comment',
            severity: 'issue',
            author: USER_AUTHOR,
            createdAt: Date.now(),
          },
        ],
        author: USER_AUTHOR,
      });

      expect(review.comments).toHaveLength(2);
      const contents = review.comments.map((c) => c.content);
      expect(contents).toContain('Pending comment');
      expect(contents).toContain('Inline review comment');

      service.dispose();
    });
  });

  describe('orgId backfill from session JSONL', () => {
    // These tests use a <root>/artifacts + <root>/sessions layout to match
    // the real data dir structure (backfill reads from ../sessions/).

    function makeDataRoot() {
      const root = join(tmpdir(), `workforce-artifact-backfill-${process.pid}-${++testCounter}`);
      dirs.push(root);
      return root;
    }

    it('should resolve orgId from linked session header on init', async () => {
      const root = makeDataRoot();
      const artifactsDir = join(root, 'artifacts');
      const sessionsDir = join(root, 'sessions');
      await mkdir(artifactsDir, { recursive: true });
      await mkdir(sessionsDir, { recursive: true });

      const artifact = {
        id: 'art_backfill_test',
        title: 'Needs OrgId',
        mimeType: 'text/markdown',
        filePath: '/plans/backfill.md',
        content: '# Backfill',
        status: 'draft',
        createdBy: USER_AUTHOR,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        sessionLinks: ['sess_with_org'],
        pendingComments: [],
        reviews: [],
        metadata: {},
      };
      await writeFile(join(artifactsDir, 'art_backfill_test.json'), JSON.stringify(artifact, null, 2), 'utf-8');

      const header = { t: 'header', v: '0.3.0', seq: 0, ts: 1, id: 'sess_with_org', createdAt: 1, metadata: { orgId: 'org-resolved' } };
      await writeFile(join(sessionsDir, 'sess_with_org.jsonl'), JSON.stringify(header) + '\n', 'utf-8');

      const service = freshService(artifactsDir);
      await service.ensureInitialized();

      const retrieved = await service.get('art_backfill_test');
      expect(retrieved).not.toBeNull();
      expect(retrieved!.orgId).toBe('org-resolved');

      service.dispose();
    });

    it('should handle single-line JSONL without trailing newline', async () => {
      const root = makeDataRoot();
      const artifactsDir = join(root, 'artifacts');
      const sessionsDir = join(root, 'sessions');
      await mkdir(artifactsDir, { recursive: true });
      await mkdir(sessionsDir, { recursive: true });

      const artifact = {
        id: 'art_noeol',
        title: 'No EOL',
        mimeType: 'text/markdown',
        filePath: '/plans/noeol.md',
        status: 'draft',
        createdBy: USER_AUTHOR,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        sessionLinks: ['sess_noeol'],
        pendingComments: [],
        reviews: [],
        metadata: {},
      };
      await writeFile(join(artifactsDir, 'art_noeol.json'), JSON.stringify(artifact, null, 2), 'utf-8');

      const header = { t: 'header', v: '0.3.0', seq: 0, ts: 1, id: 'sess_noeol', createdAt: 1, metadata: { orgId: 'org-noeol' } };
      await writeFile(join(sessionsDir, 'sess_noeol.jsonl'), JSON.stringify(header), 'utf-8');

      const service = freshService(artifactsDir);
      await service.ensureInitialized();

      const retrieved = await service.get('art_noeol');
      expect(retrieved!.orgId).toBe('org-noeol');

      service.dispose();
    });

    it('should leave orgId as empty string when no session has orgId', async () => {
      const root = makeDataRoot();
      const artifactsDir = join(root, 'artifacts');
      await mkdir(artifactsDir, { recursive: true });

      const artifact = {
        id: 'art_noresolve',
        title: 'No Resolve',
        mimeType: 'text/markdown',
        filePath: '/plans/noresolve.md',
        status: 'draft',
        createdBy: USER_AUTHOR,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        sessionLinks: ['sess_nope'],
        pendingComments: [],
        reviews: [],
        metadata: {},
      };
      await writeFile(join(artifactsDir, 'art_noresolve.json'), JSON.stringify(artifact, null, 2), 'utf-8');

      const service = freshService(artifactsDir);
      await service.ensureInitialized();

      const retrieved = await service.get('art_noresolve');
      expect(retrieved!.orgId).toBe('');

      service.dispose();
    });
  });

  describe('corrupt JSON recovery', () => {
    it('should skip corrupt JSON files during init and still load valid artifacts', async () => {
      const dir = makeDir();
      await mkdir(dir, { recursive: true });

      // Write a corrupt JSON file directly into the artifacts directory
      const corruptPath = join(dir, 'art_corrupt_file.json');
      await writeFile(corruptPath, '{ this is not valid json !!!', 'utf-8');

      // Write a valid artifact JSON alongside the corrupt one
      const validArtifact = {
        id: 'art_valid_recovery',
        title: 'Valid After Corrupt',
        mimeType: 'text/markdown',
        filePath: '/plans/valid.md',
        content: '# Valid',
        status: 'draft',
        createdBy: USER_AUTHOR,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        sessionLinks: [],
        pendingComments: [],
        reviews: [],
        metadata: {},
      };
      await writeFile(
        join(dir, 'art_valid_recovery.json'),
        JSON.stringify(validArtifact, null, 2),
        'utf-8'
      );

      // A fresh service should initialize without throwing despite the corrupt file
      const service = freshService(dir);
      await expect(service.ensureInitialized()).resolves.not.toThrow();

      // The valid artifact should be present
      const retrieved = await service.get('art_valid_recovery');
      expect(retrieved).not.toBeNull();
      expect(retrieved!.title).toBe('Valid After Corrupt');

      // The corrupt entry should not appear in the list
      const all = await service.list();
      expect(all.some((a) => a.id === 'art_corrupt_file')).toBe(false);

      service.dispose();
    });
  });
});
