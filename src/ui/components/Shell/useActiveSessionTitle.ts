import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTRPC } from '@/bridge/react';
import type { SessionSummary } from '@/services/types';

interface UseActiveSessionTitleParams {
  orgId?: string;
  selectedSessionId: string | null;
  serverConnected: boolean;
}

export function useActiveSessionTitle({
  orgId,
  selectedSessionId,
  serverConnected,
}: UseActiveSessionTitleParams): string | undefined {
  const trpc = useTRPC();
  const { data: sessionList } = useQuery(
    trpc.session.list.queryOptions(
      orgId ? { orgId } : undefined,
      { enabled: serverConnected },
    ),
  );

  return useMemo(() => {
    if (!selectedSessionId || !sessionList) return undefined;
    const session = sessionList.find((s: SessionSummary) => s.id === selectedSessionId);
    return session?.title;
  }, [selectedSessionId, sessionList]);
}
