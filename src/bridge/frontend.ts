/**
 * Legacy bridge - retained only for health-check initialization.
 * All data fetching now goes through tRPC (see @bridge/trpc and @bridge/react).
 */

const BASE_URL = 'http://localhost:4096'

export async function initBridge(): Promise<void> {
  const maxRetries = 10
  for (let i = 0; i < maxRetries; i++) {
    try {
      const res = await fetch(`${BASE_URL}/health`)
      if (res.ok) {
        console.log('[Bridge] Connected to server')
        return
      }
    } catch {
      console.warn(`[Bridge] Server not available, retry ${i + 1}/${maxRetries}...`)
    }
    await new Promise((r) => setTimeout(r, 500))
  }
  throw new Error('Failed to connect to server')
}

export const isBridgeInitialized = true
