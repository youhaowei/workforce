import { test, expect } from '@playwright/test'

test.describe('Layout', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/')
  })

  test('has correct page title', async ({ page }) => {
    await expect(page).toHaveTitle(/Fuxi/)
  })

  test('header shows profile badge', async ({ page }) => {
    const badge = page.locator('span:has-text("coder")')
    await expect(badge).toBeVisible()
  })

  test('status bar shows ready state', async ({ page }) => {
    await expect(page.locator('text=Ready')).toBeVisible()
  })

  test('both panels can be open simultaneously', async ({ page }) => {
    await page.locator('button:has-text("History")').click()
    await page.locator('button:has-text("Todos")').click()

    await expect(page.locator('h2:has-text("Sessions")')).toBeVisible()
    await expect(page.locator('h2:has-text("Todos")')).toBeVisible()
  })

  test('buttons highlight when panel is open', async ({ page }) => {
    const historyButton = page.locator('button:has-text("History")')
    
    await historyButton.click()
    await expect(historyButton).toHaveClass(/bg-blue-500/)
    
    await historyButton.click()
    await expect(historyButton).not.toHaveClass(/bg-blue-500/)
  })

  test('main chat area resizes when panels open', async ({ page }) => {
    const mainArea = page.locator('main > div').first()
    
    const initialWidth = await mainArea.boundingBox()
    
    await page.locator('button:has-text("History")').click()
    await page.locator('button:has-text("Todos")').click()
    
    const newWidth = await mainArea.boundingBox()
    
    expect(newWidth?.width).toBeLessThan(initialWidth?.width || 0)
  })

  test('textarea auto-resizes with content', async ({ page }) => {
    const input = page.locator('textarea[placeholder="Type a message..."]')
    
    const initialHeight = await input.boundingBox()
    
    await input.fill('Line 1\nLine 2\nLine 3\nLine 4\nLine 5')
    
    const newHeight = await input.boundingBox()
    
    expect(newHeight?.height).toBeGreaterThan(initialHeight?.height || 0)
  })
})
