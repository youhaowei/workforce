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

## Execution Plan - PR1 -> PR2 Feature Gap Closure

Working branch: `codex/pr1-close-pr2-gaps`  
Base: `origin/codex/implement-prdmvp-dogfood-phase`

### Baseline

- [x] Create implementation branch from PR1
- [x] Record baseline quality checks (`test`, `lint`, `type-check`)

### Phase 1 - Backend Runtime Parity

- [x] Add orchestration runtime service and router surface:
  - spawn / pause / resume / cancel / aggregate progress
- [ ] Add workflow execution semantics:
- [x] Add workflow execution semantics:
  - DAG validation and execution order
  - [x] true blocking review gates (initial pause-based implementation)
  - [x] correct workflow linkage on spawned children
- [ ] Add worktree lifecycle service and router surface:
  - create / diff / merge / archive
  - conflict handling and recovery path
- [ ] Integrate review decisions with orchestration state transitions
- [ ] Ensure audit/history captures key runtime transitions

### Phase 2 - Persistence and Environment Boundaries

- [ ] Keep PR1 storage adapter boundary as source of truth
- [ ] Route new runtime services through adapter/injectable roots
- [ ] Eliminate hard dependency on home directory for tests

### Phase 3 - UI Feature Parity

- [ ] Upgrade supervision board with runtime actions and status filters
- [ ] Add review queue with resolve actions and counts
- [ ] Add agent detail + audit visibility improvements
- [ ] Add worktree diff/merge user flow

### Phase 4 - Quality and Regression Safety

- [ ] Add service-level tests for:
  - orchestration lifecycle
  - workflow execution and blocking gates
  - worktree merge/conflict paths
- [ ] Add router integration tests for new endpoints
- [ ] Keep branch green on:
  - `bun run test`
  - `bun run lint`
  - `bun run type-check`

### Phase 5 - Dogfood Gate

- [ ] Preserve and update dogfood artifact template under `docs/dogfood/`
- [ ] Run MVP dogfood scenario and capture evidence artifacts
- [ ] Publish final FR1-FR9 gap check against `docs/PRD-MVP.md`
