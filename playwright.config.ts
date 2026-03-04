import { defineConfig, devices } from '@playwright/test'
import { mkdtempSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

// Always create an isolated temp data directory so E2E tests never touch ~/.workforce/.
// This runs synchronously at config parse time, before webServer starts.
const e2eDataDir = mkdtempSync(join(tmpdir(), 'workforce-e2e-'));
process.env.WORKFORCE_E2E_DATA_DIR = e2eDataDir;

// Use separate ports so E2E tests never conflict with the dev server (4096 + 5173).
const E2E_API_PORT = '4199';
process.env.WORKFORCE_E2E_API_PORT = E2E_API_PORT;
const E2E_VITE_PORT = '5174';

export default defineConfig({
  testDir: './e2e',
  globalTeardown: './e2e/global-teardown.ts',
  // Tests share a single server with global state (current org, user).
  // Parallel execution causes cross-test interference — run serially.
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: 'html',
  use: {
    baseURL: `http://localhost:${E2E_VITE_PORT}`,
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
      command: 'pnpm run server',
      url: `http://localhost:${E2E_API_PORT}/health`,
      reuseExistingServer: false,
      env: {
        WORKFORCE_DATA_DIR: e2eDataDir,
        PORT: E2E_API_PORT,
      },
    },
    {
      command: `pnpm run vite --port ${E2E_VITE_PORT}`,
      url: `http://localhost:${E2E_VITE_PORT}`,
      reuseExistingServer: false,
      env: {
        VITE_API_PORT: E2E_API_PORT,
      },
    },
  ],
})
