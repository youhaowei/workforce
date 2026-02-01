import { test, expect } from '@playwright/test'

test.describe('Sessions Panel', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/')
  })

  test('History button toggles sessions panel', async ({ page }) => {
    const historyButton = page.locator('button:has-text("History")')
    await expect(historyButton).toBeVisible()

    await historyButton.click()
    await expect(page.locator('h2:has-text("Sessions")')).toBeVisible()

    await historyButton.click()
    await expect(page.locator('h2:has-text("Sessions")')).not.toBeVisible()
  })

  test('sessions panel has close button', async ({ page }) => {
    await page.locator('button:has-text("History")').click()

    const closeButton = page.locator('button[title="Close"]').first()
    await expect(closeButton).toBeVisible()

    await closeButton.click()
    await expect(page.locator('h2:has-text("Sessions")')).not.toBeVisible()
  })

  test('sessions panel shows content after loading', async ({ page }) => {
    await page.locator('button:has-text("History")').click()
    await expect(page.locator('h2:has-text("Sessions")')).toBeVisible()
    
    const panel = page.locator('.w-80').first()
    await expect(panel).toBeVisible()
  })
})
