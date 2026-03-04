#!/usr/bin/env tsx
/**
 * POC: Sidecar Auth Verification
 *
 * Tests whether the Claude Agent SDK can authenticate when running
 * as a child process (simulating Tauri sidecar spawning).
 *
 * Run directly:        tsx scripts/poc-sidecar-auth.ts
 * Simulate sidecar:    tsx scripts/poc-sidecar-auth.ts --spawn-child
 *
 * The --spawn-child flag spawns a copy of itself as a child process
 * with only HOME and PATH set — stricter than production, where
 * fix-path-env provides the full repaired environment.
 */

import { existsSync, readFileSync } from 'fs';
import { homedir } from 'os';
import { spawn } from 'child_process';

const isChild = process.env.__POC_CHILD === '1';
const shouldSpawnChild = process.argv.includes('--spawn-child');

// ── Step 1: Environment diagnostics ───────────────────────────────

function printDiagnostics(label: string) {
  const home = process.env.HOME || homedir();
  const credPath = `${home}/.claude/.credentials.json`;

  console.log(`\n=== ${label} ===`);
  console.log('  PID:', process.pid);
  console.log('  PPID:', process.ppid);
  console.log('  HOME:', home);
  console.log('  PATH has bun:', (process.env.PATH ?? '').includes('bun'));
  console.log('  PATH dirs:', (process.env.PATH ?? '').split(':').length);
  console.log('  Credentials exist:', existsSync(credPath));

  if (existsSync(credPath)) {
    try {
      const creds = JSON.parse(readFileSync(credPath, 'utf-8'));
      console.log('  Has OAuth:', !!creds.claudeAiOauth);
      console.log('  Has refresh token:', !!creds.claudeAiOauth?.refreshToken);
      if (creds.claudeAiOauth?.expiresAt) {
        const expired = creds.claudeAiOauth.expiresAt < Date.now();
        console.log('  Token expired:', expired, expired ? '(SDK will refresh)' : '');
      }
    } catch (err) {
      console.log('  Credentials parse error:', err instanceof Error ? err.message : String(err));
    }
  }
}

// ── Step 2: SDK auth test ──────────────────────────────────────────

async function testSdkAuth(): Promise<boolean> {
  const { query: sdkQuery } = await import('@anthropic-ai/claude-agent-sdk');

  console.log('\n[SDK Test] Attempting auth...');

  const abortController = new AbortController();
  // Timeout after 15s — enough for auth + one turn
  const timeout = setTimeout(() => abortController.abort(), 15_000);

  // Declared outside try/catch so timeout abort in catch can read gotInit.
  let gotInit = false;
  let response = '';

  try {
    const stream = sdkQuery({
      prompt: 'Say exactly "auth-ok" and nothing else.',
      options: {
        abortController,
        cwd: process.cwd(),
        maxTurns: 1,
      },
    });

    for await (const msg of stream) {
      if (msg.type === 'system' && msg.subtype === 'init') {
        gotInit = true;
        console.log('[SDK] System init received — AUTH SUCCESS');
      }

      if (msg.type === 'stream_event') {
        const event = msg.event;
        if (event.type === 'content_block_delta' && 'delta' in event) {
          const delta = event.delta as { type: string; text?: string };
          if (delta.type === 'text_delta' && delta.text) {
            response += delta.text;
          }
        }
      }

      if (msg.type === 'result') {
        console.log('[SDK] Query complete');
        break;
      }
    }

    clearTimeout(timeout);
    console.log('[SDK] Response:', response.trim().slice(0, 100));
    return gotInit || response.length > 0;
  } catch (err: unknown) {
    clearTimeout(timeout);
    if (err instanceof Error && (err.name === 'AbortError' || err.message.includes('aborted'))) {
      console.log(`[SDK] Aborted (timeout) — init received: ${gotInit}`);
      return gotInit;
    }
    console.error('[SDK] FAILED:', err instanceof Error ? err.message : err);
    return false;
  }
}

// ── Step 3: Child process simulation ───────────────────────────────

function spawnChild(): Promise<number> {
  return new Promise((resolve) => {
    console.log('\n[Parent] Spawning child with minimal env (HOME + PATH only)...');

    const child = spawn('tsx', ['scripts/poc-sidecar-auth.ts'], {
      env: {
        // Only pass what fix-path-env would provide
        HOME: process.env.HOME || homedir(),
        PATH: process.env.PATH || '/usr/bin:/bin',
        __POC_CHILD: '1',
        // Intentionally NOT passing ANTHROPIC_API_KEY or ANTHROPIC_AUTH_TOKEN
      },
      stdio: 'inherit',
      cwd: process.cwd(),
    });

    child.on('close', (code) => {
      console.log(`\n[Parent] Child exited with code ${code}`);
      resolve(code ?? 1);
    });
  });
}

// ── Main ───────────────────────────────────────────────────────────

async function main() {
  console.log('╔══════════════════════════════════════════╗');
  console.log('║   POC: Sidecar Auth Verification         ║');
  console.log('╚══════════════════════════════════════════╝');

  if (shouldSpawnChild && !isChild) {
    // Parent mode: spawn a child with minimal env
    printDiagnostics('Parent Environment');
    const exitCode = await spawnChild();
    process.exit(exitCode);
  }

  // Direct or child mode: run the actual test
  printDiagnostics(isChild ? 'Child Environment (simulated sidecar)' : 'Direct Environment');

  const success = await testSdkAuth();

  console.log('\n' + '═'.repeat(44));
  if (success) {
    console.log('  RESULT: ✅ AUTH WORKS FROM CHILD PROCESS');
    console.log('  Sidecar architecture is viable!');
  } else {
    console.log('  RESULT: ❌ AUTH FAILED');
    console.log('  External server remains the required architecture.');
  }
  console.log('═'.repeat(44));

  process.exit(success ? 0 : 1);
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
