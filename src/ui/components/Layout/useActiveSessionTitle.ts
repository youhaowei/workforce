import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTRPC } from "@/bridge/react";
import type { Project, SessionSummary } from "@/services/types";

interface UseActiveSessionTitleParams {
  orgId?: string;
  selectedSessionId: string | null;
  serverConnected: boolean;
  projects?: Project[];
}

interface ActiveSessionInfo {
  title: string | undefined;
  projectName: string | undefined;
}

export function useActiveSessionInfo({
  orgId,
  selectedSessionId,
  serverConnected,
  projects,
}: UseActiveSessionTitleParams): ActiveSessionInfo {
  const trpc = useTRPC();
  const { data: sessionList } = useQuery(
    trpc.session.list.queryOptions(orgId ? { orgId } : undefined, { enabled: serverConnected }),
  );

  return useMemo(() => {
    if (!selectedSessionId || !sessionList) return { title: undefined, projectName: undefined };
    const session = sessionList.find((s: SessionSummary) => s.id === selectedSessionId);
    const projectId = session?.metadata?.projectId as string | undefined;
    const project = projectId ? projects?.find((p) => p.id === projectId) : undefined;
    return { title: session?.title, projectName: project?.name };
  }, [selectedSessionId, sessionList, projects]);
}
