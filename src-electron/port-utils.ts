/** Parse a port string, returning the default if invalid. */
export function parsePort(str: string | undefined, fallback: number): number {
  if (!str) return fallback;
  const n = parseInt(str, 10);
  return Number.isNaN(n) ? fallback : n;
}
