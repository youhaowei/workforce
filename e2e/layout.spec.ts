import { test, expect } from '@playwright/test'
import { setupTestUserAndOrg } from './helpers'

test.describe('Layout', () => {
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

  test('has correct page title', async ({ page }) => {
    await expect(page).toHaveTitle(/Workforce/)
  })

  test('sidebar shows app name', async ({ page }) => {
    await expect(page.locator('text=Workforce').first()).toBeVisible()
  })

  test('status bar shows ready state', async ({ page }) => {
    // Sessions view is the default — Ready text should be visible
    await expect(page.locator('text=Ready')).toBeVisible()
  })

  test('sidebar has section labels', async ({ page }) => {
    await expect(page.locator('text=Projects')).toBeVisible()
    await expect(page.locator('text=Sessions')).toBeVisible()
  })

  test('textarea auto-resizes with content', async ({ page }) => {
    // Sessions view is the default — textarea is directly visible
    const input = page.locator('textarea[placeholder="Ask Workforce anything..."]')
    await expect(input).toBeVisible({ timeout: 10000 })

    const initialHeight = await input.boundingBox()

    await input.fill('Line 1\nLine 2\nLine 3\nLine 4\nLine 5')

    const newHeight = await input.boundingBox()

    expect(newHeight?.height).toBeGreaterThan(initialHeight?.height || 0)
  })
})
