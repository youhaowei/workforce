import { test, expect } from '@playwright/test'

test.describe('Layout', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/')
  })

  test('has correct page title', async ({ page }) => {
    await expect(page).toHaveTitle(/Workforce/)
  })

  test('header shows app branding', async ({ page }) => {
    await expect(page.locator('h1')).toHaveText('Workforce')
    await expect(page.locator('text=Agentic Orchestrator')).toBeVisible()
  })

  test('status bar shows ready state', async ({ page }) => {
    await expect(page.locator('text=Ready')).toBeVisible()
  })

  test('both panels can be open simultaneously', async ({ page }) => {
    await page.locator('button:has-text("Sessions")').click()
    await page.locator('button:has-text("Todos")').click()

    await expect(page.locator('h2:has-text("Sessions")')).toBeVisible()
    await expect(page.locator('h2:has-text("Todos")')).toBeVisible()
  })

  test('tab selection updates style', async ({ page }) => {
    const templatesButton = page.locator('button:has-text("Templates")').first()

    await templatesButton.click()
    await expect(templatesButton).toHaveClass(/bg-burgundy-500/)
  })

  test('main area resizes when panels open', async ({ page }) => {
    const mainArea = page.locator('main > div').first()

    const initialWidth = await mainArea.boundingBox()

    await page.locator('button:has-text("Sessions")').click()
    await page.locator('button:has-text("Todos")').click()

    const newWidth = await mainArea.boundingBox()

    expect(newWidth?.width).toBeLessThan(initialWidth?.width || 0)
  })
})
