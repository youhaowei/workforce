import type { Command } from "commander";
import { getClient, resolveOrgId } from "../client";
import { isJsonMode, printJson } from "../output";

export function registerOrchestrationCommands(parent: Command) {
  const orchestration = parent.command("orchestration").description("Agent orchestration");

  orchestration
    .command("spawn")
    .description("Spawn an orchestrated agent")
    .requiredOption("--template <id>", "Agent template ID")
    .requiredOption("--goal <text>", "Goal for the agent")
    .option("--org <id>", "Organization ID")
    .option("--session <id>", "Parent session ID")
    .option("--worktree", "Isolate in a git worktree")
    .action(async function (
      this: Command,
      opts: {
        template: string;
        goal: string;
        org?: string;
        session?: string;
        worktree?: boolean;
      },
    ) {
      const orgId = await resolveOrgId(opts);
      const result = await getClient().orchestration.spawn.mutate({
        orgId,
        templateId: opts.template,
        goal: opts.goal,
        parentSessionId: opts.session,
        isolateWorktree: opts.worktree === true,
      });
      if (isJsonMode(this)) return printJson(result);
      console.log(`\u2713 Spawned agent: ${JSON.stringify(result)}`);
    });
}
