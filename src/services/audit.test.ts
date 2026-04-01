/**
 * AuditService Tests
 *
 * Tests for append-only JSONL audit trail: record, query by session,
 * query by org with filtering/pagination, and JSONL append behavior.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdir, rm, readFile } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { createAuditService } from "./audit";
import type { AuditService, AuditEntry } from "./types";

const TEST_DIR = join(tmpdir(), "workforce-audit-test-" + Date.now());
const WS_ID = "ws_audit";

function freshService(): AuditService {
  return createAuditService(TEST_DIR);
}

/** Build a minimal audit entry input */
function auditInput(overrides: Record<string, unknown> = {}) {
  return {
    sessionId: "sess_test",
    orgId: WS_ID,
    type: "state_change" as const,
    description: "Session transitioned to active",
    data: { from: "created", to: "active" },
    ...overrides,
  };
}

describe("AuditService", () => {
  beforeAll(async () => {
    await mkdir(join(TEST_DIR, WS_ID), { recursive: true });
  });

  afterAll(async () => {
    await rm(TEST_DIR, { recursive: true, force: true });
  });

  describe("record", () => {
    it("should record an audit entry with generated ID and timestamp", async () => {
      const service = freshService();
      const entry = await service.record(auditInput());

      expect(entry.id).toMatch(/^aud_/);
      expect(entry.timestamp).toBeLessThanOrEqual(Date.now());
      expect(entry.sessionId).toBe("sess_test");
      expect(entry.type).toBe("state_change");
      expect(entry.description).toBe("Session transitioned to active");
      expect(entry.data).toEqual({ from: "created", to: "active" });

      service.dispose();
    });

    it("should append to JSONL file", async () => {
      const wsId = "ws_jsonl";
      await mkdir(join(TEST_DIR, wsId), { recursive: true });
      const service = freshService();

      await service.record(auditInput({ orgId: wsId, description: "Entry 1" }));
      await service.record(auditInput({ orgId: wsId, description: "Entry 2" }));
      await service.record(auditInput({ orgId: wsId, description: "Entry 3" }));

      // Read raw JSONL and verify format
      const raw = await readFile(join(TEST_DIR, wsId, "audit.jsonl"), "utf-8");
      const lines = raw.trim().split("\n");
      expect(lines).toHaveLength(3);

      // Each line should be valid JSON
      for (const line of lines) {
        const parsed = JSON.parse(line) as AuditEntry;
        expect(parsed.id).toMatch(/^aud_/);
      }

      service.dispose();
    });

    it("should record different audit types", async () => {
      const wsId = "ws_types";
      await mkdir(join(TEST_DIR, wsId), { recursive: true });
      const service = freshService();

      const stateChange = await service.record(auditInput({ orgId: wsId, type: "state_change" }));
      const toolUse = await service.record(auditInput({ orgId: wsId, type: "tool_use" }));
      const reviewDec = await service.record(auditInput({ orgId: wsId, type: "review_decision" }));
      const spawn = await service.record(auditInput({ orgId: wsId, type: "agent_spawn" }));
      const worktree = await service.record(auditInput({ orgId: wsId, type: "worktree_action" }));

      expect(stateChange.type).toBe("state_change");
      expect(toolUse.type).toBe("tool_use");
      expect(reviewDec.type).toBe("review_decision");
      expect(spawn.type).toBe("agent_spawn");
      expect(worktree.type).toBe("worktree_action");

      service.dispose();
    });
  });

  describe("getForSession", () => {
    it("should return entries for a specific session", async () => {
      const wsId = "ws_sess";
      await mkdir(join(TEST_DIR, wsId), { recursive: true });
      const service = freshService();

      await service.record(auditInput({ orgId: wsId, sessionId: "sess_A", description: "A1" }));
      await service.record(auditInput({ orgId: wsId, sessionId: "sess_B", description: "B1" }));
      await service.record(auditInput({ orgId: wsId, sessionId: "sess_A", description: "A2" }));

      const entriesA = await service.getForSession("sess_A", wsId);
      expect(entriesA).toHaveLength(2);
      expect(entriesA.map((e) => e.description)).toEqual(["A1", "A2"]);

      const entriesB = await service.getForSession("sess_B", wsId);
      expect(entriesB).toHaveLength(1);

      service.dispose();
    });

    it("should return empty array for non-existent session", async () => {
      const service = freshService();
      const entries = await service.getForSession("sess_nonexistent", "ws_empty");
      expect(entries).toEqual([]);
      service.dispose();
    });
  });

  describe("getForOrg", () => {
    it("should return all entries sorted newest first", async () => {
      const wsId = "ws_all";
      await mkdir(join(TEST_DIR, wsId), { recursive: true });
      const service = freshService();

      await service.record(auditInput({ orgId: wsId, description: "First" }));
      // Small delay to ensure different timestamps
      await new Promise((r) => setTimeout(r, 10));
      await service.record(auditInput({ orgId: wsId, description: "Second" }));
      await new Promise((r) => setTimeout(r, 10));
      await service.record(auditInput({ orgId: wsId, description: "Third" }));

      const entries = await service.getForOrg(wsId);
      expect(entries).toHaveLength(3);
      expect(entries[0].description).toBe("Third");
      expect(entries[2].description).toBe("First");

      service.dispose();
    });

    it("should filter by type", async () => {
      const wsId = "ws_filter";
      await mkdir(join(TEST_DIR, wsId), { recursive: true });
      const service = freshService();

      await service.record(auditInput({ orgId: wsId, type: "state_change" }));
      await service.record(auditInput({ orgId: wsId, type: "tool_use" }));
      await service.record(auditInput({ orgId: wsId, type: "state_change" }));

      const stateChanges = await service.getForOrg(wsId, { type: "state_change" });
      expect(stateChanges).toHaveLength(2);

      const toolUses = await service.getForOrg(wsId, { type: "tool_use" });
      expect(toolUses).toHaveLength(1);

      service.dispose();
    });

    it("should support limit", async () => {
      const wsId = "ws_limit";
      await mkdir(join(TEST_DIR, wsId), { recursive: true });
      const service = freshService();

      for (let i = 0; i < 5; i++) {
        await service.record(auditInput({ orgId: wsId, description: `Entry ${i}` }));
      }

      const limited = await service.getForOrg(wsId, { limit: 3 });
      expect(limited).toHaveLength(3);

      service.dispose();
    });

    it("should support offset", async () => {
      const wsId = "ws_offset";
      await mkdir(join(TEST_DIR, wsId), { recursive: true });
      const service = freshService();

      for (let i = 0; i < 5; i++) {
        await new Promise((r) => setTimeout(r, 5));
        await service.record(auditInput({ orgId: wsId, description: `Entry ${i}` }));
      }

      // Newest first: Entry 4, Entry 3, Entry 2, Entry 1, Entry 0
      const offsetEntries = await service.getForOrg(wsId, { offset: 2, limit: 2 });
      expect(offsetEntries).toHaveLength(2);
      expect(offsetEntries[0].description).toBe("Entry 2");
      expect(offsetEntries[1].description).toBe("Entry 1");

      service.dispose();
    });

    it("should return empty array for non-existent org", async () => {
      const service = freshService();
      const entries = await service.getForOrg("ws_nope");
      expect(entries).toEqual([]);
      service.dispose();
    });
  });

  describe("persistence", () => {
    it("should persist entries across service instances", async () => {
      const wsId = "ws_persist";
      await mkdir(join(TEST_DIR, wsId), { recursive: true });

      const service1 = freshService();
      await service1.record(auditInput({ orgId: wsId, description: "Persisted entry" }));
      service1.dispose();

      const service2 = freshService();
      const entries = await service2.getForOrg(wsId);
      expect(entries).toHaveLength(1);
      expect(entries[0].description).toBe("Persisted entry");

      service2.dispose();
    });
  });
});
