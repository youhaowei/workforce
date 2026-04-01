/**
 * ReviewItemCard - A single review item in the queue.
 */

import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ReviewActions } from "./ReviewActions";
import type { ReviewItem } from "@/services/types";

export interface ReviewItemCardProps {
  item: ReviewItem;
  onResolve: (action: string, comment?: string) => void;
}

function typeVariant(type: string): { variant?: "soft" | "outline"; color?: "primary" } {
  switch (type) {
    case "approval":
      return { color: "primary" };
    case "clarification":
      return { variant: "soft" };
    case "review":
      return { variant: "outline" };
    default:
      return { variant: "outline" };
  }
}

export function ReviewItemCard({ item, onResolve }: ReviewItemCardProps) {
  return (
    <Card>
      <CardContent className="p-4 space-y-3">
        <div className="flex items-start justify-between gap-2">
          <h4 className="text-sm font-medium">{item.title}</h4>
          <Badge {...typeVariant(item.type)} className="text-[10px] shrink-0">
            {item.type}
          </Badge>
        </div>
        <p className="text-xs text-neutral-fg-subtle line-clamp-3">{item.summary}</p>
        <div className="flex items-center gap-2 text-[10px] text-neutral-fg-subtle font-mono">
          <span>{item.sessionId.slice(0, 12)}</span>
          <span className="opacity-30">|</span>
          <span>{new Date(item.createdAt).toLocaleTimeString()}</span>
        </div>
        <ReviewActions onResolve={onResolve} />
      </CardContent>
    </Card>
  );
}
