/**
 * OrgService Tests
 *
 * Tests for org CRUD, persistence, and event emission.
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll, afterAll } from "vitest";
import { mkdir, rm, readFile } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { createOrgService } from "./org";
import { createEventBus, type EventBus } from "@/shared/event-bus";

const TEST_DIR = join(tmpdir(), "workforce-org-test-" + Date.now());

// Override global event bus for testing
let testBus: EventBus;

describe("OrgService", () => {
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

  describe("create", () => {
    it("should create an org with generated ID", async () => {
      const service = createOrgService(TEST_DIR);
      const ws = await service.create("My Project");

      expect(ws.id).toMatch(/^org_/);
      expect(ws.name).toBe("My Project");
      expect(ws.settings.allowedTools).toEqual([]);
      expect(ws.createdAt).toBeLessThanOrEqual(Date.now());

      service.dispose();
    });

    it("should persist org to disk", async () => {
      const dir = join(TEST_DIR, "persist-test");
      await mkdir(dir, { recursive: true });

      const service = createOrgService(dir);
      const ws = await service.create("Persisted");

      const filePath = join(dir, ws.id, "org.json");
      const raw = await readFile(filePath, "utf-8");
      const saved = JSON.parse(raw);

      expect(saved.name).toBe("Persisted");

      service.dispose();
    });
  });

  describe("get", () => {
    it("should return org by ID", async () => {
      const service = createOrgService(join(TEST_DIR, "get-test"));
      const created = await service.create("Test");
      const found = await service.get(created.id);

      expect(found).not.toBeNull();
      expect(found!.name).toBe("Test");

      service.dispose();
    });

    it("should return null for non-existent org", async () => {
      const service = createOrgService(join(TEST_DIR, "get-null"));
      const found = await service.get("ws_nonexistent");

      expect(found).toBeNull();

      service.dispose();
    });
  });

  describe("update", () => {
    it("should update org properties", async () => {
      const service = createOrgService(join(TEST_DIR, "update-test"));
      const ws = await service.create("Original");

      const updated = await service.update(ws.id, {
        name: "Updated",
        description: "A description",
        settings: { allowedTools: ["bash", "read"], costWarningThreshold: 5.0 },
      });

      expect(updated.name).toBe("Updated");
      expect(updated.description).toBe("A description");
      expect(updated.settings.allowedTools).toEqual(["bash", "read"]);
      expect(updated.settings.costWarningThreshold).toBe(5.0);
      expect(updated.updatedAt).toBeGreaterThanOrEqual(ws.updatedAt);
      // Immutable fields preserved
      expect(updated.id).toBe(ws.id);
      expect(updated.createdAt).toBe(ws.createdAt);

      service.dispose();
    });

    it("should throw for non-existent org", async () => {
      const service = createOrgService(join(TEST_DIR, "update-throw"));
      await expect(service.update("ws_fake", { name: "X" })).rejects.toThrow("Org not found");

      service.dispose();
    });
  });

  describe("list", () => {
    it("should return all orgs", async () => {
      const service = createOrgService(join(TEST_DIR, "list-test"));

      await service.create("First");
      await service.create("Second");
      await service.create("Third");

      const list = await service.list();
      expect(list).toHaveLength(3);
      const names = list.map((w) => w.name).sort();
      expect(names).toEqual(["First", "Second", "Third"]);

      service.dispose();
    });
  });

  describe("delete", () => {
    it("should remove org from memory and disk", async () => {
      const dir = join(TEST_DIR, "delete-test");
      const service = createOrgService(dir);
      const ws = await service.create("ToDelete");

      await service.delete(ws.id);

      const found = await service.get(ws.id);
      expect(found).toBeNull();

      const list = await service.list();
      expect(list).toHaveLength(0);

      service.dispose();
    });

    it("should clear current org if deleted", async () => {
      const service = createOrgService(join(TEST_DIR, "delete-current"));
      const ws = await service.create("Current");
      service.setCurrent(ws);

      expect(await service.getCurrent()).not.toBeNull();

      await service.delete(ws.id);

      expect(await service.getCurrent()).toBeNull();

      service.dispose();
    });
  });

  describe("current org", () => {
    it("should track current org", async () => {
      const service = createOrgService(join(TEST_DIR, "current-test"));
      const ws = await service.create("Active");

      expect(await service.getCurrent()).toBeNull();

      service.setCurrent(ws);
      expect((await service.getCurrent())?.id).toBe(ws.id);

      service.setCurrent(null);
      expect(await service.getCurrent()).toBeNull();

      service.dispose();
    });
  });

  describe("initialized migration", () => {
    it("should set initialized=true for pre-existing orgs on reload", async () => {
      const dir = join(TEST_DIR, "migration-init");

      // Create org — OrgService.create() doesn't set `initialized` (falsy)
      const service1 = createOrgService(dir);
      const org = await service1.create("Legacy");
      expect(org.initialized).toBeFalsy();
      service1.dispose();

      // Reload — migration in doInit() should set initialized=true
      const service2 = createOrgService(dir);
      const reloaded = await service2.get(org.id);

      expect(reloaded).not.toBeNull();
      expect(reloaded!.initialized).toBe(true);

      service2.dispose();
    });

    it("should persist the migration to disk", async () => {
      const dir = join(TEST_DIR, "migration-persist");

      const service1 = createOrgService(dir);
      const org = await service1.create("LegacyPersist");
      service1.dispose();

      // First reload triggers migration
      const service2 = createOrgService(dir);
      await service2.list(); // trigger init
      service2.dispose();

      // Second reload should read already-migrated data
      const service3 = createOrgService(dir);
      const reloaded = await service3.get(org.id);
      expect(reloaded!.initialized).toBe(true);

      // Verify on disk
      const raw = await readFile(join(dir, org.id, "org.json"), "utf-8");
      const saved = JSON.parse(raw);
      expect(saved.initialized).toBe(true);

      service3.dispose();
    });
  });

  describe("persistence across instances", () => {
    it("should load orgs from disk on new instance", async () => {
      const dir = join(TEST_DIR, "reload-test");

      // Create org with first instance
      const service1 = createOrgService(dir);
      const ws = await service1.create("Reloaded");
      service1.dispose();

      // Load with second instance
      const service2 = createOrgService(dir);
      const found = await service2.get(ws.id);

      expect(found).not.toBeNull();
      expect(found!.name).toBe("Reloaded");

      service2.dispose();
    });

    it("should auto-select the most recent org on cold start", async () => {
      const dir = join(TEST_DIR, "auto-select");

      const service1 = createOrgService(dir);
      await service1.create("First");
      // Ensure distinct updatedAt so sort order is deterministic
      await new Promise((r) => setTimeout(r, 5));
      const second = await service1.create("Second");
      service1.dispose();

      const service2 = createOrgService(dir);
      const current = await service2.getCurrent();

      expect(current).not.toBeNull();
      expect(current!.id).toBe(second.id);

      service2.dispose();
    });
  });
});
