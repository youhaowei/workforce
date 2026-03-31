import { resolve } from 'path';

export function createPathAliases(rootDir: string) {
  return {
    '@': resolve(rootDir, 'src'),
    tracey: resolve(rootDir, 'lib/tracey/src'),
    unifai: resolve(rootDir, 'lib/unifai/src'),
    '@wystack/types': resolve(rootDir, 'lib/wystack/packages/types/src'),
    '@wystack/version': resolve(rootDir, 'lib/wystack/packages/version/src'),
    '@wystack/db': resolve(rootDir, 'lib/wystack/packages/db/src'),
    '@wystack/server': resolve(rootDir, 'lib/wystack/packages/server/src'),
    '@wystack/client': resolve(rootDir, 'lib/wystack/packages/client/src'),
    '@wystack/start': resolve(rootDir, 'lib/wystack/packages/start/src'),
    '@stdui/react': resolve(rootDir, 'lib/stdui/packages/ui/src'),
  };
}
