/**
 * ToolService - Tool registration and execution
 *
 * Provides:
 * - Dynamic tool registration/unregistration
 * - Tool execution with context
 * - Tool definition retrieval for agent queries
 */

import type {
  ToolService,
  ToolHandler,
  ToolDefinition,
  ToolExecutionContext,
  ToolExecutionResult,
} from './types';
import { getEventBus } from '@/shared/event-bus';

interface RegisteredTool {
  definition: ToolDefinition;
  handler: ToolHandler;
}

function generateToolCallId(): string {
  return `tool_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

class ToolServiceImpl implements ToolService {
  private tools = new Map<string, RegisteredTool>();

  register(name: string, handler: ToolHandler, definition?: Partial<ToolDefinition>): void {
    if (this.tools.has(name)) {
      throw new Error(`Tool already registered: ${name}`);
    }

    this.tools.set(name, {
      definition: {
        name,
        description: definition?.description ?? `Tool: ${name}`,
        inputSchema: definition?.inputSchema ?? {},
      },
      handler,
    });
  }

  unregister(name: string): void {
    this.tools.delete(name);
  }

  async execute<T = unknown>(
    name: string,
    args: Record<string, unknown>,
    context: ToolExecutionContext
  ): Promise<ToolExecutionResult<T>> {
    const tool = this.tools.get(name);
    if (!tool) {
      return {
        success: false,
        error: `Unknown tool: ${name}`,
        duration: 0,
      };
    }

    const toolId = generateToolCallId();
    const bus = getEventBus();
    const startTime = Date.now();

    bus.emit({
      type: 'ToolStart',
      toolId,
      toolName: name,
      args,
      timestamp: startTime,
    });

    try {
      const result = await tool.handler(args, context);
      const duration = Date.now() - startTime;

      bus.emit({
        type: 'ToolEnd',
        toolId,
        toolName: name,
        result,
        duration,
        timestamp: Date.now(),
      });

      return {
        success: true,
        result: result as T,
        duration,
      };
    } catch (err) {
      const duration = Date.now() - startTime;
      const errorMessage = err instanceof Error ? err.message : String(err);

      bus.emit({
        type: 'ToolEnd',
        toolId,
        toolName: name,
        result: null,
        duration,
        timestamp: Date.now(),
      });

      return {
        success: false,
        error: errorMessage,
        duration,
      };
    }
  }

  getDefinitions(): ToolDefinition[] {
    return Array.from(this.tools.values()).map((t) => t.definition);
  }

  has(name: string): boolean {
    return this.tools.has(name);
  }

  dispose(): void {
    this.tools.clear();
  }
}

let _instance: ToolService | null = null;

export function getToolService(): ToolService {
  return (_instance ??= new ToolServiceImpl());
}

export function resetToolService(): void {
  if (_instance) {
    _instance.dispose();
    _instance = null;
  }
}
