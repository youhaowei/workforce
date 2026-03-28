import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
      'tracey': resolve(__dirname, 'lib/tracey/src'),
      'unifai': resolve(__dirname, 'lib/unifai/src'),
      '@wystack/types': resolve(__dirname, 'lib/wystack/packages/types/src'),
      '@wystack/version': resolve(__dirname, 'lib/wystack/packages/version/src'),
      '@wystack/db': resolve(__dirname, 'lib/wystack/packages/db/src'),
      '@wystack/server': resolve(__dirname, 'lib/wystack/packages/server/src'),
      '@wystack/client': resolve(__dirname, 'lib/wystack/packages/client/src'),
      '@wystack/start': resolve(__dirname, 'lib/wystack/packages/start/src'),
      '@stdui/react': resolve(__dirname, 'lib/stdui/packages/ui/src'),
    },
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
