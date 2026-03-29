import { defineConfig } from 'vite';
import { sharedAliases } from './vite.shared';

export default defineConfig({
  resolve: {
    alias: sharedAliases(__dirname),
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
