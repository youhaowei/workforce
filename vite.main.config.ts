import { defineConfig } from 'vite';
import { builtinModules } from 'module';
import { createPathAliases } from './tooling/path-aliases';

export default defineConfig({
  resolve: {
    alias: createPathAliases(__dirname),
  },
  build: {
    target: 'node20',
    outDir: 'dist-electron',
    lib: {
      entry: 'src-electron/main.ts',
      formats: ['cjs'],
      fileName: () => 'main.cjs',
    },
    rollupOptions: {
      external: [
        'electron',
        ...builtinModules,
        ...builtinModules.map((m) => `node:${m}`),
      ],
    },
    // Prevent clearing preload output when building main (or vice versa)
    emptyOutDir: false,
  },
});
