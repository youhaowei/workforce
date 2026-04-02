/**
 * OrgService - Org management and persistence
 *
 * Provides:
 * - Org CRUD with disk persistence
 * - Current org tracking
 * - Settings management (allowed tools, cost caps)
 *
 * Persistence: ~/.workforce/orgs/{id}/org.json
 */

import { readFile, writeFile, readdir, mkdir, rm } from "fs/promises";
import { join } from "path";
import type { Org, OrgSettings, OrgService } from "./types";
import { getEventBus } from "@/shared/event-bus";
import { getLogService } from "./log";
import { getDataDir } from "./data-dir";

// =============================================================================
// Configuration
// =============================================================================

const ORGS_DIR = join(getDataDir(), "orgs");

// =============================================================================
// Helpers
// =============================================================================

function generateId(): string {
  return `org_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function defaultSettings(): OrgSettings {
  return {
    allowedTools: [],
  };
}

// =============================================================================
// Service Implementation
// =============================================================================

class OrgServiceImpl implements OrgService {
  private orgs = new Map<string, Org>();
  private currentOrg: Org | null = null;
  private orgsDir: string;
  private initialized = false;
  private initPromise: Promise<void> | null = null;

  constructor(orgsDir?: string) {
    this.orgsDir = orgsDir ?? ORGS_DIR;
  }

  private ensureInitialized(): Promise<void> {
    if (this.initialized) return Promise.resolve();
    return (this.initPromise ??= this.doInit());
  }

  private async doInit(): Promise<void> {
    try {
      await mkdir(this.orgsDir, { recursive: true });

      const entries = await readdir(this.orgsDir, { withFileTypes: true });
      const dirs = entries.filter((e) => e.isDirectory());

      for (const dir of dirs) {
        const filePath = join(this.orgsDir, dir.name, "org.json");
        try {
          const raw = await readFile(filePath, "utf-8");
          const org = JSON.parse(raw) as Org;

          // Migration: orgs created before SetupGate lack `initialized`.
          // Treat them as already initialized so returning users skip InitOrgStep.
          if (org.initialized === undefined) {
            org.initialized = true;
            await this.saveOrg(org);
          }

          this.orgs.set(org.id, org);
        } catch (innerErr) {
          getLogService().warn("general", `Skipping unreadable org file: ${filePath}`, {
            error: String(innerErr),
          });
        }
      }
    } catch (err) {
      const error = err as NodeJS.ErrnoException;
      if (error.code !== "ENOENT") {
        getLogService().error("general", "Failed to initialize orgs", { error: String(error) });
      }
    }

    // Auto-select the most recently updated org so getCurrent() isn't null after restart
    if (!this.currentOrg && this.orgs.size > 0) {
      const sorted = Array.from(this.orgs.values()).sort((a, b) => b.updatedAt - a.updatedAt);
      this.currentOrg = sorted[0];
    }

    this.initialized = true;
  }

  private async saveOrg(org: Org): Promise<void> {
    const dir = join(this.orgsDir, org.id);
    await mkdir(dir, { recursive: true });
    const filePath = join(dir, "org.json");
    await writeFile(filePath, JSON.stringify(org, null, 2), "utf-8");
  }

  async create(name: string): Promise<Org> {
    await this.ensureInitialized();

    const now = Date.now();
    const org: Org = {
      id: generateId(),
      name,
      createdAt: now,
      updatedAt: now,
      settings: defaultSettings(),
    };

    this.orgs.set(org.id, org);
    await this.saveOrg(org);

    getEventBus().emit({
      type: "OrgChange",
      orgId: org.id,
      action: "created",
      timestamp: now,
    });

    return org;
  }

  async get(id: string): Promise<Org | null> {
    await this.ensureInitialized();
    return this.orgs.get(id) ?? null;
  }

  async update(id: string, updates: Partial<Omit<Org, "id" | "createdAt">>): Promise<Org> {
    await this.ensureInitialized();

    const org = this.orgs.get(id);
    if (!org) {
      throw new Error(`Org not found: ${id}`);
    }

    const updated: Org = {
      ...org,
      ...updates,
      id: org.id,
      createdAt: org.createdAt,
      updatedAt: Date.now(),
    };

    this.orgs.set(id, updated);
    if (this.currentOrg?.id === id) {
      this.currentOrg = updated;
    }
    await this.saveOrg(updated);

    getEventBus().emit({
      type: "OrgChange",
      orgId: id,
      action: "updated",
      timestamp: updated.updatedAt,
    });

    return updated;
  }

  async list(): Promise<Org[]> {
    await this.ensureInitialized();
    return Array.from(this.orgs.values()).sort((a, b) => b.updatedAt - a.updatedAt);
  }

  async delete(id: string): Promise<void> {
    await this.ensureInitialized();

    const org = this.orgs.get(id);
    if (!org) return;

    this.orgs.delete(id);

    if (this.currentOrg?.id === id) {
      this.currentOrg = null;
    }

    try {
      await rm(join(this.orgsDir, id), { recursive: true, force: true });
    } catch {
      // Ignore file deletion errors
    }

    getEventBus().emit({
      type: "OrgChange",
      orgId: id,
      action: "deleted",
      timestamp: Date.now(),
    });
  }

  async getCurrent(): Promise<Org | null> {
    await this.ensureInitialized();
    return this.currentOrg;
  }

  setCurrent(org: Org | null): void {
    this.currentOrg = org;

    if (org) {
      getEventBus().emit({
        type: "OrgChange",
        orgId: org.id,
        action: "switched",
        timestamp: Date.now(),
      });
    }
  }

  dispose(): void {
    this.orgs.clear();
    this.currentOrg = null;
    this.initialized = false;
    this.initPromise = null;
  }
}

// =============================================================================
// Singleton Management
// =============================================================================

let _instance: OrgServiceImpl | null = null;

export function getOrgService(): OrgService {
  return (_instance ??= new OrgServiceImpl());
}

export function resetOrgService(): void {
  if (_instance) {
    _instance.dispose();
    _instance = null;
  }
}

/**
 * Create an org service with a custom directory.
 * Useful for testing.
 */
export function createOrgService(orgsDir: string): OrgService {
  return new OrgServiceImpl(orgsDir);
}
