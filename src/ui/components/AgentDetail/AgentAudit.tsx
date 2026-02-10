/**
 * AgentAudit - Audit tab showing the full audit timeline for an agent.
 */

import { useQuery } from '@tanstack/react-query';
import { useTRPC } from '@bridge/react';
import { AuditTimeline } from '../Audit';
import type { AuditEntry } from '@services/types';

interface AgentAuditProps {
  sessionId: string;
  workspaceId: string;
}

export function AgentAudit({ sessionId, workspaceId }: AgentAuditProps) {
  const trpc = useTRPC();

  const { data: entries = [], isLoading } = useQuery(
    trpc.audit.session.queryOptions(
      { sessionId, workspaceId },
      { enabled: !!workspaceId },
    ),
  );

  if (isLoading) {
    return <p className="text-sm text-muted-foreground text-center py-8">Loading...</p>;
  }

  return <AuditTimeline entries={entries as AuditEntry[]} />;
}
