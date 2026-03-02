# OpenAI Codex SDK (TypeScript) — Reference

> Reference skill for building with `@openai/codex-sdk` — the TypeScript SDK for embedding the Codex agent.
> Source: https://github.com/openai/codex/tree/main/sdk/typescript

---

## Sitemap

| Resource | URL |
|----------|-----|
| SDK README | https://github.com/openai/codex/tree/main/sdk/typescript |
| Source: codex.ts | https://github.com/openai/codex/blob/main/sdk/typescript/src/codex.ts |
| Source: thread.ts | https://github.com/openai/codex/blob/main/sdk/typescript/src/thread.ts |
| Source: events.ts | https://github.com/openai/codex/blob/main/sdk/typescript/src/events.ts |
| Source: items.ts | https://github.com/openai/codex/blob/main/sdk/typescript/src/items.ts |
| Source: codexOptions.ts | https://github.com/openai/codex/blob/main/sdk/typescript/src/codexOptions.ts |
| Source: threadOptions.ts | https://github.com/openai/codex/blob/main/sdk/typescript/src/threadOptions.ts |
| Source: turnOptions.ts | https://github.com/openai/codex/blob/main/sdk/typescript/src/turnOptions.ts |
| Source: exec.ts | https://github.com/openai/codex/blob/main/sdk/typescript/src/exec.ts |
| Source: index.ts | https://github.com/openai/codex/blob/main/sdk/typescript/src/index.ts |
| Sample: basic_streaming.ts | https://github.com/openai/codex/blob/main/sdk/typescript/samples/basic_streaming.ts |
| Sample: structured_output.ts | https://github.com/openai/codex/blob/main/sdk/typescript/samples/structured_output.ts |
| Sample: structured_output_zod.ts | https://github.com/openai/codex/blob/main/sdk/typescript/samples/structured_output_zod.ts |

---

## 1. Overview

The Codex SDK wraps the `codex` CLI, enabling developers to embed the Codex agent in workflows and apps. It communicates via JSONL events over stdin/stdout with the CLI process.

```bash
npm install @openai/codex-sdk
# Requires Node.js 18+
```

---

## 2. Core API

### Codex Class

The main entry point. Creates threads for conversation.

```typescript
import { Codex } from '@openai/codex-sdk';

const codex = new Codex();
// or with options:
const codex = new Codex({
  codexPathOverride: '/path/to/codex',
  baseUrl: 'https://api.openai.com/v1',
  apiKey: 'sk-...',
  env: { CUSTOM_VAR: 'value' },
  config: { 'some.nested.key': 'value' },
});
```

**Methods:**
- `startThread(options?)` — create a new conversation thread
- `resumeThread(id, options?)` — reconnect to a saved thread from `~/.codex/sessions`

### CodexOptions

```typescript
type CodexOptions = {
  codexPathOverride?: string;  // Custom CLI binary path
  baseUrl?: string;            // API base URL
  apiKey?: string;             // API key
  config?: CodexConfigObject;  // CLI config overrides (flattened to dotted-path TOML)
  env?: Record<string, string>; // Env vars for CLI process (replaces process.env inheritance)
};
```

---

## 3. Threads

A thread represents a conversation with the Codex agent. Supports multi-turn conversations.

```typescript
const thread = codex.startThread({
  workingDirectory: '/path/to/project',
  model: 'o4-mini',
});

// Single turn — wait for completion
const turn = await thread.run('Fix the failing test in utils.ts');
console.log(turn.finalResponse);

// Multi-turn — reuse the thread
const turn2 = await thread.run('Now add a test for the edge case');
```

### ThreadOptions

```typescript
type ThreadOptions = {
  model?: string;
  sandboxMode?: SandboxMode;
  workingDirectory?: string;
  skipGitRepoCheck?: boolean;
  modelReasoningEffort?: ModelReasoningEffort;
  networkAccessEnabled?: boolean;
  webSearchMode?: WebSearchMode;
  webSearchEnabled?: boolean;
  approvalPolicy?: ApprovalMode;
  additionalDirectories?: string[];
};
```

### Enums

```typescript
type SandboxMode = 'read-only' | 'workspace-write' | 'danger-full-access';

type ModelReasoningEffort = 'minimal' | 'low' | 'medium' | 'high' | 'xhigh';

type WebSearchMode = 'disabled' | 'cached' | 'live';

type ApprovalMode = 'never' | 'on-request' | 'on-failure' | 'untrusted';
```

---

## 4. Running Tasks

### Blocking Run

```typescript
const turn = await thread.run('Diagnose the test failure and propose a fix');
console.log(turn.finalResponse); // Final text response
console.log(turn.items);         // All items from the turn
console.log(turn.usage);         // Token usage (or null)
```

### TurnOptions

```typescript
type TurnOptions = {
  outputSchema?: unknown;  // JSON schema for structured output
  signal?: AbortSignal;    // Cancellation
};
```

### Turn Result

```typescript
type Turn = {
  items: ThreadItem[];
  finalResponse: string;
  usage: Usage | null;
};
```

---

## 5. Streaming

Use `runStreamed()` for real-time event streaming via async generator.

```typescript
const { events } = await thread.runStreamed('Summarize this codebase');

for await (const event of events) {
  switch (event.type) {
    case 'thread.started':
      console.log('Thread ID:', event.thread_id);
      break;
    case 'turn.started':
      console.log('Turn started');
      break;
    case 'item.started':
    case 'item.updated':
    case 'item.completed':
      handleItem(event.item);
      break;
    case 'turn.completed':
      console.log(`Tokens: ${event.usage.input_tokens} in, ${event.usage.output_tokens} out`);
      break;
    case 'turn.failed':
      console.error('Failed:', event.error.message);
      break;
    case 'thread.error':
      console.error('Stream error:', event.error.message);
      break;
  }
}
```

### Event Types

```typescript
type ThreadEvent =
  | ThreadStartedEvent    // { type: 'thread.started', thread_id: string }
  | TurnStartedEvent      // { type: 'turn.started' }
  | TurnCompletedEvent    // { type: 'turn.completed', usage: Usage }
  | TurnFailedEvent       // { type: 'turn.failed', error: ThreadError }
  | ItemStartedEvent      // { type: 'item.started', item: ThreadItem }
  | ItemUpdatedEvent      // { type: 'item.updated', item: ThreadItem }
  | ItemCompletedEvent    // { type: 'item.completed', item: ThreadItem }
  | ThreadErrorEvent;     // { type: 'thread.error', error: ThreadError }

type Usage = {
  input_tokens: number;
  cached_input_tokens: number;
  output_tokens: number;
};

type ThreadError = { message: string };
```

---

## 6. Thread Items

Items represent actions and outputs during a turn.

```typescript
type ThreadItem =
  | AgentMessageItem       // Agent's text response
  | ReasoningItem          // Internal reasoning
  | CommandExecutionItem   // Shell command execution
  | FileChangeItem         // File modifications
  | McpToolCallItem        // MCP tool invocations
  | WebSearchItem          // Web search queries
  | TodoListItem           // Task tracking
  | ErrorItem;             // Errors
```

### Detailed Item Types

```typescript
// Agent message
type AgentMessageItem = {
  id: string;
  type: 'agent_message';
  text: string;
};

// Reasoning
type ReasoningItem = {
  id: string;
  type: 'reasoning';
  text: string;
};

// Command execution
type CommandExecutionItem = {
  id: string;
  type: 'command_execution';
  command: string;
  aggregated_output: string;
  exit_code?: number;
  status: 'in_progress' | 'completed' | 'failed';
};

// File changes
type FileChangeItem = {
  id: string;
  type: 'file_change';
  changes: Array<{
    path: string;
    kind: 'add' | 'delete' | 'update';
  }>;
  status: 'completed' | 'failed';
};

// MCP tool calls
type McpToolCallItem = {
  id: string;
  type: 'mcp_tool_call';
  server: string;
  tool: string;
  arguments: unknown;
  result?: {
    content: McpContentBlock[];
    structured_content: unknown;
  };
  error?: { message: string };
  status: 'in_progress' | 'completed' | 'failed';
};

// Web search
type WebSearchItem = {
  id: string;
  type: 'web_search';
  query: string;
};

// Todo list
type TodoListItem = {
  id: string;
  type: 'todo_list';
  items: Array<{ text: string; completed: boolean }>;
};

// Error
type ErrorItem = {
  id: string;
  type: 'error';
  message: string;
};
```

---

## 7. Structured Output

Constrain agent responses to a JSON schema.

### Plain JSON Schema

```typescript
const schema = {
  type: 'object',
  properties: {
    summary: { type: 'string' },
    status: { type: 'string', enum: ['ok', 'action_required'] },
  },
  required: ['summary', 'status'],
  additionalProperties: false,
} as const;

const turn = await thread.run('Summarize repository status', { outputSchema: schema });
const parsed = JSON.parse(turn.finalResponse);
```

### Zod Schema

```typescript
import { z } from 'zod';
import zodToJsonSchema from 'zod-to-json-schema';

const schema = z.object({
  summary: z.string(),
  status: z.enum(['ok', 'action_required']),
});

const turn = await thread.run('Summarize repository status', {
  outputSchema: zodToJsonSchema(schema, { target: 'openAi' }),
});
```

---

## 8. Image Attachments

Include images alongside text prompts.

```typescript
const turn = await thread.run([
  { type: 'text', text: 'What does this screenshot show?' },
  { type: 'local_image', path: '/path/to/screenshot.png' },
]);
```

### Input Type

```typescript
type Input = string | UserInput[];

type UserInput =
  | { type: 'text'; text: string }
  | { type: 'local_image'; path: string };
```

---

## 9. Thread Persistence

Threads are stored in `~/.codex/sessions`. Resume by thread ID:

```typescript
const thread = codex.startThread();
const turn = await thread.run('Start working on feature X');
const threadId = thread.id; // Save this

// Later...
const resumed = codex.resumeThread(threadId);
const turn2 = await resumed.run('Continue where you left off');
```

The `thread.id` is populated after the first turn starts (available after `run()` or first event from `runStreamed()`).

---

## 10. Cancellation

Use `AbortSignal` to cancel a running turn.

```typescript
const controller = new AbortController();

// Cancel after 30 seconds
setTimeout(() => controller.abort(), 30_000);

const turn = await thread.run('Long task...', { signal: controller.signal });
```

---

## 11. Full Streaming Example

Interactive CLI with event handling:

```typescript
import { Codex } from '@openai/codex-sdk';
import type { ThreadEvent, ThreadItem } from '@openai/codex-sdk';

const codex = new Codex();
const thread = codex.startThread();

function handleItem(item: ThreadItem) {
  switch (item.type) {
    case 'agent_message':
      console.log(`Assistant: ${item.text}`);
      break;
    case 'reasoning':
      console.log(`Reasoning: ${item.text}`);
      break;
    case 'command_execution': {
      const exit = item.exit_code !== undefined ? ` Exit ${item.exit_code}.` : '';
      console.log(`Command: ${item.command} ${item.status}.${exit}`);
      break;
    }
    case 'file_change':
      for (const c of item.changes) console.log(`File ${c.kind}: ${c.path}`);
      break;
    case 'todo_list':
      for (const t of item.items) console.log(`  ${t.completed ? 'x' : ' '} ${t.text}`);
      break;
  }
}

const { events } = await thread.runStreamed('Fix all lint errors');
for await (const event of events) {
  if (event.type === 'item.completed') handleItem(event.item);
  if (event.type === 'item.updated') handleItem(event.item);
  if (event.type === 'turn.completed') {
    const u = event.usage;
    console.log(`Tokens: ${u.input_tokens} in (${u.cached_input_tokens} cached), ${u.output_tokens} out`);
  }
  if (event.type === 'turn.failed') console.error(`Failed: ${event.error.message}`);
}
```

---

## 12. Configuration Reference

### Environment & CLI Config

```typescript
const codex = new Codex({
  // Override CLI binary path
  codexPathOverride: '/usr/local/bin/codex',

  // API settings
  baseUrl: 'https://custom-api.example.com/v1',
  apiKey: 'sk-...',

  // Environment (replaces process.env for CLI process)
  env: {
    OPENAI_API_KEY: 'sk-...',
    OPENAI_BASE_URL: 'https://...',
  },

  // CLI config overrides (flattened to --config key=value flags)
  config: {
    model: 'o4-mini',
    'sandbox.permissions': 'workspace-write',
  },
});
```

### Thread Configuration

```typescript
const thread = codex.startThread({
  workingDirectory: '/path/to/repo',   // Must be git repo (or skipGitRepoCheck)
  skipGitRepoCheck: true,              // Allow non-git directories
  model: 'o4-mini',
  sandboxMode: 'workspace-write',      // 'read-only' | 'workspace-write' | 'danger-full-access'
  modelReasoningEffort: 'high',        // 'minimal' | 'low' | 'medium' | 'high' | 'xhigh'
  approvalPolicy: 'on-failure',        // 'never' | 'on-request' | 'on-failure' | 'untrusted'
  networkAccessEnabled: true,
  webSearchMode: 'live',               // 'disabled' | 'cached' | 'live'
  webSearchEnabled: true,
  additionalDirectories: ['/other/repo'],
});
```

---

## 13. Public Exports Summary

```typescript
// Classes
export { Codex } from './codex';
export { Thread } from './thread';

// Thread types
export type { RunResult, RunStreamedResult, Input, UserInput } from './thread';

// Event types
export type {
  ThreadEvent, ThreadStartedEvent, TurnStartedEvent, TurnCompletedEvent,
  TurnFailedEvent, ItemStartedEvent, ItemUpdatedEvent, ItemCompletedEvent,
  ThreadErrorEvent, ThreadError, Usage,
} from './events';

// Item types
export type {
  ThreadItem, AgentMessageItem, ReasoningItem, CommandExecutionItem,
  FileChangeItem, McpToolCallItem, WebSearchItem, TodoListItem, ErrorItem,
} from './items';

// Configuration types
export type { CodexOptions } from './codexOptions';
export type { ThreadOptions, ApprovalMode, SandboxMode, ModelReasoningEffort, WebSearchMode } from './threadOptions';
export type { TurnOptions } from './turnOptions';
```
