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
16. **Sidecar server architecture** — The Bun HTTP server (Hono + tRPC, port 4096) runs as a Tauri-managed sidecar child process rather than in-process or as a user-started external process.

    **Problem**: The Claude Agent SDK authenticates via `~/.claude/.credentials.json`, which requires correct HOME and PATH environment variables. macOS GUI apps launched from Finder/Dock inherit a minimal environment that lacks shell-configured paths — the server couldn't find credentials or the `bun` binary.

    **Why sidecar (not in-process)**: Bun's server APIs (`Bun.serve()`) can't run inside Tauri's WebView — they require a Node/Bun runtime. The server must be a separate OS process.

    **Why Tauri-managed (not user-started)**: Requiring users to open a terminal and run `bun run server` before launching the app is poor UX for a desktop app. Tauri spawning the server as a child process makes the app self-contained — double-click to launch, no terminal needed.

    **How it works**:
    - `fix-path-env` Rust crate repairs HOME/PATH at Tauri startup by spawning the user's login shell
    - `start_server` Tauri command spawns the server; `stop_server` kills it; `RunEvent::Exit` cleans up orphans
    - `useServerInit` React hook bootstraps the sidecar on mount (production only), polls `/health` until ready
    - Production: `bun build --compile` creates a standalone binary (Bun runtime embedded, no external Bun needed). Bundled via Tauri's `externalBin`.
    - Dev: sidecar bootstrap is skipped (`import.meta.env.DEV`); the `dev` script starts `server:watch` externally for HMR

    **Key files**: `src-tauri/src/main.rs` (lifecycle), `src/ui/hooks/useServerInit.ts` (boot), `src/ui/lib/server-manager.ts` (invoke wrappers), `scripts/build-server-sidecar.ts` (binary build)
