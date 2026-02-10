import { test, expect } from '@playwright/test'

test.describe('Sessions Panel', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/')
  })

  test('Sessions button toggles sessions panel', async ({ page }) => {
    const sessionsButton = page.locator('button:has-text("Sessions")')
    await expect(sessionsButton).toBeVisible()

    await sessionsButton.click()
    await expect(page.locator('h2:has-text("Sessions")')).toBeVisible()

    await sessionsButton.click()
    await expect(page.locator('h2:has-text("Sessions")')).not.toBeVisible()
  })

  test('sessions panel has close button', async ({ page }) => {
    await page.locator('button:has-text("Sessions")').click()

    const closeButton = page.locator('button[title="Close"]').first()
    await expect(closeButton).toBeVisible()

    await closeButton.click()
    await expect(page.locator('h2:has-text("Sessions")')).not.toBeVisible()
  })

  test('sessions panel shows content after loading', async ({ page }) => {
    await page.locator('button:has-text("Sessions")').click()
    await expect(page.locator('h2:has-text("Sessions")')).toBeVisible()
    
    const panel = page.locator('.w-80').first()
    await expect(panel).toBeVisible()
  })
})
