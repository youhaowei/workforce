import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTRPC } from "@/bridge/react";
import type { Project } from "@/services/types";

interface UseSessionProjectPathParams {
  orgId?: string;
  sessionId: string | null;
  projects: Project[];
  serverConnected: boolean;
}

export function useSessionProjectPath({
  sessionId,
  projects,
  serverConnected,
}: UseSessionProjectPathParams): string | null {
  const trpc = useTRPC();
  const { data: session } = useQuery(
    trpc.session.get.queryOptions(
      { sessionId: sessionId! },
      { enabled: serverConnected && !!sessionId },
    ),
  );

  return useMemo(() => {
    if (!session) return null;
    const projectId = session.metadata?.projectId as string | undefined;
    if (!projectId) return null;
    const project = projects.find((p) => p.id === projectId);
    return project?.rootPath ?? null;
  }, [session, projects]);
}
