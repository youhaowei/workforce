# POC: Effect for Error Handling in Session Persistence

**Date**: 2025-02-13
**Scope**: `src/services/poc-effect/` — session persistence layer only
**Status**: Decision-oriented evaluation, not production migration

---

## Motivation

The session service has 8 distinct error paths in its persistence layer (file I/O, JSON parsing, version migration, corruption recovery). The current `async/await + try/catch` approach handles these paths, but with trade-offs around error visibility, composability, and caller control.

This POC evaluates whether the [Effect](https://effect.website/) library improves these dimensions enough to justify adoption.

---

## Side-by-Side Comparison

### 1. Control Flow Readability

**Current** (`session-persistence-current.ts`):
```typescript
try {
  const raw = await readFile(filePath, 'utf-8');
  const parsed = JSON.parse(raw) as SessionFile;
  // ...version migration switch
} catch (err) {
  const error = err as NodeJS.ErrnoException;
  if (error.code === 'ENOENT') return null;
  if (err instanceof SyntaxError) {
    try { await rename(filePath, backupPath); } catch { }
    return null;
  }
  throw error;
}
```

- Linear happy path, but error handling is a multi-branch catch block
- Nested try/catch for backup-on-corruption adds indentation
- `instanceof` / `.code` checks are fragile — not exhaustive-checked by TS

**Effect** (`session-persistence-effect.ts`):
```typescript
pipe(
  readSessionFile(sessionsDir, sessionId),
  Effect.flatMap((file) => migrateVersion(sessionId, file)),
  Effect.catchTag('UnknownVersion', (err) => /* recover */),
  Effect.catchTag('SessionCorrupted', (err) => /* backup + null */),
  Effect.catchTag('SessionNotFound', () => Effect.succeed(null)),
)
```

- Pipeline reads top-to-bottom as: read → migrate → recover
- Each recovery step is a named combinator, not an `if` branch
- No nesting: backup is a flat `pipe` inside the `catchTag`

**Verdict**: Effect is **moderately better** for complex multi-recovery flows. For simple operations (save, delete), the pipe boilerplate offers no advantage over a plain `await`.

### 2. Explicit Error Modeling

**Current**: Errors are implicit. The function signature is `Promise<Session | null>` — the caller cannot distinguish "not found" from "corrupted" from "I/O failure" without reading the implementation.

**Effect**: The type signature is the documentation:
```typescript
loadSessionEffect: (dir, id) =>
  Effect<Session | null, DiskIOError>
```

The full error channel before recovery is:
```typescript
Effect<Session, SessionNotFound | SessionCorrupted | UnknownVersion | DiskIOError>
```

Each error is a `Data.TaggedError` with contextual fields (sessionId, path, cause). Callers can pattern-match with `catchTag` and TypeScript enforces exhaustiveness.

**Verdict**: Effect is **significantly better** here. The tagged error types are the standout feature — they make error contracts part of the type system rather than just documentation.

### 3. Testability and Mockability

**Current**: Tests must create real files on disk (or mock `fs/promises`). Error paths are tested by crafting bad files. The test can only observe the final result (`null` or a `Session`), not which error path was taken.

**Effect**: Two levels of testing are possible:
1. **Same as current**: Promise wrappers behave identically (27 shared tests pass for both)
2. **Typed error inspection**: Tests can run `Effect.runPromiseExit()` to inspect the exact error tag, fields, and cause chain without any mocking:
```typescript
const exit = await Effect.runPromiseExit(effect);
if (Exit.isFailure(exit)) {
  // Inspect exact error type, fields, cause
}
```

Effect also enables injecting dependencies via `Layer` / `Context` (not explored in this POC), which would allow filesystem mocking without patching module internals.

**Verdict**: Effect is **moderately better**. The exit inspection is useful for error-path tests. The `Layer`-based DI story is powerful but adds another concept to learn.

### 4. Integration Friction with Existing Code

| Dimension | Assessment |
|-----------|-----------|
| **Bundle size** | `effect` is ~45 KB gzipped (tree-shakeable). Acceptable for a desktop app. |
| **Runtime** | `Effect.runPromise()` wraps seamlessly — existing callers see no difference. |
| **TypeScript compat** | Full strict-mode compatibility. No special TS config needed. |
| **Learning curve** | `pipe`, `Effect.flatMap`, `catchTag` are the core concepts (~30 min). Full Effect ecosystem (Layer, Schedule, Fiber) is deep but not required. |
| **Gradual adoption** | Promise wrappers mean you can adopt Effect internally without changing any external API. |
| **Team familiarity** | Likely low. Effect's functional style (`pipe`, `flatMap`) is unfamiliar to most TS teams. |
| **Debugging** | Stack traces include Effect fiber info. `Effect.runPromiseExit` makes error inspection explicit but requires knowing the API. |

**Verdict**: Integration friction is **low for a narrow scope** (one module), but **high for broad adoption** due to the paradigm shift. The Promise wrapper pattern is the key enabler — it lets you use Effect internally without infecting the rest of the codebase.

---

## Quantitative Comparison

| Metric | Current | Effect |
|--------|---------|--------|
| Lines of code (implementation) | 95 | 165 |
| Lines of code (types/errors) | 0 (implicit) | 45 |
| Test cases (shared) | 21 pass | 21 pass |
| Test cases (impl-specific) | 1 | 5 |
| Error types visible in signature | 0 | 4 |
| Distinct error cases distinguishable by caller | 1 (`null` vs throw) | 4 (NotFound, Corrupted, UnknownVersion, DiskIOError) |
| New dependency size | 0 | ~45 KB gzip |

---

## Recommendation: **Defer broad adoption. Extract error types now.**

### What Effect gets right
- Tagged error types are genuinely valuable. Making error contracts explicit in the type system catches bugs and improves documentation.
- The `catchTag` combinator is a clean way to handle multi-branch recovery.
- Promise wrappers enable surgical adoption without API changes.

### Why defer
- **The ROI is narrow.** The session persistence layer has 8 error paths — that's the densest error handling in the codebase. Most other services have 1-2 error paths where try/catch is fine.
- **The overhead is real.** 70% more implementation code for the same behavior. Every team member needs to learn `pipe`/`flatMap`/`catchTag` vocabulary.
- **We can get 80% of the value without Effect.** Typed error unions + a lightweight `Result` type (already defined in `types.ts` but unused) would give us explicit error modeling without the paradigm shift.

### Recommended follow-up

1. **Adopt typed error classes now** — The `Data.TaggedError` pattern is valuable even without Effect. Define domain error classes (like `SessionNotFound`, `SessionCorrupted`) as plain TypeScript classes and use the existing `Result<T, E>` type:
   ```typescript
   async function loadSession(dir: string, id: string):
     Promise<Result<Session, SessionNotFound | SessionCorrupted | DiskIOError>>
   ```

2. **Revisit Effect if/when** we add:
   - Retry policies with backoff (Effect's `Schedule` is excellent)
   - Resource management / cleanup guarantees (`Scope`)
   - Structured concurrency for parallel agent orchestration (`Fiber`)

   These are scenarios where Effect's value clearly exceeds its complexity cost.

3. **Keep this POC** as a reference for what Effect adoption would look like if the need arises.

---

## Files

| File | Purpose |
|------|---------|
| `session-persistence-current.ts` | Extracted current-style persistence (baseline) |
| `session-persistence-effect.ts` | Effect-based reimplementation (comparison) |
| `session-persistence.test.ts` | 27 shared + 6 impl-specific tests |
| `DESIGN-NOTE.md` | This document |
