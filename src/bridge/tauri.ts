/**
 * Tauri IPC Bridge
 *
 * Connects the SolidJS frontend to the Bun backend via Tauri IPC.
 * Forwards EventBus events and handles user actions.
 */

import { emit, listen } from '@tauri-apps/api/event';
import { getEventBus, type BusEvent } from '../shared/event-bus';

// ============================================================================
// Types
// ============================================================================

interface UserAction {
  id: string;
  action: string;
  payload: unknown;
}

interface ActionResult {
  id: string;
  ok: boolean;
  result?: unknown;
  error?: string;
}

// ============================================================================
// Bridge State
// ============================================================================

let initialized = false;
const pendingActions = new Map<string, {
  resolve: (result: unknown) => void;
  reject: (error: Error) => void;
}>();

// ============================================================================
// Initialization
// ============================================================================

/**
 * Initialize the Tauri IPC bridge.
 * Forwards EventBus events to the Tauri frontend.
 */
export async function initBridge(): Promise<void> {
  if (initialized) return;

  const bus = getEventBus();

  // Forward all EventBus events to Tauri frontend
  bus.on('*', (event: BusEvent) => {
    emit('bus-event', event).catch((err) => {
      console.error('[TauriBridge] Failed to emit event:', err);
    });
  });

  // Listen for user actions from frontend
  await listen<UserAction>('user-action', async (event) => {
    const { id, action, payload } = event.payload;

    try {
      const result = await routeAction(action, payload);
      await emit('action-result', { id, ok: true, result } as ActionResult);
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      bus.emit({
        type: 'BridgeError',
        source: action,
        error,
        timestamp: Date.now(),
      });
      await emit('action-result', { id, ok: false, error } as ActionResult);
    }
  });

  // Listen for action results (for frontend-initiated actions)
  await listen<ActionResult>('action-result', (event) => {
    const { id, ok, result, error } = event.payload;
    const pending = pendingActions.get(id);

    if (pending) {
      pendingActions.delete(id);
      if (ok) {
        pending.resolve(result);
      } else {
        pending.reject(new Error(error ?? 'Unknown error'));
      }
    }
  });

  initialized = true;
  console.log('[TauriBridge] Initialized');
}

// ============================================================================
// Action Routing
// ============================================================================

/**
 * Route user actions to appropriate handlers.
 */
async function routeAction(action: string, payload: unknown): Promise<unknown> {
  switch (action) {
    case 'query':
      return handleQuery(payload as { prompt: string });

    case 'cancel':
      return handleCancel();

    case 'session:create':
      return handleSessionCreate();

    case 'session:resume':
      return handleSessionResume(payload as { sessionId: string });

    case 'session:list':
      return handleSessionList();

    case 'session:delete':
      return handleSessionDelete(payload as { sessionId: string });

    case 'session:fork':
      return handleSessionFork(payload as { sessionId: string });

    default:
      throw new Error(`Unknown action: ${action}`);
  }
}

// ============================================================================
// Action Handlers
// ============================================================================

async function handleQuery(payload: { prompt: string }): Promise<void> {
  const { getAgentService } = await import('../services/agent');
  const service = getAgentService();

  // Stream tokens - events are forwarded via EventBus
  for await (const _delta of service.query(payload.prompt)) {
    // Tokens are emitted via EventBus, no action needed here
  }
}

async function handleCancel(): Promise<void> {
  const { getAgentService } = await import('../services/agent');
  const service = getAgentService();
  service.cancel();
}

async function handleSessionCreate(): Promise<{ sessionId: string }> {
  const { getSessionService } = await import('../services/session');
  const service = getSessionService();
  const session = await service.create();
  return { sessionId: session.id };
}

async function handleSessionResume(payload: { sessionId: string }): Promise<void> {
  const { getSessionService } = await import('../services/session');
  const service = getSessionService();
  await service.resume(payload.sessionId);
}

async function handleSessionList(): Promise<unknown[]> {
  const { getSessionService } = await import('../services/session');
  const service = getSessionService();
  return service.list();
}

async function handleSessionDelete(payload: { sessionId: string }): Promise<void> {
  const { getSessionService } = await import('../services/session');
  const service = getSessionService();
  await service.delete(payload.sessionId);
}

async function handleSessionFork(payload: { sessionId: string }): Promise<unknown> {
  const { getSessionService } = await import('../services/session');
  const service = getSessionService();
  return service.fork(payload.sessionId);
}

// ============================================================================
// Frontend API
// ============================================================================

/**
 * Send an action to the backend and wait for result.
 */
export async function sendAction<T = unknown>(action: string, payload?: unknown): Promise<T> {
  const id = `action_${Date.now()}_${Math.random().toString(36).slice(2)}`;

  return new Promise((resolve, reject) => {
    pendingActions.set(id, { resolve: resolve as (v: unknown) => void, reject });

    emit('user-action', { id, action, payload }).catch((err) => {
      pendingActions.delete(id);
      reject(err);
    });

    // Timeout after 30 seconds
    setTimeout(() => {
      if (pendingActions.has(id)) {
        pendingActions.delete(id);
        reject(new Error('Action timeout'));
      }
    }, 30000);
  });
}

/**
 * Subscribe to EventBus events from backend.
 */
export async function onBusEvent(callback: (event: BusEvent) => void): Promise<() => void> {
  const unlisten = await listen<BusEvent>('bus-event', (event) => {
    callback(event.payload);
  });

  return unlisten;
}

// ============================================================================
// Exports
// ============================================================================

export { initialized as isBridgeInitialized };
