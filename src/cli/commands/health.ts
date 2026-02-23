import type { Command } from 'commander';
import { getClient } from '../client';
import { isJsonMode, printJson } from '../output';

export function registerHealthCommands(parent: Command) {
  const health = parent.command('health').description('Server health checks');

  health
    .command('check')
    .description('Check if the Workforce server is running')
    .action(async function (this: Command) {
      try {
        const result = await getClient().health.check.query();
        if (isJsonMode(this)) return printJson(result);
        console.log('\u2713 Server is running');
      } catch {
        console.log('\u2717 Server not responding');
        process.exit(1);
      }
    });
}
