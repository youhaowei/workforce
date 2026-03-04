import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));

async function measureMemory() {
  return new Promise((resolve, reject) => {
    const proc = spawn('pnpm', ['run', 'dev'], {
      cwd: dirname(__dirname),
      stdio: 'pipe'
    });

    let resolved = false;
    const timeout = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        const memUsage = process.memoryUsage();
        const heapUsedMB = parseFloat((memUsage.heapUsed / 1024 / 1024).toFixed(2));
        const externalMB = parseFloat((memUsage.external / 1024 / 1024).toFixed(2));
        const totalMB = heapUsedMB + externalMB;
        
        console.log(`Memory Usage (idle):`);
        console.log(`  Heap Used: ${heapUsedMB}MB`);
        console.log(`  External: ${externalMB}MB`);
        console.log(`  Total: ${totalMB}MB`);
        
        if (totalMB < 100) {
          console.log('✓ PASS: Idle memory < 100MB');
          resolve(true);
        } else {
          console.log(`✗ FAIL: Idle memory ${totalMB}MB > 100MB`);
          resolve(false);
        }
        
        proc.kill();
      }
    }, 3000);

    proc.on('error', reject);
  });
}

const result = await measureMemory();
process.exit(result ? 0 : 1);
