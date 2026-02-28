/**
 * ToolActivityTrace — Expandable trace of tools used during a message.
 *
 * Shows a compact summary ("using Read" / "used 5 tools") with an expandable
 * list of every tool invocation and its human-readable input summary.
 */

import { useState } from 'react';
import { ChevronRight } from 'lucide-react';
import type { ToolActivity } from '@/services/types';

interface ToolActivityTraceProps {
  activities: ToolActivity[];
  currentTool: string | null;
  isStreaming: boolean;
}

export default function ToolActivityTrace({ activities, currentTool, isStreaming }: ToolActivityTraceProps) {
  const [expanded, setExpanded] = useState(false);
  const hasActivities = activities.length > 0;

  function getLabel() {
    if (currentTool) return `using ${currentTool}`;
    if (hasActivities) return `used ${activities.length} tool${activities.length === 1 ? '' : 's'}`;
    return 'thinking';
  }
  const label = getLabel();

  return (
    <div className="flex flex-col text-xs">
      <button
        type="button"
        onClick={() => hasActivities && setExpanded(!expanded)}
        className={`flex items-center gap-1.5 ${hasActivities ? 'cursor-pointer hover:text-foreground' : 'cursor-default'}`}
      >
        {isStreaming && (
          <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse flex-shrink-0" />
        )}
        <span className="text-muted-foreground">{label}</span>
        {hasActivities && (
          <ChevronRight
            className={`h-3 w-3 text-muted-foreground transition-transform ${expanded ? 'rotate-90' : ''}`}
          />
        )}
      </button>
      {expanded && (
        <ul className="ml-3 mt-1 space-y-0.5 border-l border-border pl-2">
          {activities.map((a, i) => (
            <li key={i} className="flex gap-1.5 text-muted-foreground">
              <span className="font-medium flex-shrink-0">{a.name}</span>
              <span className="opacity-60 truncate">{a.input}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
