import type { Command } from 'commander';
import { getClient } from '../client';
import { isJsonMode, printJson } from '../output';

export function registerAgentCommands(parent: Command) {
  const agent = parent.command('agent').description('Agent interactions');

  agent
    .command('run')
    .description('Run the agent (streams response)')
    .argument('<prompt...>', 'Prompt text')
    .action(async function (this: Command, promptParts: string[]) {
      const prompt = promptParts.join(' ');
      const json = isJsonMode(this);
      console.log('Running agent...');
      const tokens: string[] = [];
      await new Promise<void>((resolve, reject) => {
        const subscription = getClient().agent.run.subscribe(
          { prompt },
          {
            onData: (data) => {
              if (data.type === 'token') {
                tokens.push(data.data);
                if (!json) process.stdout.write(data.data);
              } else if (data.type === 'error') {
                subscription.unsubscribe();
                reject(new Error(data.data));
              } else if (data.type === 'done') {
                subscription.unsubscribe();
                resolve();
              }
            },
            onError: (err) => reject(err),
            onComplete: () => resolve(),
          },
        );
      });
      if (!json) process.stdout.write('\n');
      if (json) printJson({ response: tokens.join('') });
    });

  agent
    .command('cancel')
    .description('Cancel a running agent')
    .action(async () => {
      await getClient().agent.cancel.mutate();
      console.log('\u2713 Cancelled agent run');
    });

  agent
    .command('status')
    .description('Check if the agent is running')
    .action(async () => {
      const result = await getClient().agent.activeStream.query();
      console.log(result.running ? '\u23f3 Agent is running' : '\ud83d\udca4 Agent is idle');
    });
}
