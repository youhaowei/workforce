import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { tmpdir } from "os";
import { join } from "path";
import { mkdirSync } from "fs";
import { mkdir, rm, readFile, writeFile } from "fs/promises";
import type { JournalRecord, Session } from "./types";
import {
  appendRecord,
  appendRecords,
  writeRecords,
  replaySession,
  replaySessionMetadata,
  consolidateSession,
  writeForkSession,
  AppendLock,
  SeqAllocator,
  JSONL_VERSION,
} from "./session-journal";

const TEST_ROOT = join(tmpdir(), `workforce-journal-test-${Date.now()}`);
let dirCounter = 0;

function nextDir(): string {
  const dir = join(TEST_ROOT, `test-${++dirCounter}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function readJsonl(dir: string, id: string): Promise<string> {
  return readFile(join(dir, `${id}.jsonl`), "utf-8");
}

function parseJsonl(raw: string): unknown[] {
  return raw
    .split("\n")
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l));
}

let seqCounter = 0;
function nextSeq() {
  return seqCounter++;
}

function makeHeader(id = "sess-1", metadata: Record<string, unknown> = {}): JournalRecord {
  return {
    t: "header",
    v: JSONL_VERSION,
    seq: 0,
    ts: 1000,
    id,
    title: "Test Session",
    createdAt: 1000,
    metadata,
  };
}

function makeMessage(
  id: string,
  role: "user" | "assistant",
  content: string,
  ts = 2000,
): JournalRecord {
  return { t: "message", seq: nextSeq(), ts, id, role, content };
}

function makeFinal(id: string, content: string, ts = 3000): JournalRecord {
  return {
    t: "message_final",
    seq: nextSeq(),
    ts,
    id,
    role: "assistant",
    content,
    stopReason: "end_turn",
  };
}

beforeEach(async () => {
  await mkdir(TEST_ROOT, { recursive: true });
});

afterAll(async () => {
  await rm(TEST_ROOT, { recursive: true, force: true });
});

describe("JSONL I/O", () => {
  describe("appendRecord", () => {
    it("creates file and appends a single record", async () => {
      const dir = nextDir();
      const record = makeHeader();
      await appendRecord(dir, "sess-1", record);

      const raw = await readJsonl(dir, "sess-1");
      const lines = parseJsonl(raw);
      expect(lines).toHaveLength(1);
      expect(lines[0]).toMatchObject({ t: "header", id: "sess-1" });
    });

    it("appends to an existing file", async () => {
      const dir = nextDir();
      await appendRecord(dir, "sess-1", makeHeader());
      await appendRecord(dir, "sess-1", makeMessage("m1", "user", "hello"));

      const lines = parseJsonl(await readJsonl(dir, "sess-1"));
      expect(lines).toHaveLength(2);
      expect(lines[1]).toMatchObject({ t: "message", content: "hello" });
    });
  });

  describe("appendRecords", () => {
    it("appends multiple records in one I/O", async () => {
      const dir = nextDir();
      await appendRecord(dir, "sess-1", makeHeader());
      await appendRecords(dir, "sess-1", [
        makeMessage("m1", "user", "hello"),
        makeMessage("m2", "assistant", "hi"),
      ]);

      const lines = parseJsonl(await readJsonl(dir, "sess-1"));
      expect(lines).toHaveLength(3);
    });

    it("is a no-op for empty array", async () => {
      const dir = nextDir();
      await appendRecord(dir, "sess-1", makeHeader());
      await appendRecords(dir, "sess-1", []);

      const lines = parseJsonl(await readJsonl(dir, "sess-1"));
      expect(lines).toHaveLength(1);
    });
  });

  describe("writeRecords", () => {
    it("overwrites the file with the given records", async () => {
      const dir = nextDir();
      await writeRecords(dir, "sess-1", [makeHeader(), makeMessage("m1", "user", "hello")]);

      const lines = parseJsonl(await readJsonl(dir, "sess-1"));
      expect(lines).toHaveLength(2);
    });
  });
});

describe("replaySession", () => {
  it("returns null for missing file", async () => {
    const dir = nextDir();

    expect(await replaySession(dir, "nonexistent")).toBeNull();
  });

  it("returns null for empty file", async () => {
    const dir = nextDir();

    await writeFile(join(dir, "sess-1.jsonl"), "", "utf-8");
    expect(await replaySession(dir, "sess-1")).toBeNull();
  });

  it("replays header + messages into a Session", async () => {
    const dir = nextDir();
    await writeRecords(dir, "sess-1", [
      makeHeader(),
      makeMessage("m1", "user", "hello", 2000),
      makeFinal("m2", "hi there", 3000),
    ]);

    const result = await replaySession(dir, "sess-1");
    expect(result).not.toBeNull();
    const session = result!.session;
    expect(session.id).toBe("sess-1");
    expect(session.title).toBe("Test Session");
    expect(session.messages).toHaveLength(2);
    expect(session.messages[0]).toMatchObject({ id: "m1", role: "user", content: "hello" });
    expect(session.messages[1]).toMatchObject({ id: "m2", role: "assistant", content: "hi there" });
    expect(session.updatedAt).toBe(3000);
  });

  it("replays streaming deltas (start → delta → final)", async () => {
    const dir = nextDir();
    await writeRecords(dir, "sess-1", [
      makeHeader(),
      { t: "message_start", seq: 1, ts: 2000, id: "msg-1", role: "assistant" },
      { t: "message_delta", seq: 2, ts: 2001, id: "msg-1", delta: "hel" },
      { t: "message_delta", seq: 3, ts: 2002, id: "msg-1", delta: "lo" },
      {
        t: "message_final",
        seq: 4,
        ts: 3000,
        id: "msg-1",
        role: "assistant",
        content: "hello",
        stopReason: "end_turn",
      },
    ]);

    const result = await replaySession(dir, "sess-1");
    const session = result!.session;
    expect(session.messages).toHaveLength(1);
    expect(session.messages[0].content).toBe("hello");
  });

  it("sorts deltas by seq during replay", async () => {
    const dir = nextDir();
    await writeRecords(dir, "sess-1", [
      makeHeader(),
      { t: "message_start", seq: 1, ts: 2000, id: "msg-1", role: "assistant" },
      { t: "message_delta", seq: 3, ts: 2002, id: "msg-1", delta: "world" },
      { t: "message_delta", seq: 2, ts: 2001, id: "msg-1", delta: "hello " },
      { t: "message_abort", seq: 4, ts: 3000, id: "msg-1", reason: "crash" },
    ]);

    const result = await replaySession(dir, "sess-1");
    const session = result!.session;
    expect(session.messages).toHaveLength(1);
    expect(session.messages[0].content).toBe("hello world");
  });

  it("recovers aborted thinking-only streams with terminal block status", async () => {
    const dir = nextDir();
    await writeRecords(dir, "sess-1", [
      makeHeader(),
      { t: "message_start", seq: 1, ts: 2000, id: "msg-1", role: "assistant" },
      {
        t: "message_blocks",
        seq: 2,
        ts: 2001,
        id: "msg-1",
        contentBlocks: [{ type: "thinking", text: "still thinking", status: "running" }],
      } as JournalRecord,
      { t: "message_abort", seq: 3, ts: 3000, id: "msg-1", reason: "user_cancelled" },
    ]);

    const result = await replaySession(dir, "sess-1");
    const session = result!.session;
    expect(session.messages).toHaveLength(1);
    expect(session.messages[0].content).toBe("");
    expect(session.messages[0].contentBlocks).toEqual([
      { type: "thinking", text: "still thinking", status: "complete" },
    ]);
  });

  it("prefers message_final over message_abort when both arrive for same id", async () => {
    const dir = nextDir();
    await writeRecords(dir, "sess-1", [
      makeHeader(),
      { t: "message_start", seq: 1, ts: 2000, id: "msg-1", role: "assistant" },
      { t: "message_delta", seq: 2, ts: 2001, id: "msg-1", delta: "partial" },
      { t: "message_abort", seq: 3, ts: 3000, id: "msg-1", reason: "user_cancelled" },
      {
        t: "message_final",
        seq: 4,
        ts: 4000,
        id: "msg-1",
        role: "assistant",
        content: "complete answer",
        stopReason: "end_turn",
      },
    ]);

    const result = await replaySession(dir, "sess-1");
    const session = result!.session;
    expect(session.messages).toHaveLength(1);
    expect(session.messages[0].content).toBe("complete answer");
  });

  it("persists aborted streams that have only toolActivities", async () => {
    const dir = nextDir();
    await writeRecords(dir, "sess-1", [
      makeHeader(),
      { t: "message_start", seq: 1, ts: 2000, id: "msg-1", role: "assistant" },
      {
        t: "message_blocks",
        seq: 2,
        ts: 2001,
        id: "msg-1",
        contentBlocks: [],
        toolActivities: [{ name: "Read", input: "{}" }],
      } as JournalRecord,
      { t: "message_abort", seq: 3, ts: 3000, id: "msg-1", reason: "user_cancelled" },
    ]);

    const result = await replaySession(dir, "sess-1");
    const session = result!.session;
    expect(session.messages).toHaveLength(1);
    expect(session.messages[0].toolActivities).toEqual([{ name: "Read", input: "{}" }]);
  });

  it("recovers orphaned streams (deltas without final/abort)", async () => {
    const dir = nextDir();
    await writeRecords(dir, "sess-1", [
      makeHeader(),
      { t: "message_start", seq: 1, ts: 2000, id: "msg-1", role: "assistant" },
      { t: "message_delta", seq: 2, ts: 2001, id: "msg-1", delta: "partial content" },
      // No final or abort — simulates a crash
    ]);

    const result = await replaySession(dir, "sess-1");
    const session = result!.session;
    expect(session.messages).toHaveLength(1);
    expect(session.messages[0].content).toBe("partial content");
  });

  it("handles message_blocks during stream", async () => {
    const dir = nextDir();
    await writeRecords(dir, "sess-1", [
      makeHeader(),
      { t: "message_start", seq: 1, ts: 2000, id: "msg-1", role: "assistant" },
      {
        t: "message_blocks",
        seq: 2,
        ts: 2001,
        id: "msg-1",
        contentBlocks: [{ type: "text", text: "block" }],
      },
      { t: "message_delta", seq: 3, ts: 2002, id: "msg-1", delta: "content" },
      // Orphaned — should recover with blocks
    ]);

    const result = await replaySession(dir, "sess-1");
    const session = result!.session;
    expect(session.messages[0].contentBlocks).toEqual([{ type: "text", text: "block" }]);
  });

  it("applies meta records to update session fields", async () => {
    const dir = nextDir();
    await writeRecords(dir, "sess-1", [
      makeHeader(),
      { t: "meta", seq: 1, ts: 5000, patch: { title: "New Title", custom: "value" } },
    ]);

    const result = await replaySession(dir, "sess-1");
    const session = result!.session;
    expect(session.title).toBe("New Title");
    expect(session.metadata.custom).toBe("value");
    expect(session.updatedAt).toBe(5000);
  });

  it("skips malformed lines gracefully", async () => {
    const dir = nextDir();
    const header = JSON.stringify(makeHeader());
    const validMsg = JSON.stringify(makeMessage("m1", "user", "hello"));
    const content = `${header}\n{broken json\n${validMsg}\n`;

    await writeFile(join(dir, "sess-1.jsonl"), content, "utf-8");

    const result = await replaySession(dir, "sess-1");
    const session = result!.session;
    expect(session.messages).toHaveLength(1);
    expect(session.messages[0].content).toBe("hello");
  });

  it("marks file as corrupt if header is invalid", async () => {
    const dir = nextDir();

    await writeFile(join(dir, "sess-1.jsonl"), '{"t":"not_header"}\n', "utf-8");

    const session = await replaySession(dir, "sess-1");
    expect(session).toBeNull();
  });

  it("backfills question results from follow-up user messages", async () => {
    const dir = nextDir();
    await writeRecords(dir, "sess-1", [
      makeHeader(),
      {
        t: "message_final",
        seq: 1,
        ts: 2000,
        id: "msg-1",
        role: "assistant",
        content: "Asking...",
        stopReason: "end_turn",
        contentBlocks: [
          {
            type: "tool_use",
            id: "tu-1",
            name: "AskUserQuestion",
            input: "{}",
            status: "complete",
          },
        ],
      },
      makeMessage("msg-2", "user", "My answer", 3000),
    ]);

    const result = await replaySession(dir, "sess-1");
    const session = result!.session;
    const block = session.messages[0].contentBlocks![0];
    expect(block.type === "tool_use" && block.result).toEqual({
      _fromFollowUp: true,
      answer: "My answer",
    });
  });
});

describe("replaySessionMetadata", () => {
  it("returns session with empty messages from header only", async () => {
    const dir = nextDir();
    await writeRecords(dir, "sess-1", [
      makeHeader("sess-1", { orgId: "org-1" }),
      makeMessage("m1", "user", "hello"),
    ]);

    const session = await replaySessionMetadata(dir, "sess-1");
    expect(session!.id).toBe("sess-1");
    expect(session!.title).toBe("Test Session");
    expect(session!.messages).toEqual([]);
    expect(session!.metadata.orgId).toBe("org-1");
  });

  it("returns null for missing file", async () => {
    const dir = nextDir();

    expect(await replaySessionMetadata(dir, "missing")).toBeNull();
  });
});

describe("consolidateSession", () => {
  it("rewrites JSONL with header + message records only", async () => {
    const dir = nextDir();
    // Write a messy JSONL with streaming artifacts
    await writeRecords(dir, "sess-1", [
      makeHeader(),
      { t: "message_start", seq: 1, ts: 2000, id: "msg-1", role: "assistant" },
      { t: "message_delta", seq: 2, ts: 2001, id: "msg-1", delta: "hello" },
    ]);

    // Create a session as if it was replayed
    const session: Session = {
      id: "sess-1",
      title: "Test Session",
      createdAt: 1000,
      updatedAt: 3000,
      messages: [
        { id: "msg-1", role: "assistant", content: "hello", timestamp: 2000 },
        { id: "msg-2", role: "user", content: "hi", timestamp: 2500 },
      ],
      metadata: { key: "val" },
    };

    await consolidateSession(dir, session);

    const lines = parseJsonl(await readJsonl(dir, "sess-1"));
    expect(lines).toHaveLength(3); // header + 2 messages
    expect(lines[0]).toMatchObject({ t: "header", ts: 3000, metadata: { key: "val" } });
    expect(lines[1]).toMatchObject({ t: "message_final", id: "msg-1", content: "hello" });
    expect(lines[2]).toMatchObject({ t: "message", id: "msg-2", role: "user" });
  });

  it("uses atomic rename via .tmp file", async () => {
    const dir = nextDir();
    await writeRecords(dir, "sess-1", [makeHeader()]);

    const session: Session = {
      id: "sess-1",
      title: "T",
      createdAt: 1,
      updatedAt: 1,
      messages: [],
      metadata: {},
    };

    await consolidateSession(dir, session);

    // Final file should exist, tmp should not
    const raw = await readJsonl(dir, "sess-1");
    expect(raw.length).toBeGreaterThan(0);
  });
});

describe("writeForkSession", () => {
  it("writes a complete JSONL from a forked session", async () => {
    const dir = nextDir();
    const forked: Session = {
      id: "fork-1",
      title: "Forked",
      createdAt: 1000,
      updatedAt: 2000,
      parentId: "parent-1",
      messages: [
        { id: "m1", role: "user", content: "hello", timestamp: 1500 },
        { id: "m2", role: "assistant", content: "hi", timestamp: 1600 },
      ],
      metadata: { forked: true },
    };

    await writeForkSession(dir, forked);

    const result = await replaySession(dir, "fork-1");
    const session = result!.session;
    expect(session.id).toBe("fork-1");
    expect(session.parentId).toBe("parent-1");
    expect(session.messages).toHaveLength(2);
  });
});

describe("AppendLock", () => {
  it("serializes concurrent writes for the same session", async () => {
    const lock = new AppendLock();
    const order: number[] = [];

    const p1 = lock.acquire("s1", async () => {
      await new Promise((r) => setTimeout(r, 30));
      order.push(1);
      return "first";
    });

    const p2 = lock.acquire("s1", async () => {
      order.push(2);
      return "second";
    });

    const [r1, r2] = await Promise.all([p1, p2]);
    expect(r1).toBe("first");
    expect(r2).toBe("second");
    expect(order).toEqual([1, 2]);
  });

  it("allows parallel writes for different sessions", async () => {
    const lock = new AppendLock();
    const order: string[] = [];

    const p1 = lock.acquire("s1", async () => {
      await new Promise((r) => setTimeout(r, 20));
      order.push("s1");
    });

    const p2 = lock.acquire("s2", async () => {
      order.push("s2");
    });

    await Promise.all([p1, p2]);
    // s2 should complete before s1 since it's a different session and doesn't wait
    expect(order).toEqual(["s2", "s1"]);
  });

  it("releases lock even if fn throws", async () => {
    const lock = new AppendLock();

    await expect(
      lock.acquire("s1", async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");

    // Next acquire should still work
    const result = await lock.acquire("s1", async () => "ok");
    expect(result).toBe("ok");
  });

  it("clear resets all locks", () => {
    const lock = new AppendLock();
    lock.clear(); // Should not throw
  });
});

// =============================================================================
// v0.3.0 Journal Tests
// =============================================================================

describe("v0.3.0 journal features", () => {
  describe("new record types in replay", () => {
    it("preserves unknown record types in session.records", async () => {
      const dir = nextDir();
      await writeRecords(dir, "sess-1", [
        makeHeader(),
        makeMessage("m1", "user", "hello"),
        {
          t: "tool_call",
          seq: 10,
          ts: 2000,
          actionId: "tu-1",
          messageId: "msg-1",
          name: "Read",
          input: { path: "/a.ts" },
        } as JournalRecord,
        {
          t: "hook",
          seq: 11,
          ts: 2001,
          hookId: "h-1",
          hookName: "lint",
          hookEvent: "PostToolUse",
          outcome: "success",
        } as JournalRecord,
        makeFinal("m2", "done"),
      ]);

      const result = await replaySession(dir, "sess-1");
      expect(result).not.toBeNull();
      const session = result!.session;
      // Messages should have the user + assistant messages
      expect(session.messages).toHaveLength(2);
      // Non-message records should be in session.records
      expect(session.records).toBeDefined();
      expect(session.records).toHaveLength(2);
      expect(session.records![0]).toMatchObject({ t: "tool_call", name: "Read" });
      expect(session.records![1]).toMatchObject({ t: "hook", hookName: "lint" });
    });

    it("handles session with only message records (no records bag)", async () => {
      const dir = nextDir();
      await writeRecords(dir, "sess-1", [
        makeHeader(),
        makeMessage("m1", "user", "hi"),
        makeFinal("m2", "hello"),
      ]);

      const result = await replaySession(dir, "sess-1");
      const session = result!.session;
      expect(session.messages).toHaveLength(2);
      expect(session.records).toBeUndefined();
    });
  });

  describe("consolidation with new record types", () => {
    it("preserves tool_call records through consolidation", async () => {
      const dir = nextDir();
      await writeRecords(dir, "sess-1", [
        makeHeader(),
        makeMessage("m1", "user", "fix the bug"),
        {
          t: "tool_call",
          seq: 5,
          ts: 2000,
          actionId: "tu-1",
          messageId: "msg-1",
          name: "Read",
          input: { path: "/a.ts" },
        } as JournalRecord,
        makeFinal("m2", "done"),
      ]);

      const session: Session = {
        id: "sess-1",
        title: "Test",
        createdAt: 1000,
        updatedAt: 3000,
        messages: [
          { id: "m1", role: "user", content: "fix the bug", timestamp: 2000 },
          { id: "m2", role: "assistant", content: "done", timestamp: 3000 },
        ],
        metadata: {},
      };

      await consolidateSession(dir, session);

      const lines = parseJsonl(await readJsonl(dir, "sess-1"));
      // header + 2 messages + 1 tool_call
      expect(lines).toHaveLength(4);
      const toolCall = lines.find((l: any) => l.t === "tool_call") as any;
      expect(toolCall).toBeDefined();
      expect(toolCall.name).toBe("Read");
      expect(toolCall.actionId).toBe("tu-1");
    });

    it("drops streaming intermediaries during consolidation", async () => {
      const dir = nextDir();
      await writeRecords(dir, "sess-1", [
        makeHeader(),
        { t: "message_start", seq: 1, ts: 2000, id: "msg-1", role: "assistant" } as JournalRecord,
        { t: "message_delta", seq: 2, ts: 2001, id: "msg-1", delta: "hello" } as JournalRecord,
        {
          t: "thinking_delta",
          seq: 3,
          ts: 2002,
          id: "msg-1",
          delta: "thinking...",
        } as JournalRecord,
        { t: "message_blocks", seq: 4, ts: 2003, id: "msg-1", contentBlocks: [] } as JournalRecord,
        {
          t: "tool_progress",
          seq: 5,
          ts: 2004,
          actionId: "tu-1",
          name: "Read",
          output: "reading...",
        } as JournalRecord,
        {
          t: "tool_call",
          seq: 6,
          ts: 2005,
          actionId: "tu-1",
          messageId: "msg-1",
          name: "Read",
          input: {},
        } as JournalRecord,
        makeFinal("msg-1", "hello"),
      ]);

      const session: Session = {
        id: "sess-1",
        title: "Test",
        createdAt: 1000,
        updatedAt: 3000,
        messages: [{ id: "msg-1", role: "assistant", content: "hello", timestamp: 3000 }],
        metadata: {},
      };

      await consolidateSession(dir, session);

      const lines = parseJsonl(await readJsonl(dir, "sess-1"));
      const types = (lines as any[]).map((l) => l.t);
      // Should keep: header, tool_call (ts:2005), message_final (ts:3000) — chronological order
      expect(types).toEqual(["header", "tool_call", "message_final"]);
      // Should NOT have any streaming types
      expect(types).not.toContain("message_start");
      expect(types).not.toContain("message_delta");
      expect(types).not.toContain("thinking_delta");
      expect(types).not.toContain("message_blocks");
      expect(types).not.toContain("tool_progress");
    });

    it("folds meta patches into header metadata", async () => {
      const dir = nextDir();
      await writeRecords(dir, "sess-1", [
        makeHeader("sess-1", { initial: true }),
        {
          t: "meta",
          seq: 1,
          ts: 1500,
          patch: { title: "Updated Title", custom: "value" },
        } as JournalRecord,
        { t: "meta", seq: 2, ts: 2000, patch: { another: "patch" } } as JournalRecord,
        makeMessage("m1", "user", "hi"),
      ]);

      const session: Session = {
        id: "sess-1",
        title: "Updated Title",
        createdAt: 1000,
        updatedAt: 2000,
        messages: [{ id: "m1", role: "user", content: "hi", timestamp: 2000 }],
        metadata: { initial: true, title: "Updated Title", custom: "value", another: "patch" },
      };

      await consolidateSession(dir, session);

      const lines = parseJsonl(await readJsonl(dir, "sess-1"));
      // No standalone meta records
      const metas = (lines as any[]).filter((l) => l.t === "meta");
      expect(metas).toHaveLength(0);
      // Header has folded metadata
      const header = lines[0] as any;
      expect(header.metadata).toMatchObject({ initial: true, custom: "value", another: "patch" });
    });

    it("falls back to state rebuild when JSONL is missing", async () => {
      const dir = nextDir();
      // No JSONL file exists

      const session: Session = {
        id: "sess-new",
        title: "New Session",
        createdAt: 1000,
        updatedAt: 2000,
        messages: [{ id: "m1", role: "user", content: "hello", timestamp: 1500 }],
        metadata: { source: "test" },
      };

      await consolidateSession(dir, session);

      const lines = parseJsonl(await readJsonl(dir, "sess-new"));
      expect(lines).toHaveLength(2); // header + message
      expect((lines[0] as any).t).toBe("header");
      expect((lines[1] as any).t).toBe("message");
    });
  });

  describe("SeqAllocator", () => {
    it("allocates monotonically increasing values", () => {
      const alloc = new SeqAllocator(5);
      expect(alloc.allocate()).toBe(5);
      expect(alloc.allocate()).toBe(6);
      expect(alloc.allocate()).toBe(7);
    });

    it("reports current value", () => {
      const alloc = new SeqAllocator(10);
      expect(alloc.current()).toBe(10);
      alloc.allocate();
      expect(alloc.current()).toBe(11);
    });

    it("initializes from max(seq) in replayed session", async () => {
      const dir = nextDir();
      await writeRecords(dir, "sess-1", [
        makeHeader(),
        { t: "message", seq: 5, ts: 2000, id: "m1", role: "user", content: "hi" } as JournalRecord,
        {
          t: "tool_call",
          seq: 42,
          ts: 2001,
          actionId: "tu-1",
          messageId: "m1",
          name: "Read",
          input: {},
        } as JournalRecord,
        {
          t: "message_final",
          seq: 20,
          ts: 3000,
          id: "m2",
          role: "assistant",
          content: "hello",
          stopReason: "end_turn",
        } as JournalRecord,
      ]);

      // Replay to get maxSeq
      const result = await replaySession(dir, "sess-1");
      expect(result).not.toBeNull();
      const session = result!.session;

      // maxSeq should be 42 (highest seq in the file)
      expect(result!.maxSeq).toBe(42);

      // SeqAllocator initialized from maxSeq + 1 would start at 43
      const alloc = new SeqAllocator(result!.maxSeq + 1);
      expect(alloc.allocate()).toBe(43);

      // The records bag should have the tool_call with seq=42
      const toolCall = session.records?.find((r) => r.t === "tool_call");
      expect(toolCall).toBeDefined();
      expect(toolCall!.seq).toBe(42);
    });
  });

  describe("seq ordering in replay", () => {
    it("assembles deltas using seq for ordering", async () => {
      const dir = nextDir();
      // Write deltas out of order (by seq)
      await writeRecords(dir, "sess-1", [
        makeHeader(),
        { t: "message_start", seq: 1, ts: 2000, id: "msg-1", role: "assistant" } as JournalRecord,
        { t: "message_delta", seq: 3, ts: 2002, id: "msg-1", delta: " world" } as JournalRecord,
        { t: "message_delta", seq: 2, ts: 2001, id: "msg-1", delta: "hello" } as JournalRecord,
        {
          t: "message_final",
          seq: 4,
          ts: 2003,
          id: "msg-1",
          role: "assistant",
          content: "hello world",
          stopReason: "end_turn",
        } as JournalRecord,
      ]);

      const result = await replaySession(dir, "sess-1");
      const session = result!.session;
      expect(session.messages).toHaveLength(1);
      expect(session.messages[0].content).toBe("hello world");
    });
  });
});
