/**
 * Onboarding E2E Tests — SetupGate flow.
 *
 * Tests the 4-step onboarding gate: User → CreateOrg → SelectOrg → InitOrg → Shell.
 * Runs serially because each test modifies shared server state (user, orgs).
 * Must run BEFORE other test suites (configured via Playwright projects).
 */

import { test, expect } from '@playwright/test';
import { resetServerState, setupTestUserAndOrg, trpcMutate, trpcQuery } from './helpers';

test.describe.configure({ mode: 'serial' });

test.describe('Onboarding Flow', () => {
  test('full fresh onboarding — User → CreateOrg → InitOrg → Shell', async ({ page }) => {
    await resetServerState();
    await page.goto('/');

    // Step 1: UserStep — "Welcome to Workforce"
    await expect(page.getByRole('heading', { name: /welcome to workforce/i })).toBeVisible();
    await expect(page.getByText(/what should we call you/i)).toBeVisible();

    // Fill name and submit
    const nameInput = page.locator('#user-name');
    await nameInput.fill('Jane Doe');
    await page.getByRole('button', { name: /continue/i }).click();

    // Step 2: CreateOrgStep — "Let's create your first workspace"
    await expect(page.getByText(/first workspace/i)).toBeVisible({ timeout: 10000 });

    // Should have pre-filled org name from user name
    const orgInput = page.locator('#org-name');
    await expect(orgInput).toHaveValue("Jane Doe's Workspace");
    await page.getByRole('button', { name: /continue/i }).click();

    // Step 4: InitOrgStep — "Set up"
    await expect(page.getByRole('heading', { name: /set up/i })).toBeVisible({ timeout: 10000 });
    await expect(page.getByText(/configure your workspace defaults/i)).toBeVisible();

    // Fill optional description
    const descriptionInput = page.locator('#org-description');
    await descriptionInput.fill('Test workspace for E2E');

    // Submit with defaults (Opus, Auto thinking, Friendly tone, Balanced detail)
    await page.getByRole('button', { name: /get started/i }).click();

    // Should reach the Shell — look for the message input
    await expect(
      page.locator('textarea[placeholder="Ask Workforce anything..."]'),
    ).toBeVisible({ timeout: 10000 });
  });

  test('returning user with initialized org skips all steps', async ({ page }) => {
    await resetServerState();
    await setupTestUserAndOrg('Returning User', 'Active Workspace');

    await page.goto('/');

    // Should skip directly to Shell — no setup gate visible
    await expect(
      page.locator('textarea[placeholder="Ask Workforce anything..."]'),
    ).toBeVisible({ timeout: 10000 });

    // Setup gate headings should NOT be visible
    await expect(page.getByText(/welcome to workforce/i)).not.toBeVisible();
    await expect(page.getByText(/first workspace/i)).not.toBeVisible();
  });

  test('user exists, no org → starts at CreateOrgStep', async ({ page }) => {
    await resetServerState();
    await trpcMutate('user.create', { displayName: 'Existing User' });

    await page.goto('/');

    // Should skip UserStep and show CreateOrgStep
    await expect(page.getByText(/first workspace/i)).toBeVisible({ timeout: 10000 });

    // UserStep should NOT be visible
    await expect(page.getByRole('heading', { name: /welcome to workforce/i })).not.toBeVisible();
  });

  test('user + org exist, org not initialized → starts at InitOrgStep', async ({ page }) => {
    await resetServerState();

    // Create user + org via API, but don't initialize
    await trpcMutate('user.create', { displayName: 'Init User' });
    const org = await trpcMutate('org.create', { name: 'Uninitialized Org' });
    await trpcMutate('org.activate', { id: org.id });

    await page.goto('/');

    // Should skip to InitOrgStep
    await expect(page.getByRole('heading', { name: /set up/i })).toBeVisible({ timeout: 10000 });

    // Previous steps should NOT be visible
    await expect(page.getByRole('heading', { name: /welcome to workforce/i })).not.toBeVisible();
    await expect(page.getByText(/first workspace/i)).not.toBeVisible();
  });

  test('multiple orgs, none selected → shows SelectOrgStep', async ({ page }) => {
    await resetServerState();

    // Create user + 2 initialized orgs, but don't activate either
    await trpcMutate('user.create', { displayName: 'Choosy User' });
    const org1 = await trpcMutate('org.create', { name: 'Workspace Alpha' });
    const org2 = await trpcMutate('org.create', { name: 'Workspace Beta' });
    await trpcMutate('org.update', { id: org1.id, updates: { initialized: true } });
    await trpcMutate('org.update', { id: org2.id, updates: { initialized: true } });

    await page.goto('/');

    // Should show SelectOrgStep with both workspaces
    await expect(page.getByRole('heading', { name: /select a workspace/i })).toBeVisible({ timeout: 10000 });
    await expect(page.getByText('Workspace Alpha')).toBeVisible();
    await expect(page.getByText('Workspace Beta')).toBeVisible();

    // Click one org card → should advance past gate
    await page.getByText('Workspace Alpha').click();
    await expect(
      page.locator('textarea[placeholder="Ask Workforce anything..."]'),
    ).toBeVisible({ timeout: 10000 });
  });

  // Clean up after the suite so the "chromium" project starts fresh
  test.afterAll(async () => {
    await resetServerState();
    await setupTestUserAndOrg();
  });
});
