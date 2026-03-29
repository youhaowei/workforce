import { defineConfig } from 'vite';
import { createPathAliases } from './tooling/path-aliases';

export default defineConfig({
  resolve: {
    alias: createPathAliases(__dirname),
  },
  build: {
    rollupOptions: {
      output: {
        entryFileNames: '[name].cjs',
      },
    },
  },
});
