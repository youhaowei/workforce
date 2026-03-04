import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { resolve } from 'path';
import { readFileSync, writeFileSync, unlinkSync } from 'fs';

/** Read the server's actual port from .dev-port (written by server on startup). */
function discoverApiPort(): string | undefined {
  try {
    return readFileSync(resolve(__dirname, '.dev-port'), 'utf-8').trim();
  } catch {
    return undefined;
  }
}

const VITE_PORT_FILE = resolve(__dirname, '.vite-port');

/** Write .vite-port so Electron knows which port to connect to. */
function vitePortFile(): Plugin {
  return {
    name: 'vite-port-file',
    configureServer(server) {
      server.httpServer?.once('listening', () => {
        const addr = server.httpServer!.address();
        if (addr && typeof addr === 'object') {
          writeFileSync(VITE_PORT_FILE, String(addr.port));
        }
      });
      // Clean up on dev server shutdown (Ctrl+C, etc.)
      const cleanup = () => {
        try { unlinkSync(VITE_PORT_FILE); } catch { /* not found */ }
      };
      server.httpServer?.on('close', cleanup);
    },
    buildEnd() {
      try { unlinkSync(VITE_PORT_FILE); } catch { /* not found */ }
    },
  };
}

export default defineConfig({
  plugins: [react(), tailwindcss(), vitePortFile()],
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
    ...(() => {
      const apiPort = discoverApiPort();
      return apiPort && !process.env.VITE_API_PORT
        ? { 'import.meta.env.VITE_API_PORT': JSON.stringify(apiPort) }
        : {};
    })(),
  },
  build: {
    target: 'ES2020',
    minify: 'esbuild',
    sourcemap: false,
  },
});
