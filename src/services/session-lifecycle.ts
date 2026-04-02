/**
 * Session Lifecycle — WorkAgent creation and state transitions.
 *
 * Free functions operating on sessions + journal I/O.
 */

import type {
  Session,
  SessionLifecycle,
  LifecycleState,
  WorkAgentConfig,
  HydrationStatus,
  JournalMeta,
  JournalRecord,
} from "./types";
import { VALID_TRANSITIONS } from "./types";
import { getEventBus } from "@/shared/event-bus";
import { writeRecords, JSONL_VERSION } from "./session-journal";

export interface LifecycleDeps {
  readonly sessions: Map<string, Session>;
  readonly sessionsDir: string;
  generateId(): string;
  registerSession(session: Session, status?: HydrationStatus): void;
  writeRecords(sessionId: string, records: JournalRecord[]): Promise<void>;
  ensureInitialized(): Promise<void>;
}

export async function createWorkAgent(
  deps: LifecycleDeps,
  config: WorkAgentConfig,
): Promise<Session> {
  await deps.ensureInitialized();
  const now = Date.now();
  const lifecycle: SessionLifecycle = { state: "created", stateHistory: [] };
  const metadata = {
    type: "workagent" as const,
    lifecycle,
    templateId: config.templateId,
    goal: config.goal,
    workflowId: config.workflowId,
    workflowStepIndex: config.workflowStepIndex,
    worktreePath: config.worktreePath,
    orgId: config.orgId,
    repoRoot: config.repoRoot,
  };

  const session: Session = {
    id: deps.generateId(),
    title: config.goal,
    createdAt: now,
    updatedAt: now,
    parentId: config.parentId,
    messages: [],
    metadata,
  };

  deps.registerSession(session, "ready");
  await writeRecords(deps.sessionsDir, session.id, [
    {
      t: "header",
      v: JSONL_VERSION,
      seq: 0,
      ts: now,
      id: session.id,
      title: session.title,
      createdAt: now,
      parentId: config.parentId,
      metadata,
    },
  ]);
  getEventBus().emit({
    type: "SessionChange",
    sessionId: session.id,
    action: "created",
    timestamp: now,
  });
  return session;
}

export async function transitionState(
  deps: LifecycleDeps,
  sessionId: string,
  newState: LifecycleState,
  reason: string,
  actor: "system" | "user" | "agent" = "system",
): Promise<Session> {
  await deps.ensureInitialized();
  const session = deps.sessions.get(sessionId);
  if (!session) throw new Error(`Session not found: ${sessionId}`);

  const lifecycle = session.metadata.lifecycle as SessionLifecycle | undefined;
  const currentState: LifecycleState = lifecycle?.state ?? "created";
  const allowed = VALID_TRANSITIONS[currentState];
  if (!allowed.includes(newState)) {
    throw new Error(
      `Invalid state transition: ${currentState} → ${newState}. Allowed: ${allowed.join(", ") || "none"}`,
    );
  }

  const now = Date.now();
  const updatedLifecycle: SessionLifecycle = {
    state: newState,
    stateHistory: [
      ...(lifecycle?.stateHistory ?? []),
      { from: currentState, to: newState, reason, timestamp: now, actor },
    ],
    pauseReason: newState === "paused" ? reason : undefined,
    failureReason: newState === "failed" ? reason : undefined,
    completionSummary: newState === "completed" ? reason : lifecycle?.completionSummary,
  };

  session.metadata = { ...session.metadata, lifecycle: updatedLifecycle };
  session.updatedAt = now;

  await deps.writeRecords(sessionId, [
    { t: "meta", seq: 0, ts: now, patch: { lifecycle: updatedLifecycle } } satisfies JournalMeta,
  ]);
  getEventBus().emit({
    type: "LifecycleTransition",
    sessionId,
    from: currentState,
    to: newState,
    reason,
    actor,
    timestamp: now,
  });
  return session;
}

export async function listByState(
  deps: LifecycleDeps,
  state: LifecycleState,
  orgId?: string,
): Promise<Session[]> {
  await deps.ensureInitialized();
  return Array.from(deps.sessions.values()).filter((session) => {
    const lifecycle = session.metadata.lifecycle as SessionLifecycle | undefined;
    if (!lifecycle || lifecycle.state !== state) return false;
    if (orgId && session.metadata.orgId !== orgId) return false;
    return true;
  });
}

export async function getChildren(
  deps: LifecycleDeps,
  parentSessionId: string,
): Promise<Session[]> {
  await deps.ensureInitialized();
  return Array.from(deps.sessions.values())
    .filter((s) => s.parentId === parentSessionId)
    .sort((a, b) => b.createdAt - a.createdAt);
}
