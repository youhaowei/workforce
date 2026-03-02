/**
 * ReviewBadge - Shows pending review count as a badge on the navigation button.
 * Uses tRPC query instead of legacy SolidJS store.
 */

import { useQuery } from '@tanstack/react-query';
import { useTRPC } from '@/bridge/react';
import { useRequiredOrgId } from '@/ui/hooks/useRequiredOrgId';
import { Badge } from '@/components/ui/badge';

export function ReviewBadge() {
  const trpc = useTRPC();
  const orgId = useRequiredOrgId();

  const { data: count } = useQuery(
    trpc.review.count.queryOptions({ orgId }),
  );

  if (!count || count <= 0) return null;

  return (
    <Badge color="danger" className="absolute -top-1 -right-1 h-4 min-w-4 px-1 text-[9px] font-bold">
      {count > 9 ? '9+' : count}
    </Badge>
  );
}
