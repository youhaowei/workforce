import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTRPC } from '@/bridge/react';
import type { SessionSummary, Project } from '@/services/types';

interface UseSessionProjectPathParams {
  orgId?: string;
  sessionId: string | null;
  projects: Project[];
  serverConnected: boolean;
}

export function useSessionProjectPath({
  orgId,
  sessionId,
  projects,
  serverConnected,
}: UseSessionProjectPathParams): string | null {
  const trpc = useTRPC();
  const { data: sessionList } = useQuery(
    trpc.session.list.queryOptions(
      orgId ? { orgId } : undefined,
      { enabled: serverConnected },
    ),
  );

  return useMemo(() => {
    if (!sessionId || !sessionList) return null;
    const session = sessionList.find((s: SessionSummary) => s.id === sessionId);
    if (!session) return null;
    const projectId = session.metadata?.projectId as string | undefined;
    if (!projectId) return null;
    const project = projects.find((p) => p.id === projectId);
    return project?.rootPath ?? null;
  }, [sessionId, sessionList, projects]);
}
