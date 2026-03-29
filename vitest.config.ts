import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';
import { tmpdir } from 'os';
import { sharedAliases } from './vite.shared';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: sharedAliases(__dirname),
  },
  test: {
    globals: true,
    environment: 'node',
    env: {
      // Redirect service writes to temp dir so tests don't touch ~/.workforce
      WORKFORCE_DATA_DIR: path.join(tmpdir(), `workforce-test-${process.pid}`),
    },
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx', 'src-electron/**/*.test.ts'],
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
