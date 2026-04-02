import { describe, it, expect } from "vitest";
import { filterSessions, groupSessions } from "./sessionListHelpers";
import type { SessionSummary, Project } from "@/services/types";

function makeSession(overrides: Partial<SessionSummary> = {}): SessionSummary {
  return {
    id: `sess_${Math.random().toString(36).slice(2)}`,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    metadata: {},
    messageCount: 0,
    ...overrides,
  };
}

describe("filterSessions", () => {
  const sessions: SessionSummary[] = [
    makeSession({ id: "1", title: "Alpha chat", metadata: { type: "chat" } }),
    makeSession({
      id: "2",
      title: "Beta agent",
      metadata: { type: "workagent", goal: "deploy service" },
    }),
    makeSession({
      id: "3",
      title: "Gamma",
      metadata: { type: "chat", lifecycle: { state: "active", stateHistory: [] } },
    }),
    makeSession({
      id: "4",
      title: "Delta",
      metadata: { type: "workagent", lifecycle: { state: "completed", stateHistory: [] } },
      lastMessagePreview: "finished deployment",
    }),
  ];

  it("returns all sessions when no filters are applied", () => {
    const result = filterSessions(sessions, "all", "all", "");
    expect(result).toHaveLength(4);
  });

  it("filters by type", () => {
    const result = filterSessions(sessions, "workagent", "all", "");
    expect(result.map((s) => s.id)).toEqual(["2", "4"]);
  });

  it("filters by lifecycle state", () => {
    const result = filterSessions(sessions, "all", "active", "");
    expect(result.map((s) => s.id)).toEqual(["3"]);
  });

  it("filters by title search query", () => {
    const result = filterSessions(sessions, "all", "all", "alpha");
    expect(result.map((s) => s.id)).toEqual(["1"]);
  });

  it("filters by goal search query", () => {
    // 'deploy' matches session 2 (goal) and session 4 (lastMessagePreview: 'finished deployment')
    const result = filterSessions(sessions, "all", "all", "deploy");
    expect(result.map((s) => s.id)).toEqual(["2", "4"]);
  });

  it("filters by lastMessagePreview", () => {
    const result = filterSessions(sessions, "all", "all", "deployment");
    expect(result.map((s) => s.id)).toEqual(["4"]);
  });

  it("combines type and search filters", () => {
    const result = filterSessions(sessions, "chat", "all", "alpha");
    expect(result.map((s) => s.id)).toEqual(["1"]);
  });

  it("returns empty array when nothing matches", () => {
    const result = filterSessions(sessions, "all", "all", "nonexistent");
    expect(result).toHaveLength(0);
  });

  it("trims and lowercases the search query", () => {
    const result = filterSessions(sessions, "all", "all", "  ALPHA  ");
    expect(result.map((s) => s.id)).toEqual(["1"]);
  });
});

describe("groupSessions", () => {
  const sessions: SessionSummary[] = [
    makeSession({ id: "1", metadata: { projectId: "proj_a" } }),
    makeSession({ id: "2", metadata: { projectId: "proj_b" } }),
    makeSession({ id: "3", metadata: { projectId: "proj_a" } }),
    makeSession({ id: "4", metadata: {} }),
  ];

  const projectMap = new Map<string, Project>([
    [
      "proj_a",
      {
        id: "proj_a",
        orgId: "org1",
        name: "Project A",
        rootPath: "/a",
        color: "#E57373",
        createdAt: 0,
        updatedAt: 0,
      },
    ],
    [
      "proj_b",
      {
        id: "proj_b",
        orgId: "org1",
        name: "Project B",
        rootPath: "/b",
        color: "#81C784",
        createdAt: 0,
        updatedAt: 0,
      },
    ],
  ]);

  it('returns null when groupBy is "none"', () => {
    expect(groupSessions(sessions, "none")).toBeNull();
  });

  describe("groupBy project", () => {
    it("groups sessions by projectId", () => {
      const groups = groupSessions(sessions, "project", projectMap)!;
      expect(groups).not.toBeNull();
      const keys = groups.map((g) => g.key);
      expect(keys).toContain("proj_a");
      expect(keys).toContain("proj_b");
      expect(keys).toContain("__ungrouped__");
    });

    it("assigns correct labels from projectMap", () => {
      const groups = groupSessions(sessions, "project", projectMap)!;
      const projA = groups.find((g) => g.key === "proj_a");
      expect(projA?.label).toBe("Project A");
      expect(projA?.color).toBe("#E57373");
    });

    it("places ungrouped sessions last", () => {
      const groups = groupSessions(sessions, "project", projectMap)!;
      expect(groups[groups.length - 1].key).toBe("__ungrouped__");
    });

    it("counts sessions per group correctly", () => {
      const groups = groupSessions(sessions, "project", projectMap)!;
      const projA = groups.find((g) => g.key === "proj_a");
      expect(projA?.sessions).toHaveLength(2);
    });
  });

  describe("groupBy status", () => {
    const statusSessions: SessionSummary[] = [
      makeSession({ id: "1", metadata: { lifecycle: { state: "active", stateHistory: [] } } }),
      makeSession({ id: "2", metadata: { lifecycle: { state: "completed", stateHistory: [] } } }),
      makeSession({ id: "3", metadata: { lifecycle: { state: "active", stateHistory: [] } } }),
      makeSession({ id: "4", metadata: {} }), // defaults to 'created'
    ];

    it("groups by lifecycle state", () => {
      const groups = groupSessions(statusSessions, "status")!;
      expect(groups).not.toBeNull();
      const keys = groups.map((g) => g.key);
      expect(keys).toContain("active");
      expect(keys).toContain("completed");
      expect(keys).toContain("created");
    });

    it("orders groups by predefined state order", () => {
      const groups = groupSessions(statusSessions, "status")!;
      const keys = groups.map((g) => g.key);
      // 'active' should come before 'created' which comes before 'completed'
      expect(keys.indexOf("active")).toBeLessThan(keys.indexOf("created"));
      expect(keys.indexOf("created")).toBeLessThan(keys.indexOf("completed"));
    });

    it("capitalizes group labels", () => {
      const groups = groupSessions(statusSessions, "status")!;
      const active = groups.find((g) => g.key === "active");
      expect(active?.label).toBe("Active");
    });
  });
});
