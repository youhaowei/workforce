#!/usr/bin/env bun
/**
 * Workforce CLI — interact with the Workforce server from the command line.
 *
 * Usage: bun run cli <command> [subcommand] [options]
 *
 * The CLI calls the same tRPC API as the GUI, connecting to localhost:4096.
 */

import { createTRPCClient, httpBatchLink } from '@trpc/client';
import superjson from 'superjson';
import type { AppRouter } from '../server/routers';

const BASE_URL = process.env.WORKFORCE_URL || 'http://localhost:4096/api/trpc';

const client = createTRPCClient<AppRouter>({
  links: [
    httpBatchLink({
      url: BASE_URL,
      transformer: superjson,
    }),
  ],
});

// ─── Helpers ────────────────────────────────────────────────

function printJson(data: unknown) {
  console.log(JSON.stringify(data, null, 2));
}

function printTable(rows: Record<string, unknown>[], columns?: string[]) {
  if (rows.length === 0) {
    console.log('(empty)');
    return;
  }
  const cols = columns ?? Object.keys(rows[0]);
  const widths = cols.map((c) =>
    Math.max(c.length, ...rows.map((r) => String(r[c] ?? '').length))
  );

  // Header
  console.log(cols.map((c, i) => c.padEnd(widths[i])).join('  '));
  console.log(cols.map((_, i) => '─'.repeat(widths[i])).join('  '));

  // Rows
  for (const row of rows) {
    console.log(cols.map((c, i) => String(row[c] ?? '').padEnd(widths[i])).join('  '));
  }
}

function die(msg: string): never {
  console.error(`Error: ${msg}`);
  process.exit(1);
}

function requireArg(args: string[], index: number, name: string): string {
  if (!args[index]) die(`Missing required argument: ${name}`);
  return args[index];
}

function parseFlags(args: string[]): Record<string, string> {
  const flags: Record<string, string> = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith('--')) {
      const key = args[i].slice(2);
      const val = args[i + 1] && !args[i + 1].startsWith('--') ? args[++i] : 'true';
      flags[key] = val;
    }
  }
  return flags;
}

const json = process.argv.includes('--json');

// ─── Commands ───────────────────────────────────────────────

const commands: Record<string, Record<string, (args: string[]) => Promise<void>>> = {
  health: {
    check: async () => {
      const result = await client.health.ping.query();
      console.log(result ? '✓ Server is running' : '✗ Server not responding');
    },
  },

  session: {
    list: async (args) => {
      const flags = parseFlags(args);
      const sessions = await client.session.list.query(
        flags.state ? { state: flags.state as any } : undefined
      );
      if (json) return printJson(sessions);
      printTable(
        (sessions as any[]).map((s: any) => ({
          id: s.id?.slice(0, 8) ?? '?',
          title: (s.title ?? 'Untitled').slice(0, 40),
          state: s.state ?? '?',
          messages: s.messageCount ?? '?',
        })),
        ['id', 'title', 'state', 'messages']
      );
    },

    get: async (args) => {
      const id = requireArg(args, 0, 'session-id');
      const session = await client.session.get.query({ sessionId: id });
      printJson(session);
    },

    create: async (args) => {
      const flags = parseFlags(args);
      const session = await client.session.create.mutate(flags.title ? flags.title : undefined);
      if (json) return printJson(session);
      console.log(`✓ Created session: ${(session as any).id}`);
    },

    delete: async (args) => {
      const id = requireArg(args, 0, 'session-id');
      await client.session.delete.mutate({ sessionId: id });
      console.log(`✓ Deleted session: ${id}`);
    },

    messages: async (args) => {
      const id = requireArg(args, 0, 'session-id');
      const flags = parseFlags(args);
      const limit = flags.limit ? parseInt(flags.limit) : undefined;
      const messages = await client.session.messages.query({ sessionId: id, limit });
      if (json) return printJson(messages);
      for (const msg of messages as any[]) {
        const role = msg.role ?? '?';
        const text = (msg.content ?? msg.text ?? '').slice(0, 120);
        console.log(`[${role}] ${text}`);
      }
    },

    send: async (args) => {
      const id = requireArg(args, 0, 'session-id');
      const message = requireArg(args, 1, 'message');
      await client.session.addMessage.mutate({ sessionId: id, role: 'user', content: message });
      console.log(`✓ Message sent to session ${id.slice(0, 8)}`);
    },
  },

  agent: {
    query: async (args) => {
      const flags = parseFlags(args);
      const sessionId = requireArg(
        [flags.session ?? args[0]],
        0,
        'session-id (or --session <id>)'
      );
      const prompt = flags.prompt ?? args[1];
      if (!prompt) die('Missing required argument: prompt (or --prompt <text>)');
      console.log(`Querying agent in session ${sessionId.slice(0, 8)}...`);
      const result = await client.agent.query.mutate({ sessionId, prompt });
      if (json) return printJson(result);
      console.log((result as any)?.response ?? result);
    },

    cancel: async (args) => {
      const id = requireArg(args, 0, 'session-id');
      await client.agent.cancel.mutate({ sessionId: id });
      console.log(`✓ Cancelled agent query in session ${id.slice(0, 8)}`);
    },

    status: async (args) => {
      const id = requireArg(args, 0, 'session-id');
      const querying = await client.agent.isQuerying.query({ sessionId: id });
      console.log(querying ? '⏳ Agent is querying' : '💤 Agent is idle');
    },
  },

  task: {
    list: async (args) => {
      const flags = parseFlags(args);
      const tasks = await client.task.list.query(flags.org ? { orgId: flags.org } : undefined);
      if (json) return printJson(tasks);
      printTable(
        (tasks as any[]).map((t: any) => ({
          id: t.id?.slice(0, 8) ?? '?',
          title: (t.title ?? '').slice(0, 50),
          status: t.status ?? '?',
          assignee: t.assignee ?? '-',
        })),
        ['id', 'title', 'status', 'assignee']
      );
    },

    get: async (args) => {
      const id = requireArg(args, 0, 'task-id');
      const task = await client.task.get.query({ taskId: id });
      printJson(task);
    },

    create: async (args) => {
      const flags = parseFlags(args);
      const title = flags.title ?? args[0];
      if (!title) die('Missing required argument: title (or --title <text>)');
      const task = await client.task.create.mutate({
        title,
        description: flags.description,
        orgId: flags.org,
      });
      if (json) return printJson(task);
      console.log(`✓ Created task: ${(task as any).id}`);
    },

    update: async (args) => {
      const id = requireArg(args, 0, 'task-id');
      const flags = parseFlags(args);
      const task = await client.task.update.mutate({ taskId: id, ...flags });
      if (json) return printJson(task);
      console.log(`✓ Updated task: ${id.slice(0, 8)}`);
    },

    done: async (args) => {
      const id = requireArg(args, 0, 'task-id');
      await client.task.updateStatus.mutate({ taskId: id, status: 'done' });
      console.log(`✓ Marked task ${id.slice(0, 8)} as done`);
    },
  },

  org: {
    list: async () => {
      const orgs = await client.org.list.query();
      if (json) return printJson(orgs);
      printTable(
        (orgs as any[]).map((o: any) => ({
          id: o.id?.slice(0, 8) ?? '?',
          name: o.name ?? '?',
          agents: o.agentCount ?? '?',
        })),
        ['id', 'name', 'agents']
      );
    },

    get: async (args) => {
      const id = requireArg(args, 0, 'org-id');
      const org = await client.org.get.query({ orgId: id });
      printJson(org);
    },

    create: async (args) => {
      const flags = parseFlags(args);
      const name = flags.name ?? args[0];
      if (!name) die('Missing required argument: name (or --name <text>)');
      const org = await client.org.create.mutate({ name });
      if (json) return printJson(org);
      console.log(`✓ Created org: ${(org as any).id}`);
    },

    current: async () => {
      const org = await client.org.getCurrent.query();
      if (json) return printJson(org);
      if (org) {
        console.log(`Current org: ${(org as any).name} (${(org as any).id?.slice(0, 8)})`);
      } else {
        console.log('No active org');
      }
    },

    activate: async (args) => {
      const id = requireArg(args, 0, 'org-id');
      await client.org.activate.mutate({ orgId: id });
      console.log(`✓ Activated org: ${id.slice(0, 8)}`);
    },
  },

  template: {
    list: async () => {
      const templates = await client.template.list.query();
      if (json) return printJson(templates);
      printTable(
        (templates as any[]).map((t: any) => ({
          id: t.id?.slice(0, 8) ?? '?',
          name: t.name ?? '?',
          description: (t.description ?? '').slice(0, 50),
        })),
        ['id', 'name', 'description']
      );
    },

    get: async (args) => {
      const id = requireArg(args, 0, 'template-id');
      const template = await client.template.get.query({ templateId: id });
      printJson(template);
    },
  },

  workflow: {
    list: async () => {
      const workflows = await client.workflow.list.query();
      if (json) return printJson(workflows);
      printTable(
        (workflows as any[]).map((w: any) => ({
          id: w.id?.slice(0, 8) ?? '?',
          name: w.name ?? '?',
          steps: w.steps?.length ?? '?',
        })),
        ['id', 'name', 'steps']
      );
    },

    get: async (args) => {
      const id = requireArg(args, 0, 'workflow-id');
      const wf = await client.workflow.get.query({ workflowId: id });
      printJson(wf);
    },

    run: async (args) => {
      const id = requireArg(args, 0, 'workflow-id');
      const result = await client.workflow.execute.mutate({ workflowId: id });
      if (json) return printJson(result);
      console.log(`✓ Workflow ${id.slice(0, 8)} executed`);
    },
  },

  orchestration: {
    spawn: async (args) => {
      const flags = parseFlags(args);
      if (!flags.template && !flags.session)
        die('Provide --template <id> or --session <id>');
      const result = await client.orchestration.spawn.mutate({
        templateId: flags.template,
        sessionId: flags.session,
        prompt: flags.prompt,
      });
      if (json) return printJson(result);
      console.log(`✓ Spawned agent: ${JSON.stringify(result)}`);
    },
  },

  worktree: {
    get: async (args) => {
      const id = requireArg(args, 0, 'session-id');
      const wt = await client.worktree.get.query({ sessionId: id });
      printJson(wt);
    },

    diff: async (args) => {
      const id = requireArg(args, 0, 'session-id');
      const diff = await client.worktree.diff.query({ sessionId: id });
      if (json) return printJson(diff);
      console.log(typeof diff === 'string' ? diff : JSON.stringify(diff, null, 2));
    },

    merge: async (args) => {
      const id = requireArg(args, 0, 'session-id');
      await client.worktree.merge.mutate({ sessionId: id });
      console.log(`✓ Merged worktree for session ${id.slice(0, 8)}`);
    },
  },

  review: {
    list: async () => {
      const reviews = await client.review.list.query();
      if (json) return printJson(reviews);
      printTable(
        (reviews as any[]).map((r: any) => ({
          id: r.id?.slice(0, 8) ?? '?',
          status: r.status ?? '?',
          session: r.sessionId?.slice(0, 8) ?? '?',
        })),
        ['id', 'status', 'session']
      );
    },

    pending: async () => {
      const reviews = await client.review.listPending.query();
      if (json) return printJson(reviews);
      console.log(`${(reviews as any[]).length} pending reviews`);
      for (const r of reviews as any[]) {
        console.log(`  ${r.id?.slice(0, 8)} — ${r.summary ?? 'No summary'}`);
      }
    },

    resolve: async (args) => {
      const id = requireArg(args, 0, 'review-id');
      const flags = parseFlags(args);
      const action = (flags.action ?? 'approve') as 'approve' | 'reject' | 'request_changes';
      await client.review.resolve.mutate({ reviewId: id, action, comment: flags.comment });
      console.log(`✓ Review ${id.slice(0, 8)} ${action}d`);
    },
  },

  audit: {
    org: async (args) => {
      const flags = parseFlags(args);
      const entries = await client.audit.org.query(
        flags.org ? { orgId: flags.org } : undefined
      );
      if (json) return printJson(entries);
      for (const e of entries as any[]) {
        console.log(`[${e.timestamp ?? '?'}] ${e.action ?? '?'} — ${e.details ?? ''}`);
      }
    },

    session: async (args) => {
      const id = requireArg(args, 0, 'session-id');
      const entries = await client.audit.session.query({ sessionId: id });
      if (json) return printJson(entries);
      for (const e of entries as any[]) {
        console.log(`[${e.timestamp ?? '?'}] ${e.action ?? '?'} — ${e.details ?? ''}`);
      }
    },
  },
};

// ─── Usage ──────────────────────────────────────────────────

function printUsage() {
  console.log(`
workforce — CLI for the Workforce orchestrator

Usage: workforce <command> <subcommand> [args] [--flags]

Commands:
  health check                          Check if server is running

  session list [--state <state>]        List sessions
  session get <id>                      Get session details
  session create [--title <title>]      Create a new session
  session delete <id>                   Delete a session
  session messages <id> [--limit N]     View session messages
  session send <id> <message>           Send a message to a session

  agent query <session-id> <prompt>     Query agent in a session
  agent cancel <session-id>             Cancel running query
  agent status <session-id>             Check if agent is querying

  task list [--org <id>]                List tasks
  task get <id>                         Get task details
  task create <title> [--description]   Create a task
  task update <id> [--title] [--desc]   Update a task
  task done <id>                        Mark task as done

  org list                              List organizations
  org get <id>                          Get org details
  org create <name>                     Create an org
  org current                           Show active org
  org activate <id>                     Set active org

  template list                         List agent templates
  template get <id>                     Get template details

  workflow list                         List workflows
  workflow get <id>                     Get workflow details
  workflow run <id>                     Execute a workflow

  orchestration spawn [flags]           Spawn an agent

  worktree get <session-id>             Get worktree info
  worktree diff <session-id>            View worktree diff
  worktree merge <session-id>           Merge worktree

  review list                           List reviews
  review pending                        List pending reviews
  review resolve <id> [--action]        Resolve a review

  audit org [--org <id>]                Org audit log
  audit session <session-id>            Session audit log

Global flags:
  --json                                Output as JSON
  --url <url>                           Override server URL

  `);
}

// ─── Main ───────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2).filter((a) => a !== '--json');
  const command = args[0];
  const subcommand = args[1];
  const rest = args.slice(2);

  if (!command || command === '--help' || command === '-h') {
    printUsage();
    process.exit(0);
  }

  const group = commands[command];
  if (!group) die(`Unknown command: ${command}. Run 'workforce --help' for usage.`);

  const handler = group[subcommand];
  if (!handler) {
    const available = Object.keys(group).join(', ');
    die(`Unknown subcommand: ${command} ${subcommand}. Available: ${available}`);
  }

  try {
    await handler(rest);
  } catch (err: any) {
    if (err?.message?.includes('ECONNREFUSED')) {
      die('Cannot connect to Workforce server. Is it running? (bun run server)');
    }
    die(err?.message ?? String(err));
  }
}

main();
