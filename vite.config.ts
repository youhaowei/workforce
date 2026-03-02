import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { resolve } from 'path';
import { readFileSync } from 'fs';

/** Read the server's actual port from .dev-port (written by server on startup). */
function discoverApiPort(): string | undefined {
  try {
    return readFileSync(resolve(__dirname, '.dev-port'), 'utf-8').trim();
  } catch {
    return undefined;
  }
}

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
    },
  },
  server: {
    port: 5173,
    strictPort: false,
  },
  define: {
    // Propagate discovered port so bridge/config.ts picks it up at build time
    ...(discoverApiPort() && !process.env.VITE_API_PORT
      ? { 'import.meta.env.VITE_API_PORT': JSON.stringify(discoverApiPort()) }
      : {}),
  },
  build: {
    target: 'ES2020',
    minify: 'esbuild',
    sourcemap: false,
  },
});
