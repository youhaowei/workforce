import { defineConfig } from 'vite';
import { builtinModules } from 'module';
import { createPathAliases } from './tooling/path-aliases';

export default defineConfig({
  resolve: {
    alias: createPathAliases(__dirname),
  },
  build: {
    outDir: 'dist-electron',
    lib: {
      entry: 'src-electron/preload.ts',
      formats: ['cjs'],
      fileName: () => 'preload.cjs',
    },
    rollupOptions: {
      external: [
        'electron',
        ...builtinModules,
        ...builtinModules.map((m) => `node:${m}`),
      ],
    },
    emptyOutDir: false,
  },
});
