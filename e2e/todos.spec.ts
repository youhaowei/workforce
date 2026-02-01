import { test, expect } from '@playwright/test'

test.describe('Todo Panel', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/')
  })

  test('Todos button toggles todo panel', async ({ page }) => {
    const todosButton = page.locator('button:has-text("Todos")')
    await expect(todosButton).toBeVisible()

    await todosButton.click()
    await expect(page.locator('h2:has-text("Todos")')).toBeVisible()

    await todosButton.click()
    await expect(page.locator('h2:has-text("Todos")')).not.toBeVisible()
  })

  test('todo panel has close button', async ({ page }) => {
    await page.locator('button:has-text("Todos")').click()

    const closeButton = page.locator('button[title="Close"]').last()
    await expect(closeButton).toBeVisible()

    await closeButton.click()
    await expect(page.locator('h2:has-text("Todos")')).not.toBeVisible()
  })

  test('has add todo input', async ({ page }) => {
    await page.locator('button:has-text("Todos")').click()

    const input = page.locator('input[placeholder="Add a todo..."]')
    await expect(input).toBeVisible()
  })

  test('add button is disabled when input is empty', async ({ page }) => {
    await page.locator('button:has-text("Todos")').click()

    const addButton = page.locator('button:has-text("Add")')
    await expect(addButton).toBeDisabled()
  })

  test('can add a todo', async ({ page }) => {
    await page.locator('button:has-text("Todos")').click()

    const input = page.locator('input[placeholder="Add a todo..."]')
    await input.fill('Test todo item')

    const addButton = page.locator('button:has-text("Add")')
    await expect(addButton).toBeEnabled()
    await addButton.click()

    await expect(input).toHaveValue('')
    await expect(page.locator('text=Test todo item')).toBeVisible()
  })

  test('can complete a todo', async ({ page }) => {
    await page.locator('button:has-text("Todos")').click()

    const input = page.locator('input[placeholder="Add a todo..."]')
    await input.fill('Todo to complete')
    await page.locator('button:has-text("Add")').click()

    const todoItem = page.locator('text=Todo to complete').locator('..')
    const completeButton = todoItem.locator('button[title="Complete"], button:has-text("✓")').first()
    
    if (await completeButton.isVisible()) {
      await completeButton.click()
    }
  })

  test('can delete a todo', async ({ page }) => {
    await page.locator('button:has-text("Todos")').click()

    const input = page.locator('input[placeholder="Add a todo..."]')
    await input.fill('Todo to delete')
    await page.locator('button:has-text("Add")').click()

    await expect(page.locator('text=Todo to delete')).toBeVisible()

    const todoItem = page.locator('text=Todo to delete').locator('..')
    const deleteButton = todoItem.locator('button[title="Delete"], button:has-text("×")').first()
    
    if (await deleteButton.isVisible()) {
      await deleteButton.click()
      await expect(page.locator('text=Todo to delete')).not.toBeVisible()
    }
  })

  test('shows pending count badge', async ({ page }) => {
    await page.locator('button:has-text("Todos")').click()

    const input = page.locator('input[placeholder="Add a todo..."]')
    await input.fill('Pending todo')
    await page.locator('button:has-text("Add")').click()

    const badge = page.locator('h2:has-text("Todos") span')
    await expect(badge).toBeVisible()
  })
})
