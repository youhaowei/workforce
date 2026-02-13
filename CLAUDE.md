# Workforce - Desktop Agentic Orchestrator

## 📋 Project State & Documentation

**Documentation lives in `docs/`:**

```
docs/
├── PRD-MVP.md                              # Product requirements
├── vision.md                               # Product vision
├── research-synthesis.md                   # Research notes
├── architecture/
│   ├── decisions.md                        # Architectural decision log
│   └── learnings.md                        # Performance metrics and patterns
└── operations/
    ├── issues.md                           # Known issues and risks
    └── open-decisions.md                   # Unresolved product decisions
```

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

**Metrics**: 391 tests passing (3 skipped), ESLint clean (0 warnings), TypeScript strict mode, 6 MB idle memory.

## ⚠️ IMPORTANT: Do NOT Auto-Run Dev Server

**NEVER run `bun run dev` or `bun run build` automatically.**
Always ask the user before starting the dev server or building the app.

## Commands

```bash
bun install        # Install dependencies
bun run test       # Run unit tests (391 tests, 3 skipped)
bun run test:e2e   # Run Playwright E2E tests (28 tests)
bun run lint       # Lint code
bun run type-check # TypeScript check
bun run server     # Start backend server (port 4096) - RUN THIS FIRST
bun run server:watch # Server with hot-reload (used by dev/dev:web automatically)
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
│  UI Layer (React 19)                                        │
│  - Zustand/Jotai stores, React hooks                        │
│  - Virtual scrolling (react-virtuoso)                       │
└─────────────────────────────────────────────────────────────┘
                    ↓ tRPC client (splitLink: HTTP + SSE)
┌─────────────────────────────────────────────────────────────┐
│  tRPC Server (v11) + Hono                                   │
│  - Type-safe API with Zod validation                        │
│  - SSE subscriptions for streaming + events                 │
│  - Mounted at /api/trpc/*                                   │
└─────────────────────────────────────────────────────────────┘
                    ↓ direct function calls
┌─────────────────────────────────────────────────────────────┐
│  Service Layer (lazy-initialized singletons)                │
│  AgentService │ SessionService │ ToolService │ etc.        │
└─────────────────────────────────────────────────────────────┘
```

**Key Design Decision**: tRPC v11 for type-safe client-server communication
- **Frontend** (WebView): React 19 with Zustand + Jotai + TanStack Query via tRPC
- **Backend**: Hono HTTP server with tRPC routers wrapping service layer
- **Performance**: First-class concern - streaming via SSE subscriptions, rAF-batched token accumulation

**Note**: Originally planned as sidecar pattern, but switched to in-process for better performance. See `docs/architecture/decisions.md` for details.

### Directory Structure

```
src/
├── ui/           # React 19 components (browser-safe only)
│   ├── components/
│   ├── stores/   # Zustand stores
│   ├── hooks/    # React hooks (useEventBus, etc.)
│   ├── context/  # PlatformProvider, HotkeyProvider
│   └── lib/      # Utilities (cn helper)
├── server/       # Hono HTTP server + tRPC routers
│   ├── index.ts  # CORS, tRPC mount, diagnostic routes (/health, /debug-log, /auth-check)
│   ├── trpc.ts   # initTRPC with superjson
│   └── routers/  # Domain routers (session, org, agent, etc.)
├── services/     # Backend services (Bun runtime only)
│   ├── agent.ts  # Claude SDK wrapper
│   ├── session.ts
│   ├── todo.ts
│   └── git.ts
├── bridge/       # tRPC client
│   ├── trpc.ts      # Vanilla tRPC client (splitLink)
│   ├── react.ts     # React Query tRPC proxy
│   └── query-client.ts  # TanStack QueryClient
└── shared/       # Shared code (no Node APIs)
    └── event-bus.ts

src-tauri/        # Tauri/Rust layer
├── src/main.rs   # Pure UI shell (connects to external server)
└── Cargo.toml    # Tauri dependencies

e2e/              # Playwright E2E tests
```

### Key Pattern: tRPC + React Query

UI components use tRPC queries/mutations via TanStack React Query:

```typescript
// ✅ Correct - use tRPC for data fetching
import { trpc } from '@/bridge/react';
const { data: sessions } = trpc.session.list.useQuery();

// ✅ Mutations with cache invalidation
const deleteMutation = trpc.session.delete.useMutation({
  onSuccess: () => queryClient.invalidateQueries({ queryKey: ['session'] }),
});

// ✅ Zustand for client-only state
import { useMessagesStore } from '@/ui/stores/useMessagesStore';
const messages = useMessagesStore((s) => s.messages);
```

**Note**: Services are lazy-initialized singletons. All services implement `dispose()` for cleanup. The service barrel (`src/services/index.ts`) re-exports all getters, reset functions, and factory functions. `server/index.ts` contains only CORS, tRPC mount, and 3 diagnostic routes — all domain logic lives in tRPC routers.

### Path Aliases

| Alias | Path   |
| ----- | ------ |
| `@/*` | `src/*` |

## Testing

-   **Unit tests**: `bun run test` (Vitest, 391 tests passing, 3 skipped)
  - 339 service/hook/router tests
  - 48 component tests (React Testing Library)
-   **E2E tests**: `bun run test:e2e` (Playwright, 28 tests)
-   **E2E headed**: `bun run test:e2e:headed` (watch tests run)
-   **E2E debug**: `bun run test:e2e:debug` (step through)

**Test Coverage**: All HIGH/MEDIUM priority components tested.

## Tech Stack

-   **Runtime**: Bun (not Node)
-   **Desktop**: Tauri 2.0
-   **UI**: React 19 + Zustand + Jotai + TanStack Query
-   **API**: tRPC v11 (type-safe, superjson, SSE subscriptions)
-   **Server**: Hono + @hono/trpc-server
-   **Types**: TypeScript strict mode
-   **Styling**: Tailwind CSS v4 (@tailwindcss/vite)
-   **E2E**: Playwright
-   **Agent SDK**: `@anthropic-ai/claude-agent-sdk` (spawns Claude Code processes, uses Claude CLI auth)

## Performance Metrics

| Metric | Target | Actual | Status |
|--------|--------|--------|--------|
| Idle memory | < 100 MB | 6.06 MB | ✅ PASS |
| First token latency | < 300 ms | ~0 ms | ✅ PASS |
| Stream throughput | - | 14.55 ms/1000 tokens | ✅ PASS |
| Cold start (dev) | < 2s | ~5s | ⚠️ Dev mode only |

**Note**: Cold start ~5s is dev mode overhead (Rust compilation). Production builds don't have this. See `docs/architecture/learnings.md` for detailed performance analysis.

## Gotchas

1. **External server architecture** - Server runs from terminal (not spawned by Tauri) for proper shell environment. `bun run dev` handles this automatically.
2. **Services use Node APIs** - Services run in Bun runtime (not browser)
3. **Tauri detection**: Use `__TAURI_INTERNALS__` (not `__TAURI__` in v2)
4. **E2E tests need server** - Playwright config auto-starts `dev:web` (server for testing)
5. **Port 4096** - Server runs on this port
6. **Build minifier** - Uses `esbuild` (not terser) in vite.config.ts
7. **Path aliases** - Defined in tsconfig.json AND vite.config.ts (must sync)
8. **ESLint warnings** - 0 warnings. See `docs/operations/issues.md`
9. **Cold start** - ~5s in dev mode (Tauri/Rust compilation). Production builds don't have this overhead.
10. **Memory optimization** - All services implement `dispose()` pattern. Idle memory: 6 MB (target < 100 MB) ✅
11. **Claude Agent SDK Auth** - SDK uses Claude CLI's auth from `~/.claude/.credentials.json`. Running server from terminal ensures proper shell environment for auth. The SDK handles token refresh internally.
12. **Agent tests skipped** - `src/services/agent.test.ts` tests are skipped; need rewrite for new SDK.
13. **SDK streaming** - Must pass `includePartialMessages: true` to `sdkQuery()` options to get `stream_event` with `content_block_delta` events. Without it, only final `assistant` messages are returned.
14. **Bun.serve timeout** - Default `idleTimeout` is 10s. SSE endpoints need longer timeout (120s) for LLM responses. Set in server export config.
15. **Debug logging** - `debug.log` in project root captures server/agent flow. View via `http://localhost:4096/debug-log` or `tail -f debug.log`.
16. **SSE token whitespace** - Never `.trim()` SSE data; removes spaces between LLM tokens. Only trim final complete message in `finishStreamingMessage()`.
17. **Streaming duplication** - With `includePartialMessages: true`, SDK sends content via deltas AND final message. Only yield from `content_block_delta` events to avoid duplicate text.
18. **Native clipboard** - Use Tauri's native Edit menu for clipboard ops, not JS handlers. See `src-tauri/src/main.rs` for `SubmenuBuilder` setup.
19. **Virtualization** - Use `react-virtuoso` for virtual scrolling (replaced `@tanstack/solid-virtual`).
20. **Markdown rendering** - Use `marked` + `dompurify` for XSS-safe markdown. Component at `src/ui/components/Messages/Markdown.tsx`.
21. **Service barrel export** - `src/services/index.ts` re-exports all services with `getXxxService()`/`resetXxxService()` pattern. `disposeAllServices()` resets all singletons for test cleanup.
22. **vitest.config.ts separate from vite.config.ts** - Both must use `@vitejs/plugin-react`. If vitest uses wrong plugin, React hooks fail with `Cannot read properties of null (reading 'useState')`.
23. **`vi.useFakeTimers()` + `waitFor()` deadlock** - React Testing Library's `waitFor` uses `setTimeout` for polling. Fake timers intercept this. Use `vi.useRealTimers()` before async tests.
24. **tRPC client splitLink** - Queries/mutations use `httpBatchLink`, subscriptions use `httpSubscriptionLink` (SSE). Both configured in `src/bridge/trpc.ts`.

**Known Issues**: See `docs/operations/issues.md` for detailed issues and resolutions.