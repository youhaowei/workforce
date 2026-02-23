import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { serveStatic } from 'hono/bun'
import { trpcServer } from '@hono/trpc-server'
import { existsSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'
import { debugLog, getLogPath } from '@/shared/debug-log'
import { getLogService } from '@/services/log'
import { appRouter } from './routers'

/**
 * Log auth-related diagnostics on server startup.
 * Helps debug auth issues in desktop or standalone mode.
 */
function logAuthDiagnostics() {
  const home = process.env.HOME || homedir()
  const credPath = `${home}/.claude/.credentials.json`
  const log = getLogService()

  log.info('general', 'Auth diagnostics', {
    cwd: process.cwd(),
    home,
    credentialsExist: existsSync(credPath),
    anthropicApiKeySet: !!process.env.ANTHROPIC_API_KEY,
    anthropicAuthTokenSet: !!process.env.ANTHROPIC_AUTH_TOKEN,
    pid: process.pid,
    ppid: process.ppid,
  })
}

const app = new Hono()

// Trusted-local threat model: server binds to localhost:4096, only the local
// desktop webview (or dev browser on localhost) should access it.
const ALLOWED_ORIGINS = new Set(['localhost', '127.0.0.1']);

app.use('*', cors({
  origin: (origin) => {
    if (!origin) return origin as string;  // same-origin / non-browser
    try {
      const url = new URL(origin);
      if (ALLOWED_ORIGINS.has(url.hostname)) return origin;
    } catch { /* invalid origin */ }
    return undefined as unknown as string;  // reject — no ACAO header
  },
}))

// tRPC endpoint — all routers available at /api/trpc/*
app.use('/api/trpc/*', trpcServer({ router: appRouter }))

app.get('/health', (c) => c.json({ ok: true }))

app.get('/debug-log', async (c) => {
  const logPath = getLogPath()
  try {
    const { readFileSync } = await import('fs')
    const content = readFileSync(logPath, 'utf-8')
    // Return last 200 lines
    const lines = content.split('\n')
    const lastLines = lines.slice(-200).join('\n')
    return c.text(`Log file: ${logPath}\n\n${lastLines}`)
  } catch (err) {
    return c.text(`Log file: ${logPath}\nError reading log: ${err}`)
  }
})

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

// Serve Vite build output in production (same-origin, no CORS needed).
// In Electrobun production bundle: import.meta.dir = Resources/app/bun/ → ../dist
// In dev standalone: import.meta.dir = <project>/src/server/ → ../../dist
const distCandidates = [join(import.meta.dir, '../dist'), join(import.meta.dir, '../../dist')];
const distPath = distCandidates.find((p) => existsSync(p));
if (distPath) {
  app.use('*', serveStatic({ root: distPath }))
  // SPA fallback: serve index.html for non-API paths that don't match a static file
  const indexPath = join(distPath, 'index.html');
  if (existsSync(indexPath)) {
    const indexHtml = Bun.file(indexPath).text();
    app.get('*', async (c) => c.html(await indexHtml))
  }
}

export function startServer(overrides?: { port?: number }) {
  const port = overrides?.port ?? parseInt(process.env.PORT || '4096')
  const server = Bun.serve({
    port,
    hostname: 'localhost',
    fetch: app.fetch,
    // SSE streams may have long pauses while waiting for SDK responses
    // Default 10s timeout is too short for agent queries
    idleTimeout: 120, // 2 minutes
  })

  logAuthDiagnostics()
  debugLog('Server', `Workforce server running on ${server.url}`)
  return server
}

// Standalone mode (bun run server)
if (import.meta.main) startServer()
