/**
 * WorkspaceAuditView - Workspace-level audit log.
 * Shows all audit entries with type filtering.
 */

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTRPC } from '@bridge/react';
import { useWorkspaceStore } from '@ui/stores/useWorkspaceStore';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { ScrollArea } from '@/components/ui/scroll-area';
import { History } from 'lucide-react';
import { AuditEntryItem } from './AuditEntryItem';
import type { AuditEntry, AuditEntryType } from '@services/types';

const AUDIT_TYPES: Array<{ value: string; label: string }> = [
  { value: 'all', label: 'All types' },
  { value: 'state_change', label: 'State Changes' },
  { value: 'tool_use', label: 'Tool Use' },
  { value: 'review_decision', label: 'Review Decisions' },
  { value: 'agent_spawn', label: 'Agent Spawns' },
  { value: 'worktree_action', label: 'Worktree Actions' },
];

export function WorkspaceAuditView() {
  const trpc = useTRPC();
  const workspaceId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const [typeFilter, setTypeFilter] = useState('all');

  const { data: entries = [], isLoading } = useQuery(
    trpc.audit.workspace.queryOptions(
      {
        workspaceId: workspaceId!,
        type: typeFilter !== 'all' ? (typeFilter as AuditEntryType) : undefined,
        limit: 200,
      },
      { enabled: !!workspaceId },
    ),
  );

  if (!workspaceId) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center text-muted-foreground gap-2 p-6">
        <History className="h-8 w-8" />
        <p className="text-sm">Select a workspace to view audit log</p>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden p-6">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">Audit Log</h2>
          <p className="text-xs text-muted-foreground">
            {entries.length} entries
          </p>
        </div>
        <Select value={typeFilter} onValueChange={setTypeFilter}>
          <SelectTrigger className="w-48 h-9">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {AUDIT_TYPES.map((t) => (
              <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {isLoading ? (
        <p className="text-sm text-muted-foreground text-center py-12">Loading...</p>
      ) : entries.length > 0 ? (
        <ScrollArea className="flex-1">
          <div className="space-y-0.5 max-w-3xl">
            {(entries as AuditEntry[]).map((entry) => (
              <AuditEntryItem key={entry.id} entry={entry} />
            ))}
          </div>
        </ScrollArea>
      ) : (
        <div className="text-center py-12">
          <History className="h-8 w-8 mx-auto mb-3 text-muted-foreground" />
          <p className="text-sm font-medium">No audit entries</p>
          <p className="text-xs text-muted-foreground mt-1">
            Agent activity will appear here
          </p>
        </div>
      )}
    </div>
  );
}
