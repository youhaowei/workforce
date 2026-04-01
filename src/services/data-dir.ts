/**
 * Shared data directory resolution.
 *
 * All services that persist to disk should use getDataDir() instead of
 * hardcoding paths. The directory defaults to ~/.workforce but can be
 * overridden via the WORKFORCE_DATA_DIR environment variable, which
 * allows tests to redirect writes to a temp directory.
 */

import { join } from "path";
import { homedir } from "os";

export function getDataDir(): string {
  return process.env.WORKFORCE_DATA_DIR || join(homedir(), ".workforce");
}
