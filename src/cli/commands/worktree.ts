import type { Command } from 'commander';
import { getClient } from '../client';
import { isJsonMode, printJson } from '../output';

export function registerWorktreeCommands(parent: Command) {
  const worktree = parent.command('worktree').description('Git worktree operations');

  worktree
    .command('get')
    .description('Get worktree info for a session')
    .argument('<session-id>', 'Session ID')
    .action(async (sessionId: string) => {
      const wt = await getClient().worktree.get.query({ sessionId });
      printJson(wt);
    });

  worktree
    .command('diff')
    .description('View worktree diff for a session')
    .argument('<session-id>', 'Session ID')
    .action(async function (this: Command, sessionId: string) {
      const diff = await getClient().worktree.diff.query({ sessionId });
      if (isJsonMode(this)) return printJson(diff);
      console.log(typeof diff === 'string' ? diff : JSON.stringify(diff, null, 2));
    });

  worktree
    .command('merge')
    .description('Merge worktree for a session')
    .argument('<session-id>', 'Session ID')
    .option('--strategy <strategy>', 'Merge strategy (merge|rebase)')
    .action(async (sessionId: string, opts: { strategy?: string }) => {
      await getClient().worktree.merge.mutate({
        sessionId,
        strategy: opts.strategy as 'merge' | 'rebase' | undefined,
      });
      console.log(`\u2713 Merged worktree for session ${sessionId.slice(0, 8)}`);
    });
}
