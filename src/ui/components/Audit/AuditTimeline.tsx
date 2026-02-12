/**
 * AuditTimeline - Vertical timeline of audit entries.
 */

import { ScrollArea } from '@/components/ui/scroll-area';
import { AuditEntryItem } from './AuditEntryItem';
import type { AuditEntry } from '@/services/types';

interface AuditTimelineProps {
  entries: AuditEntry[];
}

export function AuditTimeline({ entries }: AuditTimelineProps) {
  if (entries.length === 0) {
    return (
      <p className="text-sm text-muted-foreground text-center py-8">No audit entries</p>
    );
  }

  return (
    <ScrollArea className="h-full">
      <div className="space-y-0.5">
        {entries.map((entry) => (
          <AuditEntryItem key={entry.id} entry={entry} />
        ))}
      </div>
    </ScrollArea>
  );
}
