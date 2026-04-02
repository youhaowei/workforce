import type { Command } from "commander";
import { getClient } from "../client";
import { isJsonMode, printJson, printTable } from "../output";

export function registerSessionCommands(parent: Command) {
  const session = parent.command("session").description("Manage sessions");

  session
    .command("list")
    .description("List sessions")
    .option("--state <state>", "Filter by lifecycle state")
    .option("--org <id>", "Organization ID")
    .action(async function (this: Command, opts: { state?: string; org?: string }) {
      const trpc = getClient();
      const sessions = opts.state
        ? await trpc.session.listByState.query({
            state: opts.state as
              | "created"
              | "active"
              | "paused"
              | "completed"
              | "failed"
              | "cancelled",
            orgId: opts.org,
          })
        : await trpc.session.list.query(opts.org ? { orgId: opts.org } : undefined);
      if (isJsonMode(this)) return printJson(sessions);
      const rows = (sessions as any[]).map((s) => ({
        id: s.id?.slice(0, 8) ?? "?",
        title: (s.title ?? "Untitled").slice(0, 40),
        state: (s.metadata?.lifecycle as any)?.state ?? "?",
        messages: s.messageCount ?? s.messages?.length ?? "?",
      }));
      printTable(rows, ["id", "title", "state", "messages"]);
    });

  session
    .command("get")
    .description("Get session details")
    .argument("<session-id>", "Session ID")
    .action(async (_sessionId: string) => {
      const s = await getClient().session.get.query({ sessionId: _sessionId });
      printJson(s);
    });

  session
    .command("create")
    .description("Create a new session")
    .option("--title <title>", "Session title")
    .action(async function (this: Command, opts: { title?: string }) {
      const s = await getClient().session.create.mutate(
        opts.title ? { title: opts.title } : undefined,
      );
      if (isJsonMode(this)) return printJson(s);
      console.log(`\u2713 Created session: ${s.id}`);
    });

  session
    .command("delete")
    .description("Delete a session")
    .argument("<session-id>", "Session ID")
    .action(async (sessionId: string) => {
      await getClient().session.delete.mutate({ sessionId });
      console.log(`\u2713 Deleted session: ${sessionId}`);
    });

  session
    .command("messages")
    .description("View session messages")
    .argument("<session-id>", "Session ID")
    .option("--limit <n>", "Limit number of messages", parseInt)
    .action(async function (this: Command, sessionId: string, opts: { limit?: number }) {
      const messages = await getClient().session.messages.query({ sessionId, limit: opts.limit });
      if (isJsonMode(this)) return printJson(messages);
      for (const msg of messages as any[]) {
        const role = msg.role ?? "?";
        const text = (msg.content ?? msg.text ?? "").slice(0, 120);
        console.log(`[${role}] ${text}`);
      }
    });

  session
    .command("send")
    .description("Send a message to a session")
    .argument("<session-id>", "Session ID")
    .argument("<message...>", "Message text")
    .action(async (sessionId: string, messageParts: string[]) => {
      const message = messageParts.join(" ");
      await getClient().session.addMessage.mutate({
        sessionId,
        message: {
          id: `msg_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
          role: "user",
          content: message,
          timestamp: Date.now(),
        },
      });
      console.log(`\u2713 Message sent to session ${sessionId.slice(0, 8)}`);
    });
}
