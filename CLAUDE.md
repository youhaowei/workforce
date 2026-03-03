# Workforce - Desktop Agentic Orchestrator

Docs: `docs/` (high-level) + [Notion](https://www.notion.so/2ffd48ccaf5481d7bb33d67599423042) (feature specs, architecture). Known issues: `docs/operations/issues.md`.

## Commands

```bash
bun install          # Install dependencies
bun run test         # All unit tests (Vitest)
bun run test -- src/services/session.test.ts  # Single test file
bun run test:e2e     # Playwright E2E tests
bun run lint         # Lint code
bun run type-check   # TypeScript check
bun run server       # Start backend server (port 4096)
bun run server:watch # Server with hot-reload
bun run dev:web      # Start server + vite for web testing (port 5173)
bun run clean        # Remove build artifacts (dist, .electrobun)
```

**ASK FIRST — never auto-run:**

```bash
bun run dev   # Server + Electrobun desktop app (dev loads from Vite :5173)
bun run build # Electrobun release build
```

**Desktop**: Dev mode starts server externally (`server:watch &`) then Electrobun. Production: `src/bun/index.ts` calls `startServer()` directly — Hono serves API + Vite output on `:4096`.

## Architecture

```
Electrobun (src/bun/index.ts)  →  startServer() direct call
         ↓
Hono + tRPC v11 (:4096)       →  /api/trpc/*, SSE subscriptions, Vite static
         ↓ http
React 19 WebView               →  Zustand/Jotai stores, tRPC client (splitLink)
         ↓
Service Layer                  →  Lazy singletons, unifai agent SDK, JSONL persistence
```

- **tRPC splitLink**: queries/mutations via `httpBatchLink`, subscriptions via `httpSubscriptionLink` (SSE)
- **Streaming**: SSE with rAF-batched token accumulation, `content_block_delta` events only
- **Path alias**: `@/*` → `src/*` (synced in tsconfig.json + vite.config.ts)

### Directory Structure

```
src/
├── ui/              # React 19 (browser-safe only)
│   ├── components/  # ← FEATURE components (Shell, Sessions, Theme, ChatInfo, etc.)
│   ├── stores/      # Zustand stores (messages, theme, dialog, etc.)
│   ├── hooks/       # React hooks (usePlanMode, useEventBus, etc.)
│   ├── context/     # PlatformProvider, HotkeyProvider
│   ├── hotkeys/     # Hotkey definitions and handler
│   ├── formatters/  # Text formatting (markdown, stripMarkdown)
│   └── lib/         # Utilities (cn helper, oklch color math)
├── components/ui/   # ← PRIMITIVE components (button, surface, card, dialog, etc.)
├── theme/           # Design token definitions (tokens.ts)
├── server/          # Hono HTTP server + tRPC routers
│   ├── index.ts     # CORS, tRPC mount, diagnostic routes
│   ├── trpc.ts      # initTRPC with superjson
│   └── routers/     # Domain routers + _services.ts (lazy service barrel)
├── services/        # Backend services (Bun runtime only)
│   ├── agent.ts, agent-instance.ts, agent-models.ts
│   ├── session.ts, session-journal.ts, session-streaming.ts, session-rehydration.ts
│   ├── orchestration.ts, todo.ts, git.ts, org.ts, user.ts, project.ts
│   └── types.ts     # Domain types, error classes, Result<T,E>
├── bridge/          # tRPC client (trpc.ts, react.ts, query-client.ts)
├── cli/             # CLI commands framework
├── shared/          # Shared code (no Node/Bun APIs) — event-bus.ts, palette.ts
├── utils/           # Bun-side utilities (execFileNoThrow)
└── hooks/           # Non-React hooks (typescript-lsp integration)

src/bun/index.ts     # Electrobun main process (Bun-native, no browser APIs)
e2e/                 # Playwright E2E tests
```

**Two component directories** — Don't confuse them:
- `src/components/ui/` — Radix-based **primitives** (Button, Surface, Card, Dialog, etc.). Styled with CVA + token classes.
- `src/ui/components/` — **Feature** components (Shell, Sessions, Theme, Messages, etc.). Compose primitives into app-specific UI.

### Data Flow

- **Server data**: `trpc.session.list.useQuery()` via `@/bridge/react` (TanStack Query)
- **Mutations**: `trpc.session.delete.useMutation()` with `queryClient.invalidateQueries()` on success
- **Client state**: Zustand stores (e.g., `useMessagesStore((s) => s.messages)`)
- **Services**: Lazy singletons with `dispose()`. Barrel: `src/services/index.ts`. All domain logic in tRPC routers.

### Error Handling

- **`Result<T, E>`** at service boundaries (from `src/services/types.ts`) — not `null`, not thrown exceptions
- **Tagged error classes** with `readonly _tag` discriminant — callers `switch` on `_tag`
- **`null`** only for genuine absence, never for "something went wrong"
- **Throw** only for programming errors / invariant violations
- **Never** silently swallow errors — at minimum log with context
- See `docs/architecture/decisions.md` #14-15 for rationale

## Testing

Test at the layer the change lives in (test both if a fix crosses layers):
- **Service/router** — `router.test.ts` via `createCaller()`, or service-level with factory functions + temp dirs
- **UI** — React Testing Library + jsdom (`src/ui/**/*.test.tsx`)
- **E2E** — Playwright (`bun run test:e2e`, `test:e2e:headed`, `test:e2e:debug`)

### Conventions

- **Bug reproduction** — Construct JSONL journal records and replay via `replaySession()`. More reliable than mocking UI state.
- **Logging** — Wide events over breadcrumbs. One structured JSON entry per operation (session ID, tools, duration, outcome), not 20 `debugLog()` calls. `debug.log` viewable via `/debug-log` endpoint or `tail -f`.
- **Co-located tests** — `Foo.test.ts` next to `Foo.ts`, not in `__tests__/` directories
- **Environments** — Node (default) for services/routers; `jsdom` for `src/ui/**/*.test.tsx` (auto-matched in vitest.config.ts)
- **Shared mocks** — `src/services/__test__/orchestration-helpers.ts`: `mockSession()`, `createMockSessionService()`, etc.
- **Temp data** — `WORKFORCE_DATA_DIR` points to tmpdir in tests, never `~/.workforce/`

## Tech Stack

Bun (not Node) · Electrobun · React 19 · Zustand + Jotai + TanStack Query · tRPC v11 (superjson, SSE) · Hono · TypeScript strict · Tailwind CSS v4 · Playwright · `unifai` wrapping `@anthropic-ai/claude-agent-sdk`

## Design Token System

The UI uses a custom OKLCH-based design token system bridged to Tailwind CSS v4 via CSS custom properties.

### Token Architecture

```
src/index.css         # @theme inline block + :root/:root.dark token definitions
src/theme/tokens.ts   # TypeScript token interfaces
src/ui/lib/oklch.ts   # OKLCH ↔ hex conversion utilities
src/ui/stores/useThemeStore.ts  # Runtime theme overrides (mode + color customization)
```

### Token Namespaces

| Namespace | CSS variable | Tailwind class | Purpose |
|-----------|-------------|----------------|---------|
| Palette | `--palette-primary` | `bg-palette-primary` | Accent colors (primary, secondary, success, danger, warning, info) |
| Palette FG | `--palette-primary-fg` | `text-palette-primary-fg` | Foreground on palette backgrounds |
| Neutral | `--neutral-fg`, `--neutral-bg` | `text-neutral-fg`, `bg-neutral-bg` | Text, backgrounds, borders (13 tokens) |
| Surface | `--surface-base`, `--surface-radius` | via CSS vars | Shell ground, panel backgrounds |

### How It Works

1. `:root` in `index.css` defines all tokens in OKLCH (e.g., `--palette-primary: oklch(0.205 0 0)`)
2. `@theme inline` block maps CSS vars to Tailwind's `--color-*` namespace
3. Components use Tailwind classes: `bg-palette-primary`, `text-neutral-fg-subtle`, `border-neutral-border`
4. `useThemeStore` applies runtime overrides by setting inline styles on `documentElement`

### Component Patterns

**Button** — Two-axis compound variant system (`variant × color`):
- Variants: `solid`, `soft`, `outline`, `ghost`, `link`
- Colors: `neutral`, `primary`, `secondary`, `success`, `danger`, `warning`, `info`
- Each combo maps to specific token classes (e.g., `solid + primary → bg-palette-primary text-palette-primary-fg`)

**Surface** — Panel backgrounds with CVA variants: `main` (bg/45 + blur), `stage` (/95), `panel` (/90)

### Neutral Tones

All 13 neutral tokens share a single hue + chroma — only lightness varies. Users can customize the hue/chroma pair (e.g., warm/cool/slate), and all neutrals update coherently. Light and dark modes have separate lightness scales.

## Performance

See `docs/architecture/learnings.md` for metrics. Key targets: < 100 MB idle memory, < 300 ms first token latency, streaming via SSE with rAF-batched token accumulation.

## Gotchas

### Visual/CSS Changes
- **Always verify visually** — After ANY CSS or layout change, use chrome-tester (model: sonnet) to inspect the rendered result before declaring done. Don't guess — inspect computed styles on the actual elements.
- **Investigate before fixing** — For visual bugs or inconsistency reports, inspect all candidate elements FIRST to identify the exact source. Don't remove/modify properties speculatively.
- **Fix systematically** — When user reports "X is inconsistent with Y", read BOTH components, make a checklist of all differences, and fix all at once. Don't iterate piecemeal.
- **Ask before restructuring** — When moving components between layout containers (e.g., inside/outside a Surface), ask about the intended visual hierarchy rather than guessing.

### Design Tokens & Styling
- **Always use token classes** — Use `bg-palette-primary`, `text-neutral-fg`, etc. Never use raw colors (`bg-gray-500`, `text-black`) in components.
- **Button color axis** — Button uses `color="neutral"` (not `"default"`). Active/selected states that should respect the user's accent color use `color="primary"`.
- **Surface variant determines bg** — `<Surface variant="main">` provides the frosted glass bg. Don't add manual `bg-*` classes on top.
- **OKLCH in CSS vars** — Token values are OKLCH strings. Use `src/ui/lib/oklch.ts` for conversion. The `/` opacity syntax works with OKLCH (e.g., `bg-palette-primary/90`).
- **Theme overrides are inline styles** — `useThemeStore` sets overrides on `document.documentElement.style`. These take precedence over `:root` definitions in CSS.
- **Panel consistency** — Panels (ChatInfo, Sessions, Theme) share: header `h-10 px-3 gap-2`, title `text-sm font-semibold text-neutral-fg`, content `p-3 space-y-4 text-sm`, section labels `text-xs font-medium text-neutral-fg-subtle`.

### Architecture
- **`electrobun/bun` imports only in `src/bun/`** — Keep `src/ui/` browser-safe. Native dialogs via tRPC (`dialog.openDirectory` mutation).
- **`isDesktop` detection** — `window.location.port === '4096'` in `App.tsx`. Dev web `:5173`, desktop `:4096`.
- **Singleflight for lazy init** — `this.initPromise ??= this.doInit()` prevents concurrent callers racing.
- **Error classes** — Tagged domain errors in `src/services/types.ts`. Services return `Result<T, E>`, routers map to `TRPCError`.
- **Debug logging** — `debug.log` in project root. View via `/debug-log` endpoint or `tail -f`.
- **SetupGate** — Wraps `Shell`, guarantees user identity + initialized org. `useRequiredOrgId()` throws if called outside.

### SDK & Streaming
- **Auth** — Claude CLI auth from `~/.claude/.credentials.json`. SDK handles token refresh.
- **Streaming** — `content_block_delta` events only (not final message). Never `.trim()` SSE data — strips inter-token spaces.
- **Bun.serve timeout** — Default `idleTimeout` 10s; SSE needs 120s.
- **Cold-replay answers** — Answers persisted in `block.result` via `updateBlockResult`. Historical answers as follow-up messages: `backfillQuestionResults` in `session-journal.ts` handles migration.

### UI
- **Radix UI** — Unified `radix-ui` package, not individual `@radix-ui/*`. ContextMenu has no controlled `open` prop — gate via capture-phase `stopPropagation` on `contextmenu`.
- **React 19 `useRef`** — Requires initial value: `useRef<T | undefined>(undefined)`, not `useRef<T>()`.
- **`useState` + async queries** — `useState(() => fn(queryData))` captures `undefined` at first render. Use `useEffect` + ref guard instead.
- **Markdown** — `marked` + `dompurify`. `stripMarkdown()` regexes must use word boundaries to avoid corrupting `foo_bar_baz` identifiers.

### Testing & Build
- **NEVER kill user processes** — Do NOT kill processes on ports 4096, 5173. If occupied, fail clearly.
- **E2E isolation** — Tests use temp data dir (`WORKFORCE_DATA_DIR`), own server on ports 4199 (API) / 5174 (Vite), `reuseExistingServer: false`. Never writes to `~/.workforce/`.
- **E2E fixtures** — Clean up tRPC API data in `afterEach`. Sync via `page.waitForResponse()`, not text selectors.
- **vitest.config.ts** — Separate from vite.config.ts; both need `@vitejs/plugin-react`.
- **Fake timers + `waitFor()`** — Deadlocks. Use `vi.useRealTimers()` before async assertions.
- **Router tests** — Share global singletons. `resetXxxService()` in `afterEach` is mandatory. For isolated tests, use factory functions with temp dirs.
- **Build** — `esbuild` minifier (not terser). ESLint complexity max 15 per function.
- **Optimistic updates** — `onMutate` must return rollback context for `onError`.

### unifai Dependency
- **What**: Multi-provider agent abstraction (`github:youhaowei/unifai`). GitHub dep for portability; `bun link` for local dev.
- **Local setup**: `cd ~/Projects/unifai && bun link` then `cd ~/Projects/workforce && bun link unifai`
- **After `bun install`**: Re-run `bun link unifai` (install overwrites the link)
- **In worktrees**: Run `bun link unifai` after creation (or just use the GitHub version)

## Recipes

**Add a new tRPC router:**
1. Create `src/server/routers/{name}.ts` — export a `{name}Router` using `router()` + `publicProcedure`
2. Add to `src/server/routers/index.ts` `appRouter` merge
3. Access service via `getXxxService()` from `src/server/routers/_services.ts`

**Add a new service:**
1. Create `src/services/{name}.ts` — class with `ensureInitialized()`, `dispose()`, lazy singleton getter
2. Export `get{Name}Service()` and `reset{Name}Service()` from `src/services/index.ts`
3. Add to `src/server/routers/_services.ts` for router access

**Add a new UI primitive:**
1. Create `src/components/ui/{name}.tsx` — CVA variants, token classes, `forwardRef`
2. Follow Button/Surface pattern: variant × color compound variants, token classes (not raw colors)

**Add a new feature component:**
1. Create `src/ui/components/{Name}/` directory with `index.ts` barrel
2. Use primitives from `@/components/ui/*`, stores from `@/ui/stores/*`
3. Data via `trpc.{domain}.{method}.useQuery()` from `@/bridge/react`

## Principles

- **Push back** — Give genuine technical opinions, especially on architecture and scope. Don't just comply.
- **Greenfield** — No external consumers. Prioritize clean abstractions over backward compatibility. Delete dead types entirely.