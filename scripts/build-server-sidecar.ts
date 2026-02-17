#!/usr/bin/env bun
/**
 * build-server-sidecar.ts — Compile the Workforce server into a standalone
 * binary for Tauri sidecar distribution.
 *
 * Uses `bun build --compile` to produce a self-contained executable that
 * bundles the Bun runtime. The output path follows Tauri's externalBin
 * naming convention: `src-tauri/binaries/server-{target-triple}[.exe]`.
 *
 * Usage:
 *   bun scripts/build-server-sidecar.ts          # Build for current host
 *   bun scripts/build-server-sidecar.ts --all     # Build for all targets
 *
 * Set TAURI_ENV_TARGET_TRIPLE to override host detection (used by CI).
 */

import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';

const TAURI_TO_BUN_TARGET: Record<string, string> = {
  'aarch64-apple-darwin': 'bun-darwin-arm64',
  'x86_64-apple-darwin': 'bun-darwin-x64',
  'aarch64-unknown-linux-gnu': 'bun-linux-arm64',
  'x86_64-unknown-linux-gnu': 'bun-linux-x64',
  'x86_64-pc-windows-msvc': 'bun-windows-x64',
};

function detectHostTriple(): string {
  try {
    const output = execFileSync('rustc', ['-vV'], { encoding: 'utf8' });
    const match = output.match(/^host:\s*(\S+)$/m);
    if (!match?.[1]) {
      throw new Error('missing host triple in rustc -vV output');
    }
    return match[1];
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Error: cannot detect host target triple (install rustc). ${message}`);
    process.exit(1);
  }
}

function resolveCompileTarget(tauriTargetTriple: string): string {
  const bunTarget = TAURI_TO_BUN_TARGET[tauriTargetTriple];
  if (!bunTarget) {
    console.error(
      `Error: unsupported TAURI_ENV_TARGET_TRIPLE "${tauriTargetTriple}".\n` +
      `Supported triples: ${Object.keys(TAURI_TO_BUN_TARGET).join(', ')}`,
    );
    process.exit(1);
  }
  return bunTarget;
}

function buildForTarget(tauriTargetTriple: string): boolean {
  const bunTarget = resolveCompileTarget(tauriTargetTriple);
  const outputExt = tauriTargetTriple.includes('windows') ? '.exe' : '';
  const outputPath = `src-tauri/binaries/server-${tauriTargetTriple}${outputExt}`;

  console.log(`Building sidecar: target=${tauriTargetTriple} bunTarget=${bunTarget}`);

  const result = spawnSync(
    'bun',
    [
      'build',
      '--compile',
      `--target=${bunTarget}`,
      'src/server/index.ts',
      '--outfile',
      outputPath,
    ],
    { stdio: 'inherit' },
  );

  if (result.error) {
    console.error(`Build spawn error for ${tauriTargetTriple}:`, result.error.message);
    return false;
  }

  if (result.signal) {
    console.error(`Build killed by signal ${result.signal} for ${tauriTargetTriple}`);
    return false;
  }

  return result.status === 0;
}

const args = new Set(process.argv.slice(2));
const buildAll = args.has('--all');

mkdirSync('src-tauri/binaries', { recursive: true });

if (buildAll) {
  const triples = Object.keys(TAURI_TO_BUN_TARGET);
  const failures: string[] = [];

  if (process.env.TAURI_ENV_TARGET_TRIPLE) {
    console.warn('Warning: ignoring TAURI_ENV_TARGET_TRIPLE because --all was provided');
  }

  for (const triple of triples) {
    if (!buildForTarget(triple)) {
      failures.push(triple);
    }
  }

  if (failures.length > 0) {
    console.error(`Failed sidecar builds: ${failures.join(', ')}`);
    process.exit(1);
  }
} else {
  // Only detect host triple as fallback when TAURI_ENV_TARGET_TRIPLE is unset.
  // This avoids requiring rustc on CI workers that provide the target explicitly.
  const tauriTargetTriple = process.env.TAURI_ENV_TARGET_TRIPLE || detectHostTriple();
  if (!buildForTarget(tauriTargetTriple)) {
    process.exit(1);
  }
}
