import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@ui': resolve(__dirname, 'src/ui'),
      '@services': resolve(__dirname, 'src/services'),
      '@shared': resolve(__dirname, 'src/shared'),
      '@hooks': resolve(__dirname, 'src/hooks'),
      '@mcp': resolve(__dirname, 'src/mcp'),
      '@bridge': resolve(__dirname, 'src/bridge'),
      '@utils': resolve(__dirname, 'src/utils'),
    },
  },
  server: {
    port: 5173,
    strictPort: false,
  },
  build: {
    target: 'ES2020',
    minify: 'esbuild',
    sourcemap: false,
  },
});
