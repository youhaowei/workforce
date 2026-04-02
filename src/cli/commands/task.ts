import type { Command } from 'commander';
import { getClient } from '../client';
import { isJsonMode, printJson, printTable } from '../output';

export function registerTaskCommands(parent: Command) {
  const task = parent.command('task').description('Manage tasks');

  task
    .command('list')
    .description('List tasks')
    .option('--status <status>', 'Filter by status')
    .option('--search <query>', 'Search tasks')
    .action(async function (this: Command, opts: { status?: string; search?: string }) {
      const input: { status?: 'pending' | 'in_progress' | 'completed' | 'cancelled'; search?: string } = {};
      if (opts.status) input.status = opts.status as typeof input.status;
      if (opts.search) input.search = opts.search;
      const tasks = await getClient().task.list.query(Object.keys(input).length > 0 ? input : undefined);
      if (isJsonMode(this)) return printJson(tasks);
      printTable(
        (tasks as any[]).map((t) => ({
          id: t.id?.slice(0, 8) ?? '?',
          title: (t.title ?? '').slice(0, 50),
          status: t.status ?? '?',
          assignee: t.assignee ?? '-',
        })),
        ['id', 'title', 'status', 'assignee'],
      );
    });

  task
    .command('get')
    .description('Get task details')
    .argument('<task-id>', 'Task ID')
    .action(async (taskId: string) => {
      const t = await getClient().task.get.query({ id: taskId });
      printJson(t);
    });

  task
    .command('create')
    .description('Create a task')
    .argument('[title]', 'Task title')
    .option('--title <title>', 'Task title (alternative to positional)')
    .option('--description <desc>', 'Task description')
    .action(async function (this: Command, titleArg: string | undefined, opts: { title?: string; description?: string }) {
      const title = opts.title ?? titleArg;
      if (!title) return this.error('Missing required argument: title');
      const t = await getClient().task.create.mutate({ title, description: opts.description });
      if (isJsonMode(this)) return printJson(t);
      console.log(`\u2713 Created task: ${t.id}`);
    });

  task
    .command('update')
    .description('Update a task')
    .argument('<task-id>', 'Task ID')
    .option('--title <title>', 'New title')
    .option('--description <desc>', 'New description')
    .option('--priority <n>', 'New priority', parseInt)
    .action(async function (this: Command, taskId: string, opts: { title?: string; description?: string; priority?: number }) {
      const updates: { title?: string; description?: string; priority?: number } = {};
      if (opts.title) updates.title = opts.title;
      if (opts.description) updates.description = opts.description;
      if (opts.priority !== undefined) updates.priority = opts.priority;
      const t = await getClient().task.update.mutate({ id: taskId, updates });
      if (isJsonMode(this)) return printJson(t);
      console.log(`\u2713 Updated task: ${taskId.slice(0, 8)}`);
    });

  task
    .command('done')
    .description('Mark a task as done')
    .argument('<task-id>', 'Task ID')
    .action(async (taskId: string) => {
      await getClient().task.updateStatus.mutate({ id: taskId, status: 'completed' });
      console.log(`\u2713 Marked task ${taskId.slice(0, 8)} as done`);
    });
}
