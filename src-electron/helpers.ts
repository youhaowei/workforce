import { execFileSync } from "child_process";
import { readFileSync } from "fs";
import path from "path";
import type { ServerType } from "@hono/node-server";
import { parsePort } from "@/shared/port-utils";

/**
 * macOS GUI-launched apps get a stripped PATH. Repair by sourcing the login shell.
 * Returns the repaired PATH or undefined if skipped/failed.
 */
export function repairPath(
  currentPath: string | undefined,
  loginShell: string,
): string | undefined {
  try {
    // Use a null byte delimiter to isolate PATH from any profile script output
    const raw = execFileSync(loginShell, ["-lc", 'printf "\\0%s" "$PATH"'], {
      encoding: "utf-8",
      timeout: 3_000,
    });
    const nulIdx = raw.lastIndexOf("\0");
    const shellPath = (nulIdx >= 0 ? raw.slice(nulIdx + 1) : raw).trim();
    if (!shellPath) return currentPath;

    const existing = new Set((currentPath || "").split(":"));
    const extra = shellPath.split(":").filter((p) => p && !existing.has(p));
    if (!extra.length) return currentPath;

    return currentPath ? `${currentPath}:${extra.join(":")}` : extra.join(":");
  } catch {
    return undefined;
  }
}

/** Read a port from: env var > dot-file in app root > fallback. */
export function discoverPort(
  envVar: string,
  dotFile: string,
  fallback: number,
  appPath: string,
): number {
  const envValue = process.env[envVar];
  if (envValue) return parsePort(envValue, fallback);
  try {
    const portStr = readFileSync(path.join(appPath, dotFile), "utf-8").trim();
    return parsePort(portStr, fallback);
  } catch {
    return fallback;
  }
}

/** Gracefully close a server with a timeout. */
export async function closeServerWithTimeout(
  closingServer: ServerType,
  timeoutMs: number,
  onWarn?: (context: Record<string, unknown>, msg: string) => void,
): Promise<void> {
  let resolveTimeout: () => void;
  const timeoutPromise = new Promise<void>((r) => {
    resolveTimeout = r;
  });

  const timer = setTimeout(() => {
    onWarn?.({ timeoutMs }, "Server shutdown exceeded timeout, forcing app exit");
    resolveTimeout();
  }, timeoutMs);

  const closePromise = new Promise<void>((resolve, reject) => {
    closingServer.close((error) => {
      clearTimeout(timer);
      if (error) reject(error);
      else resolve();
    });
  });

  closePromise.catch((err) => onWarn?.({ error: err }, "Server close error"));
  await Promise.race([closePromise, timeoutPromise]);
}

const ALLOWED_EXTERNAL_PROTOCOLS = new Set(["http:", "https:"]);

/**
 * Validate a URL for open-external IPC — only http/https allowed.
 * Returns the parsed URL or throws with a descriptive error.
 */
export function validateExternalUrl(url: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`Invalid URL: ${url}`);
  }
  if (!ALLOWED_EXTERNAL_PROTOCOLS.has(parsed.protocol)) {
    throw new Error(`Blocked open-external for scheme: ${parsed.protocol}`);
  }
  return parsed;
}

/**
 * Check if a navigation URL is allowed — must be http://localhost:<rendererPort>.
 */
export function isAllowedNavigation(url: string, allowedPort: number): boolean {
  try {
    const parsed = new URL(url);
    return (
      parsed.protocol === "http:" &&
      parsed.hostname === "localhost" &&
      parsed.port === String(allowedPort)
    );
  } catch {
    return false;
  }
}

/** Poll a health endpoint until it returns 200. */
export async function waitForHealth(
  url: string,
  timeoutMs: number,
  fetchFn: typeof fetch = fetch,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  const interval = 100;
  while (Date.now() < deadline) {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), 2_000);
    try {
      const res = await fetchFn(url, { signal: ac.signal });
      // Consume body to release the socket
      await res.body?.cancel();
      if (res.ok) return true;
    } catch {
      /* server not ready yet */
    } finally {
      clearTimeout(timer);
    }
    await new Promise((r) => setTimeout(r, interval));
  }
  return false;
}
