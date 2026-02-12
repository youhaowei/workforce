/**
 * ReviewQueue - Main review queue view showing pending items.
 * Uses tRPC queries instead of legacy SolidJS reviewStore.
 */

import { useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTRPC } from '@/bridge/react';
import { useOrgStore } from '@/ui/stores/useOrgStore';
import { ReviewItemCard } from './ReviewItemCard';
import { CheckCircle } from 'lucide-react';
import type { ReviewItem } from '@/services/types';

export function ReviewQueue() {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const orgId = useOrgStore((s) => s.currentOrgId);

  const { data: items = [], isLoading } = useQuery(
    trpc.review.listPending.queryOptions(
      { orgId: orgId! },
      { enabled: !!orgId, refetchInterval: 3000 },
    ),
  );

  const resolveMutation = useMutation(
    trpc.review.resolve.mutationOptions({
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: ['review'] });
      },
    }),
  );

  const handleResolve = useCallback(
    (reviewId: string, action: string, comment?: string) => {
      if (!orgId) return;
      resolveMutation.mutate({
        id: reviewId,
        orgId,
        action: action as 'approve' | 'reject' | 'edit' | 'clarify',
        comment,
      });
    },
    [orgId, resolveMutation],
  );

  return (
    <div className="flex-1 flex flex-col overflow-hidden pt-14 px-6 pb-6">
      <div className="mb-4">
        <h2 className="text-lg font-semibold">Review Queue</h2>
        <p className="text-xs text-muted-foreground">
          Items awaiting your review ({items.length} pending)
        </p>
      </div>
      <div className="flex-1 overflow-y-auto">
        {isLoading && (
          <p className="text-sm text-muted-foreground text-center py-8">Loading...</p>
        )}
        {!isLoading && items.length > 0 && (
          <div className="space-y-3 max-w-2xl">
            {items.map((item: ReviewItem) => (
              <ReviewItemCard
                key={item.id}
                item={item}
                onResolve={(action, comment) => handleResolve(item.id, action, comment)}
              />
            ))}
          </div>
        )}
        {!isLoading && items.length === 0 && (
          <div className="text-center py-12">
            <div className="w-12 h-12 mx-auto mb-3 rounded-full bg-green-500/10 flex items-center justify-center">
              <CheckCircle className="h-5 w-5 text-green-600" />
            </div>
            <p className="text-sm font-medium">All caught up!</p>
            <p className="text-xs text-muted-foreground mt-1">No pending reviews</p>
          </div>
        )}
      </div>
    </div>
  );
}
