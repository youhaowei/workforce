# Architectural Decisions - Workforce

Last updated: 2026-03-28

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
16. **Desktop runtime is Electron** — Workforce ships an Electron shell with a Node.js main process and an in-process Hono backend in production. Tauri is no longer a supported runtime.

    **Current architecture (Electron)**:
    - `src-electron/` — Electron main/preload processes: PATH repair, BrowserWindow lifecycle, native menu, CSP, and desktop IPC
    - `src/server/index.ts` — Hono HTTP server on Node.js; runs in-process in packaged desktop builds and as a separate dev process for `dev:web`
    - `src/ui/` — React renderer loaded from Vite in development and bundled `dist/` assets in production
    - Native dialogs and external URL handling flow through `window.electronAPI`
    - `isDesktop` detected via `!!window.electronAPI`. Do not use port-based detection.
    - Packaging uses electron-builder with bun-managed dependencies
