/**
 * AuditEntryItem - Individual audit entry with type-specific formatting.
 */

import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { ChevronDown, ChevronRight } from 'lucide-react';
import type { AuditEntry } from '@/services/types';

interface AuditEntryItemProps {
  entry: AuditEntry;
}

function typeVariant(type: string): { variant?: 'soft' | 'outline'; color?: 'primary' | 'danger' } {
  switch (type) {
    case 'state_change': return { color: 'primary' };
    case 'tool_use': return { variant: 'soft' };
    case 'review_decision': return { color: 'danger' };
    case 'agent_spawn': return { variant: 'outline' };
    default: return { variant: 'outline' };
  }
}

function ExpandIcon({ hasData, expanded }: { hasData: boolean; expanded: boolean }) {
  if (!hasData) return <span className="w-3 shrink-0" />;
  if (expanded) return <ChevronDown className="h-3 w-3 shrink-0" />;
  return <ChevronRight className="h-3 w-3 shrink-0" />;
}

export function AuditEntryItem({ entry }: AuditEntryItemProps) {
  const [expanded, setExpanded] = useState(false);
  const hasData = Object.keys(entry.data).length > 0;

  return (
    <Collapsible open={expanded} onOpenChange={setExpanded}>
      <CollapsibleTrigger className="w-full flex items-center gap-3 text-xs p-2 hover:bg-neutral-bg-dim rounded transition-colors text-left">
        <ExpandIcon hasData={hasData} expanded={expanded} />
        <span className="font-mono text-neutral-fg-subtle w-20 shrink-0">
          {new Date(entry.timestamp).toLocaleTimeString()}
        </span>
        <Badge {...typeVariant(entry.type)} className="text-[10px] shrink-0">
          {entry.type.replace('_', ' ')}
        </Badge>
        <span className="text-neutral-fg-subtle truncate flex-1">{entry.description}</span>
        <code className="text-[10px] text-neutral-fg-subtle shrink-0">{entry.sessionId.slice(0, 8)}</code>
      </CollapsibleTrigger>
      {hasData && (
        <CollapsibleContent className="ml-9 mt-1 mb-2">
          <pre className="text-[11px] font-mono bg-neutral-bg-dim p-2 rounded overflow-x-auto max-h-40">
            {JSON.stringify(entry.data, null, 2)}
          </pre>
        </CollapsibleContent>
      )}
    </Collapsible>
  );
}
