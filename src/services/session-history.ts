import { getEventBus } from "@/shared/event-bus";
import type { Session } from "./types";
import { AppendLock, consolidateSession, writeForkSession } from "./session-journal";

export interface SessionHistoryDeps {
  sessionsDir: string;
  appendLock: AppendLock;
  consolidationTimers: Map<string, ReturnType<typeof setTimeout>>;
  deletedSessionIds: Set<string>;
  registerSession: (session: Session) => void;
  getSession: (sessionId: string) => Promise<Session | null>;
  generateId: () => string;
}

export async function forkSession(
  deps: SessionHistoryDeps,
  sessionId: string,
  options?: { atMessageIndex?: number },
): Promise<Session> {
  const parent = await deps.getSession(sessionId);
  if (!parent) throw new Error(`Session not found: ${sessionId}`);
  if (parent.messages.length === 0) throw new Error("Cannot fork an empty session");

  const cutoff = options?.atMessageIndex;
  if (cutoff !== undefined && (cutoff < -1 || cutoff >= parent.messages.length))
    throw new Error(
      `Invalid message index: ${cutoff}. Session has ${parent.messages.length} messages.`,
    );

  let messages: typeof parent.messages;
  if (cutoff === -1) messages = [];
  else if (cutoff !== undefined) messages = parent.messages.slice(0, cutoff + 1);
  else messages = parent.messages;
  const lastIdx = cutoff !== undefined && cutoff >= 0 ? cutoff : parent.messages.length - 1;
  const forkAtMessageId = parent.messages[lastIdx]?.id;
  const now = Date.now();
  const {
    lifecycle: _,
    type: _t,
    templateId: _ti,
    goal: _g,
    worktreePath: _w,
    workflowId: _wf,
    workflowStepIndex: _ws,
    repoRoot: _rr,
    forkAtMessageId: _old,
    ...inheritedMetadata
  } = parent.metadata;
  const forked: Session = {
    id: deps.generateId(),
    title: parent.title ? `${parent.title} (fork)` : undefined,
    createdAt: now,
    updatedAt: now,
    parentId: parent.id,
    messages: messages.map((m) => ({ ...m })),
    metadata: { ...inheritedMetadata, forkAtMessageId },
  };

  deps.registerSession(forked);
  await writeForkSession(deps.sessionsDir, forked);
  getEventBus().emit({
    type: "SessionChange",
    sessionId: forked.id,
    action: "created",
    timestamp: now,
  });
  return forked;
}

export async function truncateSession(
  deps: SessionHistoryDeps,
  sessionId: string,
  upToMessageIndex: number,
): Promise<Session> {
  const session = await deps.getSession(sessionId);
  if (!session) throw new Error(`Session not found: ${sessionId}`);
  if (upToMessageIndex === -1 && session.messages.length === 0) return session;
  if (upToMessageIndex < -1 || upToMessageIndex >= session.messages.length)
    throw new Error(
      `Invalid message index: ${upToMessageIndex}. Session has ${session.messages.length} messages.`,
    );

  const timer = deps.consolidationTimers.get(sessionId);
  if (timer) {
    clearTimeout(timer);
    deps.consolidationTimers.delete(sessionId);
  }

  await deps.appendLock.acquire(sessionId, async () => {
    session.messages =
      upToMessageIndex === -1 ? [] : session.messages.slice(0, upToMessageIndex + 1);
    session.updatedAt = Date.now();
    if (!deps.deletedSessionIds.has(sessionId)) await consolidateSession(deps.sessionsDir, session);
  });
  getEventBus().emit({
    type: "SessionChange",
    sessionId,
    action: "updated",
    timestamp: session.updatedAt,
  });
  return session;
}
