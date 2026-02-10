import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { streamSSE } from 'hono/streaming'
import { trpcServer } from '@hono/trpc-server'
import { existsSync } from 'fs'
import { homedir } from 'os'
import { getAgentService } from '../services/agent'
import { getSessionService } from '../services/session'
import { getWorkspaceService } from '../services/workspace'
import { getTemplateService } from '../services/template'
import { getWorktreeService } from '../services/worktree'
import { createOrchestrationService } from '../services/orchestration'
import { createWorkflowService } from '../services/workflow'
import { createReviewService } from '../services/review'
import { createAuditService } from '../services/audit'
import { getEventBus } from '../shared/event-bus'
import { debugLog, getLogPath } from '../shared/debug-log'
import { appRouter } from './routers'

/**
 * Log auth-related diagnostics on server startup.
 * Helps debug auth issues when Tauri spawns the Workforce.
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

app.post('/query', async (c) => {
  const { prompt } = await c.req.json<{ prompt: string }>()
  debugLog('Server', '/query received', { prompt: prompt.slice(0, 100) })
  const agent = getAgentService()

  return streamSSE(c, async (stream) => {
    let tokenCount = 0
    try {
      debugLog('Server', 'Starting agent.query iteration')
      for await (const delta of agent.query(prompt)) {
        tokenCount++
        if (tokenCount <= 5) debugLog('Server', 'Token received', { index: tokenCount, preview: delta.token.slice(0, 50) })
        await stream.writeSSE({ data: delta.token })
      }
      debugLog('Server', 'Stream complete', { totalTokens: tokenCount })
      await stream.writeSSE({ event: 'done', data: '' })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      debugLog('Server', 'Query error', { error: message })
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

// =============================================================================
// Workspace Routes
// =============================================================================

app.get('/workspace', async (c) => {
  const workspaces = await getWorkspaceService().list()
  return c.json(workspaces)
})

app.post('/workspace', async (c) => {
  const { name, rootPath } = await c.req.json<{ name: string; rootPath: string }>()
  const workspace = await getWorkspaceService().create(name, rootPath)
  return c.json(workspace, 201)
})

app.get('/workspace/:id', async (c) => {
  const workspace = await getWorkspaceService().get(c.req.param('id'))
  if (!workspace) return c.json({ error: 'Not found' }, 404)
  return c.json(workspace)
})

app.put('/workspace/:id', async (c) => {
  const updates = await c.req.json()
  const workspace = await getWorkspaceService().update(c.req.param('id'), updates)
  return c.json(workspace)
})

app.delete('/workspace/:id', async (c) => {
  await getWorkspaceService().delete(c.req.param('id'))
  return c.json({ ok: true })
})

app.post('/workspace/:id/activate', async (c) => {
  const workspace = await getWorkspaceService().get(c.req.param('id'))
  if (!workspace) return c.json({ error: 'Not found' }, 404)
  getWorkspaceService().setCurrent(workspace)
  return c.json(workspace)
})

// =============================================================================
// Template Routes
// =============================================================================

app.get('/workspace/:wid/template', async (c) => {
  const includeArchived = c.req.query('includeArchived') === 'true'
  const templates = await getTemplateService().list(c.req.param('wid'), { includeArchived })
  return c.json(templates)
})

app.post('/workspace/:wid/template', async (c) => {
  const body = await c.req.json()
  const template = await getTemplateService().create(c.req.param('wid'), body)
  return c.json(template, 201)
})

app.get('/workspace/:wid/template/:id', async (c) => {
  const template = await getTemplateService().get(c.req.param('wid'), c.req.param('id'))
  if (!template) return c.json({ error: 'Not found' }, 404)
  return c.json(template)
})

app.put('/workspace/:wid/template/:id', async (c) => {
  const updates = await c.req.json()
  const template = await getTemplateService().update(c.req.param('wid'), c.req.param('id'), updates)
  return c.json(template)
})

app.post('/workspace/:wid/template/:id/duplicate', async (c) => {
  const template = await getTemplateService().duplicate(c.req.param('wid'), c.req.param('id'))
  return c.json(template, 201)
})

app.post('/workspace/:wid/template/:id/archive', async (c) => {
  await getTemplateService().archive(c.req.param('wid'), c.req.param('id'))
  return c.json({ ok: true })
})

app.post('/workspace/:wid/template/:id/validate', async (c) => {
  const template = await getTemplateService().get(c.req.param('wid'), c.req.param('id'))
  if (!template) return c.json({ error: 'Not found' }, 404)
  const validation = getTemplateService().validate(template)
  return c.json(validation)
})

// =============================================================================
// Session Lifecycle Routes
// =============================================================================

app.post('/session/:id/transition', async (c) => {
  const { state, reason, actor } = await c.req.json<{
    state: string; reason: string; actor?: 'system' | 'user' | 'agent'
  }>()
  const session = await getSessionService().transitionState(
    c.req.param('id'),
    state as import('../services/types').LifecycleState,
    reason,
    actor
  )
  return c.json(session)
})

app.get('/session/:id/children', async (c) => {
  const children = await getSessionService().getChildren(c.req.param('id'))
  return c.json(children)
})

// =============================================================================
// Orchestration Routes (Phase 2)
// =============================================================================

// Lazy-init orchestration service (composes other services)
let _orchestrationService: ReturnType<typeof createOrchestrationService> | null = null
function getOrchestrationService() {
  if (!_orchestrationService) {
    _orchestrationService = createOrchestrationService(
      getSessionService(),
      getTemplateService(),
      getWorktreeService(),
      getWorkflowServiceInstance()
    )
  }
  return _orchestrationService
}

let _workflowService: ReturnType<typeof createWorkflowService> | null = null
function getWorkflowServiceInstance() {
  return (_workflowService ??= createWorkflowService())
}

app.post('/workspace/:wid/spawn', async (c) => {
  const { templateId, goal, parentSessionId, isolateWorktree } = await c.req.json<{
    templateId: string; goal: string; parentSessionId?: string; isolateWorktree?: boolean
  }>()
  const session = await getOrchestrationService().spawn({
    templateId,
    goal,
    parentSessionId,
    workspaceId: c.req.param('wid'),
    isolateWorktree,
  })
  return c.json(session, 201)
})

app.post('/session/:id/cancel-agent', async (c) => {
  const { reason } = await c.req.json<{ reason?: string }>().catch(() => ({ reason: undefined }))
  await getOrchestrationService().cancel(c.req.param('id'), reason)
  return c.json({ ok: true })
})

app.post('/session/:id/pause-agent', async (c) => {
  const { reason } = await c.req.json<{ reason: string }>()
  await getOrchestrationService().pause(c.req.param('id'), reason)
  return c.json({ ok: true })
})

app.post('/session/:id/resume-agent', async (c) => {
  await getOrchestrationService().resume(c.req.param('id'))
  return c.json({ ok: true })
})

app.get('/session/:id/progress', async (c) => {
  const progress = await getOrchestrationService().getAggregateProgress(c.req.param('id'))
  return c.json(progress)
})

// =============================================================================
// Workflow Routes (Phase 2)
// =============================================================================

app.get('/workspace/:wid/workflow', async (c) => {
  const includeArchived = c.req.query('includeArchived') === 'true'
  const workflows = await getWorkflowServiceInstance().list(c.req.param('wid'), { includeArchived })
  return c.json(workflows)
})

app.post('/workspace/:wid/workflow', async (c) => {
  const body = await c.req.json()
  const workflow = await getWorkflowServiceInstance().create(c.req.param('wid'), body)
  return c.json(workflow, 201)
})

app.get('/workspace/:wid/workflow/:id', async (c) => {
  const workflow = await getWorkflowServiceInstance().get(c.req.param('wid'), c.req.param('id'))
  if (!workflow) return c.json({ error: 'Not found' }, 404)
  return c.json(workflow)
})

app.put('/workspace/:wid/workflow/:id', async (c) => {
  const updates = await c.req.json()
  const workflow = await getWorkflowServiceInstance().update(c.req.param('wid'), c.req.param('id'), updates)
  return c.json(workflow)
})

app.post('/workspace/:wid/workflow/:id/execute', async (c) => {
  const session = await getOrchestrationService().executeWorkflow(c.req.param('id'), c.req.param('wid'))
  return c.json(session, 201)
})

app.post('/workspace/:wid/workflow/:id/validate', async (c) => {
  const workflow = await getWorkflowServiceInstance().get(c.req.param('wid'), c.req.param('id'))
  if (!workflow) return c.json({ error: 'Not found' }, 404)
  const validation = getWorkflowServiceInstance().validate(workflow)
  return c.json(validation)
})

app.post('/workspace/:wid/workflow/:id/archive', async (c) => {
  await getWorkflowServiceInstance().archive(c.req.param('wid'), c.req.param('id'))
  return c.json({ ok: true })
})

// =============================================================================
// Worktree Routes (Phase 2)
// =============================================================================

app.get('/session/:id/worktree', async (c) => {
  const info = getWorktreeService().getForSession(c.req.param('id'))
  if (!info) return c.json({ error: 'No worktree for session' }, 404)
  return c.json(info)
})

app.get('/session/:id/worktree/diff', async (c) => {
  const diff = await getWorktreeService().getDiff(c.req.param('id'))
  return c.json({ diff })
})

app.post('/session/:id/worktree/merge', async (c) => {
  const { strategy } = await c.req.json<{ strategy?: 'merge' | 'rebase' }>().catch(() => ({ strategy: undefined }))
  const result = await getWorktreeService().merge(c.req.param('id'), strategy)
  return c.json(result)
})

app.post('/session/:id/worktree/archive', async (c) => {
  await getWorktreeService().archive(c.req.param('id'))
  return c.json({ ok: true })
})

// =============================================================================
// Review Queue Routes (Phase 3)
// =============================================================================

let _reviewService: ReturnType<typeof createReviewService> | null = null
function getReviewService() {
  return (_reviewService ??= createReviewService())
}

let _auditService: ReturnType<typeof createAuditService> | null = null
function getAuditService() {
  return (_auditService ??= createAuditService())
}

app.get('/workspace/:wid/review', async (c) => {
  const status = c.req.query('status') as 'pending' | 'resolved' | undefined
  const items = await getReviewService().list({ workspaceId: c.req.param('wid'), status })
  return c.json(items)
})

app.get('/workspace/:wid/review/pending', async (c) => {
  const items = await getReviewService().listPending(c.req.param('wid'))
  return c.json(items)
})

app.get('/workspace/:wid/review/count', async (c) => {
  const count = await getReviewService().pendingCount(c.req.param('wid'))
  return c.json({ count })
})

app.get('/workspace/:wid/review/:id', async (c) => {
  const item = await getReviewService().get(c.req.param('id'), c.req.param('wid'))
  if (!item) return c.json({ error: 'Not found' }, 404)
  return c.json(item)
})

app.post('/workspace/:wid/review/:id/resolve', async (c) => {
  const { action, comment } = await c.req.json<{ action: string; comment?: string }>()
  const item = await getReviewService().resolve(
    c.req.param('id'),
    c.req.param('wid'),
    action as import('../services/types').ReviewAction,
    comment
  )
  return c.json(item)
})

// =============================================================================
// Audit Trail Routes (Phase 3)
// =============================================================================

app.get('/workspace/:wid/audit', async (c) => {
  const limit = c.req.query('limit') ? parseInt(c.req.query('limit')!) : undefined
  const offset = c.req.query('offset') ? parseInt(c.req.query('offset')!) : undefined
  const type = c.req.query('type') as import('../services/types').AuditEntryType | undefined
  const entries = await getAuditService().getForWorkspace(c.req.param('wid'), { limit, offset, type })
  return c.json(entries)
})

app.get('/session/:id/audit', async (c) => {
  const workspaceId = c.req.query('workspaceId')
  if (!workspaceId) return c.json({ error: 'workspaceId query param required' }, 400)
  const entries = await getAuditService().getForSession(c.req.param('id'), workspaceId)
  return c.json(entries)
})

// =============================================================================
// Events SSE
// =============================================================================

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
  // SSE streams may have long pauses while waiting for SDK responses
  // Default 10s timeout is too short for agent queries
  idleTimeout: 120, // 2 minutes
}

// Log diagnostics on startup to help debug auth issues
logAuthDiagnostics()
console.log(`Workforce server running on http://localhost:${port}`)
