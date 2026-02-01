import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { streamSSE } from 'hono/streaming'
import { existsSync } from 'fs'
import { homedir } from 'os'
import { getAgentService } from '../services/agent'
import { getSessionService } from '../services/session'
import { getEventBus } from '../shared/event-bus'

/**
 * Log auth-related diagnostics on server startup.
 * Helps debug auth issues when Tauri spawns the sidecar.
 */
function logAuthDiagnostics() {
  const home = process.env.HOME || homedir()
  const credPath = `${home}/.claude/.credentials.json`

  console.log('[Auth Diagnostics]')
  console.log('  CWD:', process.cwd())
  console.log('  HOME:', home)
  console.log('  Credentials file exists:', existsSync(credPath))
  console.log('  ANTHROPIC_API_KEY set:', !!process.env.ANTHROPIC_API_KEY)
  console.log('  ANTHROPIC_AUTH_TOKEN set:', !!process.env.ANTHROPIC_AUTH_TOKEN)
  console.log('  PID:', process.pid)
  console.log('  PPID:', process.ppid)
}

const app = new Hono()

app.use('*', cors())

app.get('/health', (c) => c.json({ ok: true }))

/**
 * Check auth configuration without making an API call.
 * Returns diagnostic info about available auth sources.
 *
 * NOTE: The SDK subprocess handles token refresh internally.
 * Even if the stored token is expired, the SDK will refresh it.
 */
app.get('/auth-check', async (c) => {
  const home = process.env.HOME || homedir()
  const credPath = `${home}/.claude/.credentials.json`

  const result: {
    hasCredentialsFile: boolean
    hasApiKey: boolean
    hasAuthToken: boolean
    credentialsFileReadable: boolean
    tokenExpired?: boolean
    hasRefreshToken?: boolean
    credentialsError?: string
    home: string
    cwd: string
    pid: number
    ppid: number
    note?: string
  } = {
    hasCredentialsFile: existsSync(credPath),
    hasApiKey: !!process.env.ANTHROPIC_API_KEY,
    hasAuthToken: !!process.env.ANTHROPIC_AUTH_TOKEN,
    credentialsFileReadable: false,
    home,
    cwd: process.cwd(),
    pid: process.pid,
    ppid: process.ppid,
  }

  // Try to read and parse credentials file
  if (result.hasCredentialsFile) {
    try {
      const { readFileSync } = await import('fs')
      const content = readFileSync(credPath, 'utf-8')
      const creds = JSON.parse(content)
      result.credentialsFileReadable = true

      // Check OAuth token status
      if (creds.claudeAiOauth) {
        result.hasRefreshToken = !!creds.claudeAiOauth.refreshToken
        if (creds.claudeAiOauth.expiresAt) {
          result.tokenExpired = creds.claudeAiOauth.expiresAt < Date.now()
        }
      }
    } catch (err) {
      result.credentialsError = err instanceof Error ? err.message : String(err)
    }
  }

  // SDK handles token refresh, so credentials file is sufficient
  const hasAnyAuth = result.hasCredentialsFile || result.hasApiKey || result.hasAuthToken

  if (result.tokenExpired && result.hasRefreshToken) {
    result.note = 'Token expired but refresh token available - SDK will refresh automatically'
  }

  return c.json({ authenticated: hasAnyAuth, ...result }, hasAnyAuth ? 200 : 401)
})

app.post('/query', async (c) => {
  const { prompt } = await c.req.json<{ prompt: string }>()
  const agent = getAgentService()

  return streamSSE(c, async (stream) => {
    try {
      for await (const delta of agent.query(prompt)) {
        await stream.writeSSE({ data: delta.token })
      }
      await stream.writeSSE({ event: 'done', data: '' })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      await stream.writeSSE({ event: 'error', data: message })
    }
  })
})

app.post('/cancel', (c) => {
  const agent = getAgentService()
  agent.cancel()
  return c.json({ ok: true })
})

app.get('/session', async (c) => {
  const sessions = await getSessionService().list()
  return c.json(sessions)
})

app.post('/session', async (c) => {
  const session = await getSessionService().create()
  return c.json(session)
})

app.post('/session/:id/resume', async (c) => {
  const session = await getSessionService().resume(c.req.param('id'))
  return c.json(session)
})

app.post('/session/:id/fork', async (c) => {
  const session = await getSessionService().fork(c.req.param('id'))
  return c.json(session)
})

app.delete('/session/:id', async (c) => {
  await getSessionService().delete(c.req.param('id'))
  return c.json({ ok: true })
})

app.get('/events', async (c) => {
  const bus = getEventBus()

  return streamSSE(c, async (stream) => {
    const unsubscribe = bus.on('*', (event) => {
      stream.writeSSE({ data: JSON.stringify(event) })
    })

    stream.onAbort(() => unsubscribe())

    while (true) {
      await stream.sleep(30000)
    }
  })
})

const port = parseInt(process.env.PORT || '4096')

export default {
  port,
  fetch: app.fetch,
}

// Log diagnostics on startup to help debug auth issues
logAuthDiagnostics()
console.log(`Fuxi server running on http://localhost:${port}`)
