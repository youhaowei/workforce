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
16. **~~Sidecar server architecture~~ → ~~Electrobun direct-call~~ → ~~Electron subprocess~~ → Tauri sidecar architecture** — Originally Tauri sidecar (~300 lines Rust). Migrated to Electrobun, then Electron. This worktree returns to Tauri for smaller footprint and native vibrancy.

    **Current architecture (Tauri)**:
    - `src-tauri/` — Rust main process: repairs PATH for sidecar, applies window vibrancy, spawns Bun sidecar
    - `src-tauri/sidecar.rs` — Spawns Bun server (`src/server/index.ts`) as sidecar, waits for health before showing window
    - `src/server/index.ts` — Hono HTTP server (Bun). Runs as sidecar in desktop, standalone for dev:web
    - `tauri.conf.json` — `devUrl: localhost:5173` (Vite); `transparent: true` for macOS vibrancy
    - Native dialogs via Tauri commands: `invoke('open_directory')`, `invoke('open_external')`
    - `isDesktop` detected via `!!window.__TAURI__` or `!!window.__TAURI_INTERNALS__`. Do not use port-based detection.
    - Tauri 2 + `@tauri-apps/api` handles build and packaging
