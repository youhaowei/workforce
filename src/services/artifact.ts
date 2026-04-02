/**
 * ArtifactService — Workspace-level artifact persistence.
 *
 * Each artifact is stored as a JSON file under ~/.workforce/data/artifacts/<id>.json.
 * Artifacts are independent of sessions — they can be linked to multiple sessions.
 * The artifact's content lives on disk at filePath; this service manages metadata.
 */

import { readdir, mkdir, readFile, writeFile, unlink } from "fs/promises";
import { join } from "path";
import type {
  ArtifactService,
  Artifact,
  ArtifactMimeType,
  ArtifactFilter,
  ArtifactPatch,
  ArtifactComment,
  ArtifactReview,
  Author,
} from "./types";
import { getDataDir } from "./data-dir";
import { createLogger } from "tracey";

const log = createLogger("Artifact");

function generateArtifactId() {
  return `art_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

class ArtifactServiceImpl implements ArtifactService {
  private artifacts = new Map<string, Artifact>();
  private artifactsDir: string;
  private initialized = false;
  private initPromise: Promise<void> | null = null;
  private writeLocks = new Map<string, Promise<void>>();

  constructor(artifactsDir?: string) {
    this.artifactsDir = artifactsDir ?? join(getDataDir(), "artifacts");
  }

  async ensureInitialized() {
    if (this.initialized) return;
    this.initPromise ??= this.doInit();
    return this.initPromise;
  }

  private validateId(id: string) {
    if (!/^art_[a-z0-9_]+$/.test(id)) throw new Error(`Invalid artifact ID: ${id}`);
  }

  private async doInit() {
    await mkdir(this.artifactsDir, { recursive: true });
    const entries = await readdir(this.artifactsDir);
    const jsonFiles = entries.filter((f) => f.endsWith(".json"));
    const needsOrgId: Artifact[] = [];

    for (const file of jsonFiles) {
      try {
        const raw = await readFile(join(this.artifactsDir, file), "utf-8");
        const artifact = JSON.parse(raw) as Artifact;
        if (!/^art_[a-z0-9_]+$/.test(artifact.id)) {
          log.warn({ file, artifactId: artifact.id }, "Skipping artifact with invalid ID");
          continue;
        }
        if (!artifact.orgId) {
          (artifact as unknown as Record<string, unknown>).orgId = "";
          needsOrgId.push(artifact);
        }
        this.artifacts.set(artifact.id, artifact);
      } catch (err) {
        log.warn({ file, err }, `Failed to load artifact: ${file}`);
      }
    }

    // Auto-backfill orgId from linked session JSONL headers
    if (needsOrgId.length > 0) {
      // Derive sessions dir from the same data root as artifacts dir.
      // artifactsDir is <dataDir>/artifacts, so sessions is <dataDir>/sessions.
      const sessionsDir = join(this.artifactsDir, "..", "sessions");
      for (const artifact of needsOrgId) {
        const orgId = await this.resolveOrgIdFromSessions(sessionsDir, artifact.sessionLinks);
        if (orgId) {
          artifact.orgId = orgId;
          await this.persist(artifact);
          log.info({ artifactId: artifact.id, orgId }, "Backfilled orgId from linked session");
        } else {
          log.warn(
            { artifactId: artifact.id },
            "Could not resolve orgId — no linked sessions with orgId",
          );
        }
      }
    }

    log.info({ count: this.artifacts.size }, `Loaded ${this.artifacts.size} artifacts`);
    this.initialized = true;
  }

  /** Read the JSONL header of linked sessions to find an orgId. */
  private async resolveOrgIdFromSessions(sessionsDir: string, sessionLinks: string[]) {
    for (const sessionId of sessionLinks) {
      try {
        const raw = await readFile(join(sessionsDir, `${sessionId}.jsonl`), "utf-8");
        const nlIdx = raw.indexOf("\n");
        const firstLine = nlIdx === -1 ? raw : raw.slice(0, nlIdx);
        const header = JSON.parse(firstLine);
        const orgId = header.metadata?.orgId ?? header.orgId;
        if (orgId) return orgId as string;
      } catch {
        // Session file may not exist or be corrupt — try next
      }
    }
    return null;
  }

  private async persist(artifact: Artifact) {
    this.validateId(artifact.id);
    const id = artifact.id;
    const prev = this.writeLocks.get(id) ?? Promise.resolve();
    const next = prev.then(async () => {
      const filePath = join(this.artifactsDir, `${id}.json`);
      await writeFile(filePath, JSON.stringify(artifact, null, 2), "utf-8");
    });
    const locked = next
      .catch((err) => {
        log.error({ artifactId: id, err }, "Failed to persist artifact");
      })
      .finally(() => {
        if (this.writeLocks.get(id) === locked) this.writeLocks.delete(id);
      });
    this.writeLocks.set(id, locked);
    await next;
  }

  async create(input: {
    orgId: string;
    projectId?: string;
    title: string;
    mimeType: ArtifactMimeType;
    filePath: string;
    content?: string;
    status?: Artifact["status"];
    createdBy: Author;
    sessionId?: string;
    metadata?: Record<string, unknown>;
  }) {
    await this.ensureInitialized();
    const now = Date.now();
    const artifact: Artifact = {
      id: generateArtifactId(),
      orgId: input.orgId,
      projectId: input.projectId,
      title: input.title,
      mimeType: input.mimeType,
      filePath: input.filePath,
      content: input.content,
      status: input.status ?? "draft",
      createdBy: input.createdBy,
      createdAt: now,
      updatedAt: now,
      sessionLinks: input.sessionId ? [input.sessionId] : [],
      pendingComments: [],
      reviews: [],
      metadata: input.metadata ?? {},
    };

    this.artifacts.set(artifact.id, artifact);
    await this.persist(artifact);
    log.info({ artifactId: artifact.id, title: artifact.title }, "Created artifact");
    return artifact;
  }

  async get(artifactId: string) {
    await this.ensureInitialized();
    return this.artifacts.get(artifactId) ?? null;
  }

  async list(filter?: ArtifactFilter) {
    await this.ensureInitialized();
    let results = [...this.artifacts.values()];
    if (filter?.orgId) results = results.filter((a) => a.orgId === filter.orgId);
    if (filter?.projectId) results = results.filter((a) => a.projectId === filter.projectId);
    if (filter?.mimeType) results = results.filter((a) => a.mimeType === filter.mimeType);
    if (filter?.status) results = results.filter((a) => a.status === filter.status);
    if (filter?.sessionId)
      results = results.filter((a) => a.sessionLinks.includes(filter.sessionId!));
    return results.sort((a, b) => b.updatedAt - a.updatedAt);
  }

  async update(artifactId: string, patch: ArtifactPatch) {
    await this.ensureInitialized();
    const artifact = this.artifacts.get(artifactId);
    if (!artifact) throw new Error(`Artifact not found: ${artifactId}`);
    const updated = {
      ...artifact,
      sessionLinks: [...artifact.sessionLinks],
      pendingComments: [...artifact.pendingComments],
      reviews: [...artifact.reviews],
      metadata: { ...artifact.metadata },
    };
    if (patch.title !== undefined) updated.title = patch.title;
    if (patch.status !== undefined) updated.status = patch.status;
    if (patch.content !== undefined) updated.content = patch.content;
    if (patch.metadata !== undefined)
      updated.metadata = { ...artifact.metadata, ...patch.metadata };
    updated.updatedAt = Date.now();
    this.artifacts.set(artifactId, updated);
    await this.persist(updated);
    return updated;
  }

  async delete(artifactId: string) {
    this.validateId(artifactId);
    await this.ensureInitialized();
    if (!this.artifacts.has(artifactId)) throw new Error(`Artifact not found: ${artifactId}`);
    this.artifacts.delete(artifactId);
    try {
      await unlink(join(this.artifactsDir, `${artifactId}.json`));
    } catch {
      /* ok */
    }
    log.info({ artifactId }, "Deleted artifact");
  }

  async linkToSession(artifactId: string, sessionId: string) {
    await this.ensureInitialized();
    const artifact = this.artifacts.get(artifactId);
    if (!artifact) throw new Error(`Artifact not found: ${artifactId}`);
    if (!artifact.sessionLinks.includes(sessionId)) {
      const updated = {
        ...artifact,
        sessionLinks: [...artifact.sessionLinks, sessionId],
        updatedAt: Date.now(),
      };
      this.artifacts.set(artifactId, updated);
      await this.persist(updated);
    }
  }

  async addComment(artifactId: string, input: Omit<ArtifactComment, "id" | "createdAt">) {
    await this.ensureInitialized();
    const artifact = this.artifacts.get(artifactId);
    if (!artifact) throw new Error(`Artifact not found: ${artifactId}`);
    const comment: ArtifactComment = {
      ...input,
      id: `cmt_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
      createdAt: Date.now(),
    };
    const updated = {
      ...artifact,
      pendingComments: [...artifact.pendingComments, comment],
      updatedAt: Date.now(),
    };
    this.artifacts.set(artifactId, updated);
    await this.persist(updated);
    return comment;
  }

  async submitReview(artifactId: string, input: Omit<ArtifactReview, "id" | "createdAt">) {
    await this.ensureInitialized();
    const artifact = this.artifacts.get(artifactId);
    if (!artifact) throw new Error(`Artifact not found: ${artifactId}`);
    // Merge pending comments + input comments, assigning IDs to any without one
    const mergedComments = [...artifact.pendingComments, ...input.comments].map((cmt) =>
      cmt.id === ""
        ? {
            ...cmt,
            id: `cmt_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`,
            createdAt: Date.now(),
          }
        : cmt,
    );
    const review: ArtifactReview = {
      ...input,
      id: `rev_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
      createdAt: Date.now(),
      comments: mergedComments,
    };
    // Update status based on review action
    let newStatus = artifact.status;
    if (input.action === "approve") newStatus = "approved";
    else if (input.action === "reject") newStatus = "rejected";
    const updated = {
      ...artifact,
      reviews: [...artifact.reviews, review],
      pendingComments: [],
      status: newStatus,
      updatedAt: Date.now(),
    };
    this.artifacts.set(artifactId, updated);
    await this.persist(updated);
    return review;
  }

  dispose() {
    this.artifacts.clear();
    this.writeLocks.clear();
    this.initialized = false;
    this.initPromise = null;
  }
}

// Singleton
let _instance: ArtifactServiceImpl | null = null;
export function getArtifactService(): ArtifactService {
  _instance ??= new ArtifactServiceImpl();
  return _instance;
}
export function resetArtifactService() {
  if (_instance) {
    _instance.dispose();
    _instance = null;
  }
}
export function createArtifactService(dir: string): ArtifactService {
  return new ArtifactServiceImpl(dir);
}
