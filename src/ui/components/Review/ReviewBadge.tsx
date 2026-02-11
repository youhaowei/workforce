/**
 * ReviewBadge - Shows pending review count as a badge on the navigation button.
 * Uses tRPC query instead of legacy SolidJS store.
 */

import { useQuery } from '@tanstack/react-query';
import { useTRPC } from '@/bridge/react';
import { useWorkspaceStore } from '@/ui/stores/useWorkspaceStore';
import { Badge } from '@/components/ui/badge';

export function ReviewBadge() {
  const trpc = useTRPC();
  const workspaceId = useWorkspaceStore((s) => s.currentWorkspaceId);

  const { data: count } = useQuery(
    trpc.review.count.queryOptions(
      { workspaceId: workspaceId! },
      { enabled: !!workspaceId, refetchInterval: 3000 },
    ),
  );

  if (!count || count <= 0) return null;

  return (
    <Badge variant="destructive" className="absolute -top-1 -right-1 h-4 min-w-4 px-1 text-[9px] font-bold">
      {count > 9 ? '9+' : count}
    </Badge>
  );
}
