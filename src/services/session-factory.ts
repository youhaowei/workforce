import { join } from "path";
import type { SessionService } from "./types";
import { getDataDir } from "./data-dir";
import { SessionServiceImpl } from "./session";

const SESSIONS_DIR = join(getDataDir(), "sessions");

let _instance: SessionServiceImpl | null = null;

export function getSessionService(): SessionService {
  return (_instance ??= new SessionServiceImpl(SESSIONS_DIR));
}

export function resetSessionService(): void {
  if (_instance) {
    _instance.dispose();
    _instance = null;
  }
}

export function createSessionService(sessionsDir: string): SessionService {
  return new SessionServiceImpl(sessionsDir);
}
