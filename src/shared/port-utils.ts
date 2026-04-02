import type { Server } from "net";

export function parsePort(value: string | undefined, fallback: number): number {
  if (!value || !/^\d+$/.test(value)) return fallback;
  const parsed = Number.parseInt(value, 10);
  return parsed >= 1 && parsed <= 65535 ? parsed : fallback;
}

/**
 * Bind-to-discover: attempt to listen on `basePort`, catch EADDRINUSE, retry
 * on the next port. Eliminates the TOCTOU gap in probe-then-bind approaches.
 *
 * `createServerFn` receives the candidate port and must return a server that
 * is already calling `.listen()`. This function resolves when one succeeds.
 */
export async function bindWithRetry<T extends Server>(
  basePort: number,
  maxRetries: number,
  createServerFn: (port: number) => T,
  onRetry?: (tried: number, next: number) => void,
): Promise<{ server: T; port: number }> {
  for (let offset = 0; offset <= maxRetries; offset += 1) {
    const candidate = basePort + offset;
    try {
      const server = await new Promise<T>((resolve, reject) => {
        // serve() calls .listen() synchronously; event handlers are attached
        // after return. This works because Node's net.Server defers error/listening
        // emission to the next tick — a stable behavior since Node 0.x.
        const s = createServerFn(candidate);
        const onError = (err: NodeJS.ErrnoException) => {
          s.close(() => reject(err));
        };
        s.once("error", onError);
        s.once("listening", () => {
          s.removeListener("error", onError);
          resolve(s);
        });
      });
      return { server, port: candidate };
    } catch (err) {
      const isRetryable = (err as NodeJS.ErrnoException).code === "EADDRINUSE";
      if (!isRetryable) throw err;
      if (offset >= maxRetries) {
        throw new Error(`All ports ${basePort}-${basePort + maxRetries} are in use`);
      }
      onRetry?.(candidate, candidate + 1);
    }
  }

  throw new Error(`All ports ${basePort}-${basePort + maxRetries} are in use`);
}
