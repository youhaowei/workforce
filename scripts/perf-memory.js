import { execFile, spawn } from 'child_process';
import { dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

function execFileAsync(command, args) {
  return new Promise((resolve, reject) => {
    execFile(command, args, { encoding: 'utf-8' }, (error, stdout) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(stdout);
    });
  });
}

async function measureProcessTreeRssMb(rootPid) {
  const output = await execFileAsync('ps', ['-Ao', 'ppid=,pid=,rss=']);
  const rows = output
    .trim()
    .split('\n')
    .map((line) => line.trim().split(/\s+/))
    .filter((parts) => parts.length === 3)
    .map(([ppid, pid, rss]) => ({
      ppid: Number.parseInt(ppid, 10),
      pid: Number.parseInt(pid, 10),
      rssKb: Number.parseInt(rss, 10),
    }))
    .filter((row) => Number.isFinite(row.ppid) && Number.isFinite(row.pid) && Number.isFinite(row.rssKb));

  const descendants = new Set([rootPid]);
  let grew = true;

  while (grew) {
    grew = false;
    for (const row of rows) {
      if (!descendants.has(row.pid) && descendants.has(row.ppid)) {
        descendants.add(row.pid);
        grew = true;
      }
    }
  }

  const totalRssKb = rows
    .filter((row) => descendants.has(row.pid))
    .reduce((sum, row) => sum + row.rssKb, 0);

  return Number.parseFloat((totalRssKb / 1024).toFixed(2));
}

async function measureMemory() {
  return new Promise((resolve, reject) => {
    const proc = spawn('pnpm', ['run', 'dev'], {
      cwd: dirname(__dirname),
      stdio: 'pipe',
    });

    let resolved = false;
    const timeout = setTimeout(async () => {
      if (resolved) return;
      resolved = true;

      try {
        const totalMB = await measureProcessTreeRssMb(proc.pid);

        console.log('Memory Usage (idle):');
        console.log(`  Process Tree RSS: ${totalMB}MB`);

        if (totalMB < 100) {
          console.log('✓ PASS: Idle memory < 100MB');
          resolve(true);
        } else {
          console.log(`✗ FAIL: Idle memory ${totalMB}MB > 100MB`);
          resolve(false);
        }
      } catch (error) {
        reject(error);
        return;
      } finally {
        proc.kill();
      }
    }, 3000);

    proc.on('error', reject);
    proc.on('exit', () => clearTimeout(timeout));
  });
}

const result = await measureMemory();
process.exit(result ? 0 : 1);
