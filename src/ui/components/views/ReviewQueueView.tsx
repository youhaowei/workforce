import React from 'react';
import { trpcClient } from '@bridge/index';
import type { ReviewAction } from '@services/types';
import type { ReviewItem } from '@ui/types/domain';
import { Badge, Button, Card, CardContent, CardDescription, CardHeader, CardTitle } from '@ui/components/ui';

interface ReviewQueueViewProps {
  reviews: ReviewItem[];
  onAfterChange: () => Promise<void>;
}

export default function ReviewQueueView(props: ReviewQueueViewProps): React.ReactElement {
  const resolve = async (id: string, action: ReviewAction) => {
    await trpcClient.reviews.resolve.mutate({ id, action });
    await props.onAfterChange();
  };

  return (
    <div className="h-full overflow-auto p-6">
      <h2 className="mb-3 text-lg font-semibold text-zinc-900">Review Queue</h2>
      <div className="space-y-2">
        {props.reviews.length === 0 ? (
          <div className="rounded border border-zinc-200 bg-white p-3 text-sm text-zinc-500">
            No review items.
          </div>
        ) : null}
        {props.reviews.map((review) => (
          <Card key={review.id}>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">{review.summary}</CardTitle>
              <CardDescription>Source: {review.sourceAgentId}</CardDescription>
              <Badge variant="outline">{review.status}</Badge>
            </CardHeader>
            <CardContent className="pt-0">
              <div className="mt-2 flex flex-wrap gap-2">
                <Button size="sm" variant="secondary" onClick={() => void resolve(review.id, 'approve')}>
                  Approve
                </Button>
                <Button size="sm" variant="destructive" onClick={() => void resolve(review.id, 'reject')}>
                  Reject
                </Button>
                <Button size="sm" variant="outline" onClick={() => void resolve(review.id, 'request_edit')}>
                  Request Edit
                </Button>
                <Button size="sm" variant="ghost" onClick={() => void resolve(review.id, 'clarification')}>
                  Clarify
                </Button>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
