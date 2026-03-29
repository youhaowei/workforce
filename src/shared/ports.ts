/** Default port constants — single source of truth for all modes. */
export const DEFAULT_SERVER_PORT = 19675;
export const DEFAULT_VITE_PORT = 19676;

/** Parse a port string, returning the fallback if invalid or out of range (1–65535). */
export function parsePort(str: string | undefined, fallback: number): number {
  if (!str) return fallback;
  const n = parseInt(str, 10);
  return (Number.isNaN(n) || n < 1 || n > 65535) ? fallback : n;
}
