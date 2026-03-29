import { resolve } from 'path';

/**
 * Shared Vite resolve aliases — imported by vite.config.ts, vitest.config.ts,
 * and vite.main.config.ts to prevent drift.
 *
 * Must stay in sync with tsconfig.json "paths".
 */
export function sharedAliases(root: string): Record<string, string> {
  return {
    '@': resolve(root, 'src'),
    'tracey': resolve(root, 'lib/tracey/src'),
    'unifai': resolve(root, 'lib/unifai/src'),
    '@wystack/types': resolve(root, 'lib/wystack/packages/types/src'),
    '@wystack/version': resolve(root, 'lib/wystack/packages/version/src'),
    '@wystack/db': resolve(root, 'lib/wystack/packages/db/src'),
    '@wystack/server': resolve(root, 'lib/wystack/packages/server/src'),
    '@wystack/client': resolve(root, 'lib/wystack/packages/client/src'),
    '@wystack/start': resolve(root, 'lib/wystack/packages/start/src'),
    '@stdui/react': resolve(root, 'lib/stdui/packages/ui/src'),
  };
}
