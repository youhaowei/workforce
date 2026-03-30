import { execFileSync, spawn } from 'child_process';
import { access } from 'fs/promises';
import path from 'path';
import { setTimeout as delay } from 'timers/promises';
import { fileURLToPath } from 'url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..');
const smokePorts = Array.from({ length: 21 }, (_, index) => 19675 + index);
const launchArgs = ['--remote-debugging-port=9333'];

async function getCandidateBundles() {
  const suffix = process.arch;
  const candidates = [];

  if (process.platform === 'darwin') {
    candidates.push(
      {
        appPath: path.join(repoRoot, 'out', `Workforce-darwin-${suffix}`, 'Workforce.app'),
        binaryPath: path.join(repoRoot, 'out', `Workforce-darwin-${suffix}`, 'Workforce.app', 'Contents', 'MacOS', 'Workforce'),
      },
    );
  } else if (process.platform === 'linux') {
    candidates.push(
      {
        appPath: path.join(repoRoot, 'out', `Workforce-linux-${suffix}`),
        binaryPath: path.join(repoRoot, 'out', `Workforce-linux-${suffix}`, 'Workforce'),
      },
      {
        appPath: path.join(repoRoot, 'out', `workforce-linux-${suffix}`),
        binaryPath: path.join(repoRoot, 'out', `workforce-linux-${suffix}`, 'workforce'),
      },
    );
  } else if (process.platform === 'win32') {
    candidates.push(
      {
        appPath: path.join(repoRoot, 'out', `Workforce-win32-${suffix}`),
        binaryPath: path.join(repoRoot, 'out', `Workforce-win32-${suffix}`, 'Workforce.exe'),
      },
    );
  }

  return candidates;
}

async function resolveBundle() {
  for (const candidate of await getCandidateBundles()) {
    try {
      await access(candidate.binaryPath);
      return candidate;
    } catch {
      // Try the next packaged location.
    }
  }

  throw new Error(`Could not find packaged Workforce binary under ${path.join(repoRoot, 'out')}`);
}

async function pollHealth() {
  const deadline = Date.now() + 30_000;

  while (Date.now() < deadline) {
    for (const port of smokePorts) {
      try {
        const response = await fetch(`http://localhost:${port}/health`);
        if (response.ok) {
          const json = await response.json();
          if (json?.ok === true) return { port, payload: json };
        }
      } catch {
        // Port not ready yet.
      }
    }

    await delay(250);
  }

  throw new Error(`Timed out waiting for /health on ports ${smokePorts[0]}-${smokePorts.at(-1)}`);
}

async function terminateApp(child, binaryPath) {
  child.kill('SIGTERM');
  await delay(1_000);
  if (!child.killed) child.kill('SIGKILL');

  if (process.platform === 'darwin') {
    try {
      execFileSync('pkill', ['-f', binaryPath]);
    } catch {
      // Best-effort cleanup for Electron helper processes.
    }
  }
}

async function main() {
  const { appPath, binaryPath } = await resolveBundle();
  const child = spawn(binaryPath, launchArgs, {
    cwd: repoRoot,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      ELECTRON_DISABLE_SECURITY_WARNINGS: 'true',
    },
  });

  let stdout = '';
  let stderr = '';
  let exitDetail = null;
  child.stdout.on('data', (chunk) => {
    stdout += chunk.toString();
  });
  child.stderr.on('data', (chunk) => {
    stderr += chunk.toString();
  });
  child.on('exit', (code, signal) => {
    exitDetail = { code, signal };
  });

  try {
    const { port, payload } = await pollHealth();
    console.log(`Packaged smoke OK: http://localhost:${port}/health -> ${JSON.stringify(payload)}`);
  } catch (error) {
    await terminateApp(child, binaryPath);
    throw new Error([
      error instanceof Error ? error.message : String(error),
      exitDetail && `process exit: ${JSON.stringify(exitDetail)}`,
      `launch target: ${binaryPath}`,
      process.platform === 'darwin' && `app bundle: ${appPath}`,
      stdout && `stdout:\n${stdout.trim()}`,
      stderr && `stderr:\n${stderr.trim()}`,
    ].filter(Boolean).join('\n\n'));
  }

  await terminateApp(child, binaryPath);
}

await main();
