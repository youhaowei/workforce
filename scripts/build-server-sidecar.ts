#!/usr/bin/env bun

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

function buildForTarget(tauriTargetTriple: string, hostTriple: string): boolean {
  const bunTarget = resolveCompileTarget(tauriTargetTriple);
  const outputPath = `src-tauri/binaries/server-${tauriTargetTriple}`;

  console.log(
    `Building sidecar: tauriTarget=${tauriTargetTriple} bunTarget=${bunTarget} host=${hostTriple}`,
  );

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

  return result.status === 0;
}

const hostTriple = detectHostTriple();
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
    if (!buildForTarget(triple, hostTriple)) {
      failures.push(triple);
    }
  }

  if (failures.length > 0) {
    console.error(`Failed sidecar builds: ${failures.join(', ')}`);
    process.exit(1);
  }
} else {
  const tauriTargetTriple = process.env.TAURI_ENV_TARGET_TRIPLE || hostTriple;
  if (!buildForTarget(tauriTargetTriple, hostTriple)) {
    process.exit(1);
  }
}
