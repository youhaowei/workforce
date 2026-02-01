# Fuxi - Desktop Agentic Orchestrator

## 📋 Project State & Documentation

**For detailed project state, see Sisyphus planning files:**
- **Plan**: `.sisyphus/plans/fuxi.md` - Full project plan with 18/18 tasks complete ✅
- **Issues**: `.sisyphus/notepads/fuxi/issues.md` - Known issues and gotchas
- **Learnings**: `.sisyphus/notepads/fuxi/learnings.md` - Performance metrics and patterns
- **Decisions**: `.sisyphus/notepads/fuxi/decisions.md` - Architectural decisions

**Current Status**: All 18 tasks complete (100%) - Foundation, Orchestration, Parity Features, and Polish phases done.

### Project Completion Summary

**All Phases Complete** ✅
- Phase 1: Foundation (6/6 tasks) - EventBus, services, Agent SDK, UI shell, tools
- Phase 2: Orchestration (5/5 tasks) - Agent profiles, skills, hooks, background tasks, sessions
- Phase 3: Parity Features (4/4 tasks) - Todos, Git workflows, LSP, sessions UI
- Phase 4: Polish (3/3 tasks) - Remaining tools, performance optimization, tests

**Key Features Implemented**:
- ✅ Agent orchestration (Sisyphus/Prometheus/Oracle-style profiles)
- ✅ Skills system with dynamic loading
- ✅ Pre/post tool hooks
- ✅ Background task manager
- ✅ Todo tracking with UI
- ✅ Git/PR workflows
- ✅ LSP integration (TypeScript)
- ✅ Session management with persistence
- ✅ Full tool suite (via Anthropic Agent SDK)
- ✅ Virtual scrolling UI with streaming support

**Metrics**: 251 tests passing (1 skipped), ESLint clean (12 warnings), TypeScript strict mode, 6 MB idle memory.

## ⚠️ IMPORTANT: Do NOT Auto-Run Dev Server

**NEVER run `bun run dev` or `bun run build` automatically.**
Always ask the user before starting the dev server or building the app.

## Commands

```bash
bun install        # Install dependencies
bun run test       # Run unit tests (251 tests, 1 skipped)
bun run test:e2e   # Run Playwright E2E tests (28 tests)
bun run lint       # Lint code
bun run type-check # TypeScript check
bun run server     # Start backend server (port 4096) - RUN THIS FIRST
bun run dev:web    # Start server + vite for web testing
bun run clean      # Remove build artifacts (src-tauri/target, dist)
```

**User-initiated only (ASK FIRST):**

```bash
bun run dev   # Start server + Tauri desktop app
bun run build # Build Tauri app
```

### Running the Desktop App

**External Server Architecture**: The `dev` script starts the server from the terminal first (ensuring proper shell environment for Claude Agent SDK auth), then launches Tauri.

```bash
bun run dev  # Starts server in background, then Tauri
```

If you need to run them separately:
```bash
bun run server  # Terminal 1
tauri dev       # Terminal 2
```

## Architecture

### In-Process Service Architecture (No HTTP Server)

```
┌─────────────────────────────────────────────────────────────┐
│  UI Layer (SolidJS)                                         │
│  - Reactive components with fine-grained updates            │
│  - Virtual scrolling for message lists                      │
└─────────────────────────────────────────────────────────────┘
                    ↓ direct function calls
┌─────────────────────────────────────────────────────────────┐
│  EventBus (typed, zero-copy where possible)                 │
│  - Streaming tokens                                         │
│  - Tool execution events                                    │
│  - Background task updates                                  │
└─────────────────────────────────────────────────────────────┘
                    ↓ direct function calls
┌─────────────────────────────────────────────────────────────┐
│  Service Layer (lazy-initialized singletons)                │
│  AgentService │ SessionService │ ToolService │ etc.        │
└─────────────────────────────────────────────────────────────┘
```

**Key Design Decision**: In-process services + EventBus (zero HTTP overhead)
- **Frontend** (WebView): SolidJS, communicates via direct imports
- **Backend** (In-process): Services run in same process, no serialization overhead
- **Performance**: First-class concern - all implementations optimized for memory and CPU

**Note**: Originally planned as sidecar pattern, but switched to in-process for better performance. See `.sisyphus/notepads/fuxi/decisions.md` for details.

### Directory Structure

```
src/
├── ui/           # SolidJS components (browser-safe only)
│   ├── components/
│   ├── stores/   # Reactive state (messages, tools, todos)
│   └── hooks/
├── server/       # Hono HTTP server (sidecar)
│   └── index.ts  # Routes: /query, /session/*, /events, /health
├── services/     # Backend services (run in sidecar only)
│   ├── agent.ts  # Claude SDK wrapper
│   ├── session.ts
│   ├── todo.ts
│   └── git.ts
├── bridge/       # Frontend HTTP client
│   ├── frontend.ts  # HTTP client (fetch-based)
│   └── index.ts     # Re-exports frontend APIs
└── shared/       # Shared code (no Node APIs)
    └── event-bus.ts

src-tauri/        # Tauri/Rust layer
├── src/main.rs   # Pure UI shell (connects to external server)
└── Cargo.toml    # Tauri dependencies

e2e/              # Playwright E2E tests
```

### Key Pattern: Direct Service Access

UI components use services directly via EventBus for reactive updates.

```typescript
// ✅ Correct - use EventBus for reactive updates
import { EventBus } from "@shared/event-bus";
EventBus.on("TokenDelta", (event) => { /* update UI */ });

// ✅ Services accessed directly (in-process)
import { getAgentService } from "@services/agent";
const agent = getAgentService();
```

**Note**: Services are lazy-initialized singletons. All services implement `dispose()` for cleanup.

### Path Aliases

| Alias       | Path            |
| ----------- | --------------- |
| `@ui`       | `src/ui/`       |
| `@services` | `src/services/` |
| `@bridge`   | `src/bridge/`   |
| `@shared`   | `src/shared/`   |
| `@hooks`    | `src/hooks/`    |

## Testing

-   **Unit tests**: `bun run test` (Vitest, 251 tests passing, 1 skipped)
  - 211 service/hook tests
  - 49 component tests (SolidJS Testing Library)
-   **E2E tests**: `bun run test:e2e` (Playwright, 28 tests)
-   **E2E headed**: `bun run test:e2e:headed` (watch tests run)
-   **E2E debug**: `bun run test:e2e:debug` (step through)

**Test Coverage**: All HIGH/MEDIUM priority components tested. See `.sisyphus/plans/fuxi.md` Task 18 for details.

## Tech Stack

-   **Runtime**: Bun (not Node)
-   **Desktop**: Tauri 2.0
-   **UI**: SolidJS (fine-grained reactivity)
-   **Services**: In-process (no HTTP server in production)
-   **Server**: Hono (HTTP framework, for E2E testing only)
-   **Types**: TypeScript strict mode
-   **Styling**: TailwindCSS
-   **E2E**: Playwright
-   **Agent SDK**: `@anthropic-ai/claude-agent-sdk` (spawns Claude Code processes, uses Claude CLI auth)

## Performance Metrics

| Metric | Target | Actual | Status |
|--------|--------|--------|--------|
| Idle memory | < 100 MB | 6.06 MB | ✅ PASS |
| First token latency | < 300 ms | ~0 ms | ✅ PASS |
| Stream throughput | - | 14.55 ms/1000 tokens | ✅ PASS |
| Cold start (dev) | < 2s | ~5s | ⚠️ Dev mode only |

**Note**: Cold start ~5s is dev mode overhead (Rust compilation). Production builds don't have this. See `.sisyphus/notepads/fuxi/learnings.md` for detailed performance analysis.

## Gotchas

1. **External server architecture** - Server runs from terminal (not spawned by Tauri) for proper shell environment. `bun run dev` handles this automatically.
2. **Services use Node APIs** - Services run in Bun runtime (not browser)
3. **Tauri detection**: Use `__TAURI_INTERNALS__` (not `__TAURI__` in v2)
4. **E2E tests need server** - Playwright config auto-starts `dev:web` (server for testing)
5. **Port 4096** - Server runs on this port
6. **Build minifier** - Uses `esbuild` (not terser) in vite.config.ts
7. **Path aliases** - Defined in tsconfig.json AND vite.config.ts (must sync)
8. **ESLint warnings** - 12 warnings remain (mostly SolidJS reactivity issues). See `.sisyphus/notepads/fuxi/issues.md`
9. **Cold start** - ~5s in dev mode (Tauri/Rust compilation). Production builds don't have this overhead.
10. **Memory optimization** - All services implement `dispose()` pattern. Idle memory: 6 MB (target < 100 MB) ✅
11. **Claude Agent SDK Auth** - SDK uses Claude CLI's auth from `~/.claude/.credentials.json`. Running server from terminal ensures proper shell environment for auth. The SDK handles token refresh internally.
12. **Agent tests skipped** - `src/services/agent.test.ts` tests are skipped; need rewrite for new SDK.

**Known Issues**: See `.sisyphus/notepads/fuxi/issues.md` for detailed issues and resolutions.
