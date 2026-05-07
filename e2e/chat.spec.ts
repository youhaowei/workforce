import { test, expect } from '@playwright/test'
import { setupTestUserAndOrg } from './helpers'

test.describe('Chat', () => {
  test.beforeAll(async () => {
    await setupTestUserAndOrg()
  })

  test.beforeEach(async ({ page }) => {
    await page.goto('/')
    // Wait for layout to load (past setup gate) — sidebar is always rendered
    await expect(page.locator('aside[role="complementary"]')).toBeVisible({ timeout: 10000 })
    // Sessions view is the default — textarea is directly visible
    await expect(
      page.locator('textarea[placeholder="Ask Workforce anything..."]'),
    ).toBeVisible({ timeout: 10000 })
  })

  test('has message input', async ({ page }) => {
    const input = page.locator('textarea[placeholder="Ask Workforce anything..."]')
    await expect(input).toBeVisible()
    await expect(input).toBeEnabled()
  })

  test('send button is disabled when input is empty', async ({ page }) => {
    const sendButton = page.locator('button[title="Send (Enter)"]')
    await expect(sendButton).toBeDisabled()
  })

  test('send button is enabled when input has text', async ({ page }) => {
    const input = page.locator('textarea[placeholder="Ask Workforce anything..."]')
    await input.fill('Hello')

    const sendButton = page.locator('button[title="Send (Enter)"]')
    await expect(sendButton).toBeEnabled()
  })

  test('clears input after submission', async ({ page }) => {
    const input = page.locator('textarea[placeholder="Ask Workforce anything..."]')
    await input.fill('Test message')

    const sendButton = page.locator('button[title="Send (Enter)"]')
    await sendButton.click()

    await expect(input).toHaveValue('')
  })

  test('shows status indicator', async ({ page }) => {
    await expect(page.locator('text=Ready')).toBeVisible()
  })

  test('Enter key submits message', async ({ page }) => {
    const input = page.locator('textarea[placeholder="Ask Workforce anything..."]')
    await input.fill('Test message')
    await input.press('Enter')

    await expect(input).toHaveValue('')
  })

  test('Shift+Enter adds newline', async ({ page }) => {
    const input = page.locator('textarea[placeholder="Ask Workforce anything..."]')
    await input.fill('Line 1')
    await input.press('Shift+Enter')
    await input.pressSequentially('Line 2')

    await expect(input).toHaveValue('Line 1\nLine 2')
  })

  test('Escape clears input', async ({ page }) => {
    const input = page.locator('textarea[placeholder="Ask Workforce anything..."]')
    await input.fill('Some text')
    await input.press('Escape')

    await expect(input).toHaveValue('')
  })
})
