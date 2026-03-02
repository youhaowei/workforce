/**
 * AgentActions - Actions tab showing tool calls and file modifications from audit entries.
 */

import { useQuery } from '@tanstack/react-query';
import { useTRPC } from '@/bridge/react';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { Wrench, FileText } from 'lucide-react';
import type { AuditEntry } from '@/services/types';

interface AgentActionsProps {
  sessionId: string;
  orgId: string;
}

export function AgentActions({ sessionId, orgId }: AgentActionsProps) {
  const trpc = useTRPC();

  const { data: entries = [] } = useQuery(
    trpc.audit.session.queryOptions(
      { sessionId, orgId },
    ),
  );

  const toolUseEntries = (entries as AuditEntry[]).filter((e) => e.type === 'tool_use');
  const fileEntries = toolUseEntries.filter(
    (e) => e.data?.toolName === 'write' || e.data?.toolName === 'edit',
  );

  return (
    <ScrollArea className="h-full">
      <div className="space-y-6 max-w-2xl pb-4">
        {/* Tool Calls */}
        <div>
          <h3 className="text-sm font-medium mb-2 flex items-center gap-1.5">
            <Wrench className="h-3.5 w-3.5" />
            Tool Calls ({toolUseEntries.length})
          </h3>
          {toolUseEntries.length > 0 ? (
            <div className="space-y-1">
              {toolUseEntries.map((entry) => (
                <div key={entry.id} className="flex items-center gap-3 text-xs p-2 hover:bg-neutral-bg-dim rounded">
                  <span className="font-mono text-neutral-fg-subtle w-20 shrink-0">
                    {new Date(entry.timestamp).toLocaleTimeString()}
                  </span>
                  <Badge variant="soft" className="text-[10px] font-mono shrink-0">
                    {(entry.data?.toolName as string) ?? 'unknown'}
                  </Badge>
                  <span className="text-neutral-fg-subtle truncate">{entry.description}</span>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-xs text-neutral-fg-subtle">No tool calls recorded</p>
          )}
        </div>

        {/* Files Modified */}
        {fileEntries.length > 0 && (
          <div>
            <h3 className="text-sm font-medium mb-2 flex items-center gap-1.5">
              <FileText className="h-3.5 w-3.5" />
              Files Modified ({fileEntries.length})
            </h3>
            <div className="space-y-1">
              {fileEntries.map((entry) => (
                <div key={entry.id} className="flex items-center gap-3 text-xs p-2 bg-neutral-bg-dim rounded">
                  <span className="font-mono text-neutral-fg-subtle w-20 shrink-0">
                    {new Date(entry.timestamp).toLocaleTimeString()}
                  </span>
                  <code className="text-[10px] truncate">
                    {(entry.data?.filePath as string) ?? entry.description}
                  </code>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </ScrollArea>
  );
}
