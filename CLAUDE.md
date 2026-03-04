# Workforce - Desktop Agentic Orchestrator

Docs: `docs/` (high-level) + [Notion](https://www.notion.so/2ffd48ccaf5481d7bb33d67599423042) (feature specs, architecture). Known issues: `docs/operations/issues.md`.

## Commands

```bash
pnpm install          # Install dependencies
pnpm run test         # All unit tests (Vitest)
pnpm run test -- src/services/session.test.ts  # Single test file
pnpm run test:e2e     # Playwright E2E tests
pnpm run lint         # Lint code
pnpm run type-check   # TypeScript check
pnpm run server       # Start backend server (port 4096)
pnpm run server:watch # Server with hot-reload
pnpm run dev:web      # Start server + vite for web testing (port 5173)
pnpm run clean        # Remove build artifacts (dist, out)
```

**ASK FIRST — never auto-run:**

```bash
pnpm run dev   # Server + Electron desktop app (dev loads from Vite :5173)
pnpm run build # Electron Forge release build
```

## Key Disambiguation

**Two component directories** — Don't confuse them:
- `src/components/ui/` — Radix-based **primitives** (Button, Surface, Card, Dialog, etc.). Styled with CVA + token classes.
- `src/ui/components/` — **Feature** components (Shell, Sessions, Theme, Messages, etc.). Compose primitives into app-specific UI.

**Path alias**: `@/*` → `src/*` (synced in tsconfig.json + vite.config.ts)

## Conventions

### Infrastructure Values
- **Never hardcode ports, URLs, or paths** — Use discovery patterns (e.g., `.dev-port`, `.vite-port` files). Hardcoded values silently break when ports shift, servers restart on different ports, or environments differ.
- **Port-file pattern** — Server writes `.dev-port`, Vite writes `.vite-port` on startup. Consumers read the file to discover the actual port.

### Error Handling
- **`Result<T, E>`** at service boundaries (from `src/services/types.ts`) — not `null`, not thrown exceptions
- **Tagged error classes** with `readonly _tag` discriminant — callers `switch` on `_tag`
- **`null`** only for genuine absence, never for "something went wrong"
- **Throw** only for programming errors / invariant violations
- **Never** silently swallow errors — at minimum log with context

### Testing
Test at the layer the change lives in (test both if a fix crosses layers):
- **Service/router** — `router.test.ts` via `createCaller()`, or service-level with factory functions + temp dirs
- **UI** — React Testing Library + jsdom (`src/ui/**/*.test.tsx`)
- **E2E** — Playwright (`pnpm run test:e2e`, `test:e2e:headed`, `test:e2e:debug`)
- **Bug reproduction** — Construct JSONL journal records and replay via `replaySession()`. More reliable than mocking UI state.
- **Co-located tests** — `Foo.test.ts` next to `Foo.ts`, not in `__tests__/` directories
- **Environments** — Node (default) for services/routers; `jsdom` for `src/ui/**/*.test.tsx` (auto-matched in vitest.config.ts)
- **Shared mocks** — `src/services/__test__/orchestration-helpers.ts`: `mockSession()`, `createMockSessionService()`, etc.
- **Temp data** — `WORKFORCE_DATA_DIR` points to tmpdir in tests, never `~/.workforce/`

### Design Tokens & Styling
- **Always use token classes** — Use `bg-palette-primary`, `text-neutral-fg`, etc. Never use raw colors (`bg-gray-500`, `text-black`) in components.
- **Button color axis** — Button uses `color="neutral"` (not `"default"`). Active/selected states use `color="primary"`.
- **Surface variant determines bg** — `<Surface variant="main">` provides the frosted glass bg. Don't add manual `bg-*` classes on top.
- **OKLCH in CSS vars** — Token values are OKLCH strings. Use `src/ui/lib/oklch.ts` for conversion. The `/` opacity syntax works with OKLCH (e.g., `bg-palette-primary/90`).
- **Theme overrides are inline styles** — `useThemeStore` sets overrides on `document.documentElement.style`. These take precedence over `:root` definitions in CSS.
- **Panel consistency** — Panels (ChatInfo, Sessions, Theme) share: header `h-10 px-3 gap-2`, title `text-sm font-semibold text-neutral-fg`, content `p-3 space-y-4 text-sm`, section labels `text-xs font-medium text-neutral-fg-subtle`.

## Reference Implementation

**craft-agents-oss** (`/Users/youhaowei/Projects/external/craft-agents-oss/`) — Same stack (Electron + Tailwind v4 + Vite + React). Strong reference for Electron window chrome, drag regions, native integrations, panel layouts, and desktop UX patterns. Check it FIRST before implementing Electron-specific features or debugging platform issues.

## Gotchas

### Architecture
- **`electron` imports only in `src/electron/`** — Keep `src/ui/` browser-safe. Native dialogs via IPC (`window.electronAPI.openDirectory()`).
- **`isDesktop` detection** — `window.location.port === '4096'` in `App.tsx`. Dev web `:5173`, desktop `:4096`.
- **Singleflight for lazy init** — `this.initPromise ??= this.doInit()` prevents concurrent callers racing.
- **SetupGate** — Wraps `Shell`, guarantees user identity + initialized org. `useRequiredOrgId()` throws if called outside.

### SDK & Streaming
- **Streaming** — `content_block_delta` events only (not final message). Never `.trim()` SSE data — strips inter-token spaces.
- **@hono/node-server** — Server runs via `@hono/node-server`'s `serve()`. SSE connections need appropriate timeout handling.
- **Cold-replay answers** — Answers persisted in `block.result` via `updateBlockResult`. Historical answers as follow-up messages: `backfillQuestionResults` in `session-journal.ts` handles migration.

### UI
- **Radix UI** — Unified `radix-ui` package, not individual `@radix-ui/*`. ContextMenu has no controlled `open` prop — gate via capture-phase `stopPropagation` on `contextmenu`.
- **React 19 `useRef`** — Requires initial value: `useRef<T | undefined>(undefined)`, not `useRef<T>()`.
- **`useState` + async queries** — `useState(() => fn(queryData))` captures `undefined` at first render. Use `useEffect` + ref guard instead.
- **Markdown** — `marked` + `dompurify`. `stripMarkdown()` regexes must use word boundaries to avoid corrupting `foo_bar_baz` identifiers.
- **Drag region overlay** — `index.html` has a z-40 fixed div covering `--topbar-height` for window dragging. Interactive elements (`button`, `input`, `a`, `[role="button"]`) auto-opt-out via `-webkit-app-region: no-drag`. Custom interactive elements in the topbar need `role="button"` or explicit `app-region: no-drag` to be clickable. The raw `<style>` tag in `index.html` is intentional — Lightning CSS strips `-webkit-app-region`.

### Testing & Build
- **NEVER kill user processes** — Do NOT kill processes on ports 4096, 5173. If occupied, fail clearly.
- **E2E isolation** — Tests use temp data dir (`WORKFORCE_DATA_DIR`), own server on ports 4199 (API) / 5174 (Vite), `reuseExistingServer: false`. Never writes to `~/.workforce/`.
- **E2E fixtures** — Clean up tRPC API data in `afterEach`. Sync via `page.waitForResponse()`, not text selectors.
- **vitest.config.ts** — Separate from vite.config.ts; both need `@vitejs/plugin-react`.
- **Fake timers + `waitFor()`** — Deadlocks. Use `vi.useRealTimers()` before async assertions.
- **Router tests** — Share global singletons. `resetXxxService()` in `afterEach` is mandatory. For isolated tests, use factory functions with temp dirs.
- **Optimistic updates** — `onMutate` must return rollback context for `onError`.

### unifai Dependency
- **What**: Multi-provider agent abstraction (`github:youhaowei/unifai`). GitHub dep for portability; `pnpm link` for local dev.
- **Local setup**: `cd ~/Projects/workforce && pnpm link ~/Projects/unifai`
- **After `pnpm install`**: Re-run `pnpm link ~/Projects/unifai` (install overwrites the link)
- **In worktrees**: Run `pnpm link ~/Projects/unifai` after creation (or just use the GitHub version)

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
