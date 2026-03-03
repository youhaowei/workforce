import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { serveStatic } from 'hono/bun'
import { trpcServer } from '@hono/trpc-server'
import { existsSync, writeFileSync, unlinkSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'
import { debugLog, getLogPath } from '@/shared/debug-log'
import { getLogService } from '@/services/log'
import { getAgentService } from '@/services/agent'
import { appRouter } from './routers'

// Eagerly create the AgentService singleton at module-load time so the Claude
// SDK subprocess and model cache begin loading as early as possible — well
// before the HTTP server is bound or the first UI request arrives.
// In production (Electron), this runs as soon as the Bun subprocess starts;
// in dev, as soon as `bun run server:watch` evaluates the entry point.
getAgentService();

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

// Health check — also polled by Electron main process at startup (see src/shared/constants.ts)
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
// In Electron production bundle: import.meta.dir = Resources/app/src/server/ → ../../dist
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

const DEV_PORT_FILE = join(import.meta.dir, '../../.dev-port')

function tryServe(port: number): ReturnType<typeof Bun.serve> {
  try {
    return Bun.serve({
      port,
      hostname: 'localhost',
      fetch: app.fetch,
      idleTimeout: 120,
    })
  } catch {
    // Port in use — let the OS assign a free one
    debugLog('Server', `Port ${port} in use, requesting OS-assigned port`)
    return Bun.serve({
      port: 0,
      hostname: 'localhost',
      fetch: app.fetch,
      idleTimeout: 120,
    })
  }
}

export function startServer(overrides?: { port?: number }) {
  const basePort = overrides?.port ?? parseInt(process.env.PORT || '4096')
  const server = tryServe(basePort)

  // Write actual port so vite can discover it
  if (import.meta.main) {
    writeFileSync(DEV_PORT_FILE, String(server.port))
    process.on('exit', () => { try { unlinkSync(DEV_PORT_FILE) } catch { /* cleanup best-effort */ } })
    process.on('SIGINT', () => process.exit(0))
    process.on('SIGTERM', () => process.exit(0))
  }

  logAuthDiagnostics()
  debugLog('Server', `Workforce server running on ${server.url}`)

  // Warm up model list cache eagerly so it's ready before the first query.
  // getSupportedModels() will first try disk cache (instant) then refresh
  // from the SDK subprocess in the background. Concurrent callers during
  // warm-up piggyback on the same in-flight promise, avoiding duplicate
  // subprocess spawns.
  getAgentService().getSupportedModels().then(
    (models) => debugLog('Server', `Model cache warmed: ${models.length} models`),
    (err) => debugLog('Server', 'Model cache warm-up failed (will retry on demand)', { error: err instanceof Error ? err.message : String(err) }),
  )

  return server
}

// Standalone mode (bun run server)
if (import.meta.main) startServer()
