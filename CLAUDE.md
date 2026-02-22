# Workforce - Desktop Agentic Orchestrator

## 📋 Project State & Documentation

**Repo docs (`docs/`) are high-level. Detailed feature specs and architecture reference live in [Notion (Workforce project)](https://www.notion.so/2ffd48ccaf5481d7bb33d67599423042).**

```
docs/
├── product/
│   ├── PRD-MVP.md                          # High-level PRD overview (links to Notion feature specs)
│   ├── vision.md                           # Product vision & philosophy
│   └── research-synthesis.md               # ARCHIVED — historical research reference
├── architecture/
│   ├── decisions.md                        # Architectural decision log
│   └── learnings.md                        # Performance metrics and patterns
└── operations/
    ├── issues.md                           # Known issues and risks
    ├── open-decisions.md                   # Unresolved product decisions
    └── decisions/
        └── session-list-performance.md     # One-off decision: lightweight session list
```

**Notion (detailed docs):**
- PRD — MVP Overview
- Feature Spec: Sessions & Fork (FR4 + FR5)
- Feature Spec: Agent & Workflow Templates (FR2 + FR3)
- Feature Spec: Supervision & Review (FR6 + FR7 + FR8)
- Feature Spec: Skills & Tools (FR10)
- Feature Spec: Parallel Work Isolation (FR9)
- Feature Spec: Organization & Projects (FR1)
- Feature Spec: History & Auditability (FR11)
- Architecture: Agent Model
- Architecture: Distributed Architecture (Hive Mind)
- Architecture: Department-Specific Orchestration
- Architecture: Design Principles

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

**Metrics**: ESLint clean (0 warnings), TypeScript strict mode, 6 MB idle memory.

## ⚠️ IMPORTANT: Do NOT Auto-Run Dev Server

**NEVER run `bun run dev` or `bun run build` automatically.**
Always ask the user before starting the dev server or building the app.

## Commands

```bash
bun install        # Install dependencies
bun run test       # Run unit tests
bun run test:e2e   # Run Playwright E2E tests
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

**Dev mode**: `bun run dev` starts the server externally (`server:watch &`), then launches Tauri. The sidecar bootstrap in `useServerInit` is skipped via `import.meta.env.DEV`.

```bash
bun run dev  # Starts server in background, then Tauri
```

If you need to run them separately:
```bash
bun run server  # Terminal 1
tauri dev       # Terminal 2
```

**Production mode**: Tauri spawns the server as a compiled sidecar binary (no external Bun needed). `useServerInit` calls `startServer()` → Rust spawns the binary → polls `/health` until ready. The `fix-path-env` crate repairs HOME/PATH for GUI-launched apps.

## Architecture

### Sidecar Architecture (Tauri + Bun HTTP Server)

```
┌─────────────────────────────────────────────────────────────┐
│  Tauri (Rust)                                               │
│  - Spawns Bun server as sidecar child process               │
│  - fix-path-env repairs HOME/PATH for GUI apps              │
│  - Native menus, window management                          │
└─────────────────────────────────────────────────────────────┘
         ↓ start_server/stop_server commands
┌─────────────────────────────────────────────────────────────┐
│  UI Layer (React 19 WebView)                                │
│  - Zustand/Jotai stores, React hooks                        │
│  - Virtual scrolling (react-virtuoso)                       │
│  - useServerInit auto-boots sidecar in production           │
└─────────────────────────────────────────────────────────────┘
         ↓ tRPC client (splitLink: HTTP + SSE) → localhost:4096
┌─────────────────────────────────────────────────────────────┐
│  Bun HTTP Server (Hono + tRPC v11)                          │
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
- **Backend**: Hono HTTP server (port 4096) with tRPC routers wrapping service layer
- **Sidecar**: In production, Tauri spawns a compiled server binary (`bun build --compile`). In dev, server runs externally via `server:watch`.
- **Performance**: First-class concern - streaming via SSE subscriptions, rAF-batched token accumulation

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
    ├── event-bus.ts
    └── palette.ts    # Color palette + colorFromName (used by service & UI)

src-tauri/        # Tauri/Rust layer
├── src/main.rs   # Sidecar lifecycle (start/stop server), env repair, native menus
└── Cargo.toml    # Tauri dependencies (fix-path-env, shell plugin)

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

### Error Handling

Use typed domain errors and `Result<T, E>` at service boundaries. Do **not** use `null` to mean "something went wrong" — only for genuine absence (e.g. optional fields). Do **not** add silent `catch {}` blocks.

**Error classes** — Define tagged error classes with a `readonly _tag` discriminant and contextual fields:

```typescript
// ✅ Typed, tagged, carries context
export class SessionNotFound {
  readonly _tag = 'SessionNotFound';
  constructor(readonly sessionId: string) {}
}

export class SessionCorrupted {
  readonly _tag = 'SessionCorrupted';
  constructor(readonly sessionId: string, readonly path: string, readonly cause: SyntaxError) {}
}
```

**Result type** — Use `Result<T, E>` from `src/services/types.ts` for operations that can fail in expected ways:

```typescript
// ✅ Caller sees exactly what can fail
async function loadSession(
  dir: string, id: string
): Promise<Result<Session, SessionNotFound | SessionCorrupted | DiskIOError>>

// ❌ null conflates "not found" with "corrupted"
async function loadSession(dir: string, id: string): Promise<Session | null>

// ❌ Throws hide the error contract
async function loadSession(dir: string, id: string): Promise<Session>  // throws on error
```

**When to throw vs return Result:**
- **Return `Result`** for expected failures at service boundaries (not found, validation, I/O)
- **Throw** only for programming errors / invariant violations that should never happen
- **Never** silently swallow errors — at minimum log a warning with context

**Pattern matching** — Callers discriminate on `_tag`:

```typescript
const result = await loadSession(dir, id);
if (!result.ok) {
  switch (result.error._tag) {
    case 'SessionNotFound': return null;
    case 'SessionCorrupted': await backupAndRecover(result.error); break;
    case 'DiskIOError': throw result.error;
  }
}
```

See `docs/architecture/decisions.md` #14-15 for rationale (Effect was evaluated and deferred).

### Path Aliases

| Alias | Path   |
| ----- | ------ |
| `@/*` | `src/*` |

## Testing

-   **Unit tests**: `bun run test` (Vitest)
-   **E2E tests**: `bun run test:e2e` (Playwright)
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

### Architecture
- **Sidecar server** — Bun HTTP server on port 4096. Dev: started externally by `bun run dev`. Production: Tauri spawns compiled binary via `useServerInit` → `start_server` Rust command.
- **Services use Bun APIs** — Not browser-safe. Lazy-init singletons with `dispose()`. Barrel: `src/services/index.ts` (`getXxxService()`/`resetXxxService()`/`disposeAllServices()`).
- **Singleflight for lazy init** — `ensureInitialized()` must cache the in-flight promise (`this.initPromise ??= this.doInit()`) to prevent concurrent callers from racing.
- **Error classes in types.ts** — Domain errors (e.g. `ProjectNotFound`) live in `src/services/types.ts` alongside the interface. Services return `Result<T, E>`, routers map to `TRPCError`.
- **tRPC splitLink** — Queries/mutations use `httpBatchLink`, subscriptions use `httpSubscriptionLink` (SSE). Config in `src/bridge/trpc.ts`.
- **Path aliases** — `@/*` → `src/*` in both tsconfig.json and vite.config.ts (must sync).
- **Debug logging** — `debug.log` in project root. View via `/debug-log` endpoint or `tail -f`.
- **SetupGate boundary** — `SetupGate` wraps `Shell` and guarantees user identity + initialized org before Shell mounts. `useRequiredOrgId()` throws if called outside this boundary (before org is set in Zustand). Shell initializes `serverConnected = true` because SetupGate already verified the server. The `initialized` field on `Org` is migrated to `true` for pre-existing orgs in `OrgService.doInit()`.

### SDK & Streaming
- **Auth** — SDK uses Claude CLI auth from `~/.claude/.credentials.json`. SDK handles token refresh internally. Tauri's `fix-path-env` crate repairs HOME/PATH for GUI-launched apps so auth works without a terminal.
- **Streaming** — Pass `includePartialMessages: true` to `sdkQuery()`. Only yield from `content_block_delta` events (not final message) to avoid duplication. Never `.trim()` SSE data — it strips inter-token spaces.
- **Bun.serve timeout** — Default `idleTimeout` is 10s; SSE needs 120s for LLM responses.

### Tauri & UI
- **Radix UI** — Uses unified `radix-ui` package (not individual `@radix-ui/*`). Import from `"radix-ui"` directly.
- **Tauri v2 detection** — Use `__TAURI_INTERNALS__` (not `__TAURI__`).
- **Tauri plugins require 3 changes** — (1) Cargo.toml dependency, (2) `.plugin()` registration in `main.rs`, (3) capability permission in `src-tauri/capabilities/default.json`.
- **Native clipboard** — Use Tauri's Edit menu, not JS handlers. See `src-tauri/src/main.rs`.
- **Radix ContextMenu** — No controlled `open` prop. Gate opening via capture-phase `stopPropagation` on the `contextmenu` event.
- **React 19 `useRef`** — Requires initial value: `useRef<T | undefined>(undefined)`, not `useRef<T>()`.
- **Virtualization** — `react-virtuoso` for virtual scrolling.
- **Markdown** — `marked` + `dompurify` for rendering. `stripMarkdown()` in `src/ui/formatters/markdown.ts` for plain-text previews. Emphasis-stripping regexes must require word boundaries to avoid corrupting identifiers like `foo_bar_baz`.
- **`useState` initializer + async queries** — `useState(() => fn(queryData))` captures `queryData` at first render, which is always `undefined`/`null` for async queries. Use a separate `useEffect` to apply async data once it resolves, guarded by a ref to avoid re-application.

### Testing & Build
- **NEVER kill user processes** — Do NOT kill processes on ports 4096, 5173, or any port the user's dev server may be running on. E2E tests must use their own isolated server instances. If a port is occupied, fail with a clear error — never kill the process.
- **E2E isolation** — E2E tests use a temp data dir (`mkdtempSync` in `playwright.config.ts`) and start their own server with `WORKFORCE_DATA_DIR` pointing to that temp dir. Tests NEVER write to `~/.workforce/`. The backend server uses `reuseExistingServer: false` to guarantee isolation.
- **E2E needs server** — Playwright auto-starts both `bun run server` and `bun run vite`.
- **E2E fixtures with server state** — Tests creating data via tRPC API (`POST /api/trpc/<proc>` with body `{ json: input }`) must clean up in `afterEach`. Use `page.waitForResponse()` to sync on API calls rather than text selectors.
- **Agent tests skipped** — `src/services/agent.test.ts` needs rewrite for new SDK.
- **vitest.config.ts** — Separate from vite.config.ts; both must use `@vitejs/plugin-react` or React hooks break.
- **Fake timers + `waitFor()`** — Deadlocks. Use `vi.useRealTimers()` before async assertions.
- **Build minifier** — `esbuild` (not terser) in vite.config.ts.
- **ESLint complexity limit** — Max 15 per function. Extract sub-components to stay under.
- **Optimistic updates** — `onMutate` must return rollback context for `onError` when side effects (selection clearing, cache changes) happen.
- **Router tests share global singletons** — Services like `UserService` persist to `~/.workforce/` on disk. `resetXxxService()` clears memory but not disk. Use factory functions (`createXxxService(tempPath)`) for isolated unit tests. Router integration tests sharing `createCaller({})` must account for cross-test disk persistence.

**Known Issues**: See `docs/operations/issues.md` for detailed issues and resolutions.

## Communication Style

Be honest and push back when you think my approach has issues. Don't just comply — give me your genuine technical opinion, especially on architecture and scope decisions.