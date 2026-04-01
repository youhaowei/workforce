/**
 * ReviewActions - Action buttons for resolving a review item.
 */

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Check, X, MoreHorizontal, Pencil, HelpCircle } from "lucide-react";

export interface ReviewActionsProps {
  onResolve: (action: string, comment?: string) => void;
}

export function ReviewActions({ onResolve }: ReviewActionsProps) {
  const [comment, setComment] = useState("");
  const [expanded, setExpanded] = useState(false);

  function resolve(action: string) {
    onResolve(action, comment || undefined);
    setComment("");
    setExpanded(false);
  }

  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <Button size="sm" onClick={() => resolve("approve")}>
          <Check className="h-3 w-3 mr-1" />
          Approve
        </Button>
        <Button variant="solid" color="danger" size="sm" onClick={() => resolve("reject")}>
          <X className="h-3 w-3 mr-1" />
          Reject
        </Button>
        <Button variant="outline" size="sm" onClick={() => setExpanded(!expanded)}>
          <MoreHorizontal className="h-3 w-3 mr-1" />
          More
        </Button>
      </div>
      {expanded && (
        <div className="space-y-2">
          <Textarea
            className="text-xs resize-none"
            rows={2}
            placeholder="Add a comment..."
            value={comment}
            onChange={(e) => setComment(e.target.value)}
          />
          <div className="flex gap-2">
            <Button variant="soft" size="sm" onClick={() => resolve("edit")}>
              <Pencil className="h-3 w-3 mr-1" />
              Edit & Resume
            </Button>
            <Button variant="outline" size="sm" onClick={() => resolve("clarify")}>
              <HelpCircle className="h-3 w-3 mr-1" />
              Clarify
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
