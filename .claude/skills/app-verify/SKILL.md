---
name: app-verify
description: Runtime-verify a Workforce change end-to-end by launching an isolated dev instance, driving it with browser-agent, and producing a structured pass/fail report. Use when a change affects the UI, tRPC streaming, event pipeline, agent/orchestration services, or anywhere static checks can't prove runtime behavior. Triggers on "verify the app", "runtime check", "verify streaming/cancel/UI", or after modifying agent, agent-instance, orchestration, or any router that feeds the UI.
---

# Workforce App Verify

Compose the pieces CLAUDE.md describes separately (agent-browser, port rules, `--data-dir`) into one workflow with guaranteed teardown and a structured report the main agent can act on.

## Inputs

- **Feature/flow** — what to exercise (e.g., "spawn a WorkAgent session from Templates", "cancel mid-stream")
- **Assertions** — explicit pass conditions
- **Optional seed profile** — `minimal` / `demo` / `e2e` when `scripts/seed.ts` exists; until then, expect first-boot onboarding

## Core workflow

### 1. Pick ports

Never use 19675/19676 (user's own dev) or 19775/19776 (E2E reserved). Start at 19875/19876 — `dev-preview.sh` auto-scans forward if taken.

```
PORT=19876  # Vite port; dev-preview.sh picks server port independently
```

### 2. Isolated data dir

Per-run, per-verify. Never share with the user's live data.

```
DATA_DIR=".workforce-verify-$(date +%s)"
```

### 3. Seed (when seed script exists)

```bash
bun scripts/seed.ts <profile> --data-dir "$DATA_DIR"
```

Until then, onboarding happens on first boot via UI.

### 4. Boot dev:web in background

```bash
PORT=$VITE_PORT bun run dev:web --data-dir "$DATA_DIR" &
```

Wait for the "Workforce server running on http://localhost:PORT" and "VITE ready" log lines. Note actual bound ports. `tsx --watch` hot-reloads on code changes — edit and re-verify without restart.

### 5. Delegate to browser-agent

Give it:
- The Vite URL
- One-paragraph flow brief
- Explicit assertions
- "Screenshot each phase"
- "Do not touch other ports"
- Backup evidence sources: JSONL path (`$DATA_DIR/sessions/*.jsonl`), server debug endpoint (`curl http://localhost:$SERVER_PORT/debug-log`)

Browser-agent returns a structured report with per-assertion pass/fail and screenshots.

### 6. Cross-check the report

Browser-agent sees what's on screen. The session JSONL and server log are authoritative for whether the backend actually did the thing. If the report says "UI didn't show X" but the JSONL shows X happened, the gap is UI rendering, not the service you changed.

### 7. Teardown

```bash
kill %1 2>/dev/null || true
lsof -ti :$SERVER_PORT :$VITE_PORT | xargs -r kill 2>/dev/null
rm -rf "$DATA_DIR"   # skip with --keep-artifacts
```

## Output contract

```
VERIFY: {feature} — PASS | FAIL | BLOCKED

Assertions:
- [PASS/FAIL] {assertion 1}: {one-line observation}
- [PASS/FAIL] {assertion 2}: {one-line observation}

Evidence:
- Screenshots: /tmp/wf-verify-*.png
- Journal: t:message count = N (expected: M)
- Server errors: {none | summary}

Regression vs pre-existing:
- {regression from current branch | pre-existing | unclear}

Recommended action:
- {fix inline | file separate ticket | accept and move on}
```

The regression/pre-existing line is mandatory. Browser-agent often surfaces gaps unrelated to the current change; distinguishing matters for scope discipline.

## When NOT to use

- **Unit-testable behavior** — use vitest.
- **Pure backend with no UI surface** — `bun run cli` or integration tests.
- **Electron-specific** (native dialogs, IPC, packaged build) — use the `electron` skill + CDP.
- **Onboarding UX under active change** — skill assumes onboarding is stable; verify manually if not.

## Gotchas

- **CLAUDECODE leak** — when dev:web is launched from inside a Claude Code tmux pane, `CLAUDECODE=1` inherits to subprocesses. `buildSdkEnv()` strips it for the agent SDK; anything else that spawns needs its own strip.
- **Auto-reload** — tsx `--watch` restarts server, Vite HMR reloads page. Ports + data dir persist.
- **Health probe** — `curl -fsS http://localhost:$SERVER_PORT/debug-log > /dev/null` — cheap readiness check.
- **--import + non-empty target** — `dev:web --import <src>` into a non-empty data dir needs `--force` or fails loudly.
- **Browser-agent tab reuse** — confirm it creates a new tab, not reusing a stale one.

## Debug a FAIL

1. Screenshots — what did the browser see?
2. JSONL — `cat $DATA_DIR/sessions/*.jsonl` — does backend state match the screen?
3. Server log — `curl http://localhost:$SERVER_PORT/debug-log | tail -100`
4. Browser console — ask browser-agent to dump messages
5. Network tab — tRPC errors, 500s, dangling subscriptions

If JSONL shows the service did its job but UI didn't update: the gap is in the renderer or query invalidation, not the service you changed. File separately.

## Handoff

Main agent takes the pass/fail summary and decides:
- PASS → continue (commit, PR, next task)
- FAIL + regression → fix on this branch, re-verify
- FAIL + pre-existing → file ticket, proceed with original scope
- BLOCKED → report to user, ask for alternative verification

Never merge a FAIL as a regression. File pre-existing issues, don't absorb them into the current change.
