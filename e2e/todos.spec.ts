import { test, expect } from '@playwright/test'
import { setupTestUserAndOrg } from './helpers'

test.describe('Task Panel', () => {
  test.beforeAll(async () => {
    await setupTestUserAndOrg()
  })

  test.beforeEach(async ({ page }) => {
    await page.goto('/')
    // Wait for layout to load (past setup gate) — sidebar is always rendered
    await expect(
      page.locator('aside[role="complementary"]'),
    ).toBeVisible({ timeout: 10000 })
  })

  test('app loads past setup gate', async ({ page }) => {
    // Verify the sidebar is visible (layout rendered past setup gate)
    await expect(page.locator('aside[role="complementary"]')).toBeVisible()
    // Sessions view is the default — Ready text should be visible
    await expect(page.locator('text=Ready')).toBeVisible()
  })
})
