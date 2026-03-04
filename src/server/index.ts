import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { serve } from '@hono/node-server'
import { serveStatic } from '@hono/node-server/serve-static'
import { existsSync, readFileSync, writeFileSync, unlinkSync } from 'fs'
import { homedir } from 'os'
import { join, dirname, resolve } from 'path'
import { fileURLToPath } from 'url'
import { debugLog, getLogPath } from '@/shared/debug-log'
import { getLogService } from '@/services/log'
import { getAgentService } from '@/services/agent'
import { appRouter } from './routers'
import { trpcServer } from '@hono/trpc-server'
import type { ServerType } from '@hono/node-server'

const __dirname = dirname(fileURLToPath(import.meta.url))

// Eagerly create the AgentService singleton at module-load time so the Claude
// SDK subprocess and model cache begin loading as early as possible — well
// before the HTTP server is bound or the first UI request arrives.
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

export const app = new Hono()

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

// Health check — also polled by Electron main process at startup
app.get('/health', (c) => c.json({ ok: true }))

app.get('/debug-log', async (c) => {
  const logPath = getLogPath()
  try {
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
// In Electron production bundle: __dirname = Resources/app.asar.unpacked/.vite/build/ → ../../dist
// The asar.unpack config extracts dist/ to app.asar.unpacked/ so non-Electron
// fs APIs (like @hono/node-server serveStatic) can read the files.
// In dev standalone: __dirname = <project>/src/server/ → ../../dist
const distCandidates = [
  join(__dirname, '../dist'),
  join(__dirname, '../../dist'),
  // Electron asar.unpacked path: .vite/build → app.asar.unpacked/dist
  join(__dirname.replace('app.asar', 'app.asar.unpacked'), '../dist'),
  join(__dirname.replace('app.asar', 'app.asar.unpacked'), '../../dist'),
];
const distPath = distCandidates.find((p) => existsSync(p));
if (distPath) {
  app.use('*', serveStatic({ root: distPath }))
  // SPA fallback: serve index.html for non-API paths that don't match a static file
  const indexPath = join(distPath, 'index.html');
  if (existsSync(indexPath)) {
    const indexHtml = readFileSync(indexPath, 'utf-8');
    app.get('*', (c) => c.html(indexHtml))
  }
}

const DEV_PORT_FILE = join(__dirname, '../../.dev-port')

function tryServe(port: number): ServerType {
  const server = serve({
    fetch: app.fetch,
    port,
    hostname: 'localhost',
  })
  // SSE connections are long-lived; prevent premature closure
  if ('keepAliveTimeout' in server) server.keepAliveTimeout = 120_000
  return server
}

export function startServer(overrides?: { port?: number }) {
  const basePort = overrides?.port ?? parseInt(process.env.PORT || '4096')
  const server = tryServe(basePort)

  // Retrieve the actual bound port
  const addr = server.address()
  const actualPort = typeof addr === 'object' && addr ? addr.port : basePort

  // Write actual port so vite can discover it
  if (isMainModule) {
    writeFileSync(DEV_PORT_FILE, String(actualPort))
    process.on('exit', () => { try { unlinkSync(DEV_PORT_FILE) } catch { /* cleanup best-effort */ } })
    process.on('SIGINT', () => process.exit(0))
    process.on('SIGTERM', () => process.exit(0))
  }

  logAuthDiagnostics()
  debugLog('Server', `Workforce server running on http://localhost:${actualPort}`)

  // Warm up model list cache eagerly so it's ready before the first query.
  getAgentService().getSupportedModels().then(
    (models) => debugLog('Server', `Model cache warmed: ${models.length} models`),
    (err) => debugLog('Server', 'Model cache warm-up failed (will retry on demand)', { error: err instanceof Error ? err.message : String(err) }),
  )

  return server
}

// Standalone mode (tsx src/server/index.ts)
const isMainModule = process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])
if (isMainModule) startServer()
