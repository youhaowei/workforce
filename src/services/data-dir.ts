/**
 * Shared data directory resolution.
 *
 * All services that persist to disk should use getDataDir() instead of
 * hardcoding paths. The directory defaults to ~/.workforce but can be
 * overridden via the WORKFORCE_DATA_DIR environment variable, which
 * allows tests to redirect writes to a temp directory.
 */

import { join, resolve } from "path";
import { homedir } from "os";

export function getDataDir(): string {
  const envValue = process.env.WORKFORCE_DATA_DIR;
  // Treat empty string as unset — resolve("") returns cwd which is wrong.
  const raw = envValue && envValue.length > 0 ? envValue : join(homedir(), ".workforce");
  return resolve(raw);
}
