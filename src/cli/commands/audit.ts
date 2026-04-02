import type { Command } from 'commander';
import { getClient, resolveOrgId } from '../client';
import { isJsonMode, printJson } from '../output';

export function registerAuditCommands(parent: Command) {
  const audit = parent.command('audit').description('Audit logs');

  audit
    .command('org')
    .description('View organization audit log')
    .option('--org <id>', 'Organization ID')
    .action(async function (this: Command, opts: { org?: string }) {
      const orgId = await resolveOrgId(opts);
      const entries = await getClient().audit.org.query({ orgId });
      if (isJsonMode(this)) return printJson(entries);
      for (const e of entries as any[]) {
        console.log(`[${e.timestamp ?? '?'}] ${e.type ?? '?'} \u2014 ${e.description ?? ''}`);
      }
    });

  audit
    .command('session')
    .description('View session audit log')
    .argument('<session-id>', 'Session ID')
    .option('--org <id>', 'Organization ID')
    .action(async function (this: Command, sessionId: string, opts: { org?: string }) {
      const orgId = await resolveOrgId(opts);
      const entries = await getClient().audit.session.query({ sessionId, orgId });
      if (isJsonMode(this)) return printJson(entries);
      for (const e of entries as any[]) {
        console.log(`[${e.timestamp ?? '?'}] ${e.type ?? '?'} \u2014 ${e.description ?? ''}`);
      }
    });
}
