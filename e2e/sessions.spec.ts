import { test, expect } from '@playwright/test'
import { setupTestUserAndOrg } from './helpers'

test.describe('Sessions Panel', () => {
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

  test('Sessions nav button navigates to sessions view', async ({ page }) => {
    const sessionsButton = page.locator('button:has-text("Sessions")')
    await expect(sessionsButton).toBeVisible()
    await sessionsButton.click()

    // Sessions view should show the sessions panel header
    await expect(page.locator('h2:has-text("Sessions")')).toBeVisible()
  })
})
