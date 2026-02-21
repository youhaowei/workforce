import { test, expect } from '@playwright/test'
import { trpcMutate, trpcQuery, setupTestUserAndOrg, resetServerState } from './helpers'

test.describe('Projects', () => {
  let orgId: string

  test.beforeAll(async () => {
    // Ensure user exists so the setup gate is passed
    await setupTestUserAndOrg()
  })

  test.beforeEach(async ({ page }) => {
    // Create a fresh org for each test
    const org = await trpcMutate('org.create', { name: 'Test Org' })
    orgId = org.id
    await trpcMutate('org.activate', { id: orgId })
    await trpcMutate('org.update', { id: orgId, updates: { initialized: true } })

    await page.goto('/')
    // Wait for Shell to load (past setup gate)
    await expect(page.locator('button:has-text("Home")')).toBeVisible({ timeout: 10000 })
  })

  test.afterEach(async () => {
    // Clean up the test org (and its projects) to prevent test pollution
    if (orgId) {
      try {
        const projects = await trpcQuery('project.list', { orgId })
        for (const p of projects ?? []) {
          await trpcMutate('project.delete', { id: p.id })
        }
        await trpcMutate('org.delete', { id: orgId })
      } catch {
        // Best-effort cleanup
      }
    }
    // Re-activate the base org so other test files see a valid currentOrg
    await setupTestUserAndOrg()
  })

  test('Projects button switches to projects view', async ({ page }) => {
    const projectsButton = page.locator('button:has-text("Projects")')
    await expect(projectsButton).toBeVisible()

    await projectsButton.click()
    await expect(page.locator('h2:has-text("Projects")')).toBeVisible()
  })

  test('projects panel shows empty state with create button', async ({ page }) => {
    await page.locator('button:has-text("Projects")').click()
    await expect(page.locator('text=No projects yet')).toBeVisible()
    await expect(page.locator('button:has-text("Create project")')).toBeVisible()
  })

  test('New button opens create project dialog', async ({ page }) => {
    await page.locator('button:has-text("Projects")').click()
    await expect(page.locator('h2:has-text("Projects")')).toBeVisible()

    await page.locator('button:has-text("New")').click()
    await expect(page.locator('text=New Project')).toBeVisible()
  })

  test('create dialog has name, path, and color fields', async ({ page }) => {
    await page.locator('button:has-text("Projects")').click()
    await page.locator('button:has-text("New")').click()

    await expect(page.locator('label:has-text("Name")')).toBeVisible()
    await expect(page.locator('label:has-text("Root Path")')).toBeVisible()
    await expect(page.locator('label:has-text("Color")')).toBeVisible()
  })

  test('create button is disabled when fields are empty', async ({ page }) => {
    await page.locator('button:has-text("Projects")').click()
    await page.locator('button:has-text("New")').click()

    const createButton = page.locator('button[type="submit"]:has-text("Create")')
    await expect(createButton).toBeDisabled()
  })

  test('can create a new project', async ({ page }) => {
    await page.locator('button:has-text("Projects")').click()
    await page.locator('button:has-text("New")').click()

    // Fill in project name
    await page.locator('#project-name').fill('My Test Project')

    // Fill in root path
    await page.locator('#project-path').fill('/tmp/my-test-project')

    // Submit
    const createButton = page.locator('button[type="submit"]:has-text("Create")')
    await expect(createButton).toBeEnabled()
    await createButton.click()

    // Dialog should close
    await expect(page.locator('text=New Project')).not.toBeVisible()

    // Project should appear in the list (use .first() — name also appears in detail heading)
    await expect(page.locator('text=My Test Project').first()).toBeVisible()
    // Use getByText to avoid Playwright treating /tmp/... as a regex
    await expect(page.getByText('/tmp/my-test-project').first()).toBeVisible()
  })

  test('can create project from empty state button', async ({ page }) => {
    await page.locator('button:has-text("Projects")').click()

    // Click the "Create project" button in the empty state
    await page.locator('button:has-text("Create project")').click()
    await expect(page.locator('text=New Project')).toBeVisible()

    await page.locator('#project-name').fill('Empty State Project')
    await page.locator('#project-path').fill('/tmp/empty-state')
    await page.locator('button[type="submit"]:has-text("Create")').click()

    await expect(page.locator('text=Empty State Project').first()).toBeVisible()
  })

  test('can search projects', async ({ page }) => {
    // Create two projects via API then reload to pick them up
    await trpcMutate('project.create', {
      orgId,
      name: 'Alpha Project',
      rootPath: '/tmp/alpha',
    })
    await trpcMutate('project.create', {
      orgId,
      name: 'Beta Project',
      rootPath: '/tmp/beta',
    })
    await page.reload()
    await expect(page.locator('button:has-text("Home")')).toBeVisible({ timeout: 10000 })

    await page.locator('button:has-text("Projects")').click()

    // Wait for both projects to appear
    await expect(page.locator('text=Alpha Project').first()).toBeVisible()
    await expect(page.locator('text=Beta Project').first()).toBeVisible()
    await expect(page.locator('text=2 projects')).toBeVisible()

    // Search for "Alpha"
    await page.locator('input[placeholder="Search projects..."]').fill('Alpha')
    await expect(page.locator('text=Alpha Project').first()).toBeVisible()
    await expect(page.locator('text=Beta Project')).not.toBeVisible()
    await expect(page.locator('text=1 project')).toBeVisible()
  })

  test('can select a project', async ({ page }) => {
    // Create a project via API then reload to pick it up
    await trpcMutate('project.create', {
      orgId,
      name: 'Selectable Project',
      rootPath: '/tmp/selectable',
    })
    await page.reload()
    await expect(page.locator('button:has-text("Home")')).toBeVisible({ timeout: 10000 })

    await page.locator('button:has-text("Projects")').click()
    await expect(page.locator('text=Selectable Project').first()).toBeVisible({ timeout: 10000 })

    // Click the project row
    await page.locator('text=Selectable Project').first().click()

    // The row should get the active/accent background
    const projectRow = page.locator('[role="button"]:has-text("Selectable Project")')
    await expect(projectRow).toHaveClass(/bg-accent/)
  })

  test('cancel button closes create dialog', async ({ page }) => {
    await page.locator('button:has-text("Projects")').click()
    await page.locator('button:has-text("New")').click()
    await expect(page.locator('text=New Project')).toBeVisible()

    await page.locator('button:has-text("Cancel")').click()
    await expect(page.locator('text=New Project')).not.toBeVisible()
  })
})
