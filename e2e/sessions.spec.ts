import { test, expect } from '@playwright/test'
import { setupTestUserAndOrg } from './helpers'

test.describe('Sessions Panel', () => {
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

  test('sessions section is visible in sidebar by default', async ({ page }) => {
    // Sessions view is the default — sessions section label should be visible
    await expect(page.locator('text=Sessions')).toBeVisible()
  })
})
