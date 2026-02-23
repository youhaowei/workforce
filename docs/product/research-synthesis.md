# Workforce v2 — Research Synthesis & Migration Blueprint

> **⚠️ ARCHIVED — February 15, 2026**
> This document is kept as historical reference. Active content has been extracted to:
> - **Feature specs** → Notion (child pages of [Workforce project](https://www.notion.so/2ffd48ccaf5481d7bb33d67599423042))
> - **Architecture reference** → Notion: Agent Model, Distributed Architecture, Department Orchestration, Design Principles
> - **Product overview** → `docs/product/PRD-MVP.md` (slimmed)
> - **Vision** → `docs/product/vision.md` (unchanged)

*Generated: February 6, 2026*
*Sources: Current Workforce, Architecture Decisions doc, Craft Agents OSS, OpenCode Desktop, Cursor Self-Driving Codebases, Anthropic C Compiler, Opus 4.6 Finance*

---

## Vision: Workforce is an Orchestration Platform, Not an Agent

Workforce is the **platform layer** that makes autonomous agentic work possible. It is NOT the agents themselves.

**What Workforce provides:**
- **Agent lifecycle** — Spawn, monitor, coordinate, and stop agent sessions (Claude Code, Agent SDK, MCP-connected agents)
- **Tool connectivity** — MCP servers, API sources, credentials, file systems — everything an agent needs to do its work
- **Self-organization infrastructure** — Agents can discover available tools, claim tasks, share context, hand off work
- **Configuration system** — Workflows, constraints, skills, and department profiles are all configurable and improvable (by humans OR by agents)
- **Progress tracking & reporting** — The CEO dashboard that shows what's happening, what's done, what's blocked, what it costs
- **Communication fabric** — How agents share state, how results flow between departments, how the human gets notified

**What Workforce does NOT do:**
- Build specialized agents for each department. The intelligence is already in Claude (via Claude Code, Agent SDK, skills).
- Micromanage agent task execution. Agents self-orient within their configured environment.
- Require the user to understand the internals. The UX is: "What do you want to do?" → system figures out the rest.

**Analogy:** Workforce is to agents what Kubernetes is to containers. It doesn't run your code — it orchestrates the things that do.

**User experience:** The user says "I want to launch a marketing campaign for our new product" and Workforce determines which agents to spawn, what skills/tools they need, what workflow to follow, and reports back with progress and deliverables for review.

---

## Agent Model: Single-Responsibility WorkAgents

### Hard Constraint: One Agent, One Job

Each **WorkAgent** is specialized to do exactly one thing. This is a context window constraint, not a design preference:
- An agent loaded with legal domain knowledge, contract templates, and compliance rules cannot simultaneously hold a codebase and reason about engineering tasks
- Context is a finite resource — mixing domains degrades quality in both
- Single-purpose agents are more predictable, debuggable, and cost-efficient

### Two Agent Types

**WorkAgent** — The worker. Single-skill, single-purpose, works independently.
- Loaded with exactly one skill bundle (domain knowledge + tools + templates)
- Executes one task or one workflow step
- Short-to-medium lived (task duration)
- Doesn't know about other agents or the broader project
- Reports progress and produces deliverables, then terminates

**Supervisor** — The team lead. Longer-running, broader context, doesn't do the work.
- Holds project-level context (goals, constraints, dependencies, progress so far)
- Spawns WorkAgents with the right skill + task assignment
- Tracks WorkAgent progress, synthesizes results
- Makes routing decisions (what to do next, which skill is needed)
- Surfaces blockers and review gates to the CEO dashboard
- Does NOT hold domain-specific skill knowledge — it delegates

### How It Works

```
User: "Launch a marketing campaign for our new product"
     │
     ▼
┌─────────────────────────────────┐
│  Supervisor (project context)    │
│  Knows: goal, constraints,       │
│  workflow steps, progress         │
└──────┬──────┬──────┬────────────┘
       │      │      │
       ▼      ▼      ▼
   WorkAgent  WorkAgent  WorkAgent
   (research) (content)  (planning)
   skill:     skill:     skill:
   competitive content-   campaign-
   -analysis  creation   planning
```

Each WorkAgent gets:
- One skill bundle
- One task description (from Supervisor or workflow step)
- Access to the tools defined in its skill
- A way to report results back

### Why Not One Big Agent?

| Approach | Pros | Cons |
|----------|------|------|
| One big agent | Simpler, full context | Context limit hit fast, quality degrades with mixed domains, expensive, single point of failure |
| Specialized WorkAgents | Better quality per domain, parallelizable, cost-efficient, fault-isolated | Coordination overhead, context handoff between agents |

The coordination overhead is Workforce's job to handle. That's the whole point of the platform.

### Implications for the Platform

Workforce must provide:
- **Agent spawner** — Create a WorkAgent with: skill bundle + task + tool access
- **Context handoff** — Pass relevant context from Supervisor to WorkAgent (and back) without contaminating domains
- **Result synthesis** — Supervisor collects WorkAgent outputs, synthesizes into project-level progress
- **Parallel execution** — Multiple WorkAgents can run simultaneously on independent tasks
- **Fault isolation** — One WorkAgent failing doesn't crash the others or the Supervisor

---

## Distributed Architecture: Hive Mind

### Core Concept

Workforce is not a single desktop app. It's a **distributed orchestration system** where each running instance is a worker node in a shared organization.

```
                    ┌─────────────────────────┐
                    │     Organization         │
                    │  (shared state & queue)  │
                    └──────────┬──────────────┘
                               │
              ┌────────────────┼────────────────┐
              │                │                │
     ┌────────▼──────┐ ┌──────▼────────┐ ┌─────▼───────────┐
     │   Node A       │ │   Node B       │ │   Node C         │
     │   (laptop)     │ │   (cloud VM)   │ │   (cloud VM)     │
     │   capacity: 3  │ │   capacity: 5  │ │   capacity: 10   │
     │   ┌──┐┌──┐┌──┐│ │   ┌──┐┌──┐... │ │   ┌──┐┌──┐...   │
     │   │WA││WA││WA││ │   │WA││WA│    │ │   │WA││WA│       │
     │   └──┘└──┘└──┘│ │   └──┘└──┘    │ │   └──┘└──┘       │
     └───────────────┘ └───────────────┘ └──────────────────┘
```

### Terminology

- **Organization** — The shared "company." Owns workspaces, projects, work queue, org-level config. Persisted in a shared state layer.
- **Node** — A running Workforce instance. Has its own Claude CLI auth, concurrency limit, and hardware. Registers with the org on startup.
- **Capacity** — How many WorkAgents a node can run simultaneously. Set per node (based on hardware, billing plan, desired throughput).
- **Work queue** — Where Supervisors put tasks. Nodes pull tasks based on available capacity and skill requirements.

### How It Works

1. User says "I want X" on any node
2. A Supervisor agent is created (can run on any node)
3. Supervisor breaks work into tasks, puts them in the org's work queue
4. Available nodes pick up tasks based on:
   - Available capacity (slots free)
   - Required skills/tools (node has the right MCP servers connected)
   - Auth scope (node has the right Claude CLI auth)
5. WorkAgents execute on whichever node picked up the task
6. Results flow back to the Supervisor via the shared state layer
7. Supervisor synthesizes, surfaces to CEO dashboard on all connected nodes

### Scaling Model

| Want more throughput? | Do this |
|----------------------|---------|
| Local development | 1 node on your laptop (capacity: 2-3) |
| Solo power user | Laptop + 1 cloud VM (capacity: 5-10) |
| Small team | 3-5 cloud VMs (capacity: 10-50 total) |
| Full workforce | N cloud VMs, scale horizontally |

Each node is stateless except for its Claude CLI auth. All project state lives in the organization's shared layer. Adding a node = adding capacity.

### Auth Implication

Each node needs its own Claude CLI auth (`~/.claude/.credentials.json`). This is actually fine for the distributed model:
- Your laptop has your auth
- Cloud VMs can be set up with service account auth (when Anthropic supports it)
- Each node operates with its own billing/rate limits
- The org-level auth constraint becomes: "how many authenticated nodes can you provision?"

### Shared State Layer (Open Question)

The organization needs a shared persistence layer that all nodes can access. Options:

1. **File-based (simplest)** — Shared filesystem (NFS, cloud storage). Work queue = files in a directory. Coordination = file locks. This is literally what Anthropic's C compiler team used (text file locks on a shared git repo). Simple, proven, fragile at scale.

2. **SQLite + Litestream** — Single SQLite database replicated across nodes. Litestream provides continuous replication to S3/cloud storage. Good for moderate scale (dozens of nodes). Read-heavy, write-light workloads.

3. **Lightweight message queue** — Redis, NATS, or similar. Work queue = message queue. State = key-value store. More infrastructure to manage but proven at scale.

4. **Git-based (Anthropic pattern)** — Shared git repo for state. Push/pull/merge cycle. Simple, versioned, auditable. Coordination via branch locks or file locks. Works at moderate scale.

5. **Cloud-native** — Supabase, Firebase, or similar. Managed, real-time sync, built-in auth. Least infrastructure to manage, but adds a cloud dependency.

**Decision needed for MVP:** Start with the simplest option that proves the model (probably file-based or git-based), upgrade later.

### What This Changes in the Platform

Workforce must now provide:
- **Node registration** — Node joins org on startup, advertises capacity and capabilities
- **Work queue** — Distributed task queue where Supervisors post work and nodes claim it
- **Shared state** — Org-level state that all nodes can read/write (projects, progress, deliverables)
- **Result routing** — WorkAgent results flow back to the Supervisor regardless of which node executed
- **Capacity management** — Track available slots per node, route work to nodes with capacity
- **Node health** — Detect when a node goes offline, reassign its in-flight tasks
- **CEO dashboard sync** — All nodes see the same org-level dashboard

---

## Hard Constraint: No Sidecar, No Custom Auth

**Claude Agent SDK requires the OS-level Claude CLI auth** from `~/.claude/.credentials.json`. This auth state:
- Only persists in the shell environment where `claude` was authenticated
- Does NOT propagate to child processes spawned by Tauri's Rust backend
- Cannot be worked around by offering a custom login flow (violates Claude Code ToS)

**Implication:** The sidecar architecture pattern (used by OpenCode) is **off the table**. Workforce must either:
1. **External server started from terminal** (current approach — server runs in a terminal with proper shell env, WebView connects via HTTP)
2. **In-process services** where Bun has inherited the shell environment

The current Workforce already solved this: `bun run dev` starts the server from the terminal first, then launches Tauri. The server process inherits `PATH`, `HOME`, and the Claude credential files.

**What this means for state management:**
- TanStack Query is still valuable — but for caching Agent SDK responses over the HTTP bridge, not for querying a sidecar
- The Hono server on port 4096 stays (it's the auth boundary)
- EventBus stays for in-WebView communication
- The bridge/ layer stays as the HTTP client

---

## What OpenCode Desktop Teaches Us

### Worth Adopting

**1. tauri-specta for Type-Safe IPC**
Auto-generates TypeScript bindings from Rust `#[tauri::command]` functions. Eliminates hand-written IPC serialization. Even though our Tauri layer is thin (menus, windows, clipboard), type-safe IPC prevents bugs as we add native features.

**2. Platform Abstraction Layer (Expanded)**
OpenCode's `Platform` interface is more complete than our PlatformBridge:
```typescript
interface Platform {
  platform: "desktop" | "web"
  os?: "macos" | "windows" | "linux"
  fetch: typeof globalThis.fetch
  storage: (name: string) => AsyncStorage     // Missing from our plan
  openLink(url: string): void
  openPath(path: string, app?: string): Promise<...>
  openFilePickerDialog(opts): Promise<string | string[]>
  parseMarkdown(md: string): Promise<string>  // Native Rust rendering
  notifications: NotificationAPI              // Missing from our plan
}
```
Action: Expand our PlatformBridge with `storage`, `notifications`, `parseMarkdown`.

**3. Event Coalescing for Streaming Performance**
OpenCode batches streamed events by type/key, flushing every ~16ms (requestAnimationFrame). Critical for React — even with Jotai atoms, rapid token deltas can thrash the reconciler.

Pattern:
```
Token events arrive → Queue by message ID → Deduplicate → Flush on rAF
```
Action: Implement coalescing layer between EventBus and Jotai atom updates.

**4. Native Markdown Rendering (Rust comrak)**
OpenCode sends markdown to Rust for final rendering, freeing the JS thread.
Consideration: Use Streamdown for streaming state management + Rust comrak for final cached renders. Trade-off: IPC latency vs JS thread pressure. Profile before committing.

**5. Deep Linking**
`workforce://session/{id}` — navigate from notifications or CLI to specific agent sessions. Useful for "CEO transparency" vision.

**6. MCP OAuth State Machine**
```
disabled → connecting → needs_auth → authenticating → connected
                    ↓
                  failed (with error)
```
Full OAuth 2.0 with state validation, code verifier, token refresh. Our current Workforce has no MCP management — this is a gap.

### Not Adopting

**Sidecar process management** — OpenCode spawns its server as a sidecar from Rust. We can't do this due to the auth constraint. Our "start server from terminal" approach is the correct solution for our auth model.

**Solid.js patterns** — OpenCode uses Solid.js context providers extensively. We're migrating to React, so these patterns translate to Zustand stores + Jotai atoms + React context (sparingly).

---

## What Craft Agents Teaches Us

### Core Patterns to Adopt

**1. Workspace-Scoped Config Folder**
```
~/.workforce/
├── config.json                 # Global: active workspace, defaults
├── credentials.enc             # AES-256-GCM encrypted API keys/tokens
├── preferences.json            # User prefs (name, timezone)
├── permissions/default.json    # Global safe-mode rules
└── workspaces/{id}/
    ├── config.json             # Workspace settings
    ├── firm.json               # Virtual firm config (departments, roles)
    ├── permissions.json        # Workspace permission overrides
    ├── sessions/{id}.jsonl     # JSONL session files
    ├── sources/{slug}/
    │   ├── config.json         # MCP/API connection config
    │   └── guide.md            # Source documentation
    ├── skills/{slug}/
    │   └── SKILL.md            # Skill with YAML frontmatter
    └── hooks/                  # Custom pre/post tool hooks
```
Maps to Workforce's "virtual firm" metaphor: each workspace = a company with its own agents, tools, permissions.

**2. JSONL Session Persistence**
Line-delimited JSON: header line (metadata) + message lines. Benefits:
- Append-only writes (crash-safe)
- Streaming reads (load only visible messages)
- Easy corruption recovery (skip bad lines)
- Async batched persistence (max 16 messages per flush)

Replaces current JSON-per-session format.

**3. Source Server Builder Pattern**
```typescript
class SourceServerBuilder {
  buildMcpServer(source, token): McpServerConfig | null
  buildApiServer(source, credential): SDKMcpServer | null
  async buildAll(sources): { mcpServers, apiServers, errors }
}
```
Unified interface wrapping MCP (stdio/HTTP/SSE) and API sources with credential management.

**4. Three-Layer Permission Model**
1. **Mode** (coarse): `safe` / `ask` / `allow-all`
2. **Rules** (fine): Pattern-based bash/tool allow/blocklists
3. **Workspace overrides**: Per-workspace write path permissions

This IS the "CEO approval" mechanism.

**5. Auth Request Pattern**
```
Tool calls requestAuth → Agent stops (forceAbort with AbortReason.AuthRequest)
→ UI shows auth dialog → User completes auth → Result sent as "faked user message"
→ Agent resumes from same point
```
Decouples auth from tool execution. Works for OAuth, API keys, manual entry.

**6. Skill System with YAML Frontmatter**
```markdown
---
name: "Code Review"
description: "Review code for quality"
icon: "magnifying-glass"
globs: ["**/*.ts"]
alwaysAllow: ["read", "bash:grep"]
---
# Instructions injected into system prompt...
```
Skills declare their own permission rules. Extends current Fuxi skill format.

**7. Tool Assembly Pipeline**
```
User Message
    ↓ Load workspace sources
    ↓ Load workspace skills
    ↓ Build MCP servers (HTTP/SSE/stdio)
    ↓ Build API servers (dynamic tools from config)
    ↓ Assemble with built-in tools
    ↓ Query Claude SDK with full tool suite
    ↓ Process events → Convert to AgentEvents → Emit to UI
```

**8. CraftAgent Class Pattern**
2500+ line stateful orchestrator wrapping Claude Agent SDK:
- Manages session state (messages, tools, thinking level, permission mode)
- Dynamic tool composition from sources + skills + built-ins
- Permission checking before tool execution
- Event-driven streaming (AgentEvents for UI consumption)
- Auth request handling with force-abort and resume
- Configurable thinking levels (off/think/max)

**9. Session Manager Pattern**
3500+ line lifecycle manager:
- Map<string, ManagedSession> with lazy agent initialization
- Async persistence queue (batched writes, all-or-nothing)
- Config watching with hot-reload
- IPC handlers for Electron (maps to our Hono routes)

---

## Architecture Blueprint: Fuxi v2

### Layer Diagram

```
┌─────────────────────────────────────────────────────┐
│  React 19.2 + Compiler                               │
│  ├── shadcn/ui (Radix + Tailwind v4)                 │
│  ├── react-virtuoso (chat) / TanStack Virtual (lists)│
│  ├── Streamdown (streaming markdown)                 │
│  └── next-themes (dark/light mode)                   │
├─────────────────────────────────────────────────────┤
│  State Management                                    │
│  ├── Zustand — global app state                      │
│  ├── Jotai atomFamily — per-message streaming        │
│  └── TanStack Query — HTTP bridge caching            │
├─────────────────────────────────────────────────────┤
│  HTTP Bridge (fetch-based client)                    │
│  ├── POST /query — send messages to agent            │
│  ├── GET /events — SSE stream for real-time updates  │
│  ├── GET /session/* — session CRUD                   │
│  └── GET /health — server health check               │
├─────────────────────────── AUTH BOUNDARY ───────────┤
│  Hono Server (port 4096, Bun runtime)                │
│  ├── Inherits shell env (Claude CLI auth)            │
│  ├── AgentService (Claude Agent SDK wrapper)         │
│  ├── OrchestratorService (profile routing, skills)   │
│  ├── SessionService (JSONL persistence)              │
│  ├── SourceService (MCP + API lifecycle)             │
│  ├── PermissionService (three-layer model)           │
│  ├── CredentialService (AES-256-GCM storage)         │
│  ├── SkillService (frontmatter parsing)              │
│  ├── HookService (pre/post tool execution)           │
│  ├── BackgroundService (async task queue)             │
│  ├── TodoService (task tracking)                     │
│  └── GitService (repo operations)                    │
├─────────────────────────────────────────────────────┤
│  EventBus (typed, coalesced, zero-copy)              │
│  ├── Server-side: service ↔ service communication    │
│  └── Client-side: SSE events → Jotai atom updates    │
├─────────────────────────────────────────────────────┤
│  PlatformBridge (desktop ↔ web abstraction)          │
│  ├── Tauri Commands (via tauri-specta)               │
│  ├── Tauri Plugins (store, dialog, shell, deep-link) │
│  └── Tauri Events (notifications, window mgmt)       │
├─────────────────────────────────────────────────────┤
│  Tauri 2.x (Rust)                                    │
│  ├── Window management & native menus                │
│  ├── Optional: comrak markdown rendering             │
│  ├── Deep linking (workforce://session/{id})              │
│  └── Native file system & shell access               │
└─────────────────────────────────────────────────────┘
```

**Key insight:** The auth boundary between WebView and Hono server is not just architectural — it's a hard requirement. The Hono server runs in Bun with the user's shell environment. The WebView is a sandboxed browser context. They MUST communicate over HTTP.

### State Architecture Clarification

Given no sidecar, the three-layer state works as:

- **Zustand**: Global client state (sessions list, active session, UI layout, preferences). Lives entirely in WebView.
- **Jotai atomFamily**: Per-entity reactive state (message content per ID, tool status per ID, streaming flags). Updated from SSE events via the coalescing layer.
- **TanStack Query**: HTTP bridge queries with caching. `queryFn` calls the Hono server. Handles deduplication, background refetch, optimistic updates. This is where the server state boundary is.

### Config Structure

```
~/.workforce/
├── config.json                 # Global: active workspace, server port, defaults
├── credentials.enc             # Encrypted: API keys, OAuth tokens
├── preferences.json            # User prefs
├── permissions/default.json    # Global safe-mode rules
└── workspaces/{id}/
    ├── config.json             # Workspace model, defaults
    ├── firm.json               # Virtual firm: departments, agent roles
    ├── permissions.json        # Workspace overrides
    ├── sessions/
    │   └── {id}.jsonl          # JSONL: header + messages
    ├── sources/
    │   └── {slug}/
    │       ├── config.json     # type: mcp|api, transport, auth
    │       └── guide.md        # Usage documentation
    ├── skills/
    │   └── {slug}/SKILL.md     # YAML frontmatter + instructions
    └── hooks/
        └── {slug}.ts           # Pre/post tool hooks
```

---

## Migration Phases

### Phase 0: Foundation Reset
- React 19.2 + Vite + Tailwind v4 + shadcn/ui scaffold
- Port PlatformBridge (add tauri-specta, expand with OpenCode's interface)
- Port EventBus to framework-agnostic TypeScript (remove SolidJS deps)
- Set up Zustand + Jotai + TanStack Query
- Keep Hono server as-is (it works, auth works)
- Wire SSE → coalescing layer → Jotai atoms

### Phase 1: Core Services (Server-Side)
- Port AgentService (keep Claude SDK wrapper, improve event mapping)
- Port SessionService (migrate to JSONL format)
- Port OrchestratorService (add workspace scoping from Craft)
- New: SourceService (MCP + API lifecycle, OAuth state machine)
- New: PermissionService (three-layer mode manager)
- New: CredentialService (AES-256-GCM encrypted storage)
- Upgrade SkillService (add YAML frontmatter parsing)

### Phase 2: UI Shell
- App shell with shadcn/ui (sidebar, panels, header)
- Chat view with react-virtuoso + Streamdown
- Tool execution display (inline, collapsible)
- Session list + management
- Todo panel
- Settings panel

### Phase 3: Orchestration
- Profile routing with workspace awareness
- Source management UI (add/remove MCP servers, OAuth flows)
- Permission mode selector in UI
- Skill browser + editor
- Hook management
- Background task manager with progress display

### Phase 4: Polish
- Deep linking (workforce://session/{id})
- Event coalescing tuning (profile and optimize rAF batching)
- E2E tests with Playwright (port + expand)
- Performance benchmarks (match or beat v1 numbers)
- "Virtual firm" dashboard (department overview, agent activity)

---

## Decision Matrix

| Decision | Current Fuxi | OpenCode | Craft Agents | Fuxi v2 |
|----------|-------------|----------|--------------|---------|
| UI Framework | SolidJS | SolidJS | React | **React 19.2** |
| Desktop | Tauri 2 | Tauri 2 | Electron | **Tauri 2** |
| Process Model | External server | Sidecar | N/A | **External server (auth req)** |
| State | SolidJS stores | Solid context | N/A | **Zustand + Jotai + TQ** |
| Components | Custom | Custom lib | shadcn/ui | **shadcn/ui** |
| Streaming MD | marked | comrak (Rust) | N/A | **Streamdown (+comrak opt)** |
| Chat Scroll | tanstack/solid-virtual | Custom | N/A | **react-virtuoso** |
| Sessions | JSON per file | Server-side DB | JSONL | **JSONL** |
| Config | Flat ~/.workforce/ | Server-side | Workspace-scoped | **Workspace-scoped** |
| Permissions | None | N/A | Three-layer | **Three-layer** |
| MCP | None | Full lifecycle | Full lifecycle | **Full lifecycle** |
| Auth | Claude CLI only | Server-side | Encrypted+OAuth | **Claude CLI + encrypted** |
| IPC | Minimal | tauri-specta | Electron IPC | **tauri-specta** |
| Skills | Markdown files | N/A | YAML frontmatter | **YAML frontmatter** |
| Events | EventBus (typed) | SSE from server | AsyncGenerator | **EventBus + coalescing** |

---

## Open Questions

1. **Monorepo or single package?** Current Fuxi is single-package. Craft uses packages/shared + packages/core + apps/electron. For v2, splitting server/ and ui/ into separate packages (with shared types) could improve build times and enforce boundaries. But adds complexity.

2. **Comrak integration priority?** Streamdown handles streaming well. Is Rust-side rendering worth the IPC cost? Measure first.

3. **Multi-agent depth?** RESOLVED: Department-specific orchestration. Engineering = spawn Claude Code instances with minimal steering. Knowledge work = specialized agents with structured workflows and review gates. See "Department-Specific Orchestration Model" section.

4. **Session migration?** Need a migration path from v1 JSON sessions to v2 JSONL. Write a one-time converter script.

5. **Hono → what?** Keep Hono? It's lightweight and works. TanStack Query's queryFn doesn't care about the server framework. No reason to change.

---

## Insights from Latest Research (Feb 2026)

### Cursor: Self-Driving Codebases
*https://cursor.com/blog/self-driving-codebases*

Key patterns for Workforce's multi-agent orchestration:

- **Constraints over instructions** — Tell agents what NOT to do ("no TODOs, no partial implementations") rather than detailed task lists. Models do good things by default; constraints define boundaries.
- **Treat agents like brilliant new hires** — They know engineering but not your codebase. Give domain-specific context (how to run tests, deploy pipeline) not general coding advice. This validates our skill/profile system.
- **Avoid checkbox mentality** — Listing specific tasks makes the model focus narrowly, deprioritizing unlisted things. Give intent, let the model use judgment.
- **Accept some error rate** — The ideal system accepts a small, constant error rate. Errors arise and get fixed quickly. A final "green branch" agent does a fixup pass before release.
- **Let turbulence converge** — Multiple agents touching the same file is OK. Don't try to prevent all conflicts; let the system naturally converge.
- **Design for throughput** — Trade off perfection for linear scaling of token throughput across agents.
- **Infrastructure bottlenecks shift** — After RAM, disk I/O becomes the hotspot. Build artifacts and compilation dominate time.

**Implication:** The "virtual firm" should embrace parallel agents with loose coordination, not rigid task assignment. The CEO role is about engineering the environment — tests, feedback loops, constraints — not micromanaging agents.

### Anthropic: Building a C Compiler with Parallel Claudes
*https://www.anthropic.com/engineering/building-c-compiler*

16 parallel Claude Opus 4.6 agents built a 100K-line C compiler in Rust over ~2,000 sessions ($20K cost, 2 weeks). Key patterns:

- **Simple coordination beats complex orchestration** — Docker container per agent, shared git repo. Task locking via text files (!). Pull/merge/push cycle. No elaborate coordination protocol.
- **Human role = environment engineering** — "Most effort went into designing the environment around Claude — the tests, the environment, the feedback — so it could orient itself without human intervention."
- **Tests are the core feedback loop** — 99% pass rate on GCC torture tests. Tests are what let agents self-correct without human intervention.
- **Model capability is the threshold** — Opus 4.5 could produce a compiler but failed on real-world projects. Only Opus 4.6 crossed the capability threshold.

**Implication:** The orchestrator's primary job is building the right environment (tests, verification, feedback) not assigning tasks. The "CEO dashboard" should show test results and environment health, not just task completion. Simple coordination (file locks, git) may outperform complex orchestration protocols.

### Opus 4.6 Finance Workflows
*https://claude.com/blog/opus-4-6-finance*

Opus 4.6 capabilities directly relevant to Workforce's architecture:

- **Subagent spinning** — Model breaks complex tasks into independent subtasks, runs tools and subagents in parallel, identifies blockers with precision. This is native to the model now.
- **Adaptive thinking** — 4 effort levels (low/medium/high/max). Model decides when to use extended thinking based on task difficulty. Maps to our profile/thinking-level system.
- **Plugins = skill bundles + connectors** — Corporate finance plugin gives Claude immediate knowledge of domain workflows. Validates our skill + source architecture.
- **Polished first-pass deliverables** — Financial models and presentations come out right on the first try with the right context.

**Implication:** The skill/plugin system should bundle domain knowledge + tool connectors as a unit. Adaptive thinking should be exposed per-session or per-profile. Leverage the model's native subagent capabilities rather than building complex orchestration on top.

---

## Department-Specific Orchestration Model

Not all work is the same. The orchestration layer must provide different **execution modes** that agents run within. These modes are configurable — the user or an agent can define new ones, improve existing ones.

### Engineering Mode — Minimal Steering

The Cursor/Anthropic model. Workforce spawns Claude Code instances, configures the environment, and gets out of the way.

**What Workforce configures:**
- Environment (repo path, branch, test commands, CI hooks)
- Constraints (coding standards, forbidden patterns, scope boundaries)
- Coordination rules (git push/pull, file locks for multi-agent)

**What the agent does on its own:**
- Self-orients: reads codebase, runs tests, makes changes
- Self-corrects via test feedback
- Resolves merge conflicts with other agents

**What Workforce tracks:**
- Files changed, test results, build status
- Tokens used, sessions spawned, cost
- Blockers (test failures, merge conflicts needing human input)

### Knowledge Work Mode — Structured Workflows

For marketing, legal, finance, product, support. Workforce provides the workflow definition and skill bundles; the agent follows the defined steps.

**What Workforce configures:**
- Workflow definition (steps, checkpoints, review gates)
- Skill bundle per workflow (domain knowledge + MCP tools + output templates)
- Approval rules (which steps need human sign-off)

**What the agent does on its own:**
- Executes each step using the provided skills and tools
- Reports progress at each checkpoint
- Produces deliverables in the defined format
- Flags exceptions or decisions that need human input

**What Workforce tracks:**
- Step completion status
- Deliverables produced (with preview)
- Review gate status (pending / approved / rejected)
- Compliance audit trail

### Key Insight: Workflows Are Configurable

Workflow definitions are data, not code. They live in the workspace config (`~/.workforce/workspaces/{id}/workflows/`). This means:
- Users can define custom workflows for their specific needs
- Agents themselves can suggest workflow improvements based on experience
- New department types can be added without changing the platform
- A workflow is just: steps + skills + tools + approval rules

### The Spectrum

| Aspect | Engineering | Knowledge Work |
|--------|------------|----------------|
| Steering | Minimal — constraints only | Structured — workflow steps |
| Coordination | Loose — git, file locks | Tight — defined handoffs |
| Error tolerance | High — fixup pass | Low — compliance matters |
| Agent type | Claude Code instance | Specialized domain agent |
| Feedback loop | Tests, CI/CD | Checkpoints, review gates |
| Deliverable | Code + passing tests | Formatted document/analysis |
| CEO role | Environment designer | Workflow designer + reviewer |

### Project Oversight Layer — Unified Reporting

Regardless of department, the CEO needs a unified view. This is the cross-cutting concern:

- **Progress dashboard** — What's happening across all departments, all active sessions
- **Deliverable tracker** — What's been produced, what's pending review, what's approved
- **Cost monitoring** — Token usage, API costs, per-department and per-task
- **Blocker detection** — What's stuck, what needs human input, what's waiting on external
- **Activity feed** — Chronological stream of agent actions across all departments
- **Quality metrics** — Test pass rates (engineering), review gate pass rates (knowledge work)

## Design Principles

Workforce is a platform. These principles govern what it provides, not what agents do.

1. **Platform, not agents** — Workforce provides lifecycle, tools, configuration, and reporting. The intelligence lives in Claude. Don't rebuild what the model already does.
2. **Configurable execution modes** — Engineering mode (loose, environment-driven), knowledge work mode (structured, workflow-driven). New modes can be defined as config, not code.
3. **Workflows are data** — Step definitions, skill assignments, approval gates — all live in config files. Users and agents can create, edit, and improve workflows.
4. **Self-organization tools** — Give agents what they need to organize themselves: task discovery, tool registry, context sharing, progress reporting. Don't micromanage.
5. **Constraints over instructions** — The platform defines boundaries (what's allowed, what's forbidden, what needs approval). Agents use judgment within those boundaries. (Cursor)
6. **Skills = knowledge + tools + templates** — The unit of domain competence. A skill bundle makes any Claude session instantly competent in a workflow. (Opus 4.6 Finance)
7. **Adaptive effort** — Not all tasks need max thinking. The platform exposes effort controls per session/workflow. (Opus 4.6)
8. **Unified oversight** — One dashboard across all execution modes. Progress, cost, blockers, deliverables. The CEO reviews, they don't direct. (All sources)
9. **Simple UX** — The user says what they want. The platform figures out execution mode, agents, tools, workflow. No manual configuration required for common tasks.

---

*References:*
- *Craft Agents OSS: Config-driven workspaces, JSONL persistence, three-layer permissions, source abstraction*
- *OpenCode Desktop: tauri-specta, event coalescing, Platform abstraction, MCP OAuth, deep linking*
- *Workforce v1: External server architecture, EventBus, lazy singletons, performance baselines*
- *Cursor: Self-driving codebases — constraints over instructions, accept error rate, design for throughput*
- *Anthropic: C Compiler — simple coordination, environment engineering, tests as feedback*
- *Opus 4.6 Finance: Subagent spinning, adaptive thinking, plugins as skill bundles*
