# Followup Plan: Error Handling & Tracing

**Created**: 2026-02-13
**Owner**: TBD
**Related**: `poc-effect-error-handling.md`, `decisions.md` #14-15

---

## Goal

Replace ad-hoc try/catch patterns with typed domain errors and structured tracing across the service layer. No new runtime dependencies — leverage TypeScript's type system and the existing `Result<T, E>` type.

---

## Phase 1: Typed Domain Errors (Low effort, high value)

**What**: Define tagged error classes for each service and use `Result<T, E>` at service boundaries.

### 1.1 Define error taxonomy

Create `src/services/errors.ts` with domain error classes:

```
SessionNotFound      — session ID not on disk or in cache
SessionCorrupted     — JSON parse failure on session file
InvalidTransition    — lifecycle state machine violation
DiskIOError          — filesystem read/write/delete failure
AgentError           — already exists in agent-instance.ts (AUTH, RATE_LIMIT, NETWORK, etc.)
OrgNotFound          — org lookup miss
TemplateNotFound     — template lookup miss
WorkflowValidation   — DAG cycle, missing dependencies
WorktreeConflict     — merge conflict in worktree
```

Each error class should carry:
- `readonly _tag: string` — discriminant for pattern matching
- Contextual fields (IDs, paths, operation name)
- `readonly cause?: unknown` — original error for debugging

### 1.2 Adopt Result at persistence boundaries

Migrate return types for key functions:

| Function | Current | Target |
|----------|---------|--------|
| `loadSessionFromDir` | `Promise<Session \| null>` | `Promise<Result<Session, SessionNotFound \| SessionCorrupted \| DiskIOError>>` |
| `saveSessionToDir` | `Promise<void>` | `Promise<Result<void, DiskIOError>>` |
| `transitionState` | `Promise<Session>` (throws) | `Promise<Result<Session, SessionNotFound \| InvalidTransition>>` |
| `OrgService.get` | `Promise<Org \| null>` | `Promise<Result<Org, OrgNotFound \| DiskIOError>>` |

Start with session service (densest error paths), then expand to org, template, workflow.

### 1.3 Helper utilities

Add to `src/services/errors.ts`:

```typescript
// Pattern matching helper
function matchError<E extends { _tag: string }>(
  error: E,
  handlers: { [K in E['_tag']]: (e: Extract<E, { _tag: K }>) => void }
): void

// Result constructors
function ok<T>(value: T): Result<T, never>
function err<E>(error: E): Result<never, E>

// Unwrap with context
function unwrapOrThrow<T, E>(result: Result<T, E>, context?: string): T
```

**Estimated effort**: 1-2 days
**Tests**: Update existing session.test.ts to assert specific error tags instead of just `null`/`throws`

---

## Phase 2: Structured Tracing (Medium effort, medium value)

**What**: Add correlation IDs and structured context to LogService so errors can be traced across service calls.

### 2.1 Trace context

```typescript
interface TraceContext {
  traceId: string;      // Request-level correlation
  spanId: string;       // Operation-level
  sessionId?: string;   // Session scope
  orgId?: string;       // Org scope
}
```

### 2.2 LogService enhancements

Extend `LogService` to accept structured fields:

```typescript
log.error('Session load failed', {
  traceId,
  sessionId,
  error: { _tag: 'SessionCorrupted', path: '...' },
  duration: 12,
});
```

Output format: JSON lines in `debug.log` (already exists) with fields queryable by `jq`.

### 2.3 tRPC middleware for automatic trace propagation

Add tRPC middleware that:
1. Generates `traceId` per request
2. Attaches to tRPC context
3. Services receive it via context parameter
4. All log entries within a request share the `traceId`

**Estimated effort**: 2-3 days
**Tests**: Verify trace IDs appear in log output, verify correlation across service calls

---

## Phase 3: Error Recovery Patterns (Medium effort, targeted)

**What**: Replace silent catch blocks with explicit recovery strategies.

### 3.1 Audit silent catches

Current locations that swallow errors:

| Location | Current behavior | Proposed |
|----------|-----------------|----------|
| `session.ts:99` | Backup failure ignored | Log warning with trace context |
| `session.ts:352` | Delete failure ignored | Log warning, return `Result` with error |
| `session.ts:174` | Init readdir failure logged then dropped | Return partial result + error list |
| `agent-instance.ts` | Various catch blocks | Structured `AgentError` with cause chain |

### 3.2 Retry policy groundwork

Define a retry interface (no implementation yet — just the contract):

```typescript
interface RetryPolicy {
  maxAttempts: number;
  backoff: 'fixed' | 'exponential';
  baseDelay: number;
  retryableErrors: string[];  // Error _tag values
}
```

This lays the groundwork for Effect's `Schedule` if/when we adopt it. The retry policy is configuration, not a library.

**Estimated effort**: 1-2 days

---

## Revisit Triggers for Effect

Re-evaluate Effect adoption when **any** of these become true:

- [ ] We implement retry-with-backoff in 3+ services (Effect's `Schedule` is excellent here)
- [ ] We need resource cleanup guarantees across async boundaries (Effect's `Scope`)
- [ ] Parallel agent orchestration needs structured concurrency beyond `Promise.all` (Effect's `Fiber`)
- [ ] The error taxonomy grows beyond ~15 error types and `catchTag`-style matching becomes valuable
- [ ] Team grows and onboarding new members to the error handling patterns takes >1 day

When revisiting, reference `poc-effect-error-handling.md` for the side-by-side comparison and adoption strategy (Promise wrappers for gradual migration).

---

## Priority & Sequencing

```
Phase 1 (errors.ts + Result)  ←── Do first, high ROI
  ↓
Phase 2 (tracing)             ←── Do when debugging cross-service issues
  ↓
Phase 3 (recovery)            ←── Do when reliability becomes a focus
  ↓
Effect re-evaluation          ←── Trigger-based, not scheduled
```

---

## Success Criteria

- [ ] Every service boundary function returns `Result<T, E>` with typed errors
- [ ] `null` is never used to represent "something went wrong" — only for genuine absence
- [ ] LogService entries carry `traceId` for cross-service correlation
- [ ] Zero silent `catch {}` blocks remaining (all have at minimum a warning log)
- [ ] Error taxonomy documented in `src/services/errors.ts` with JSDoc
