/**
 * Shared E2E test helpers.
 *
 * Provides tRPC API helpers and common setup/teardown routines
 * so individual test files don't duplicate boilerplate.
 */

export const SERVER_URL = `http://localhost:${process.env.WORKFORCE_E2E_API_PORT || '4199'}`;

/**
 * Call a tRPC mutation on the test server.
 * POST /api/trpc/<procedure> with body { json: input }
 */
export async function trpcMutate(procedure: string, input: unknown = {}) {
  const res = await fetch(`${SERVER_URL}/api/trpc/${procedure}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ json: input }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`tRPC ${procedure} failed (${res.status}): ${text}`);
  }
  const body = await res.json();
  return body.result?.data?.json ?? body.result?.data;
}

/**
 * Call a tRPC query on the test server.
 * GET /api/trpc/<procedure>?input=<encoded-json>
 */
export async function trpcQuery(procedure: string, input?: unknown) {
  const params = input !== undefined
    ? `?input=${encodeURIComponent(JSON.stringify({ json: input }))}`
    : '';
  const res = await fetch(`${SERVER_URL}/api/trpc/${procedure}${params}`);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`tRPC ${procedure} failed (${res.status}): ${text}`);
  }
  const body = await res.json();
  return body.result?.data?.json ?? body.result?.data;
}

/**
 * Delete all orgs and user — clean slate for onboarding tests.
 * Errors are swallowed (state may already be clean).
 */
export async function resetServerState() {
  try {
    const orgs = await trpcQuery('org.list');
    for (const org of orgs ?? []) {
      await trpcMutate('org.delete', { id: org.id });
    }
  } catch { /* already clean */ }
  try {
    await trpcMutate('user.delete', {});
  } catch { /* no user is fine */ }
}

/**
 * Set up a user + initialized org — fast path past the setup gate.
 * Idempotent: skips creation if user/org already exist.
 * Returns the active org for use in tests.
 */
export async function setupTestUserAndOrg(
  userName = 'Test User',
  orgName = 'Test Org',
) {
  // Create user (skip if already exists)
  try {
    await trpcMutate('user.create', { displayName: userName });
  } catch { /* user already exists */ }

  // Create org if none exist
  const existingOrgs = await trpcQuery('org.list');
  let org;
  if (!existingOrgs?.length) {
    org = await trpcMutate('org.create', { name: orgName });
  } else {
    org = existingOrgs[0];
  }

  // Ensure activated + initialized
  await trpcMutate('org.activate', { id: org.id });
  if (!org.initialized) {
    await trpcMutate('org.update', { id: org.id, updates: { initialized: true } });
  }

  return { org };
}
