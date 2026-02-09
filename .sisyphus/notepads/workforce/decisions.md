# Architectural Decisions - Workforce

Last updated: 2026-02-09

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
11. MVP planning is split by priority tiers (P0 vs P1) in `docs/PRD-MVP.md`.
12. P0 includes a mandatory dogfooding gate: Workforce must be used to iterate on Workforce before release.
13. Locked MVP policies:
    - pause policy: hybrid
    - merge authority: manual by default
    - retry policy: manual in MVP
    - cost guardrails: warnings plus optional hard caps
    - template portability: workspace-local in MVP
