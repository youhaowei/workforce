import { test, expect } from '@playwright/test'
import { setupTestUserAndOrg } from './helpers'

test.describe('Task Panel', () => {
  test.beforeAll(async () => {
    await setupTestUserAndOrg()
  })

  test.beforeEach(async ({ page }) => {
    await page.goto('/')
    // Wait for Shell to load (past setup gate)
    await expect(
      page.locator('textarea[placeholder="Ask Workforce anything..."]'),
    ).toBeVisible({ timeout: 10000 })
  })

  test('app loads past setup gate', async ({ page }) => {
    // Verify the main Shell is visible with sidebar navigation
    await expect(page.locator('button:has-text("Home")')).toBeVisible()
    await expect(page.locator('text=Ready')).toBeVisible()
  })
})
