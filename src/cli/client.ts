/** tRPC client singleton + org resolution helpers for CLI commands. */

import { createTRPCClient, httpBatchLink, httpSubscriptionLink, splitLink } from "@trpc/client";
import superjson from "superjson";
import type { AppRouter } from "../server/routers";

import { DEFAULT_SERVER_PORT } from "@/shared/ports";

const BASE_URL = process.env.WORKFORCE_URL || `http://localhost:${DEFAULT_SERVER_PORT}/api/trpc`;

let client: ReturnType<typeof createTRPCClient<AppRouter>> | undefined;

export function getClient() {
  client ??= createTRPCClient<AppRouter>({
    links: [
      splitLink({
        condition: (op) => op.type === "subscription",
        true: httpSubscriptionLink({ url: BASE_URL, transformer: superjson }),
        false: httpBatchLink({ url: BASE_URL, transformer: superjson }),
      }),
    ],
  });
  return client;
}

/** Try to get the current active org ID. */
export async function getCurrentOrgId(): Promise<string | undefined> {
  try {
    const org = await getClient().org.getCurrent.query();
    return org?.id;
  } catch {
    return undefined;
  }
}

/** Get orgId from --org option or current org; exits if neither available. */
export async function resolveOrgId(opts: { org?: string }): Promise<string> {
  const orgId = opts.org ?? (await getCurrentOrgId());
  if (!orgId) {
    console.error("Error: No active org. Create one first: workforce org create <name>");
    process.exit(1);
  }
  return orgId;
}
