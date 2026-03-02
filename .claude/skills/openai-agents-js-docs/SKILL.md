# OpenAI Agents SDK (TypeScript) — Reference

> Reference skill for building with `@openai/agents` — the OpenAI Agents SDK for TypeScript.
> Source: https://openai.github.io/openai-agents-js/

---

## Sitemap

| Page | URL |
|------|-----|
| Overview | https://openai.github.io/openai-agents-js/ |
| Quickstart | https://openai.github.io/openai-agents-js/guides/quickstart |
| Agents | https://openai.github.io/openai-agents-js/guides/agents |
| Running Agents | https://openai.github.io/openai-agents-js/guides/running-agents |
| Results | https://openai.github.io/openai-agents-js/guides/results |
| Tools | https://openai.github.io/openai-agents-js/guides/tools |
| Multi-Agent Orchestration | https://openai.github.io/openai-agents-js/guides/multi-agent |
| Handoffs | https://openai.github.io/openai-agents-js/guides/handoffs |
| Context Management | https://openai.github.io/openai-agents-js/guides/context |
| Sessions | https://openai.github.io/openai-agents-js/guides/sessions |
| Models | https://openai.github.io/openai-agents-js/guides/models |
| Guardrails | https://openai.github.io/openai-agents-js/guides/guardrails |
| Streaming | https://openai.github.io/openai-agents-js/guides/streaming |
| Human-in-the-Loop | https://openai.github.io/openai-agents-js/guides/human-in-the-loop |
| MCP (Model Context Protocol) | https://openai.github.io/openai-agents-js/guides/mcp |
| Tracing | https://openai.github.io/openai-agents-js/guides/tracing |
| Configuring the SDK | https://openai.github.io/openai-agents-js/guides/config |
| Troubleshooting | https://openai.github.io/openai-agents-js/guides/troubleshooting |
| Release Process | https://openai.github.io/openai-agents-js/guides/release |
| **Voice Agents** | |
| Voice Overview | https://openai.github.io/openai-agents-js/guides/voice-agents |
| Voice Quickstart | https://openai.github.io/openai-agents-js/guides/voice-agents/quickstart |
| Building Voice Agents | https://openai.github.io/openai-agents-js/guides/voice-agents/build |
| Voice Transport | https://openai.github.io/openai-agents-js/guides/voice-agents/transport |
| **Extensions** | |
| AI SDK (any model) | https://openai.github.io/openai-agents-js/extensions/ai-sdk |
| Twilio (Realtime) | https://openai.github.io/openai-agents-js/extensions/twilio |
| Cloudflare Workers | https://openai.github.io/openai-agents-js/extensions/cloudflare |

**Packages**: `@openai/agents`, `@openai/agents-core`, `@openai/agents-openai`, `@openai/agents-realtime`, `@openai/agents-extensions`

---

## 1. Installation & Setup

```bash
npm install @openai/agents zod
# Requires Zod v4
export OPENAI_API_KEY=sk-...
```

Programmatic auth:
```typescript
import { setDefaultOpenAIKey, setTracingExportApiKey } from '@openai/agents';
setDefaultOpenAIKey('sk-...');
```

---

## 2. Core Primitives

Three fundamentals:
1. **Agents** — LLM + instructions + tools
2. **Handoffs** — agents delegate to other agents
3. **Guardrails** — input/output validation

Production-ready evolution of the experimental **Swarm** framework.

---

## 3. Agent Configuration

```typescript
import { Agent } from '@openai/agents';

const agent = new Agent({
  name: 'History Tutor',
  instructions: 'You provide assistance with historical queries.',
});
```

### All Agent Properties

| Property | Required | Description |
|----------|----------|-------------|
| `name` | Yes | Human-readable identifier |
| `instructions` | Yes | System prompt (string or `(ctx, agent) => string \| Promise<string>`) |
| `prompt` | No | OpenAI Responses API prompt config |
| `handoffDescription` | No | Description shown when offered as handoff target |
| `model` | No | Model name string or custom `Model` implementation |
| `modelSettings` | No | `{ temperature, topP, toolChoice, parallelToolCalls, ... }` |
| `tools` | No | Array of Tool instances |
| `mcpServers` | No | MCP servers providing tools |
| `handoffs` | No | Agent instances or `Handoff` objects |
| `outputType` | No | Zod schema or JSON schema for structured output |
| `inputGuardrails` | No | Array of input guardrail functions |
| `outputGuardrails` | No | Array of output guardrail functions |
| `resetToolChoice` | No | Prevents tool-use loops (default: `true`) |
| `toolUseBehavior` | No | `'run_llm_again'` \| `'stop_on_first_tool'` \| `{ stopAtToolNames }` \| custom fn |

### Context Type

Agents are generic: `Agent<TContext, TOutput>`. Context passes to every tool, guardrail, and handoff:

```typescript
type MyContext = { userId: string; db: Database };

const agent = new Agent<MyContext>({
  name: 'Support',
  instructions: (ctx) => `Help user ${ctx.context.userId}`,
  tools: [/* tools receive ctx.context */],
});
```

Context is **local only** — never sent to the LLM.

### Dynamic Instructions

```typescript
const agent = new Agent({
  name: 'Greeter',
  instructions: async (ctx, agent) => {
    const user = await ctx.context.db.getUser(ctx.context.userId);
    return `Greet ${user.name} warmly.`;
  },
});
```

### Structured Output

```typescript
import { z } from 'zod';

const agent = new Agent({
  name: 'Analyzer',
  instructions: 'Analyze sentiment.',
  outputType: z.object({
    sentiment: z.enum(['positive', 'negative', 'neutral']),
    confidence: z.number(),
  }),
});
```

### Agent Cloning

```typescript
const variant = agent.clone({ name: 'Variant', model: 'gpt-4.1-mini' });
```

---

## 4. Running Agents (Runner)

```typescript
import { run } from '@openai/agents';

const result = await run(agent, 'What caused WW1?');
console.log(result.finalOutput);
```

### Agent Loop

1. Call current agent's model with input
2. Inspect response:
   - **Final output** (text matching expected type, no tool calls) → return
   - **Handoff** → switch agent, continue loop
   - **Tool calls** → execute tools, feed results back, continue
3. Throws `MaxTurnsExceededError` if `maxTurns` reached

### Run Options

| Option | Default | Description |
|--------|---------|-------------|
| `stream` | `false` | Enable streaming events |
| `context` | — | Context object forwarded to tools/guardrails |
| `maxTurns` | `10` | Safety limit |
| `signal` | — | `AbortSignal` for cancellation |
| `session` | — | Session persistence implementation |
| `conversationId` | — | Server-side conversation persistence |
| `previousResponseId` | — | Chain responses without full conversation |

### RunConfig (global runner settings)

Model override, guardrails, tracing params, `workflowName`, metadata, `tracingDisabled`, `traceIncludeSensitiveData`.

### Custom Runner

```typescript
import { Runner } from '@openai/agents';

const runner = new Runner({
  model: 'gpt-5.2',
  // callModelInputFilter, toolErrorFormatter, reasoningItemIdPolicy
});
const result = await runner.run(agent, 'Hello');
```

### Error Types

`MaxTurnsExceededError`, `ModelBehaviorError`, `InputGuardrailTripwireTriggered`, `OutputGuardrailTripwireTriggered`, `ToolInputGuardrailTripwireTriggered`, `ToolOutputGuardrailTripwireTriggered`, `GuardrailExecutionError`, `ToolTimeoutError`, `ToolCallError`, `UserError` — all extend `AgentsError`.

---

## 5. Results

### RunResult Properties

| Property | Description |
|----------|-------------|
| `finalOutput` | `string` \| `z.infer<outputType>` \| `unknown` \| `undefined` |
| `history` | Full input/output history for chat |
| `output` | Full agent run output |
| `lastAgent` | Final running agent |
| `newItems` | Array of `RunItem` objects |
| `state` | Serializable state for resume/recovery |
| `interruptions` | `ToolApprovalItem[]` when approval needed |
| `rawResponses` | Raw LLM responses |
| `lastResponseId` | Final response ID |
| `input` | Original input |
| `state.usage` | Aggregated token usage |

### RunItem Types

- `RunMessageOutputItem` — LLM message
- `RunHandoffCallItem` — handoff invocation
- `RunHandoffOutputItem` — completed handoff (source/target agents)
- `RunToolCallItem` — tool invocation
- `RunToolCallOutputItem` — tool result
- `RunReasoningItem` — reasoning
- `RunToolApprovalItem` — approval request

Use `Agent.create()` instead of `new Agent()` for proper type inference across handoffs with different output types.

---

## 6. Tools

Six categories:

### 6.1 Hosted OpenAI Tools

```typescript
import { webSearchTool, fileSearchTool, codeInterpreterTool, imageGenerationTool } from '@openai/agents';

const agent = new Agent({
  name: 'Researcher',
  instructions: 'Search the web.',
  tools: [webSearchTool()],
});
```

### 6.2 Local Built-in Tools

```typescript
import { computerTool, shellTool, applyPatchTool } from '@openai/agents';

// Shell in managed container
shellTool({ type: 'container_auto' });
// Shell in existing container
shellTool({ type: 'container_reference', containerId: '...' });
```

### 6.3 Function Tools

```typescript
import { tool } from '@openai/agents';
import { z } from 'zod';

const weatherTool = tool({
  name: 'get_weather',
  description: 'Get current weather for a city',
  parameters: z.object({
    city: z.string().describe('City name'),
  }),
  execute: async (input) => {
    return `72°F and sunny in ${input.city}`;
  },
});
```

Options: `name`, `description`, `parameters` (Zod or JSON schema), `strict` (default: true), `execute`, `timeoutMs`, `needsApproval`.

Timeout behavior: `error_as_result` (returns message to model) or `raise_exception` (throws).

### 6.4 Agents as Tools

```typescript
const specialist = new Agent({ name: 'Specialist', instructions: '...' });

const manager = new Agent({
  name: 'Manager',
  tools: [specialist.asTool({ toolName: 'ask_specialist', toolDescription: '...' })],
});
```

### 6.5 MCP Server Tools

See MCP section below.

### 6.6 Experimental Codex Tool

```typescript
import { codexTool } from '@openai/agents-extensions/codex';
// Requires @openai/codex-sdk
```

### Tool Best Practices

- Short, explicit descriptions
- Validate inputs with Zod schemas
- One responsibility per tool
- Return helpful strings on error (don't throw)

---

## 7. Handoffs

```typescript
const refundAgent = new Agent({ name: 'Refund Agent', instructions: '...' });
const triageAgent = new Agent({
  name: 'Triage',
  instructions: 'Route customer requests.',
  handoffs: [refundAgent], // creates transfer_to_refund_agent tool
});
```

### Custom Handoffs

```typescript
import { handoff } from '@openai/agents';

const customHandoff = handoff({
  agent: refundAgent,
  toolNameOverride: 'escalate_refund',
  toolDescriptionOverride: 'Escalate to refund specialist',
  onHandoff: async (ctx, input) => {
    console.log('Handoff triggered with:', input);
  },
  inputType: z.object({ reason: z.string() }),
  inputFilter: (history) => history.slice(-5), // last 5 messages
});
```

Handoffs generate `transfer_to_<agent_name>` tools by default. Include `RECOMMENDED_PROMPT_PREFIX` in system prompts for reliable handoff behavior.

---

## 8. Context Management

### Local Context (RunContext<T>)

Passed to `run()`, forwarded to tools, hooks, guardrails. **Not sent to LLM.**

Appropriate uses: user IDs, database connections, loggers.

### LLM-visible Context

Four approaches:
1. **Instructions** — static or dynamic system prompt
2. **Run input** — include in the user message
3. **Function tools** — LLM requests data on demand
4. **Retrieval/search tools** — file, database, web search

**Constraint**: Every agent, tool, and hook in a single run must use the same context type.

---

## 9. Sessions

Sessions provide persistent memory across turns.

### Built-in Implementations

```typescript
import { MemorySession, OpenAIConversationsSession } from '@openai/agents';

// Local development
const session = new MemorySession();

// Server-side persistence
const session = new OpenAIConversationsSession({ apiKey: '...' });
```

### Usage with Runner

```typescript
const result = await run(agent, 'Hello', { session });
// Session automatically stores/retrieves conversation history
```

### Session Lifecycle

- **Before run**: Retrieves history, merges with new input
- **After run**: Persists user input + model outputs
- **Streaming**: Writes user input first, appends streamed outputs after turn completes
- **Resume from RunState**: Appended to same memory record

### CRUD Helpers

`session.getItems()` — returns `AgentInputItem[]`
`session.popItem()` — remove last entry (useful for user corrections)

### Transcript Compaction

```typescript
import { OpenAIResponsesCompactionSession } from '@openai/agents';

const compactSession = new OpenAIResponsesCompactionSession({
  underlyingSession: new MemorySession(),
  client: openaiClient,
  model: 'gpt-4.1',
});
```

Default: compacts when 10+ non-user items accumulate. Override `shouldTriggerCompaction` for custom logic. Debug: `DEBUG=openai-agents:openai:compaction`.

---

## 10. Models

### Default Model

`gpt-4.1` by default. Override via `OPENAI_DEFAULT_MODEL` env var or Runner config.

### ModelSettings

`temperature`, `topP`, `frequencyPenalty`, `presencePenalty`, `toolChoice`, `parallelToolCalls`, `truncation`, `maxTokens`, `store`, `promptCacheRetention`, `reasoning.effort`, `reasoning.summary`, `text.verbosity`, `providerData`.

### API Selection

```typescript
import { setOpenAIAPI } from '@openai/agents';
setOpenAIAPI('responses'); // default
setOpenAIAPI('chat_completions');
```

### WebSocket Transport

```typescript
import { setOpenAIResponsesTransport } from '@openai/agents';
setOpenAIResponsesTransport('websocket');
```

### Custom Model Providers

Implement `ModelProvider` and `Model` interfaces, pass to `Runner` constructor.

### Using Any Model via AI SDK

```typescript
import { openai } from '@ai-sdk/openai';
import { aisdk } from '@openai/agents-extensions/ai-sdk';

const agent = new Agent({
  name: 'Agent',
  model: aisdk(openai('gpt-5-mini')),
});
```

Supports any AI SDK v2/v3 provider (Anthropic, Google, Mistral, etc.).

---

## 11. Guardrails

### Input Guardrails

```typescript
const mathGuardrail = {
  name: 'math_check',
  execute: async (ctx, input) => {
    // Run guardrail agent or custom logic
    return { tripwireTriggered: false };
  },
};

const agent = new Agent({
  inputGuardrails: [mathGuardrail],
  // runInParallel: true (default) — runs alongside model
  // runInParallel: false — runs BEFORE model, prevents token spend
});
```

### Output Guardrails

Same pattern, applied to final output. Only execute when agent is last in workflow.

### Tool Guardrails

Configured on the tool itself. Return `allow`, `rejectContent`, or `throwException`. Only for `tool()` function tools (not hosted or built-in).

### Tripwires

When `tripwireTriggered: true`, throws `InputGuardrailTripwireTriggered` / `OutputGuardrailTripwireTriggered` and halts execution.

---

## 12. Streaming

```typescript
const result = await run(agent, 'Tell me a story', { stream: true });

// Text stream (pipe to stdout)
const textStream = result.toTextStream({ compatibleWithNodeStreams: true });
textStream.pipe(process.stdout);

// Or iterate events
for await (const event of result) {
  switch (event.type) {
    case 'raw_model_stream_event':
      // ResponseStreamEvent (e.g., output_text_delta)
      break;
    case 'run_item_stream_event':
      // RunItem lifecycle (handoffs, tool calls)
      break;
    case 'agent_updated_stream_event':
      // Agent switch notification
      break;
  }
}

// ALWAYS await completion
await result.completed;
```

### Human-in-the-Loop with Streaming

```typescript
const result = await run(agent, input, { stream: true });
if (result.interruptions?.length) {
  result.state.approve(/* or reject */);
  const resumed = await run(agent, result.state, { stream: true });
}
```

---

## 13. Human-in-the-Loop

### Tool Approval

```typescript
const deleteTool = tool({
  name: 'delete_record',
  description: 'Delete a database record',
  parameters: z.object({ id: z.string() }),
  needsApproval: true, // or async (ctx, input) => boolean
  execute: async (input) => { /* ... */ },
});
```

### Approval Flow

1. Agent decides to call tool → approval check triggers
2. If approval needed, execution pauses → `result.interruptions` populated
3. User approves/rejects:
   ```typescript
   result.state.approve();  // or result.state.reject()
   const resumed = await run(agent, result.state);
   ```

### State Serialization (long approvals)

```typescript
// Save
const serialized = JSON.stringify(result.state);
await db.save(serialized);

// Restore
const loaded = await db.load();
const state = RunState.fromString(agent, loaded);
const resumed = await run(agent, state);
```

---

## 14. MCP (Model Context Protocol)

Three server types:

### Hosted MCP (Responses API)

```typescript
import { hostedMcpTool } from '@openai/agents';

const agent = new Agent({
  tools: [hostedMcpTool({ serverLabel: 'deepwiki', serverUrl: 'https://...' })],
});
```

Supports `requireApproval` and OpenAI connectors (`connectorId`).

### Streamable HTTP

```typescript
import { MCPServerStreamableHttp } from '@openai/agents';

const server = new MCPServerStreamableHttp({
  url: 'https://my-mcp-server.com/mcp',
  name: 'My MCP Server',
  cacheToolsList: true,
});
```

### Stdio

```typescript
import { MCPServerStdio } from '@openai/agents';

const server = new MCPServerStdio({
  fullCommand: 'npx my-mcp-server',
  // or: command: 'npx', args: ['my-mcp-server']
});
```

### Lifecycle Management

```typescript
import { connectMcpServers } from '@openai/agents';

const { active, failed, errors } = await connectMcpServers([server1, server2]);
```

### Tool Filtering

```typescript
import { createMCPToolStaticFilter } from '@openai/agents';

const filter = createMCPToolStaticFilter({ allowedTools: ['read_file', 'search'] });
const server = new MCPServerStdio({ fullCommand: '...', toolFilter: filter });
```

---

## 15. Multi-Agent Orchestration

Two approaches:

### LLM-Based (Handoffs)

Agent uses handoffs to delegate to specialists. Good for dynamic routing. Tips:
- Invest in clear prompts and tool descriptions
- Use specialized agents over generalists
- Enable self-critique

### Code-Based (Programmatic)

```typescript
// Sequential chaining
const analysis = await run(analyzerAgent, document);
const summary = await run(summaryAgent, analysis.finalOutput);

// Parallel execution
const [result1, result2] = await Promise.all([
  run(agent1, task1),
  run(agent2, task2),
]);

// Feedback loop
let draft = await run(writerAgent, topic);
for (let i = 0; i < 3; i++) {
  const review = await run(reviewerAgent, draft.finalOutput);
  if (review.finalOutput.approved) break;
  draft = await run(writerAgent, review.finalOutput.feedback);
}
```

Combine both: managers provide central control, handoffs distribute responsibility.

---

## 16. Tracing

Enabled by default in Node.js/Deno/Bun, disabled in browsers and `NODE_ENV=test`.

### Disable

```bash
OPENAI_AGENTS_DISABLE_TRACING=1
```
Or: `RunConfig.tracingDisabled = true`.

### Multi-Run Tracing

```typescript
import { withTrace } from '@openai/agents';

await withTrace('my-workflow', async () => {
  await run(agent1, input1);
  await run(agent2, input2);
});
```

### Custom Spans

```typescript
import { createCustomSpan } from '@openai/agents';
const span = createCustomSpan('my-operation');
// ... do work
span.finish();
```

### Sensitive Data

`RunConfig.traceIncludeSensitiveData = false` — prevents LLM inputs/outputs from being captured.

### Span Types

`AgentSpan`, `GenerationSpan`, `FunctionSpan`, `GuardrailSpan`, `HandoffSpan`.

---

## 17. Configuration

### Debug Logging

```bash
DEBUG=openai-agents:*        # all
DEBUG=openai-agents:core     # core execution
DEBUG=openai-agents:openai   # API interactions
DEBUG=openai-agents:realtime # Realtime components
```

### Sensitive Data Protection

```bash
OPENAI_AGENTS_DONT_LOG_MODEL_DATA=1
OPENAI_AGENTS_DONT_LOG_TOOL_DATA=1
```

### Session Debug

```bash
OPENAI_AGENTS__DEBUG_SAVE_SESSION=1
```

---

## 18. Troubleshooting

### Supported Environments

- Node.js 22+
- Deno 2.35+
- Bun 1.2.5+

### Limited Support

- **Cloudflare Workers**: Enable `nodejs_compat`, manually flush traces, `AsyncLocalStorage` limitations
- **Browsers**: No tracing support
- **WebSocket transport**: Requires global `WebSocket` with custom header support

---

## 19. Extensions

### AI SDK Adapter

```typescript
import { aisdk } from '@openai/agents-extensions/ai-sdk';
import { anthropic } from '@ai-sdk/anthropic';

const agent = new Agent({
  model: aisdk(anthropic('claude-sonnet-4-20250514')),
});
```

Supports v2/v3 `specificationVersion` providers. Use `providerMetadata` for provider-specific options.

UI streaming helpers: `createAiSdkTextStreamResponse()`, `createAiSdkUiMessageStreamResponse()`.

### Codex Tool

```typescript
import { codexTool } from '@openai/agents-extensions/codex';
// Requires @openai/codex-sdk
```

Routes tool calls to Codex SDK for workspace-scoped autonomous tasks.
