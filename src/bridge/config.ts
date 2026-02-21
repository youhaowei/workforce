/**
 * Client-side connection config.
 *
 * Reads VITE_API_PORT at build time; defaults to 4096 (dev server).
 * E2E tests override this via playwright.config.ts → VITE_API_PORT env var.
 */

export const API_PORT = import.meta.env.VITE_API_PORT || '4096';
export const SERVER_URL = `http://localhost:${API_PORT}`;
export const TRPC_URL = `${SERVER_URL}/api/trpc`;
