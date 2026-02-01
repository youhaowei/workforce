/**
 * Ask Tool - User interaction during agent execution
 *
 * Allows the agent to ask the user questions and wait for responses.
 * Primary candidate for custom MCP tools per the plan.
 */

import { getEventBus, type AskUserEvent, type AskUserResponseEvent } from '../../shared/event-bus';

// ============================================================================
// Types
// ============================================================================

export interface AskToolInput {
  question: string;
  options?: string[];
  timeout?: number; // Milliseconds to wait for response
}

export interface AskToolResult {
  response: string;
  selectedOption?: number; // Index of selected option if options provided
  timedOut: boolean;
}

export interface MCPTool<TInput = unknown, TOutput = unknown> {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
  handler: (input: TInput, context: MCPContext) => Promise<TOutput>;
}

export interface MCPContext {
  sessionId: string;
  toolId: string;
}

// ============================================================================
// Implementation
// ============================================================================

// Pending requests awaiting user response
const pendingRequests = new Map<
  string,
  {
    resolve: (result: AskToolResult) => void;
    timeout?: ReturnType<typeof setTimeout>;
  }
>();

/**
 * Wait for user response to a question.
 */
async function waitForUserResponse(
  question: string,
  options?: string[],
  timeoutMs?: number
): Promise<AskToolResult> {
  const bus = getEventBus();
  const requestId = `ask_${Date.now()}_${Math.random().toString(36).slice(2)}`;

  return new Promise((resolve) => {
    // Set up response listener
    const cleanup = bus.on('AskUserResponse', (event: AskUserResponseEvent) => {
      if (event.requestId !== requestId) return;

      cleanup();
      const pending = pendingRequests.get(requestId);
      if (pending?.timeout) {
        clearTimeout(pending.timeout);
      }
      pendingRequests.delete(requestId);

      resolve({
        response: event.response,
        selectedOption: event.selectedOption,
        timedOut: false,
      });
    });

    // Set up timeout if specified
    let timeout: ReturnType<typeof setTimeout> | undefined;
    if (timeoutMs && timeoutMs > 0) {
      timeout = setTimeout(() => {
        cleanup();
        pendingRequests.delete(requestId);
        resolve({
          response: '',
          timedOut: true,
        });
      }, timeoutMs);
    }

    // Store pending request
    pendingRequests.set(requestId, { resolve, timeout });

    // Emit question to UI
    const askEvent: AskUserEvent = {
      type: 'AskUser',
      requestId,
      question,
      options,
      timestamp: Date.now(),
    };
    bus.emit(askEvent);
  });
}

/**
 * The ask tool definition.
 */
export const askTool: MCPTool<AskToolInput, AskToolResult> = {
  name: 'ask',
  description: 'Ask the user a question and wait for their response',
  inputSchema: {
    type: 'object',
    properties: {
      question: {
        type: 'string',
        description: 'The question to ask the user',
      },
      options: {
        type: 'array',
        items: { type: 'string' },
        description: 'Optional list of choices for the user to select from',
      },
      timeout: {
        type: 'number',
        description: 'Optional timeout in milliseconds to wait for response',
      },
    },
    required: ['question'],
  },
  handler: async (input, _context) => {
    return waitForUserResponse(input.question, input.options, input.timeout);
  },
};

/**
 * Cancel all pending ask requests.
 */
export function cancelAllPendingAsks(): void {
  for (const [, pending] of pendingRequests) {
    if (pending.timeout) {
      clearTimeout(pending.timeout);
    }
    pending.resolve({
      response: '',
      timedOut: true,
    });
  }
  pendingRequests.clear();
}

/**
 * Get count of pending asks.
 */
export function getPendingAskCount(): number {
  return pendingRequests.size;
}

// Export waitForUserResponse for testing
export { waitForUserResponse };
