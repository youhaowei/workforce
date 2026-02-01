import { test, expect } from '@playwright/test'

test.describe('Chat', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/')
  })

  test('displays app header', async ({ page }) => {
    await expect(page.locator('h1')).toHaveText('Fuxi')
    await expect(page.locator('text=Agentic Orchestrator')).toBeVisible()
  })

  test('has message input', async ({ page }) => {
    const input = page.locator('textarea[placeholder="Type a message..."]')
    await expect(input).toBeVisible()
    await expect(input).toBeEnabled()
  })

  test('send button is disabled when input is empty', async ({ page }) => {
    const sendButton = page.locator('button:has-text("Send")')
    await expect(sendButton).toBeDisabled()
  })

  test('send button is enabled when input has text', async ({ page }) => {
    const input = page.locator('textarea[placeholder="Type a message..."]')
    await input.fill('Hello')

    const sendButton = page.locator('button:has-text("Send")')
    await expect(sendButton).toBeEnabled()
  })

  test('clears input after submission', async ({ page }) => {
    const input = page.locator('textarea[placeholder="Type a message..."]')
    await input.fill('Test message')

    const sendButton = page.locator('button:has-text("Send")')
    await sendButton.click()

    await expect(input).toHaveValue('')
  })

  test('shows status indicator', async ({ page }) => {
    await expect(page.locator('text=Ready')).toBeVisible()
  })

  test('shows message count', async ({ page }) => {
    await expect(page.locator('text=0 messages')).toBeVisible()
  })

  test('Enter key submits message', async ({ page }) => {
    const input = page.locator('textarea[placeholder="Type a message..."]')
    await input.fill('Test message')
    await input.press('Enter')

    await expect(input).toHaveValue('')
  })

  test('Shift+Enter adds newline', async ({ page }) => {
    const input = page.locator('textarea[placeholder="Type a message..."]')
    await input.fill('Line 1')
    await input.press('Shift+Enter')
    await input.type('Line 2')

    await expect(input).toHaveValue('Line 1\nLine 2')
  })

  test('Escape clears input', async ({ page }) => {
    const input = page.locator('textarea[placeholder="Type a message..."]')
    await input.fill('Some text')
    await input.press('Escape')

    await expect(input).toHaveValue('')
  })
})
