import type { Command } from 'commander';
import { getClient } from '../client';
import { isJsonMode, printJson, printTable } from '../output';

export function registerOrgCommands(parent: Command) {
  const org = parent.command('org').description('Manage organizations');

  org
    .command('list')
    .description('List organizations')
    .action(async function (this: Command) {
      const orgs = await getClient().org.list.query();
      if (isJsonMode(this)) return printJson(orgs);
      printTable(
        (orgs as any[]).map((o) => ({
          id: o.id?.slice(0, 8) ?? '?',
          name: o.name ?? '?',
        })),
        ['id', 'name'],
      );
    });

  org
    .command('get')
    .description('Get organization details')
    .argument('<org-id>', 'Organization ID')
    .action(async (orgId: string) => {
      const o = await getClient().org.get.query({ id: orgId });
      printJson(o);
    });

  org
    .command('create')
    .description('Create an organization')
    .argument('[name]', 'Organization name')
    .option('--name <name>', 'Organization name (alternative to positional)')
    .action(async function (this: Command, nameArg: string | undefined, opts: { name?: string }) {
      const name = opts.name ?? nameArg;
      if (!name) return this.error('Missing required argument: name');
      const o = await getClient().org.create.mutate({ name });
      if (isJsonMode(this)) return printJson(o);
      console.log(`\u2713 Created org: ${o.id}`);
    });

  org
    .command('current')
    .description('Show the active organization')
    .action(async function (this: Command) {
      const o = await getClient().org.getCurrent.query();
      if (isJsonMode(this)) return printJson(o);
      if (o) {
        console.log(`Current org: ${o.name} (${o.id?.slice(0, 8)})`);
      } else {
        console.log('No active org');
      }
    });

  org
    .command('activate')
    .description('Set the active organization')
    .argument('<org-id>', 'Organization ID')
    .action(async (orgId: string) => {
      await getClient().org.activate.mutate({ id: orgId });
      console.log(`\u2713 Activated org: ${orgId.slice(0, 8)}`);
    });
}
