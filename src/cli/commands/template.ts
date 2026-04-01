import type { Command } from "commander";
import { getClient, resolveOrgId } from "../client";
import { isJsonMode, printJson, printTable } from "../output";

export function registerTemplateCommands(parent: Command) {
  const template = parent.command("template").description("Manage agent templates");

  template
    .command("list")
    .description("List agent templates")
    .option("--org <id>", "Organization ID")
    .option("--archived", "Include archived templates")
    .action(async function (this: Command, opts: { org?: string; archived?: boolean }) {
      const orgId = await resolveOrgId(opts);
      const templates = await getClient().template.list.query({
        orgId,
        includeArchived: opts.archived === true,
      });
      if (isJsonMode(this)) return printJson(templates);
      printTable(
        (templates as any[]).map((t) => ({
          id: t.id?.slice(0, 8) ?? "?",
          name: t.name ?? "?",
          description: (t.description ?? "").slice(0, 50),
        })),
        ["id", "name", "description"],
      );
    });

  template
    .command("get")
    .description("Get template details")
    .argument("<template-id>", "Template ID")
    .option("--org <id>", "Organization ID")
    .action(async (templateId: string, opts: { org?: string }) => {
      const orgId = await resolveOrgId(opts);
      const t = await getClient().template.get.query({ orgId, id: templateId });
      printJson(t);
    });
}
