#!/usr/bin/env bun
/**
 * Workforce CLI — interact with the Workforce server from the command line.
 *
 * Usage: bun run cli <command> [subcommand] [options]
 *        npx tsx src/cli/index.ts <command> [subcommand] [options]
 *
 * Calls the tRPC HTTP API directly (no tRPC client dependency needed).
 * Server must be running at localhost:4096 (or WORKFORCE_URL).
 */

const BASE_URL = process.env.WORKFORCE_URL || 'http://localhost:4096/api/trpc';

// ─── tRPC HTTP caller (no dependencies) ─────────────────────

async function trpcQuery(path: string, input?: unknown): Promise<unknown> {
  const url = new URL(path, BASE_URL.replace(/\/+$/, '') + '/');
  if (input !== undefined) {
    // superjson encode: wrap in { json: input }
    url.searchParams.set('input', JSON.stringify({ json: input }));
  }
  const res = await fetch(url.toString());
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`HTTP ${res.status}: ${text.slice(0, 200)}`);
  }
  const body = await res.json() as any;
  // tRPC wraps in { result: { data: { json: ... } } }
  return body?.result?.data?.json ?? body?.result?.data ?? body;
}

async function trpcMutate(path: string, input?: unknown): Promise<unknown> {
  const url = new URL(path, BASE_URL.replace(/\/+$/, '') + '/');
  const res = await fetch(url.toString(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input !== undefined ? { json: input } : {}),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`HTTP ${res.status}: ${text.slice(0, 200)}`);
  }
  const body = await res.json() as any;
  return body?.result?.data?.json ?? body?.result?.data ?? body;
}

// ─── Helpers ────────────────────────────────────────────────

function printJson(data: unknown) {
  console.log(JSON.stringify(data, null, 2));
}

function printTable(rows: Record<string, unknown>[], columns?: string[]) {
  if (!rows || rows.length === 0) {
    console.log('(empty)');
    return;
  }
  const cols = columns ?? Object.keys(rows[0]);
  const widths = cols.map((c) =>
    Math.max(c.length, ...rows.map((r) => String(r[c] ?? '').length))
  );
  console.log(cols.map((c, i) => c.padEnd(widths[i])).join('  '));
  console.log(cols.map((_, i) => '─'.repeat(widths[i])).join('  '));
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

const jsonMode = process.argv.includes('--json');

/** Try to get the current active org ID */
async function getCurrentOrgId(): Promise<string | undefined> {
  try {
    const org = await trpcQuery('org.getCurrent') as any;
    return org?.id;
  } catch {
    return undefined;
  }
}

/** Get orgId from flags or current org, die if neither */
async function resolveOrgId(flags: Record<string, string>): Promise<string> {
  const orgId = flags.org ?? (await getCurrentOrgId());
  if (!orgId) die('No active org. Create one first: workforce org create <name>');
  return orgId;
}

// ─── Commands ───────────────────────────────────────────────

const commands: Record<string, Record<string, (args: string[]) => Promise<void>>> = {
  health: {
    check: async () => {
      try {
        const result = await trpcQuery('health.check');
        console.log('✓ Server is running');
        if (jsonMode) printJson(result);
      } catch {
        console.log('✗ Server not responding');
        process.exit(1);
      }
    },
  },

  session: {
    list: async (args) => {
      const flags = parseFlags(args);
      const input = flags.state ? { state: flags.state } : undefined;
      const sessions = await trpcQuery('session.list', input) as any[];
      if (jsonMode) return printJson(sessions);
      printTable(
        sessions.map((s) => ({
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
      const session = await trpcQuery('session.get', { sessionId: id });
      printJson(session);
    },

    create: async (args) => {
      const flags = parseFlags(args);
      const session = await trpcMutate('session.create', flags.title ? { title: flags.title } : {}) as any;
      if (jsonMode) return printJson(session);
      console.log(`✓ Created session: ${session.id}`);
    },

    delete: async (args) => {
      const id = requireArg(args, 0, 'session-id');
      await trpcMutate('session.delete', { sessionId: id });
      console.log(`✓ Deleted session: ${id}`);
    },

    messages: async (args) => {
      const id = requireArg(args, 0, 'session-id');
      const flags = parseFlags(args);
      const limit = flags.limit ? parseInt(flags.limit) : undefined;
      const messages = await trpcQuery('session.messages', { sessionId: id, limit }) as any[];
      if (jsonMode) return printJson(messages);
      for (const msg of messages) {
        const role = msg.role ?? '?';
        const text = (msg.content ?? msg.text ?? '').slice(0, 120);
        console.log(`[${role}] ${text}`);
      }
    },

    send: async (args) => {
      const id = requireArg(args, 0, 'session-id');
      const message = args.slice(1).filter(a => !a.startsWith('--')).join(' ');
      if (!message) die('Missing required argument: message');
      await trpcMutate('session.addMessage', {
        sessionId: id,
        message: {
          id: `msg_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
          role: 'user',
          content: message,
          timestamp: Date.now(),
        },
      });
      console.log(`✓ Message sent to session ${id.slice(0, 8)}`);
    },
  },

  agent: {
    query: async (args) => {
      const flags = parseFlags(args);
      const positional = args.filter(a => !a.startsWith('--'));
      const sessionId = flags.session ?? positional[0];
      const prompt = flags.prompt ?? positional.slice(1).join(' ');
      if (!sessionId) die('Missing session-id');
      if (!prompt) die('Missing prompt');
      console.log(`Querying agent in session ${sessionId.slice(0, 8)}...`);
      const result = await trpcMutate('agent.query', { sessionId, prompt });
      if (jsonMode) return printJson(result);
      console.log((result as any)?.response ?? JSON.stringify(result, null, 2));
    },

    cancel: async (args) => {
      const id = requireArg(args, 0, 'session-id');
      await trpcMutate('agent.cancel', { sessionId: id });
      console.log(`✓ Cancelled agent query in session ${id.slice(0, 8)}`);
    },

    status: async (args) => {
      const id = requireArg(args, 0, 'session-id');
      const querying = await trpcQuery('agent.isQuerying', { sessionId: id });
      console.log(querying ? '⏳ Agent is querying' : '💤 Agent is idle');
    },
  },

  task: {
    list: async (args) => {
      const flags = parseFlags(args);
      const tasks = await trpcQuery('task.list', flags.org ? { orgId: flags.org } : undefined) as any[];
      if (jsonMode) return printJson(tasks);
      printTable(
        tasks.map((t) => ({
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
      const task = await trpcQuery('task.get', { taskId: id });
      printJson(task);
    },

    create: async (args) => {
      const flags = parseFlags(args);
      const title = flags.title ?? args.filter(a => !a.startsWith('--'))[0];
      if (!title) die('Missing required argument: title');
      const task = await trpcMutate('task.create', {
        title,
        description: flags.description,
        orgId: flags.org,
      }) as any;
      if (jsonMode) return printJson(task);
      console.log(`✓ Created task: ${task.id}`);
    },

    update: async (args) => {
      const id = requireArg(args, 0, 'task-id');
      const flags = parseFlags(args);
      const task = await trpcMutate('task.update', { taskId: id, ...flags });
      if (jsonMode) return printJson(task);
      console.log(`✓ Updated task: ${id.slice(0, 8)}`);
    },

    done: async (args) => {
      const id = requireArg(args, 0, 'task-id');
      await trpcMutate('task.updateStatus', { id, status: 'completed' });
      console.log(`✓ Marked task ${id.slice(0, 8)} as done`);
    },
  },

  org: {
    list: async () => {
      const orgs = await trpcQuery('org.list') as any[];
      if (jsonMode) return printJson(orgs);
      printTable(
        orgs.map((o) => ({
          id: o.id?.slice(0, 8) ?? '?',
          name: o.name ?? '?',
          agents: o.agentCount ?? '?',
        })),
        ['id', 'name', 'agents']
      );
    },

    get: async (args) => {
      const id = requireArg(args, 0, 'org-id');
      const org = await trpcQuery('org.get', { orgId: id });
      printJson(org);
    },

    create: async (args) => {
      const flags = parseFlags(args);
      const name = flags.name ?? args.filter(a => !a.startsWith('--'))[0];
      if (!name) die('Missing required argument: name');
      const rootPath = flags.path ?? process.cwd();
      const org = await trpcMutate('org.create', { name, rootPath }) as any;
      if (jsonMode) return printJson(org);
      console.log(`✓ Created org: ${org.id}`);
    },

    current: async () => {
      const org = await trpcQuery('org.getCurrent') as any;
      if (jsonMode) return printJson(org);
      if (org) {
        console.log(`Current org: ${org.name} (${org.id?.slice(0, 8)})`);
      } else {
        console.log('No active org');
      }
    },

    activate: async (args) => {
      const id = requireArg(args, 0, 'org-id');
      await trpcMutate('org.activate', { id });
      console.log(`✓ Activated org: ${id.slice(0, 8)}`);
    },
  },

  template: {
    list: async (args) => {
      const flags = parseFlags(args);
      const orgId = flags.org ?? (await getCurrentOrgId());
      if (!orgId) die('No active org. Create one with: workforce org create <name>');
      const templates = await trpcQuery('template.list', { orgId, includeArchived: flags.archived === 'true' }) as any[];
      if (jsonMode) return printJson(templates);
      printTable(
        templates.map((t) => ({
          id: t.id?.slice(0, 8) ?? '?',
          name: t.name ?? '?',
          description: (t.description ?? '').slice(0, 50),
        })),
        ['id', 'name', 'description']
      );
    },

    get: async (args) => {
      const id = requireArg(args, 0, 'template-id');
      const template = await trpcQuery('template.get', { templateId: id });
      printJson(template);
    },
  },

  workflow: {
    list: async (args) => {
      const flags = parseFlags(args);
      const orgId = await resolveOrgId(flags);
      const workflows = await trpcQuery('workflow.list', { orgId }) as any[];
      if (jsonMode) return printJson(workflows);
      printTable(
        workflows.map((w) => ({
          id: w.id?.slice(0, 8) ?? '?',
          name: w.name ?? '?',
          steps: w.steps?.length ?? '?',
        })),
        ['id', 'name', 'steps']
      );
    },

    get: async (args) => {
      const id = requireArg(args, 0, 'workflow-id');
      const wf = await trpcQuery('workflow.get', { workflowId: id });
      printJson(wf);
    },

    run: async (args) => {
      const id = requireArg(args, 0, 'workflow-id');
      const result = await trpcMutate('workflow.execute', { workflowId: id });
      if (jsonMode) return printJson(result);
      console.log(`✓ Workflow ${id.slice(0, 8)} executed`);
    },
  },

  orchestration: {
    spawn: async (args) => {
      const flags = parseFlags(args);
      if (!flags.template && !flags.session)
        die('Provide --template <id> or --session <id>');
      const result = await trpcMutate('orchestration.spawn', {
        templateId: flags.template,
        sessionId: flags.session,
        prompt: flags.prompt,
      });
      if (jsonMode) return printJson(result);
      console.log(`✓ Spawned agent: ${JSON.stringify(result)}`);
    },
  },

  worktree: {
    get: async (args) => {
      const id = requireArg(args, 0, 'session-id');
      const wt = await trpcQuery('worktree.get', { sessionId: id });
      printJson(wt);
    },

    diff: async (args) => {
      const id = requireArg(args, 0, 'session-id');
      const diff = await trpcQuery('worktree.diff', { sessionId: id });
      if (jsonMode) return printJson(diff);
      console.log(typeof diff === 'string' ? diff : JSON.stringify(diff, null, 2));
    },

    merge: async (args) => {
      const id = requireArg(args, 0, 'session-id');
      await trpcMutate('worktree.merge', { sessionId: id });
      console.log(`✓ Merged worktree for session ${id.slice(0, 8)}`);
    },
  },

  review: {
    list: async (args) => {
      const flags = parseFlags(args);
      const orgId = await resolveOrgId(flags);
      const reviews = await trpcQuery('review.list', { orgId }) as any[];
      if (jsonMode) return printJson(reviews);
      printTable(
        reviews.map((r) => ({
          id: r.id?.slice(0, 8) ?? '?',
          status: r.status ?? '?',
          session: r.sessionId?.slice(0, 8) ?? '?',
        })),
        ['id', 'status', 'session']
      );
    },

    pending: async (args) => {
      const flags = parseFlags(args);
      const orgId = await resolveOrgId(flags);
      const reviews = await trpcQuery('review.listPending', { orgId }) as any[];
      if (jsonMode) return printJson(reviews);
      console.log(`${reviews.length} pending reviews`);
      for (const r of reviews) {
        console.log(`  ${r.id?.slice(0, 8)} — ${r.summary ?? 'No summary'}`);
      }
    },

    resolve: async (args) => {
      const id = requireArg(args, 0, 'review-id');
      const flags = parseFlags(args);
      const action = (flags.action ?? 'approve') as string;
      await trpcMutate('review.resolve', { reviewId: id, action, comment: flags.comment });
      console.log(`✓ Review ${id.slice(0, 8)} ${action}d`);
    },
  },

  audit: {
    org: async (args) => {
      const flags = parseFlags(args);
      const entries = await trpcQuery('audit.org', flags.org ? { orgId: flags.org } : undefined) as any[];
      if (jsonMode) return printJson(entries);
      for (const e of entries) {
        console.log(`[${e.timestamp ?? '?'}] ${e.action ?? '?'} — ${e.details ?? ''}`);
      }
    },

    session: async (args) => {
      const id = requireArg(args, 0, 'session-id');
      const entries = await trpcQuery('audit.session', { sessionId: id }) as any[];
      if (jsonMode) return printJson(entries);
      for (const e of entries) {
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
  WORKFORCE_URL=<url>                   Override server URL (default: http://localhost:4096/api/trpc)

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
    die(`Unknown subcommand: ${command} ${subcommand ?? '(none)'}. Available: ${available}`);
  }

  try {
    await handler(rest);
  } catch (err: any) {
    const msg = err?.message ?? String(err);
    if (msg.includes('ECONNREFUSED') || msg.includes('fetch failed')) {
      die('Cannot connect to Workforce server. Is it running? (bun run server)');
    }
    die(msg);
  }
}

main();
