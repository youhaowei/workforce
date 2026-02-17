/**
 * Server lifecycle management for the Tauri desktop app.
 *
 * Thin TypeScript wrappers around Tauri invoke() commands defined in
 * src-tauri/src/main.rs (start_server, stop_server, get_env_diagnostics).
 * The Rust backend repairs HOME, PATH, etc. at startup for GUI apps
 * launched from Finder/Dock.
 */
import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';

export interface EnvDiagnostics {
  home: string;
  path_first_dirs: string[];
  path_has_bun: boolean;
  credentials_exist: boolean;
  credentials_path: string;
  pid: number;
  env_fixed: boolean;
}

export interface ServerStartResult {
  status: 'started' | 'already_running';
  pid?: number;
  server_dir?: string;
}

export interface ServerStopResult {
  status: 'stopped' | 'not_running' | 'no_child';
  pid?: number;
  kill_error?: string | null;
}

export async function getEnvDiagnostics(): Promise<EnvDiagnostics> {
  try {
    return await invoke<EnvDiagnostics>('get_env_diagnostics');
  } catch (err) {
    throw new Error(
      `Failed to get environment diagnostics: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

export async function startServer(): Promise<ServerStartResult> {
  try {
    return await invoke<ServerStartResult>('start_server');
  } catch (err) {
    throw new Error(
      `Failed to start server: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

export async function stopServer(): Promise<ServerStopResult> {
  try {
    return await invoke<ServerStopResult>('stop_server');
  } catch (err) {
    throw new Error(
      `Failed to stop server: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

export function onServerStdout(cb: (line: string) => void): Promise<UnlistenFn> {
  return listen<string>('server-stdout', (event) => cb(event.payload));
}

export function onServerStderr(cb: (line: string) => void): Promise<UnlistenFn> {
  return listen<string>('server-stderr', (event) => cb(event.payload));
}

export interface ServerTerminatedPayload {
  code: number | null;
  signal: number | null;
}

export function onServerTerminated(
  cb: (payload: ServerTerminatedPayload) => void,
): Promise<UnlistenFn> {
  return listen<ServerTerminatedPayload>('server-terminated', (event) =>
    cb(event.payload),
  );
}
