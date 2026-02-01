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

export async function sendAction<T = unknown>(action: string, payload?: unknown): Promise<T> {
  const routes: Record<string, { method: string; path: string | ((p: unknown) => string) }> = {
    'cancel': { method: 'POST', path: '/cancel' },
    'session:list': { method: 'GET', path: '/session' },
    'session:create': { method: 'POST', path: '/session' },
    'session:resume': { method: 'POST', path: (p) => `/session/${(p as { sessionId: string }).sessionId}/resume` },
    'session:fork': { method: 'POST', path: (p) => `/session/${(p as { sessionId: string }).sessionId}/fork` },
    'session:delete': { method: 'DELETE', path: (p) => `/session/${(p as { sessionId: string }).sessionId}` },
  }

  const route = routes[action]
  if (!route) throw new Error(`Unknown action: ${action}`)

  const path = typeof route.path === 'function' ? route.path(payload) : route.path
  const url = `${BASE_URL}${path}`

  const res = await fetch(url, {
    method: route.method,
    headers: route.method !== 'GET' ? { 'Content-Type': 'application/json' } : undefined,
    body: route.method !== 'GET' && payload ? JSON.stringify(payload) : undefined,
  })

  if (!res.ok) {
    throw new Error(`Action failed: ${res.statusText}`)
  }

  return res.json() as Promise<T>
}

export function streamQuery(
  prompt: string,
  onToken: (token: string) => void,
  onDone: () => void,
  onError: (err: string) => void
): () => void {
  const controller = new AbortController()

  fetch(`${BASE_URL}/query`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt }),
    signal: controller.signal,
  }).then(async (res) => {
    if (!res.ok || !res.body) {
      onError('Failed to start stream')
      return
    }

    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''

    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() || ''

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i]
        if (line.startsWith('event: error')) {
          const nextLine = lines[i + 1]
          const errorMsg = nextLine?.startsWith('data:') 
            ? nextLine.slice(5).trim() 
            : 'Unknown error'
          onError(errorMsg || 'Stream error')
          return
        } else if (line.startsWith('event: done')) {
          onDone()
          return
        } else if (line.startsWith('data:')) {
          const data = line.slice(5).trim()
          if (data) onToken(data)
        }
      }
    }
    onDone()
  }).catch((err) => {
    if (err.name !== 'AbortError') {
      onError(err.message)
    }
  })

  return () => controller.abort()
}

export async function subscribeToEvents(
  onEvent: (event: unknown) => void
): Promise<() => void> {
  const controller = new AbortController()

  fetch(`${BASE_URL}/events`, { signal: controller.signal })
    .then(async (res) => {
      if (!res.body) return
      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() || ''

        for (const line of lines) {
          if (line.startsWith('data:')) {
            const data = line.slice(5).trim()
            if (data) {
              try {
                onEvent(JSON.parse(data))
              } catch {}
            }
          }
        }
      }
    })
    .catch(() => {})

  return () => controller.abort()
}

export const isBridgeInitialized = true
