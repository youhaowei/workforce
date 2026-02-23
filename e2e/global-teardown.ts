/**
 * Playwright global teardown — remove the temp data directory.
 */

import { rm } from 'fs/promises';

async function globalTeardown() {
  const dir = process.env.WORKFORCE_E2E_DATA_DIR;
  if (dir) {
    await rm(dir, { recursive: true, force: true });
  }
}

export default globalTeardown;
