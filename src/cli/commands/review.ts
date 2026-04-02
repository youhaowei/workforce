import type { Command } from 'commander';
import { getClient, resolveOrgId } from '../client';
import { isJsonMode, printJson, printTable } from '../output';

export function registerReviewCommands(parent: Command) {
  const review = parent.command('review').description('Review management');

  review
    .command('list')
    .description('List reviews')
    .option('--org <id>', 'Organization ID')
    .action(async function (this: Command, opts: { org?: string }) {
      const orgId = await resolveOrgId(opts);
      const reviews = await getClient().review.list.query({ orgId });
      if (isJsonMode(this)) return printJson(reviews);
      printTable(
        (reviews as any[]).map((r) => ({
          id: r.id?.slice(0, 8) ?? '?',
          status: r.status ?? '?',
          session: r.sessionId?.slice(0, 8) ?? '?',
        })),
        ['id', 'status', 'session'],
      );
    });

  review
    .command('pending')
    .description('List pending reviews')
    .option('--org <id>', 'Organization ID')
    .action(async function (this: Command, opts: { org?: string }) {
      const orgId = await resolveOrgId(opts);
      const reviews = await getClient().review.listPending.query({ orgId });
      if (isJsonMode(this)) return printJson(reviews);
      console.log(`${(reviews as any[]).length} pending reviews`);
      for (const r of reviews as any[]) {
        console.log(`  ${r.id?.slice(0, 8)} \u2014 ${r.summary ?? 'No summary'}`);
      }
    });

  review
    .command('resolve')
    .description('Resolve a review')
    .argument('<review-id>', 'Review ID')
    .option('--action <action>', 'Action to take (approve|reject|edit|clarify)', 'approve')
    .option('--comment <text>', 'Comment')
    .option('--org <id>', 'Organization ID')
    .action(async (reviewId: string, opts: { action: string; comment?: string; org?: string }) => {
      const orgId = await resolveOrgId(opts);
      const action = opts.action as 'approve' | 'reject' | 'edit' | 'clarify';
      await getClient().review.resolve.mutate({ id: reviewId, orgId, action, comment: opts.comment });
      const past: Record<string, string> = { approve: 'approved', reject: 'rejected', edit: 'edited', clarify: 'clarified' };
      console.log(`\u2713 Review ${reviewId.slice(0, 8)} ${past[action] ?? action}`);
    });
}
