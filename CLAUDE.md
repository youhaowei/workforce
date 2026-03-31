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
bun run server       # Start backend server (port 19675)
bun run server:watch # Server with hot-reload
bun run dev:web      # Start server + vite for web testing (port 19676)
bun run clean        # Remove build artifacts (dist, out)
```

**ASK FIRST — never auto-run:**

```bash
bun run dev   # Server + Electron desktop app (dev loads from Vite :19676)
bun run build # Electron release build (electron-forge)
```

## Debugging Tools

- **Visual/CSS** → agent-browser on dev server (localhost:19676) or CDP on Electron (--remote-debugging-port=9229)
- **Server state** → `bun run cli -- health check`, `session list --json`, `audit session <id>`
- **Server logs** → `curl http://localhost:19675/debug-log`
- **Port issues** → `lsof -ti :19675 :19676`
- **Reproduction escalation**: agent-browser → Peekaboo → console.log + ask user → Playwright E2E

## Key Disambiguation

**Two component directories** — Don't confuse them:

- `src/components/ui/` — Radix-based **primitives** (Button, Surface, Card, Dialog, etc.). Styled with CVA + token classes.
- `src/ui/components/` — **Feature** components (Shell, Sessions, Theme, Messages, etc.). Compose primitives into app-specific UI.

**Path alias**: `@/*` → `src/*` (synced in tsconfig.json + vite.config.ts)

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
- **E2E** — Playwright (`bun run test:e2e`, `test:e2e:headed`, `test:e2e:debug`)
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

- **Electron IPC** — Keep `src/ui/` browser-safe. Native dialogs via `window.electronAPI.openDirectory()`. Electron code in `src-electron/`.
- **`isDesktop` detection** — `!!window.electronAPI` via preload bridge. Do not use port-based detection.
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
- **Drag regions** — `titlebar-drag-region` CSS class (defined in `index.html` raw `<style>` tag — Lightning CSS strips `-webkit-app-region`) applied to AppHeader and sidebar top spacer. Only active on desktop windowed mode (`html[data-electron]:not([data-fullscreen])`). Interactive elements (`button`, `input`, `a`, `[role="button"]`) auto-opt-out via `no-drag` rules. DevTools always opens detached to avoid drag zone conflicts.

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
git submodule update --init --recursive  # After fresh clone
bun install                             # Install workspace deps after submodules are present
```

`bun install` is sufficient for workspace submodules like `lib/tracey`; do not
run a separate package-manager install inside those submodules unless you are
working on the submodule repo in isolation.

### Dependency Pins

- `overrides["@openai/codex"] = 0.107.0` was added during the Electron
  migration on 2026-03-28 to keep Workforce on the known-good
  Codex release used by the desktop + agent runtime during the Electron cutover.
  Only remove or update that override after re-running `bun install`,
  `bun run test`, and a packaged Electron smoke check against the newer Codex
  release.

**Branch-per-agent for submodule changes**: When modifying a submodule, create a branch (e.g., `agent/feat-redaction`). Commit on the branch, push, then merge to main. This prevents conflicts when multiple agents work on the same submodule in parallel. The parent repo's submodule pointer should always reference a merge commit on main.

**Path resolution**: tsconfig `paths` + vite `resolve.alias` + vitest `resolve.alias` all map `"tracey"` → `lib/tracey/src` and `"unifai"` → `lib/unifai/src`.

### Logging (tracey)

- All logging via tracey (`createLogger(name)`). No `debugLog` — it's deleted.
- API keys, tokens, passwords auto-redacted.

## Recipes

When adding new routers, services, or components — **read an existing neighbor first** and follow the same pattern. Key entry points:
- **tRPC router**: `src/server/routers/` — check any existing router for the pattern
- **Service**: `src/services/` — lazy singleton with `ensureInitialized()`, `dispose()`
- **UI primitive**: `src/components/ui/` — CVA + token classes
- **Feature component**: `src/ui/components/` — compose primitives, data via tRPC hooks
