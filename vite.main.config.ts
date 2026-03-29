import { defineConfig } from 'vite';
import { createPathAliases } from './tooling/path-aliases';

export default defineConfig({
  resolve: {
    alias: createPathAliases(__dirname),
  },
  build: {
    rollupOptions: {
      output: {
        // Use .cjs extension since package.json has "type": "module"
        entryFileNames: '[name].cjs',
      },
    },
  },
});
