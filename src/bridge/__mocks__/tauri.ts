/**
 * Mock Tauri Bridge for Component Testing
 * 
 * Provides mocked versions of the Tauri IPC bridge functions
 * for use in SolidJS component tests.
 */

import { vi } from 'vitest';
import type { BusEvent } from '../../shared/event-bus';

// ============================================================================
// Mock State
// ============================================================================

let eventListeners: ((event: BusEvent) => void)[] = [];
let initialized = false;

// ============================================================================
// Mock Functions
// ============================================================================

/**
 * Mock initBridge - simulates bridge initialization
 */
export const initBridge = vi.fn(async (): Promise<void> => {
  initialized = true;
});

/**
 * Mock sendAction - simulates sending actions to backend
 * Returns configurable mock responses
 */
export const sendAction = vi.fn(async <T = unknown>(
  action: string,
  _payload?: unknown
): Promise<T> => {
  // Default mock responses by action type
  switch (action) {
    case 'query':
      return undefined as T;
    case 'cancel':
      return undefined as T;
    case 'session:create':
      return { sessionId: `mock_session_${Date.now()}` } as T;
    case 'session:list':
      return [] as T;
    case 'session:resume':
      return undefined as T;
    default:
      return undefined as T;
  }
});

/**
 * Mock onBusEvent - simulates subscribing to EventBus events
 * Returns an unsubscribe function
 */
export const onBusEvent = vi.fn(async (
  callback: (event: BusEvent) => void
): Promise<() => void> => {
  eventListeners.push(callback);
  return () => {
    eventListeners = eventListeners.filter((l) => l !== callback);
  };
});

/**
 * Check if bridge is initialized (for testing)
 */
export const isBridgeInitialized = (): boolean => initialized;

// ============================================================================
// Test Utilities
// ============================================================================

/**
 * Emit a mock event to all listeners (for testing)
 */
export const emitMockEvent = (event: BusEvent): void => {
  eventListeners.forEach((listener) => listener(event));
};

/**
 * Reset all mocks and state (call in beforeEach)
 */
export const resetMocks = (): void => {
  sendAction.mockClear();
  onBusEvent.mockClear();
  initBridge.mockClear();
  eventListeners = [];
  initialized = false;
};

/**
 * Configure sendAction to return a specific value for an action
 */
export const mockActionResponse = <T>(action: string, response: T): void => {
  sendAction.mockImplementation(async (actionName: string) => {
    if (actionName === action) {
      return response;
    }
    return undefined;
  });
};
