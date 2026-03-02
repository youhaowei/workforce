---
name: agent-sdk-docs
description: Claude Agent SDK (TypeScript) documentation reference. Use when building agents with @anthropic-ai/claude-agent-sdk, configuring SDK options, implementing hooks, subagents, MCP servers, permissions, sessions, custom tools, streaming, hosting, or security.
---

# Claude Agent SDK — TypeScript Documentation

Source: https://platform.claude.com/docs/en/agent-sdk/

## Sitemap

| Page | URL |
|------|-----|
| Overview | https://platform.claude.com/docs/en/agent-sdk/overview |
| Quickstart | https://platform.claude.com/docs/en/agent-sdk/quickstart |
| TypeScript Reference | https://platform.claude.com/docs/en/agent-sdk/typescript |
| TypeScript V2 Preview | https://platform.claude.com/docs/en/agent-sdk/typescript-v2-preview |
| Hooks | https://platform.claude.com/docs/en/agent-sdk/hooks |
| Subagents | https://platform.claude.com/docs/en/agent-sdk/subagents |
| Permissions | https://platform.claude.com/docs/en/agent-sdk/permissions |
| Sessions | https://platform.claude.com/docs/en/agent-sdk/sessions |
| MCP Servers | https://platform.claude.com/docs/en/agent-sdk/mcp |
| Custom Tools | https://platform.claude.com/docs/en/agent-sdk/custom-tools |
| User Input | https://platform.claude.com/docs/en/agent-sdk/user-input |
| Streaming vs Single | https://platform.claude.com/docs/en/agent-sdk/streaming-vs-single-mode |
| System Prompts | https://platform.claude.com/docs/en/agent-sdk/modifying-system-prompts |
| Skills | https://platform.claude.com/docs/en/agent-sdk/skills |
| Slash Commands | https://platform.claude.com/docs/en/agent-sdk/slash-commands |
| Plugins | https://platform.claude.com/docs/en/agent-sdk/plugins |
| Hosting | https://platform.claude.com/docs/en/agent-sdk/hosting |
| Secure Deployment | https://platform.claude.com/docs/en/agent-sdk/secure-deployment |
| Cost Tracking | https://platform.claude.com/docs/en/agent-sdk/cost-tracking |
| File Checkpointing | https://platform.claude.com/docs/en/agent-sdk/file-checkpointing |
| Migration Guide | https://platform.claude.com/docs/en/agent-sdk/migration-guide |

**External:**
- Examples: https://github.com/anthropics/claude-agent-sdk-demos
- Issues: https://github.com/anthropics/claude-agent-sdk-typescript/issues
- Changelog: https://github.com/anthropics/claude-agent-sdk-typescript/blob/main/CHANGELOG.md

---

## Installation & Auth

```bash
npm install @anthropic-ai/claude-agent-sdk
```

```bash
export ANTHROPIC_API_KEY=your-api-key
# Or: CLAUDE_CODE_USE_BEDROCK=1, CLAUDE_CODE_USE_VERTEX=1, CLAUDE_CODE_USE_FOUNDRY=1
```

---

## Core API: query()

```typescript
import { query } from "@anthropic-ai/claude-agent-sdk";

for await (const message of query({
  prompt: "Find and fix the bug in auth.py",
  options: {
    allowedTools: ["Read", "Edit", "Bash"],
    permissionMode: "acceptEdits"
  }
})) {
  if (message.type === "assistant") {
    for (const block of message.message.content) {
      if ("text" in block) console.log(block.text);
      else if ("name" in block) console.log(`Tool: ${block.name}`);
    }
  }
  if (message.type === "result") console.log(`Done: ${message.subtype}`);
}
```

Returns a `Query` object extending `AsyncGenerator<SDKMessage, void>` with additional methods: `abort()`, `setPermissionMode()`, `rewindFiles()`.

### V2 Preview (unstable)

```typescript
import { unstable_v2_createSession, unstable_v2_prompt } from "@anthropic-ai/claude-agent-sdk";

// One-shot
const result = await unstable_v2_prompt("What is 2 + 2?", { model: "claude-opus-4-6" });

// Multi-turn session
await using session = unstable_v2_createSession({ model: "claude-opus-4-6" });
await session.send("Hello!");
for await (const msg of session.stream()) { /* ... */ }
await session.send("Follow up");
for await (const msg of session.stream()) { /* ... */ }

// Resume
import { unstable_v2_resumeSession } from "@anthropic-ai/claude-agent-sdk";
await using resumed = unstable_v2_resumeSession(sessionId, { model: "claude-opus-4-6" });
```

---

## Options

| Option | Type | Description |
|--------|------|-------------|
| `allowedTools` | `string[]` | Tools Claude can use |
| `disallowedTools` | `string[]` | Tools to block |
| `permissionMode` | `string` | `"default"` / `"acceptEdits"` / `"bypassPermissions"` / `"plan"` |
| `systemPrompt` | `string \| { type: "preset", preset: "claude_code", append?: string }` | System prompt |
| `model` | `string` | Model ID |
| `maxTurns` | `number` | Max agent loop iterations |
| `resume` | `string` | Session ID to resume |
| `forkSession` | `boolean` | Fork instead of continue when resuming |
| `mcpServers` | `Record<string, McpServerConfig>` | MCP server configs |
| `agents` | `Record<string, AgentDefinition>` | Custom subagent definitions |
| `hooks` | `Record<string, HookMatcher[]>` | Hook configurations |
| `canUseTool` | `(toolName, input) => Promise<AllowOrDeny>` | Tool approval callback |
| `settingSources` | `SettingSource[]` | `["user","project","local"]` to load filesystem settings |
| `plugins` | `PluginConfig[]` | Plugin paths |
| `cwd` | `string` | Working directory |
| `env` | `Record<string, string>` | Environment variables |
| `enableFileCheckpointing` | `boolean` | Track file changes for rewinding |

---

## Built-in Tools

| Tool | Description |
|------|-------------|
| `Read` | Read files |
| `Write` | Create new files |
| `Edit` | Precise edits to existing files |
| `Bash` | Run terminal commands |
| `Glob` | Find files by pattern |
| `Grep` | Search file contents with regex |
| `WebSearch` | Search the web |
| `WebFetch` | Fetch and parse web pages |
| `Task` | Spawn subagents (required for subagent invocation) |
| `Skill` | Invoke agent skills |
| `AskUserQuestion` | Ask user clarifying questions |

---

## Permission Modes

Evaluation order: Hooks → Permission rules (settings.json) → Permission mode → canUseTool callback.

| Mode | Behavior |
|------|----------|
| `default` | No auto-approvals; unmatched tools trigger canUseTool |
| `acceptEdits` | Auto-approve file edits + filesystem commands (mkdir, rm, mv, cp) |
| `bypassPermissions` | All tools run without prompts (propagates to subagents!) |
| `plan` | No tool execution; Claude plans only |

Change mid-session: `await q.setPermissionMode("acceptEdits")`.

---

## Hooks

Intercept agent execution at key points.

### Hook Events

| Event | Trigger |
|-------|---------|
| `PreToolUse` | Before tool executes (can block/modify) |
| `PostToolUse` | After tool execution |
| `PostToolUseFailure` | After tool failure |
| `UserPromptSubmit` | User prompt submission |
| `Stop` | Agent stop |
| `SubagentStart` | Subagent init |
| `SubagentStop` | Subagent completion |
| `PreCompact` | Before compaction |
| `PermissionRequest` | Permission dialog would show |
| `SessionStart` | Session init |
| `SessionEnd` | Session end |
| `Notification` | Agent status messages |

### Configuration

```typescript
import { query, HookCallback, PreToolUseHookInput } from "@anthropic-ai/claude-agent-sdk";

const protectEnvFiles: HookCallback = async (input, toolUseID, { signal }) => {
  const preInput = input as PreToolUseHookInput;
  const filePath = preInput.tool_input?.file_path as string;
  if (filePath?.endsWith(".env")) {
    return {
      hookSpecificOutput: {
        hookEventName: input.hook_event_name,
        permissionDecision: "deny",
        permissionDecisionReason: "Cannot modify .env files"
      }
    };
  }
  return {};
};

for await (const msg of query({
  prompt: "Update config",
  options: {
    hooks: {
      PreToolUse: [{ matcher: "Write|Edit", hooks: [protectEnvFiles] }]
    }
  }
})) { /* ... */ }
```

### Callback Inputs

Common fields: `hook_event_name`, `session_id`, `transcript_path`, `cwd`.
Tool hooks: `tool_name`, `tool_input`. PostToolUse: `tool_response`.

### Callback Outputs

- `{}` — allow operation
- `{ hookSpecificOutput: { hookEventName, permissionDecision: "deny", permissionDecisionReason } }` — block
- `{ hookSpecificOutput: { hookEventName, permissionDecision: "allow", updatedInput: {...} } }` — modify input
- `{ systemMessage: "..." }` — inject context into conversation
- `{ continue: false, stopReason: "..." }` — stop agent

Permission priority: deny > ask > allow > default ask.

---

## Subagents

Spawn specialized agents via the Task tool.

```typescript
for await (const msg of query({
  prompt: "Review auth module for security issues",
  options: {
    allowedTools: ["Read", "Grep", "Glob", "Task"],
    agents: {
      "code-reviewer": {
        description: "Expert code reviewer for security and quality.",
        prompt: "You are a code review specialist...",
        tools: ["Read", "Grep", "Glob"],  // restrict tools
        model: "sonnet"  // override model
      },
      "test-runner": {
        description: "Runs and analyzes test suites.",
        prompt: "Run tests and provide analysis...",
        tools: ["Bash", "Read", "Grep"]
      }
    }
  }
})) { /* ... */ }
```

- Subagents **cannot** spawn their own subagents (don't include `Task` in tools).
- Messages from subagents include `parent_tool_use_id`.
- Can also define agents as `.claude/agents/*.md` files.
- Dynamic agent factories: `agents: { "reviewer": createAgent("strict") }`.
- Resume subagents by capturing `agentId` from Task tool results and using `resume: sessionId`.

---

## MCP Servers

### stdio

```typescript
mcpServers: {
  github: {
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-github"],
    env: { GITHUB_TOKEN: process.env.GITHUB_TOKEN }
  }
},
allowedTools: ["mcp__github__*"]
```

### HTTP/SSE

```typescript
mcpServers: {
  "remote-api": {
    type: "sse",  // or "http"
    url: "https://api.example.com/mcp/sse",
    headers: { Authorization: `Bearer ${process.env.API_TOKEN}` }
  }
}
```

### Tool naming: `mcp__<server-name>__<tool-name>`

### Custom In-Process Tools

```typescript
import { query, tool, createSdkMcpServer } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";

const server = createSdkMcpServer({
  name: "my-tools",
  version: "1.0.0",
  tools: [
    tool("get_weather", "Get temperature", {
      latitude: z.number(),
      longitude: z.number()
    }, async (args) => {
      const res = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${args.latitude}&longitude=${args.longitude}&current=temperature_2m`);
      const data = await res.json();
      return { content: [{ type: "text", text: `Temp: ${data.current.temperature_2m}` }] };
    })
  ]
});

// Custom MCP requires streaming input
async function* messages() {
  yield { type: "user" as const, message: { role: "user" as const, content: "Weather in SF?" } };
}

for await (const msg of query({
  prompt: messages(),
  options: { mcpServers: { "my-tools": server }, allowedTools: ["mcp__my-tools__get_weather"] }
})) { /* ... */ }
```

### MCP Tool Search

Auto-enabled when MCP tools exceed 10% of context. Configure via `env: { ENABLE_TOOL_SEARCH: "auto:5" }`.

---

## Sessions

### Capture Session ID

```typescript
for await (const msg of query({ prompt: "...", options })) {
  if (msg.type === "system" && msg.subtype === "init") {
    sessionId = msg.session_id;
  }
}
```

### Resume

```typescript
for await (const msg of query({
  prompt: "Continue where we left off",
  options: { resume: sessionId }
})) { /* ... */ }
```

### Fork

```typescript
for await (const msg of query({
  prompt: "Try a different approach",
  options: { resume: sessionId, forkSession: true }
})) { /* ... */ }
```

---

## User Input (canUseTool)

```typescript
options: {
  canUseTool: async (toolName, input) => {
    if (toolName === "AskUserQuestion") {
      // Present input.questions to user, collect answers
      return {
        behavior: "allow",
        updatedInput: { questions: input.questions, answers: { "Question text": "Selected label" } }
      };
    }
    // Tool approval
    const approved = await askUser(`Allow ${toolName}?`);
    if (approved) return { behavior: "allow", updatedInput: input };
    return { behavior: "deny", message: "User rejected" };
  }
}
```

Response types: `{ behavior: "allow", updatedInput }` or `{ behavior: "deny", message }`.
Can also modify input before allowing, or suggest alternatives in deny message.

---

## System Prompts

```typescript
// Default: minimal system prompt (no Claude Code guidelines)

// Full Claude Code system prompt
systemPrompt: { type: "preset", preset: "claude_code" }

// Append to Claude Code prompt
systemPrompt: { type: "preset", preset: "claude_code", append: "Always use PEP 8." }

// Fully custom
systemPrompt: "You are a Python specialist..."
```

**CLAUDE.md:** Only loaded when `settingSources` includes `"project"` or `"user"`.

---

## Streaming vs Single Message Input

**Streaming (recommended):** Use async generator for prompt. Supports images, queued messages, hooks, interruption, multi-turn.

```typescript
async function* generateMessages() {
  yield { type: "user" as const, message: { role: "user" as const, content: "Analyze this codebase" } };
  // Can yield more messages later
}
for await (const msg of query({ prompt: generateMessages(), options })) { /* ... */ }
```

**Single message:** Pass a string. Simpler but no images, no queueing, no interruption.

```typescript
for await (const msg of query({ prompt: "Explain auth flow", options: { maxTurns: 1 } })) { /* ... */ }
```

---

## Cost Tracking

```typescript
for await (const msg of query({ prompt: "..." })) {
  if (msg.type === "result") {
    console.log("Total cost:", msg.usage?.total_cost_usd);
    // Per-model breakdown
    for (const [model, usage] of Object.entries(msg.modelUsage || {})) {
      console.log(`${model}: $${usage.costUSD}, in: ${usage.inputTokens}, out: ${usage.outputTokens}`);
    }
  }
}
```

Messages with the same `id` report identical usage — charge once per unique ID. The `result` message has authoritative cumulative totals.

---

## File Checkpointing

Track and rewind file changes (Write/Edit/NotebookEdit only, not Bash).

```typescript
const response = query({
  prompt: "Refactor auth module",
  options: {
    enableFileCheckpointing: true,
    permissionMode: "acceptEdits",
    extraArgs: { "replay-user-messages": null },
    env: { ...process.env, CLAUDE_CODE_ENABLE_SDK_FILE_CHECKPOINTING: "1" }
  }
});

let checkpointId: string | undefined, sessionId: string | undefined;
for await (const msg of response) {
  if (msg.type === "user" && msg.uuid && !checkpointId) checkpointId = msg.uuid;
  if ("session_id" in msg) sessionId = msg.session_id;
}

// Rewind later
if (checkpointId && sessionId) {
  const rw = query({ prompt: "", options: { enableFileCheckpointing: true, resume: sessionId } });
  for await (const msg of rw) { await rw.rewindFiles(checkpointId); break; }
}
```

---

## Hosting

| Pattern | Best For |
|---------|----------|
| Ephemeral | One-off tasks, bug fixes |
| Long-Running | Email agents, chatbots, site builders |
| Hybrid | Research, project management (hydrated from DB/sessions) |
| Single Container | Multi-agent simulations |

Requirements: Node.js, ~1GiB RAM, 5GiB disk, outbound HTTPS to `api.anthropic.com`.

---

## Secure Deployment

- **Sandbox runtime:** OS-level restrictions, no Docker needed
- **Containers:** `--cap-drop ALL --network none`, mount proxy via Unix socket
- **gVisor:** Userspace syscall interception
- **VMs (Firecracker):** Hardware isolation, <125ms boot
- **Credentials:** Proxy pattern — agent never sees credentials; proxy injects auth headers
- **Network:** Route all traffic through allowlist proxy

---

## Migration from Claude Code SDK

```bash
npm uninstall @anthropic-ai/claude-code
npm install @anthropic-ai/claude-agent-sdk
```

Update imports: `"@anthropic-ai/claude-code"` → `"@anthropic-ai/claude-agent-sdk"`.

Breaking changes in v0.1.0:
1. System prompt no longer defaults to Claude Code's — use `systemPrompt: { type: "preset", preset: "claude_code" }`
2. Settings sources no longer loaded — add `settingSources: ["user", "project", "local"]`
