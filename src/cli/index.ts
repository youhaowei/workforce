#!/usr/bin/env tsx
/** Workforce CLI — typed tRPC client for the Workforce server. */

import { Command } from "commander";
import { registerAgentCommands } from "./commands/agent";
import { registerAuditCommands } from "./commands/audit";
import { registerHealthCommands } from "./commands/health";
import { registerOrgCommands } from "./commands/org";
import { registerOrchestrationCommands } from "./commands/orchestration";
import { registerReviewCommands } from "./commands/review";
import { registerSessionCommands } from "./commands/session";
import { registerTaskCommands } from "./commands/task";
import { registerTemplateCommands } from "./commands/template";
import { registerWorktreeCommands } from "./commands/worktree";
import { registerWorkflowCommands } from "./commands/workflow";

const program = new Command()
  .name("workforce")
  .description("CLI for the Workforce orchestrator")
  .version("0.1.0")
  .option("--json", "Output in JSON format");

registerHealthCommands(program);
registerSessionCommands(program);
registerAgentCommands(program);
registerTaskCommands(program);
registerOrgCommands(program);
registerTemplateCommands(program);
registerWorkflowCommands(program);
registerOrchestrationCommands(program);
registerWorktreeCommands(program);
registerReviewCommands(program);
registerAuditCommands(program);

// Wrap parseAsync with connection error handling
const originalParseAsync = program.parseAsync.bind(program);
program.parseAsync = async (...args: Parameters<typeof program.parseAsync>) => {
  try {
    return await originalParseAsync(...args);
  } catch (err: any) {
    const msg = err?.message ?? String(err);
    if (msg.includes("ECONNREFUSED") || msg.includes("fetch failed")) {
      console.error("Error: Cannot connect to Workforce server. Is it running? (bun run server)");
      process.exit(1);
    }
    console.error(`Error: ${msg}`);
    process.exit(1);
  }
};

await program.parseAsync();
// SSE subscription link keeps process alive; exit explicitly after command completes
process.exit(0);
