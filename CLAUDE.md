# Workforce - Desktop Agentic Orchestrator

Docs: `docs/` (high-level) + [Notion](https://www.notion.so/2ffd48ccaf5481d7bb33d67599423042) (feature specs, architecture). Known issues: `docs/operations/issues.md`.

## Commands

```bash
pnpm setup            # Install deps + init submodules
pnpm run test         # All unit tests (Vitest)
pnpm run test -- src/services/session.test.ts  # Single test file
pnpm run test:e2e     # Playwright E2E tests
pnpm run lint         # Lint code
pnpm run type-check   # TypeScript check
pnpm run server       # Start backend server (port 19675)
pnpm run server:watch # Server with hot-reload
pnpm run dev:web      # Start server + vite for web testing (port 19676)
pnpm run clean        # Remove build artifacts (dist, out, .vite)
```

**ASK FIRST — never auto-run:**

```bash
pnpm run dev   # Server + Electron desktop app (dev loads from Vite :19676)
pnpm run build # Electron Forge production build (.app)
```

## Debugging Tools

- **Visual/CSS** → agent-browser on dev server (localhost:19676) or Peekaboo (`peekaboo see --app "Workforce Dev"`) for Electron app
- **Server state** → `pnpm run cli -- health check`, `session list --json`, `audit session <id>`
- **Server logs** → `curl http://localhost:19675/debug-log`
- **Port issues** → `lsof -ti :19675 :19676`
- **Reproduction escalation**: agent-browser → Peekaboo → console.log + ask user → Playwright E2E

## Key Disambiguation

**Two component directories** — Don't confuse them:

- `src/components/ui/` — Radix-based **primitives** (Button, Surface, Card, Dialog, etc.). Styled with CVA + token classes.
- `src/ui/components/` — **Feature** components (Shell, Sessions, Theme, Messages, etc.). Compose primitives into app-specific UI.

**Path alias**: `@/*` → `src/*` (synced in tsconfig.json + vite.shared.ts)

## Conventions

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
- **Panel consistency** — read existing panel (ChatInfo, Sessions, Theme) for shared header/content/label patterns.

## Gotchas

### Architecture

- **Electron IPC** — Keep `src/ui/` browser-safe. Native dialogs via `window.electronAPI.openDirectory()`. Electron main process in `src-electron/`.
- **`isDesktop` detection** — `!!window.electronAPI`. Do not use port-based detection.
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
- **Drag region overlay** — `index.html` has a `<style>` tag defining `.titlebar-drag-region` with `-webkit-app-region: drag`. Interactive elements (`button`, `input`, `a`, `[role="button"]`) auto-opt-out via `-webkit-app-region: no-drag`. Custom interactive elements in the topbar need `role="button"` or explicit `app-region: no-drag` to be clickable. The raw `<style>` tag is intentional — Lightning CSS strips `-webkit-app-region`.

### Testing & Build

- **Infrastructure changes need runtime verification** — For logging, config, transport, or middleware changes, start the server and verify at runtime. Static checks miss transport misconfigurations.
- **NEVER kill user processes** — Do NOT kill processes on ports 19675, 19676. If occupied, fail clearly.
- **E2E isolation** — Tests use temp data dir (`WORKFORCE_DATA_DIR`), own server on ports 19775 (API) / 19776 (Vite), `reuseExistingServer: false`. Never writes to `~/.workforce/`.
- **E2E fixtures** — Clean up tRPC API data in `afterEach`. Sync via `page.waitForResponse()`, not text selectors.
- **vitest.config.ts** — Separate from vite.config.ts; both need `@vitejs/plugin-react`.
- **Fake timers + `waitFor()`** — Deadlocks. Use `vi.useRealTimers()` before async assertions.
- **Router tests** — Share global singletons. `resetXxxService()` in `afterEach` is mandatory. For isolated tests, use factory functions with temp dirs.
- **Optimistic updates** — `onMutate` must return rollback context for `onError`.

### Git Submodules (lib/)

Both **unifai** and **tracey** are git submodules under `lib/`:

- `lib/unifai` — Multi-provider agent abstraction. Imports as `"unifai"`.
- `lib/tracey` — Structured logging (pino-based). Imports as `"tracey"`.

```bash
pnpm setup                           # Full bootstrap (submodules + deps)
git submodule update --init          # After fresh clone (manual)
cd lib/tracey && bun install         # Install tracey's deps (pino, pino-pretty)
```

**Branch-per-agent for submodule changes**: When modifying a submodule, create a branch (e.g., `agent/feat-redaction`). Commit on the branch, push, then merge to main. This prevents conflicts when multiple agents work on the same submodule in parallel. The parent repo's submodule pointer should always reference a merge commit on main.

**Path resolution**: tsconfig `paths` + `vite.shared.ts` aliases all map `"tracey"` → `lib/tracey/src` and `"unifai"` → `lib/unifai/src`. Shared aliases are imported by all 4 Vite configs.

### Logging (tracey)

- All logging via tracey (`createLogger(name)`). No `debugLog` — it's deleted.
- API keys, tokens, passwords auto-redacted.

### Electron (src-electron/)

- **Main process**: `src-electron/main.ts` — window management, IPC handlers, port discovery, macOS vibrancy, graceful shutdown.
- **Preload**: `src-electron/preload.ts` — context bridge exposing `window.electronAPI` (openDirectory, openExternal, getServerPort).
- **Build config**: `forge.config.ts` — Electron Forge with Vite plugin. Makers: ZIP + DMG (macOS).
- **Vite configs**: `vite.main.config.ts` (main process, CJS output), `vite.preload.config.ts` (preload, CJS output).
- **Port discovery**: env var (`SERVER_PORT`) > `.dev-port` file > default 19675. `parsePort()` helper in `src-electron/port-utils.ts`.
- **Dev workflow**: `pnpm run dev` starts Electron + loads Vite dev server. `pnpm run dev:web` for browser-only iteration.
- **CDP debugging**: `--remote-debugging-port=9229` for DevTools Protocol access.

## Recipes

When adding new routers, services, or components — **read an existing neighbor first** and follow the same pattern. Key entry points:
- **tRPC router**: `src/server/routers/` — check any existing router for the pattern
- **Service**: `src/services/` — lazy singleton with `ensureInitialized()`, `dispose()`
- **UI primitive**: `src/components/ui/` — CVA + token classes
- **Feature component**: `src/ui/components/` — compose primitives, data via tRPC hooks
