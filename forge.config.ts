import type { ForgeConfig } from '@electron-forge/shared-types';
import { MakerZIP } from '@electron-forge/maker-zip';
import { MakerDMG } from '@electron-forge/maker-dmg';
import { VitePlugin } from '@electron-forge/plugin-vite';

const config: ForgeConfig = {
  packagerConfig: {
    name: 'Workforce',
    appBundleId: 'dev.workforce.app',
    icon: 'icon',
    ignore: (file: string) => {
      if (!file) return false;
      // Include Forge Vite output, production UI build, and node_modules
      const includedPrefixes = ['/.vite', '/dist', '/node_modules'];
      if (includedPrefixes.some((prefix) => file.startsWith(prefix))) return false;
      const includedFiles = ['/package.json'];
      if (includedFiles.includes(file)) return false;
      return true;
    },
    asar: {
      // Unpack dist so Hono's serveStatic can read files via normal fs paths
      // (asar-packed files aren't accessible to non-Electron fs APIs).
      unpack: '{dist/**,node_modules/**/*.node}',
    },
  },
  // Current release packaging targets macOS only. Add Windows/Linux makers if
  // desktop distribution expands beyond darwin.
  makers: [
    new MakerZIP({}, ['darwin']),
    new MakerDMG({}),
  ],
  plugins: [
    new VitePlugin({
      build: [
        { entry: 'src-electron/main.ts', config: 'vite.main.config.ts' },
        { entry: 'src-electron/preload.ts', config: 'vite.preload.config.ts' },
      ],
      // Renderer dev is intentionally external: scripts/dev-electron.sh starts
      // the backend watch process and Vite dev server, then launches Electron
      // after `.dev-port`/`.vite-port` discovery has settled.
      renderer: [],
    }),
  ],
};

export default config;
