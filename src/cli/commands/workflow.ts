import type { Command } from 'commander';
import { getClient, resolveOrgId } from '../client';
import { isJsonMode, printJson, printTable } from '../output';

export function registerWorkflowCommands(parent: Command) {
  const workflow = parent.command('workflow').description('Manage workflows');

  workflow
    .command('list')
    .description('List workflows')
    .option('--org <id>', 'Organization ID')
    .action(async function (this: Command, opts: { org?: string }) {
      const orgId = await resolveOrgId(opts);
      const workflows = await getClient().workflow.list.query({ orgId });
      if (isJsonMode(this)) return printJson(workflows);
      printTable(
        (workflows as any[]).map((w) => ({
          id: w.id?.slice(0, 8) ?? '?',
          name: w.name ?? '?',
          steps: w.steps?.length ?? '?',
        })),
        ['id', 'name', 'steps'],
      );
    });

  workflow
    .command('get')
    .description('Get workflow details')
    .argument('<workflow-id>', 'Workflow ID')
    .option('--org <id>', 'Organization ID')
    .action(async (workflowId: string, opts: { org?: string }) => {
      const orgId = await resolveOrgId(opts);
      const wf = await getClient().workflow.get.query({ orgId, id: workflowId });
      printJson(wf);
    });

  workflow
    .command('run')
    .description('Execute a workflow')
    .argument('<workflow-id>', 'Workflow ID')
    .option('--org <id>', 'Organization ID')
    .action(async function (this: Command, workflowId: string, opts: { org?: string }) {
      const orgId = await resolveOrgId(opts);
      const result = await getClient().workflow.execute.mutate({ orgId, id: workflowId });
      if (isJsonMode(this)) return printJson(result);
      console.log(`\u2713 Workflow ${workflowId.slice(0, 8)} executed`);
    });
}
