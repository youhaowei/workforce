/**
 * Server lifecycle management for the Tauri desktop app.
 *
 * When running as a Tauri app, the server is spawned by the Rust backend
 * (via the shell plugin) instead of requiring a separate terminal process.
 * The Rust side calls `fix_path_env::fix_all_vars()` at startup to repair
 * HOME, PATH, etc. for GUI apps launched from Finder/Dock.
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
  project_root?: string;
}

export interface ServerStopResult {
  status: 'stopped' | 'not_running' | 'no_child';
  pid?: number;
}

export async function getEnvDiagnostics(): Promise<EnvDiagnostics> {
  return invoke<EnvDiagnostics>('get_env_diagnostics');
}

export async function startServer(): Promise<ServerStartResult> {
  return invoke<ServerStartResult>('start_server');
}

export async function stopServer(): Promise<ServerStopResult> {
  return invoke<ServerStopResult>('stop_server');
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
