import { test, expect } from '@playwright/test'
import { setupTestUserAndOrg } from './helpers'

test.describe('Layout', () => {
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

  test('has correct page title', async ({ page }) => {
    await expect(page).toHaveTitle(/Workforce/)
  })

  test('sidebar shows app name', async ({ page }) => {
    await expect(page.locator('text=Workforce').first()).toBeVisible()
  })

  test('status bar shows ready state', async ({ page }) => {
    await expect(page.locator('text=Ready')).toBeVisible()
  })

  test('sidebar has navigation items', async ({ page }) => {
    await expect(page.locator('button:has-text("Home")')).toBeVisible()
    await expect(page.locator('button:has-text("Sessions")')).toBeVisible()
    await expect(page.locator('button:has-text("Projects")')).toBeVisible()
  })

  test('textarea auto-resizes with content', async ({ page }) => {
    const input = page.locator('textarea[placeholder="Ask Workforce anything..."]')

    const initialHeight = await input.boundingBox()

    await input.fill('Line 1\nLine 2\nLine 3\nLine 4\nLine 5')

    const newHeight = await input.boundingBox()

    expect(newHeight?.height).toBeGreaterThan(initialHeight?.height || 0)
  })
})
