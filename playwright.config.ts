import { defineConfig, devices } from '@playwright/test'
import { mkdtempSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

// Create temp data directory before webServer starts (must be synchronous at config parse time).
// Locally, reuseExistingServer=true so the env is unused — tests hit the running dev server.
const e2eDataDir = process.env.CI
  ? mkdtempSync(join(tmpdir(), 'workforce-e2e-'))
  : '';
process.env.WORKFORCE_E2E_DATA_DIR = e2eDataDir;

export default defineConfig({
  testDir: './e2e',
  globalTeardown: './e2e/global-teardown.ts',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: 'html',
  use: {
    baseURL: 'http://localhost:5173',
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'onboarding',
      use: { ...devices['Desktop Chrome'] },
      testMatch: 'onboarding.spec.ts',
    },
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
      testIgnore: 'onboarding.spec.ts',
      dependencies: ['onboarding'],
    },
  ],
  webServer: [
    {
      command: 'bun run server',
      url: 'http://localhost:4096/health',
      reuseExistingServer: !process.env.CI,
      env: {
        WORKFORCE_DATA_DIR: process.env.WORKFORCE_E2E_DATA_DIR || '',
      },
    },
    {
      command: 'bun run vite',
      url: 'http://localhost:5173',
      reuseExistingServer: !process.env.CI,
    },
  ],
})
