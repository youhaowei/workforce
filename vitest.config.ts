import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';
import { tmpdir } from 'os';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      'tracey': path.resolve(__dirname, './lib/tracey/src'),
      'unifai': path.resolve(__dirname, './lib/unifai/src'),
      '@wystack/types': path.resolve(__dirname, './lib/wystack/packages/types/src'),
      '@wystack/version': path.resolve(__dirname, './lib/wystack/packages/version/src'),
      '@wystack/db': path.resolve(__dirname, './lib/wystack/packages/db/src'),
      '@wystack/server': path.resolve(__dirname, './lib/wystack/packages/server/src'),
      '@wystack/client': path.resolve(__dirname, './lib/wystack/packages/client/src'),
      '@wystack/start': path.resolve(__dirname, './lib/wystack/packages/start/src'),
    },
  },
  test: {
    globals: true,
    environment: 'node',
    env: {
      // Redirect service writes to temp dir so tests don't touch ~/.workforce
      WORKFORCE_DATA_DIR: path.join(tmpdir(), `workforce-test-${process.pid}`),
    },
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    environmentMatchGlobs: [
      ['src/ui/**/*.test.tsx', 'jsdom'],
    ],
    setupFiles: ['./src/ui/test-setup.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
    },
  },
});
