import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@ui': path.resolve(__dirname, './src/ui'),
      '@services': path.resolve(__dirname, './src/services'),
      '@tools': path.resolve(__dirname, './src/tools'),
      '@shared': path.resolve(__dirname, './src/shared'),
      '@bridge': path.resolve(__dirname, './src/bridge'),
    },
    conditions: ['development', 'browser'],
  },
  test: {
    globals: true,
    environment: 'node',
    testTimeout: 30000,
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    environmentMatchGlobs: [['src/ui/**/*.test.tsx', 'jsdom']],
    setupFiles: ['./src/ui/test-setup.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
    },
  },
});
