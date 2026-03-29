import { createServer } from 'net';

export function parsePort(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  if (!/^\d+$/.test(value)) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isNaN(parsed) || parsed < 1 || parsed > 65535 ? fallback : parsed;
}

export function isPortAvailable(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = createServer();

    server.once('error', () => resolve(false));
    server.listen(port, 'localhost', () => {
      server.close(() => resolve(true));
    });
  });
}

export async function findAvailablePort(
  basePort: number,
  maxRetries = 10,
  isAvailable: (port: number) => Promise<boolean> = isPortAvailable,
): Promise<number> {
  for (let offset = 0; offset <= maxRetries; offset += 1) {
    const candidate = basePort + offset;
    if (await isAvailable(candidate)) return candidate;
  }

  throw new Error(`All ports ${basePort}-${basePort + maxRetries} are in use`);
}
