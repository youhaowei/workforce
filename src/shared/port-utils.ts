import { createServer } from 'net';

export function parsePort(value: string | undefined, fallback: number): number {
  if (!value || !/^\d+$/.test(value)) return fallback;
  const parsed = Number.parseInt(value, 10);
  return parsed >= 1 && parsed <= 65535 ? parsed : fallback;
}

export function isPortAvailable(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = createServer();

    server.once('error', () => {
      server.close(() => resolve(false));
    });
    server.listen(port, 'localhost', () => {
      server.close(() => resolve(true));
    });
  });
}

export async function findAvailablePort(
  basePort: number,
  maxRetries = 10,
  isAvailable: (port: number) => Promise<boolean> = isPortAvailable,
  onRetry?: (tried: number, next: number) => void,
): Promise<number> {
  for (let offset = 0; offset <= maxRetries; offset += 1) {
    const candidate = basePort + offset;
    if (await isAvailable(candidate)) return candidate;
    if (offset < maxRetries) {
      onRetry?.(candidate, candidate + 1);
    }
  }

  throw new Error(`All ports ${basePort}-${basePort + maxRetries} are in use`);
}
