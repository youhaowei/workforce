import { defineConfig } from 'vite';
import { sharedAliases } from './vite.shared';

export default defineConfig({
  resolve: {
    alias: sharedAliases(__dirname),
  },
  build: {
    rollupOptions: {
      output: {
        entryFileNames: '[name].cjs',
      },
    },
  },
});
