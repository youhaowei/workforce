# Fuxi - Desktop Agentic Orchestrator

## TL;DR

> **Quick Summary**: Build a high-performance, memory-efficient desktop agentic orchestrator with Claude Code parity + oh-my-opencode features, using in-process service architecture.
>
> **Deliverables**:
> - Tauri desktop app with in-process service layer (no HTTP server)
> - Full tool suite with lazy initialization
> - Agent orchestration (Sisyphus/Prometheus/Oracle-style)
> - Skills, hooks, background tasks, todos
> - Sessions/history UI, Git/PR, LSP
>
> **Architecture**: In-process services + EventBus (zero HTTP overhead)
> **Performance Priority**: First-class concern in all implementations
> **Auth**: Local Claude Code auth (dev-only)

---

## Performance & Memory Principles

> **CRITICAL**: These principles apply to ALL tasks. Executors must follow them.

### Memory Optimization

| Principle | Implementation |
|-----------|----------------|
| **Lazy initialization** | Don't load tools/services until first use |
| **Object pooling** | Reuse buffers for file I/O and streaming |
| **Weak references** | Use WeakMap for caches that can be GC'd |
| **Streaming over buffering** | Process data as it arrives, don't accumulate |
| **Bounded caches** | LRU with max size, not unbounded Maps |
| **Dispose patterns** | Explicit cleanup for LSP clients, file handles |

### CPU Optimization

| Principle | Implementation |
|-----------|----------------|
| **Avoid unnecessary copies** | Use views/slices, not array spreads |
| **Batch operations** | Group file system calls, debounce UI updates |
| **Off-main-thread** | Heavy compute in Web Workers or Tauri async commands |
| **Incremental parsing** | Tree-sitter for AST, don't reparse entire files |
| **Early bailout** | Short-circuit when possible (e.g., glob limits) |

### Streaming Optimization

| Principle | Implementation |
|-----------|----------------|
| **Token-level streaming** | Emit each token immediately, don't buffer |
| **Backpressure handling** | Pause upstream if UI can't keep up |
| **Ring buffer for history** | Fixed-size buffer for recent messages |
| **Delta updates** | Only send changed parts to UI |

### Benchmarks to Target

| Metric | Target |
|--------|--------|
| First token latency | < 300ms |
| Memory at idle | < 100MB |
| Memory under load | < 500MB |
| UI frame rate | 60 FPS during streaming |
| Cold start time | < 2s |

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│  UI Layer (Solid)                                           │
│  - Reactive components with fine-grained updates            │
│  - Virtual scrolling for message lists                      │
│  - Memoized renders, no unnecessary re-renders              │
└─────────────────────────────────────────────────────────────┘
                    ↓ direct function calls
┌─────────────────────────────────────────────────────────────┐
│  EventBus (typed, zero-copy where possible)                 │
│  - Streaming tokens                                         │
│  - Tool execution events                                    │
│  - Background task updates                                  │
│  - Session state changes                                    │
└─────────────────────────────────────────────────────────────┘
                    ↓ direct function calls
┌─────────────────────────────────────────────────────────────┐
│  Service Layer (lazy-initialized singletons)                │
│  ┌─────────────┐ ┌─────────────┐ ┌─────────────┐           │
│  │ AgentService│ │SessionService│ │ToolService │           │
│  │ (SDK wrap)  │ │ (persist)   │ │ (execute)   │           │
│  └─────────────┘ └─────────────┘ └─────────────┘           │
│  ┌─────────────┐ ┌─────────────┐ ┌─────────────┐           │
│  │Orchestrator │ │SkillService │ │ HookService │           │
│  │ (routing)   │ │ (injection) │ │ (pre/post)  │           │
│  └─────────────┘ └─────────────┘ └─────────────┘           │
│  ┌─────────────┐ ┌─────────────┐                           │
│  │BackgroundSvc│ │ TodoService │                           │
│  │ (async)     │ │ (tracking)  │                           │
│  └─────────────┘ └─────────────┘                           │
└─────────────────────────────────────────────────────────────┘
                    ↓ direct function calls
┌─────────────────────────────────────────────────────────────┐
│  Tool Implementations (lazy-loaded)                         │
│  - File ops: streaming reads, chunked writes                │
│  - Bash: pty with output streaming                          │
│  - LSP: connection pooling, incremental sync                │
│  - Git: libgit2 bindings or shell with caching              │
└─────────────────────────────────────────────────────────────┘
```

### Key Design Decisions

| Decision | Rationale |
|----------|-----------|
| **No HTTP server** | Eliminates serialization overhead, reduces latency |
| **EventBus over callbacks** | Decouples components without coupling to specific handlers |
| **Lazy service init** | Only load what's used, faster cold start |
| **Typed events** | Catch errors at compile time, enable tree-shaking |
| **Direct imports** | No runtime DI framework overhead |

---

## Scope Summary

### Claude Code Parity
| Feature | Status |
|---------|--------|
| Full tool suite | ✅ Included |
| Subagents | ✅ Included |
| Sessions/history UI | ✅ Included |
| Git/PR workflows | ✅ Included |
| LSP/code intelligence | ✅ Included |
| Plugin system | ❌ Excluded |
| Permissions gating | ❌ Excluded |

### Oh-My-OpenCode Features
| Feature | Status |
|---------|--------|
| Agent orchestration (Sisyphus/Prometheus/Oracle) | ✅ Included |
| Skills system | ✅ Included |
| Hooks (pre/post tool) | ✅ Included |
| Background tasks | ✅ Included |
| Todo/task tracking | ✅ Included |
| Session continuity | ✅ Included |

---

## Execution Strategy

### Phased Delivery

**Phase 1: Foundation + Performance Baseline**
- Scaffold with performance tooling
- EventBus + service layer skeleton
- Agent SDK integration with streaming
- Core tools with lazy loading

**Phase 2: Orchestration Layer**
- Agent profiles + routing
- Skills system
- Hooks pipeline
- Background task manager
- Session store

**Phase 3: Parity Features**
- Todo tracking + UI
- Git workflows
- LSP integration
- Sessions/history UI

**Phase 4: Polish + Optimization**
- Remaining tools
- Performance profiling + optimization pass
- Tests

---

## TODOs

### Phase 1: Foundation + Performance Baseline

- [x] 1. Scaffold desktop app with performance tooling

  **What to do**:
  - Create Bun-based Tauri + Solid app
  - Structure: `src/ui`, `src/services`, `src/tools`, `src/shared`
  - Add performance tooling:
    - `bun run perf:memory` — memory profiling script
    - `bun run perf:startup` — cold start timing
    - `bun run perf:stream` — streaming latency test
  - Configure Solid for fine-grained reactivity (no unnecessary re-renders)
  - Add TS strict mode + eslint perf rules

  **Performance requirements**:
  - Cold start < 2s
  - Idle memory < 100MB
  - No blocking operations in main thread

  **Category**: `quick`
  **Skills**: `quick-task`, `frontend-ui-ux`

  **Acceptance Criteria**:
  - `bun install && bun run dev` starts app
  - `bun run perf:startup` reports < 2s
  - `bun run perf:memory` reports < 100MB idle

- [ ] 2. Implement EventBus with streaming support

  **What to do**:
  - Create typed EventBus in `src/shared/event-bus.ts`
  - Event types: `TokenDelta`, `ToolStart`, `ToolEnd`, `TaskUpdate`, `SessionChange`
  - Support for:
    - Sync and async listeners
    - One-time listeners (auto-remove)
    - Wildcard subscriptions
    - Backpressure (pause/resume)
  - Zero-copy where possible (pass references, not clones)
  - Memory-safe: WeakRef for listeners to allow GC

  **Performance requirements**:
  - Event dispatch < 0.1ms
  - No memory leaks on listener churn
  - Support 1000+ events/sec

  **Category**: `unspecified-high`
  **Skills**: `vercel-composition-patterns`

  **Acceptance Criteria**:
  - `bun run test:event-bus` passes
  - Benchmark shows < 0.1ms dispatch latency
  - No memory growth after 10k subscribe/unsubscribe cycles

- [ ] 3. Implement service layer skeleton with lazy loading

  **What to do**:
  - Create service interfaces in `src/services/types.ts`
  - Implement lazy singleton pattern:
    ```typescript
    let _agentService: AgentService | null = null
    export const getAgentService = () => _agentService ??= new AgentService()
    ```
  - Services: Agent, Session, Tool, Orchestrator, Skill, Hook, Background, Todo
  - Each service has `dispose()` for cleanup
  - No service loads until first access

  **Performance requirements**:
  - Service instantiation < 10ms each
  - Dispose releases all resources

  **Category**: `unspecified-high`
  **Skills**: `vercel-composition-patterns`

  **Acceptance Criteria**:
  - Services load lazily (verified by import timing)
  - `dispose()` frees memory (verified by heap snapshot)

- [ ] 4. Implement Agent SDK wrapper with streaming

  **What to do**:
  - Wrap `query()` from Agent SDK in `src/services/agent.ts`
  - Emit `TokenDelta` events via EventBus (not callbacks)
  - Stream tokens immediately (no buffering)
  - Handle local Claude Code auth
  - Implement request cancellation via AbortController
  - Pool message objects to reduce GC pressure

  **Performance requirements**:
  - First token < 300ms (network permitting)
  - Token-to-UI latency < 16ms (one frame)
  - Memory stable during long responses

  **Category**: `unspecified-high`
  **Skills**: `ai-sdk`

  **Acceptance Criteria**:
  - `bun run test:agent-sdk` streams tokens
  - `bun run perf:stream` shows < 300ms first token
  - Memory doesn't grow linearly with response length

- [ ] 5. Build UI shell with virtual scrolling

  **What to do**:
  - Chat layout: virtualized message list (only render visible)
  - Streaming area with incremental text append
  - Input with keyboard handling
  - Status bar with agent profile
  - Use Solid's fine-grained reactivity (signals, not state objects)
  - Memoize expensive renders
  - Debounce rapid updates (batch at 60fps)

  **Performance requirements**:
  - 60 FPS during streaming
  - Scroll through 10k messages without jank
  - No re-render of unchanged components

  **Category**: `visual-engineering`
  **Skills**: `frontend-ui-ux`

  **Acceptance Criteria**:
  - `bun run dev` renders chat
  - Scroll performance smooth with 10k messages
  - Frame drops < 1% during streaming

- [ ] 6. Implement core tools with lazy loading

  **What to do**:
  - Create `src/tools/` with: Read, Write, Edit, Bash, Glob, Grep
  - Lazy load each tool on first use
  - Streaming implementations:
    - Read: stream file in chunks, don't load entire file
    - Bash: stream stdout/stderr via pty
    - Glob/Grep: yield results incrementally, respect limits
  - Use Zod for validation (lazy schema compilation)
  - Implement tool result caching with LRU eviction

  **Performance requirements**:
  - Read 100MB file with < 50MB memory overhead
  - Glob 100k files in < 5s
  - Tool cold-load < 50ms

  **Category**: `unspecified-high`
  **Skills**: `ai-sdk`

  **Acceptance Criteria**:
  - All 6 tools execute and stream results
  - `bun run perf:tools` shows streaming memory efficiency
  - Large file read doesn't spike memory

### Phase 2: Orchestration Layer

- [ ] 7. Implement agent profiles + routing

  **What to do**:
  - Define profiles in `src/services/orchestrator/profiles/`
  - Profiles: Sisyphus (executor), Prometheus (planner), Oracle (advisor), etc.
  - Lazy-load profile definitions
  - `/agent <profile>` command routing
  - Profile-specific system prompts (loaded on-demand)
  - Cache compiled prompts

  **Performance requirements**:
  - Profile switch < 50ms
  - System prompt compilation cached

  **Category**: `unspecified-high`
  **Skills**: `ai-sdk`

  **Acceptance Criteria**:
  - `/agent oracle` switches profile
  - Profile definitions lazy-loaded

- [ ] 8. Implement skills system

  **What to do**:
  - Skills as markdown files in `src/skills/`
  - Lazy loader: parse skill on first `/skill load <name>`
  - Inject skill content into system prompt
  - Skills persist per session (stored in session metadata)
  - LRU cache for parsed skills

  **Performance requirements**:
  - Skill load < 100ms
  - Parsed skills cached

  **Category**: `unspecified-high`
  **Skills**: `ai-sdk`

  **Acceptance Criteria**:
  - `/skill load git-master` injects expertise
  - Skill persists across messages

- [ ] 9. Implement pre/post tool hooks

  **What to do**:
  - Hook registry in `src/services/hook.ts`
  - PreToolUse: can modify input, block, or short-circuit
  - PostToolUse: can modify output, trigger side effects
  - Hooks run synchronously in pipeline (async if needed)
  - Built-in hooks: logging (lazy), safety checks
  - Early bailout: if hook blocks, skip remaining hooks

  **Performance requirements**:
  - Hook overhead < 1ms per tool call
  - No hooks = zero overhead

  **Category**: `unspecified-high`
  **Skills**: `ai-sdk`

  **Acceptance Criteria**:
  - Hooks fire before/after execution
  - PreToolUse can block

- [ ] 10. Implement background task manager

  **What to do**:
  - Task manager in `src/services/background.ts`
  - Use Web Workers for CPU-intensive background work
  - Task queue with priority (high/normal/low)
  - `delegate_task(run_in_background=true)` returns task_id
  - `background_output(task_id)` retrieves result
  - Limit concurrent background tasks (default: 3)
  - Auto-cleanup completed tasks after 1 hour

  **Performance requirements**:
  - Background tasks don't block main thread
  - Memory released after task cleanup

  **Category**: `unspecified-high`
  **Skills**: `ai-sdk`

  **Acceptance Criteria**:
  - Background task runs async
  - Main thread stays responsive

- [ ] 11. Implement session store with continuity

  **What to do**:
  - Session persistence in `src/services/session.ts`
  - JSONL transcripts (append-only, efficient)
  - Incremental saves (don't rewrite entire file)
  - Session index for fast lookup (SQLite or JSON index file)
  - Resume with session_id
  - Fork creates new file, links to parent
  - Compact old sessions (summarize, archive)

  **Performance requirements**:
  - Save latency < 50ms
  - Load session < 200ms
  - 1000 sessions searchable in < 100ms

  **Category**: `unspecified-high`
  **Skills**: `quick-task`

  **Acceptance Criteria**:
  - Session persists across restart
  - Resume continues conversation

### Phase 3: Parity Features

- [ ] 12. Implement todo tracking + UI

  **What to do**:
  - Todo manager in `src/services/todo.ts`
  - TodoWrite/TodoRead tools
  - In-memory with periodic flush to disk
  - Todo panel in UI (collapsible, virtualized if many items)
  - Status: pending/in_progress/completed/cancelled
  - Batch updates to reduce UI churn

  **Performance requirements**:
  - Todo operations < 10ms
  - UI updates batched

  **Category**: `visual-engineering`
  **Skills**: `frontend-ui-ux`, `ai-sdk`

  **Acceptance Criteria**:
  - Agent can CRUD todos
  - Todo panel renders list

- [ ] 13. Implement git workflows

  **What to do**:
  - Git tools: status, diff, log, add, commit, branch, PR
  - Use `simple-git` or shell with output parsing
  - Cache git status (invalidate on file change)
  - Diff viewer: syntax-highlighted, virtualized for large diffs
  - PR creation via `gh` CLI

  **Performance requirements**:
  - Git status cached, < 100ms refresh
  - Large diffs virtualized

  **Category**: `unspecified-high`
  **Skills**: `git-master`, `frontend-ui-ux`

  **Acceptance Criteria**:
  - Git tools functional
  - Diff viewer renders large diffs smoothly

- [ ] 14. Implement LSP integration

  **What to do**:
  - LSP client in `src/tools/lsp/`
  - Connection pooling: reuse server connections
  - Lazy start: only launch server when LSP tool used
  - Incremental document sync (not full sync)
  - Tools: diagnostics, goto_definition, find_references, rename, symbols
  - Cache diagnostics, invalidate on file save
  - Graceful shutdown on app exit

  **Performance requirements**:
  - LSP response < 500ms for most operations
  - Server startup < 2s
  - Memory: one server per language, pooled

  **Category**: `unspecified-high`
  **Skills**: `ai-sdk`

  **Acceptance Criteria**:
  - LSP tools return results
  - Server connections reused

- [ ] 15. Implement sessions/history UI

  **What to do**:
  - Session list sidebar (virtualized)
  - Search with debounce (300ms)
  - Resume/fork/delete actions
  - Lazy load session previews
  - Pagination for large history

  **Performance requirements**:
  - Render 1000 sessions without jank
  - Search responsive

  **Category**: `visual-engineering`
  **Skills**: `frontend-ui-ux`

  **Acceptance Criteria**:
  - Session list renders
  - Actions work

### Phase 4: Polish + Optimization

- [ ] 16. Implement remaining tools

  **What to do**:
  - WebFetch: streaming HTTP, markdown conversion
  - WebSearch: search API with caching
  - AST-grep: Tree-sitter with incremental parsing
  - Task: subagent delegation with session continuity

  **Performance requirements**:
  - All tools stream where applicable
  - AST-grep uses incremental parsing

  **Category**: `unspecified-high`
  **Skills**: `ai-sdk`

  **Acceptance Criteria**:
  - All tools functional

- [ ] 17. Performance optimization pass

  **What to do**:
  - Profile with `bun run perf:*` scripts
  - Identify and fix memory leaks
  - Optimize hot paths
  - Add performance regression tests
  - Document performance characteristics

  **Acceptance Criteria**:
  - All performance targets met
  - No memory leaks detected

- [ ] 18. Add tests

  **What to do**:
  - Vitest for services and tools
  - Playwright for UI
  - Performance regression tests
  - Memory leak detection tests

  **Category**: `unspecified-high`
  **Skills**: `playwright`

  **Acceptance Criteria**:
  - `bun run test` passes
  - `bun run test:e2e` passes
  - `bun run test:perf` passes

---

## Success Criteria

### Performance Checklist
- [ ] Cold start < 2s
- [ ] Idle memory < 100MB
- [ ] First token < 300ms
- [ ] 60 FPS during streaming
- [ ] No memory leaks

### Feature Checklist
- [ ] In-process service architecture (no HTTP)
- [ ] All tools functional with streaming
- [ ] Agent orchestration with profiles
- [ ] Skills, hooks, background tasks
- [ ] Todo tracking
- [ ] Git/PR workflows
- [ ] LSP integration
- [ ] Sessions/history UI
- [ ] Tests pass

### Verification Commands
```bash
bun install
bun run dev
bun run test
bun run test:e2e
bun run perf:memory
bun run perf:startup
bun run perf:stream
```
