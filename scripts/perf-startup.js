import { performance } from 'perf_hooks';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));

async function measureStartup() {
  const startTime = performance.now();
  
  return new Promise((resolve, reject) => {
    const proc = spawn('bun', ['run', 'dev'], {
      cwd: dirname(__dirname),
      stdio: 'pipe'
    });

    let output = '';
    let resolved = false;

    const timeout = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        proc.kill();
        const elapsed = performance.now() - startTime;
        console.log(`✓ App started in ${elapsed.toFixed(2)}ms`);
        if (elapsed < 2000) {
          console.log('✓ PASS: Cold start < 2s');
          resolve(true);
        } else {
          console.log(`✗ FAIL: Cold start ${elapsed.toFixed(2)}ms > 2000ms`);
          resolve(false);
        }
      }
    }, 5000);

    proc.stdout.on('data', (data) => {
      output += data.toString();
      if (!resolved && output.includes('listening')) {
        resolved = true;
        clearTimeout(timeout);
        proc.kill();
        const elapsed = performance.now() - startTime;
        console.log(`✓ App started in ${elapsed.toFixed(2)}ms`);
        if (elapsed < 2000) {
          console.log('✓ PASS: Cold start < 2s');
          resolve(true);
        } else {
          console.log(`✗ FAIL: Cold start ${elapsed.toFixed(2)}ms > 2000ms`);
          resolve(false);
        }
      }
    });

    proc.stderr.on('data', (data) => {
      output += data.toString();
    });

    proc.on('error', reject);
  });
}

const result = await measureStartup();
process.exit(result ? 0 : 1);
