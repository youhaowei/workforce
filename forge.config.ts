import type { ForgeConfig } from '@electron-forge/shared-types';
import { MakerZIP } from '@electron-forge/maker-zip';
import { MakerDMG } from '@electron-forge/maker-dmg';
import { VitePlugin } from '@electron-forge/plugin-vite';

const config: ForgeConfig = {
  packagerConfig: {
    name: 'Workforce',
    appBundleId: 'dev.workforce.app',
    icon: 'icon',
    // The Forge Vite plugin packages /.vite/** by default.
    // Server code is now bundled into .vite/build/main.cjs, so we only need
    // the Vite output, dist (production UI build), and node_modules for
    // any native dependencies.
    ignore: (file: string) => {
      if (!file) return false;

      const includedPrefixes = ['/.vite', '/dist', '/node_modules'];
      if (includedPrefixes.some((prefix) => file.startsWith(prefix))) return false;

      const includedFiles = ['/package.json'];
      if (includedFiles.includes(file)) return false;

      return true;
    },
    asar: {
      // Unpack dist so the Hono static server can read renderer assets
      // via normal filesystem paths (asar-packed files aren't accessible
      // to non-Electron fs APIs like @hono/node-server's serveStatic).
      unpack: '{dist/**,node_modules/**/*.node}',
    },
  },
  makers: [
    new MakerZIP({}, ['darwin']),
    new MakerDMG({}),
  ],
  plugins: [
    new VitePlugin({
      build: [
        { entry: 'src/electron/main.ts', config: 'vite.main.config.ts' },
        { entry: 'src/electron/preload.ts', config: 'vite.preload.config.ts' },
      ],
      renderer: [],
    }),
  ],
};

export default config;
