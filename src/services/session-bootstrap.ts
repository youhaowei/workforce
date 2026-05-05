import { readdir, mkdir } from "fs/promises";
import type { HydrationStatus, Session } from "./types";
import { getLogService } from "./log";
import { runMigrations } from "./migration";
import { replaySessionMetadata } from "./session-journal";
import { RehydrationManager } from "./session-rehydration";

export interface SessionBootstrapDeps {
  dataDir: string;
  sessionsDir: string;
  registerSession: (session: Session, status: HydrationStatus) => void;
  rehydrator: RehydrationManager;
}

export async function initializeSessions(deps: SessionBootstrapDeps): Promise<void> {
  await runMigrations(deps.dataDir);

  try {
    await mkdir(deps.sessionsDir, { recursive: true });
    const entries = await readdir(deps.sessionsDir);
    const sessionFiles = entries.filter(
      (name) => name.endsWith(".jsonl") && !name.includes(".corrupt") && !name.includes(".tmp"),
    );

    for (const file of sessionFiles) {
      const sessionId = file.replace(".jsonl", "");
      const session = await replaySessionMetadata(deps.sessionsDir, sessionId);
      if (session) deps.registerSession(session, "cold");
    }
  } catch (err) {
    const error = err as NodeJS.ErrnoException;
    if (error.code !== "ENOENT") {
      getLogService().error("general", "Failed to initialize sessions", { error: String(error) });
    }
  }

  deps.rehydrator.enqueue();
}
