import type { ForgeConfig } from '@electron-forge/shared-types';
import { MakerZIP } from '@electron-forge/maker-zip';
import { MakerDMG } from '@electron-forge/maker-dmg';
import { VitePlugin } from '@electron-forge/plugin-vite';

const config: ForgeConfig = {
  packagerConfig: {
    name: 'Workforce',
    appBundleId: 'dev.workforce.app',
    icon: 'icon',
    asar: {
      // Bun subprocess can't read from asar archives — unpack the entire
      // src/ tree so the server's import graph resolves on the real filesystem.
      unpack: 'src/**',
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
