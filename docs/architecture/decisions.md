# Architectural Decisions - Workforce

Last updated: 2026-02-17

## Accepted

1. MVP is single-user and local-first.
2. Runtime model is unified sessions: `chat` + `workagent`.
3. Manager behavior is a WorkAgent pattern, not a separate runtime type.
4. Persistence uses append-only JSONL for sessions/events.
5. WorkAgents use isolated git worktrees for parallel code execution.
6. UI stack for MVP: React + Zustand/Jotai/TanStack Query + shadcn/ui.
7. Board includes explicit `Failed` state (not hidden by default in model).
8. Keep a harness abstraction, but ship Claude harness first.
9. Cloud sync is deferred for MVP; add a sync/storage adapter boundary now.
10. Convex should be evaluated as a post-M1/M2 spike unless cloud sync becomes near-term mandatory.
11. MVP planning is split by priority tiers (P0 vs P1) in `docs/product/PRD-MVP.md`.
12. P0 includes a mandatory dogfooding gate: Workforce must be used to iterate on Workforce before release.
13. Locked MVP policies:
    - pause policy: hybrid
    - merge authority: manual by default
    - retry policy: manual in MVP
    - cost guardrails: warnings plus optional hard caps
    - template portability: workspace-local in MVP
14. **Effect library deferred** — POC evaluated Effect for session persistence error handling. Typed errors are valuable but the paradigm overhead isn't justified yet. Instead: adopt typed error classes + `Result<T, E>` without Effect. Revisit when retry policies, resource scoping, or structured concurrency become needed.
15. **Error handling strategy** — Use typed domain error classes + discriminated `Result<T, E>` unions at service boundaries. Tracing via structured LogService fields. No new library dependencies until complexity warrants it.
16. **~~Sidecar server architecture~~ → Electrobun direct-call architecture** — Originally the Bun HTTP server ran as a Tauri-managed sidecar child process (~300 lines of Rust lifecycle management). Migrated to Electrobun in Feb 2026, which eliminated the sidecar entirely — Electrobun's main process IS Bun, so `startServer()` is a direct function call.

    **Original problem**: macOS GUI apps launched from Finder inherit a minimal PATH. Tauri solved this with the `fix-path-env` Rust crate. Electrobun solves it with `execFileSync('zsh', ['-l', '-c', 'echo $PATH'])` in the Bun main process.

    **Current architecture**:
    - `src/bun/index.ts` — Electrobun main process: repairs PATH, calls `startServer()`, opens `BrowserWindow`
    - `src/server/index.ts` — Exports `startServer()` with `import.meta.main` guard for standalone mode
    - In production, Hono serves both the API and Vite build output on `:4096` (same origin, no CORS)
    - In dev, server runs externally via `server:watch`; Electrobun window points to Vite at `:5173`
    - Native dialogs exposed via tRPC `dialog.openDirectory` mutation (dynamic `import('electrobun/bun')`)
    - `isDesktop` detected via `window.location.port === API_PORT` (`:4096` = desktop, `:5173` = web dev)

    **What was removed**: `src-tauri/` (entire Rust backend), `src/ui/lib/server-manager.ts` (Tauri invoke wrappers), `src/ui/hooks/useServerInit.ts` (sidecar boot), `scripts/build-server-sidecar.ts` (binary compilation)
