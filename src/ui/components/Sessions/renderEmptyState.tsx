/* eslint-disable react-refresh/only-export-components */
import React from "react";
import { Search, Plus, SlidersHorizontal, MessageSquare } from "lucide-react";
import { Button } from "@/components/ui/button";

function EmptyState({
  icon,
  heading,
  subtext,
  action,
}: {
  icon: React.ReactNode;
  heading: string;
  subtext: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-10 text-center">
      <div className="h-10 w-10 rounded-full bg-neutral-bg-dim flex items-center justify-center mb-3">
        {icon}
      </div>
      <p className="text-sm font-medium mb-1">{heading}</p>
      <p className="text-xs text-neutral-fg-subtle mb-4">{subtext}</p>
      {action}
    </div>
  );
}

export function renderEmptyState(
  filteredCount: number,
  totalCount: number,
  query: string,
  onCreate?: () => void,
): React.ReactNode {
  if (filteredCount > 0) return null;

  if (query) {
    return (
      <EmptyState
        icon={<Search className="h-5 w-5 text-neutral-fg-subtle" />}
        heading="No results"
        subtext={`No sessions match "${query}"`}
      />
    );
  }

  if (totalCount > 0) {
    return (
      <EmptyState
        icon={<SlidersHorizontal className="h-5 w-5 text-neutral-fg-subtle" />}
        heading="No matching sessions"
        subtext="Try adjusting your filters"
      />
    );
  }

  return (
    <EmptyState
      icon={<MessageSquare className="h-5 w-5 text-neutral-fg-subtle" />}
      heading="No sessions yet"
      subtext="Start a conversation to begin"
      action={
        onCreate ? (
          <Button variant="outline" size="sm" onClick={onCreate}>
            <Plus className="h-3.5 w-3.5 mr-1.5" />
            New session
          </Button>
        ) : undefined
      }
    />
  );
}
