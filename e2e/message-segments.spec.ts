/**
 * E2E tests for chunked message segments and event-driven updates.
 *
 * Tests verify:
 * 1. Event-driven cache invalidation (sessions update via SSE, no polling)
 * 2. Chunked segment layout renders activity and text blocks in correct order
 */

import { test, expect } from '@playwright/test'
import { setupTestUserAndOrg, trpcMutate } from './helpers'

/** Seed a user message into a session via tRPC. */
async function seedUserMessage(sessionId: string, content: string) {
  const id = `msg_user_${Date.now()}`
  await trpcMutate('session.addMessage', {
    sessionId,
    message: { id, role: 'user', content, timestamp: Date.now() },
  })
  return id
}

/** Seed an assistant response with content blocks via stream lifecycle. */
async function seedAssistantMessage(
  sessionId: string,
  fullContent: string,
  contentBlocks?: Array<
    | { type: 'text'; text: string }
    | { type: 'tool_use'; id: string; name: string; input: string; status: 'running' | 'complete' | 'error'; result?: unknown; error?: string }
    | { type: 'thinking'; text: string }
  >,
) {
  const id = `msg_asst_${Date.now()}`
  // Record the assistant message entry
  await trpcMutate('session.addMessage', {
    sessionId,
    message: { id, role: 'assistant', content: '', timestamp: Date.now() },
  })
  // Finalize with full content + blocks
  await trpcMutate('session.streamFinalize', {
    sessionId,
    messageId: id,
    fullContent,
    stopReason: 'end_turn',
    contentBlocks,
  })
  return id
}

test.describe('Message Segments & Event-Driven Updates', () => {
  let orgId: string

  test.beforeAll(async () => {
    const { org } = await setupTestUserAndOrg()
    orgId = org.id
  })

  test.beforeEach(async ({ page }) => {
    await page.goto('/')
    await expect(page.locator('button:has-text("Home")')).toBeVisible({ timeout: 10000 })
  })

  // ─── Event-driven session list updates ─────────────────────────────────────

  test('session created via API appears in sessions list', async ({ page }) => {
    await page.locator('button:has-text("Sessions")').click()
    await expect(page.locator('h2:has-text("Sessions")')).toBeVisible()

    const title = `SSE Create ${Date.now()}`
    const session = await trpcMutate('session.create', { orgId, title })

    // Should appear via SSE event invalidation (no refetchInterval)
    await expect(page.locator(`text=${title}`)).toBeVisible({ timeout: 5000 })

    await trpcMutate('session.delete', { id: session.id })
  })

  test('session deleted via API disappears from sessions list', async ({ page }) => {
    const title = `SSE Delete ${Date.now()}`
    const session = await trpcMutate('session.create', { orgId, title })

    await page.locator('button:has-text("Sessions")').click()
    await expect(page.locator(`text=${title}`)).toBeVisible({ timeout: 5000 })

    await trpcMutate('session.delete', { id: session.id })
    await expect(page.locator(`text=${title}`)).not.toBeVisible({ timeout: 5000 })
  })

  // ─── Text-only message rendering ───────────────────────────────────────────

  test('text-only assistant message renders as visible card', async ({ page }) => {
    const title = `Text Only ${Date.now()}`
    const session = await trpcMutate('session.create', { orgId, title })

    await seedUserMessage(session.id, 'Hello')
    await seedAssistantMessage(session.id, 'Here is my detailed response.', [
      { type: 'text', text: 'Here is my detailed response.' },
    ])

    await page.locator('button:has-text("Sessions")').click()
    await page.locator(`text=${title}`).click()

    await expect(page.locator('text=Here is my detailed response.')).toBeVisible({ timeout: 5000 })

    await trpcMutate('session.delete', { id: session.id })
  })

  // ─── Activity + text segment rendering ─────────────────────────────────────

  test('activity segment shows tool summary header', async ({ page }) => {
    const title = `Activity ${Date.now()}`
    const session = await trpcMutate('session.create', { orgId, title })

    await seedUserMessage(session.id, 'Read the files')
    await seedAssistantMessage(session.id, 'Done reading.', [
      { type: 'tool_use', id: 'r1', name: 'Read', input: 'file1.ts', status: 'complete' },
      { type: 'tool_use', id: 'r2', name: 'Read', input: 'file2.ts', status: 'complete' },
      { type: 'tool_use', id: 'g1', name: 'Grep', input: 'pattern', status: 'complete' },
      { type: 'text', text: 'Done reading.' },
    ])

    await page.locator('button:has-text("Sessions")').click()
    await page.locator(`text=${title}`).click()

    // Activity header should summarize tools
    await expect(page.locator('text=read 2 files')).toBeVisible({ timeout: 5000 })
    // Text segment should be visible below activity
    await expect(page.locator('text=Done reading.')).toBeVisible()

    await trpcMutate('session.delete', { id: session.id })
  })

  // ─── Interleaved text + activity segments ──────────────────────────────────

  test('interleaved text between tool segments are all visible', async ({ page }) => {
    const title = `Interleaved ${Date.now()}`
    const session = await trpcMutate('session.create', { orgId, title })

    await seedUserMessage(session.id, 'Fix the bug')
    await seedAssistantMessage(session.id, '', [
      { type: 'text', text: 'Investigating the issue.' },
      { type: 'tool_use', id: 't1', name: 'Read', input: 'bug.ts', status: 'complete' },
      { type: 'text', text: 'Found the bug. Fixing now.' },
      { type: 'tool_use', id: 't2', name: 'Edit', input: 'bug.ts', status: 'complete' },
      { type: 'text', text: 'Bug is fixed.' },
    ])

    await page.locator('button:has-text("Sessions")').click()
    await page.locator(`text=${title}`).click()

    // All three text segments should be visible (not hidden in activity fold)
    await expect(page.locator('text=Investigating the issue.')).toBeVisible({ timeout: 5000 })
    await expect(page.locator('text=Found the bug. Fixing now.')).toBeVisible()
    await expect(page.locator('text=Bug is fixed.')).toBeVisible()

    await trpcMutate('session.delete', { id: session.id })
  })

  // ─── Tool error badge ──────────────────────────────────────────────────────

  test('failed tools show error badge in activity header', async ({ page }) => {
    const title = `Errors ${Date.now()}`
    const session = await trpcMutate('session.create', { orgId, title })

    await seedUserMessage(session.id, 'Run a command')
    await seedAssistantMessage(session.id, 'Command failed.', [
      { type: 'tool_use', id: 'b1', name: 'Bash', input: 'exit 1', status: 'error', error: 'exit code 1' },
      { type: 'tool_use', id: 'b2', name: 'Bash', input: 'echo ok', status: 'complete' },
      { type: 'text', text: 'Command failed.' },
    ])

    await page.locator('button:has-text("Sessions")').click()
    await page.locator(`text=${title}`).click()

    // Error badge should be visible in the activity header
    await expect(page.locator('text=1 failed')).toBeVisible({ timeout: 5000 })

    await trpcMutate('session.delete', { id: session.id })
  })
})
