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

### 1. Ports — let dev-preview.sh discover them

`scripts/dev-preview.sh` (used by `bun run dev:web`) auto-scans forward from 19675/19676 if those are taken — the user's own dev (19675/19676) and E2E (19775/19776) are skipped automatically. Don't pre-pick ports.

After boot, read the bound ports from disk:

```bash
SERVER_PORT=$(cat .dev-port 2>/dev/null)
VITE_PORT=$(cat .vite-port 2>/dev/null)  # written by Vite plugin if available; else parse from log
```

The server writes `.dev-port` immediately after binding. Vite's actual port is in its startup log (`VITE ready in Xms ... → Local: http://localhost:NNNN/`).

### 2. Isolated data dir

Per-run, per-verify. Never share with the user's live data.

```bash
DATA_DIR=".workforce-verify-$(date +%s)"
```

### 3. Seed (when seed script exists)

```bash
bun scripts/seed.ts <profile> --data-dir "$DATA_DIR"
```

Until then, onboarding happens on first boot via UI.

### 4. Boot dev:web in background

Use Bash with `run_in_background: true` so the dev server stays alive across subsequent tool calls. The wrapper script picks free ports and exports them.

```bash
bun run dev:web --data-dir "$DATA_DIR"
```

After boot, wait for both log markers and capture the actual ports:

- Server line: `Workforce server running on http://localhost:NNNN`  → also written to `.dev-port`
- Vite line:  `VITE ready in Xms ... → Local: http://localhost:NNNN/`

Read them once the server has bound:

```bash
SERVER_PORT=$(cat .dev-port)
# VITE_PORT: parse from BashOutput on the background shell (the "Local:" line)
```

`tsx --watch` hot-reloads on code changes — edit and re-verify without restart. Note the background shell ID returned by Bash; you'll need it for teardown in step 7.

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

Shell job control (`kill %1`) does not work here — each Bash tool invocation runs in its own shell, so `%1` is never defined in the teardown shell. Kill by PID or by port.

Primary path — stop the background shell via the Bash tool's built-in kill (the shell ID was returned when you launched `dev:web` in step 4). That kills the whole process group.

Backup path — reap anything still listening:

```bash
lsof -ti :"$SERVER_PORT" -sTCP:LISTEN | xargs -r kill 2>/dev/null || true
lsof -ti :"$VITE_PORT"   -sTCP:LISTEN | xargs -r kill 2>/dev/null || true
rm -rf "$DATA_DIR"   # skip with --keep-artifacts
```

Do NOT `rm -f .dev-port .vite-port` — those files live in the repo root and may be owned by the user's concurrent `dev:web`. `dev-preview.sh` overwrites them on next start, so leave them alone.

Do not send SIGKILL on ports 19675/19676 or 19775/19776 — those are the user's dev and E2E reservations, never the verify instance.

## Output contract

```text
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
